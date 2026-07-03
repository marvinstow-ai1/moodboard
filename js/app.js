import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://uvfuxnwinuakbqanaxtp.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2ZnV4bndpbnVha2JxYW5heHRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxNzg3MDIsImV4cCI6MjA5NTc1NDcwMn0.quSvaycB3Yk2JXCnQz7AQmHpyATtx6u0U8aGQXD73fo';
const BUCKET = 'moodboard';
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
let owner = false;

const DEFAULT_MOODS = ['All','Summer','Winter','Cozy','Dark'];
function loadMoodsList(){
  try{
    const v = JSON.parse(localStorage.getItem('mb_moods_list')||'null');
    if(Array.isArray(v) && v.length && v[0]==='All') return v;
  }catch(e){}
  return [...DEFAULT_MOODS];
}
function saveMoodsList(){
  try{ localStorage.setItem('mb_moods_list', JSON.stringify(state.moodboard.moods)); }catch(e){}
}

const state = {
  moodboard: { items:[], currentItems:[], moods: loadMoodsList(), currentMood: localStorage.getItem('mb_mood')||'All', table:'moodboard_items' }
};
let currentPage = 'moodboard';
const S = () => state[currentPage];

let editId=null, lbIndex=0, lbOpenIndex=0, selMode=null, lbIsMuted=false;
let selectedIds=new Set();
let _observer = null;
let sortNewest = false;
let chatResultIds = null;   // Mood-Chat: aktive Treffer-IDs (oder null = aus)
let _isInitialLoad = true;
// Solange der Loading Screen sichtbar ist: mehr Bilder eager vorladen und
// den Eingangs-Tween aufschieben (das Grid ist ja noch komplett verdeckt).
let _bootPending = true;
// So viele Bilder lädt der Loading Screen vor, bevor er sich ausblendet.
const BOOT_EAGER_COUNT = 40;
// So viele Boot-Bilder laden gleichzeitig. Kleiner Pool statt "alle 40 auf
// einmal": die ersten Kacheln werden schnell fertig, statt dass sich alle
// Downloads die Bandbreite teilen.
const BOOT_CONCURRENCY = 8;

// ── Nachladen im Instagram-Stil ───────────────────────────
// Alle Nicht-Boot-Bilder laufen durch EINE Batch-Warteschlange (max.
// LAZY_CONCURRENCY parallel). Gefüllt wird sie vom Prefetch-Observer in
// renderGrid: Kacheln melden sich 2–3 Viewports BEVOR sie sichtbar werden,
// sodass ein Bild beim Hinscrollen in der Regel schon fertig geladen ist.
const LAZY_CONCURRENCY = 8;
let _lazyObserver = null;
let _imgQueue = [];
let _imgActive = 0;
function pumpImgQueue(){
  // Während des Boots pausieren, damit der Prefetch dem Loading Screen
  // nicht die Bandbreite stiehlt – revealWhenReady() pumpt danach an.
  if(_bootPending) return;
  while(_imgActive < LAZY_CONCURRENCY && _imgQueue.length){
    const im = _imgQueue.shift();
    if(!im.isConnected) continue;
    const done = () => { _imgActive = Math.max(0, _imgActive - 1); pumpImgQueue(); };
    if(!im.dataset.src) continue;
    _imgActive++;
    im.addEventListener('load', done, { once:true });
    im.addEventListener('error', done, { once:true });
    im.src = im.dataset.src;
    im.removeAttribute('data-src');
  }
}
let sleepTimeout = null;
let slideshowActive = false;

const $ = id => document.getElementById(id);

// ── AUTH ─────────────────────────────────────────────────
let hasSession = false;

function updateAdminUI() {
  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = owner ? '' : 'none';
  });
  const btn = $('loginBtn');
  if (btn) btn.classList.toggle('is-owner', owner);
  // Der Hub-Menüpunkt "Login" wirkt für Eingeloggte als Abmelden.
  const label = $('hubLoginLabel');
  if (label) label.textContent = hasSession ? 'Abmelden' : 'Login';
}

function isOwnerSession(session) {
  return !!(session && session.user.app_metadata?.role === 'owner');
}

// ── GATE (Startpage mit Zugriffs-Anfrage) ────────────────
// Ohne gültige Session steht das Gate (html.gate-open, gesetzt vom
// Inline-Script in index.html) vor der App. Freunde tragen Name + E-Mail
// ein; alles Weitere (Anfrage anlegen, Freigabe prüfen, Session bauen)
// erledigt die Edge Function "gate" serverseitig. Erst wenn der Zugriff
// steht, wird die App überhaupt gestartet (startApp unten).
const GATE_MSG = {
  checking:  ['PRÜFE ZUGANG…', ''],
  requested: ['ANFRAGE GESENDET. MARVIN MUSS DICH FREIGEBEN – SCHAU SPÄTER NOCHMAL VORBEI.', 'warn'],
  pending:   ['DEINE ANFRAGE WARTET NOCH AUF FREIGABE.', 'warn'],
  blocked:   ['KEIN ZUGRIFF.', 'err'],
  mismatch:  ['NAME PASST NICHT ZU DIESER E-MAIL.', 'err'],
  invalid:   ['BITTE NAME UND E-MAIL EINTRAGEN.', 'err'],
  error:     ['FEHLER. VERSUCH ES GLEICH NOCHMAL.', 'err'],
  welcome:   ['WILLKOMMEN ✓', 'ok'],
};

function gateStatus(key) {
  const el = $('gateStatus');
  if (!el) return;
  const [text, cls] = GATE_MSG[key] || ['', ''];
  el.textContent = text;
  el.className = 'gate-status' + (cls ? ' ' + cls : '');
}

function showGate(msgKey) {
  document.documentElement.classList.add('gate-open');
  initGateSwiper();
  try {
    $('gateName').value  = localStorage.getItem('mb_gate_name')  || '';
    $('gateEmail').value = localStorage.getItem('mb_gate_email') || '';
  } catch (e) {}
  if (msgKey) gateStatus(msgKey);
}

// ── Gate-Swiper: zwei fließende Bild-Reihen hinter dem Login ────────
// Die Auswahl kommt aus der öffentlichen RPC gate_teaser (SECURITY
// DEFINER, db/gate_teaser.sql): ohne Session ist die Items-Tabelle per
// RLS gesperrt, fürs Gate gibt die Funktion aber eine zufällige
// Mini-Auswahl der Medien-URLs frei (keine Titel/Moods/Tags, keine
// echten Videos). GIF-Clips laufen stumm in Dauerschleife, Bilder
// nutzen ihr Grid-Thumbnail. Schlägt der Abruf fehl, bleibt das Gate
// einfach ohne Swiper voll funktionsfähig.
let _gateSwiperDone = false;
const GATE_ROW_TILES = 10;   // Kacheln pro Reihe (vor der Loop-Verdopplung)

// Der Teaser-Abruf startet sofort beim Laden des Moduls, parallel zum
// Session-Check in initGate – das Inline-Script in index.html hat
// html.gate-open ja schon synchron gesetzt. So sind die URLs meist schon
// da, wenn showGate() die Kacheln baut, und die Bilder stehen innerhalb
// der ersten Sekunde. (Promise.resolve stößt den thenable Query-Builder
// von supabase-js an; ohne .then() würde er gar nicht erst anfragen.)
const _gateTeaserFetch = document.documentElement.classList.contains('gate-open')
  ? Promise.resolve(sb.rpc('gate_teaser', { n: GATE_ROW_TILES * 2 })).catch(() => null)
  : null;

// Medium erst weich einblenden, wenn es wirklich anzeigbar ist
// (.ready → Opacity-Transition in gate.css).
function gateTileReady(el, event) {
  el.addEventListener(event, () => el.classList.add('ready'), { once: true });
}

function gateTile(it) {
  const tile = document.createElement('div');
  tile.className = 'gate-tile';
  if (isClip(it)) {
    const v = document.createElement('video');
    v.muted = true; v.loop = true; v.autoplay = true;
    v.playsInline = true; v.preload = 'auto';
    v.setAttribute('muted', '');   // iOS erlaubt Autoplay nur mit Attribut
    gateTileReady(v, 'loadeddata');
    v.src = it.media_url;
    const p = v.play(); if (p && p.catch) p.catch(() => {});
    tile.appendChild(v);
  } else {
    const im = document.createElement('img');
    im.alt = ''; im.decoding = 'async';
    gateTileReady(im, 'load');
    im.src = it.thumb_url || it.media_url;
    if (im.complete) im.classList.add('ready');   // war schon im Cache
    tile.appendChild(im);
  }
  return tile;
}

function fillGateTrack(track, items) {
  if (!track || !items.length) return;
  // Reihe auf Mindestlänge auffüllen (bei kleinen Boards zyklisch
  // wiederholen) und für die nahtlose Schleife verdoppeln – die
  // Marquee-Animation (gate.css) läuft exakt eine Hälfte weit.
  const set = [];
  while (set.length < GATE_ROW_TILES) set.push(...items);
  set.length = GATE_ROW_TILES;
  [...set, ...set].forEach(it => track.appendChild(gateTile(it)));
  track.classList.add('run');
}

async function initGateSwiper() {
  if (_gateSwiperDone) return;
  _gateSwiperDone = true;
  const a = $('gateTrackA'), b = $('gateTrackB');
  if (!a || !b) return;
  try {
    // Vorgezogenen Abruf nutzen, falls er beim Modul-Load gestartet wurde;
    // sonst (z. B. Gate erst nach abgelaufener Session) jetzt anfragen.
    const res = await (_gateTeaserFetch ?? sb.rpc('gate_teaser', { n: GATE_ROW_TILES * 2 }));
    if (!res) return;
    const { data, error } = res;
    if (error || !Array.isArray(data) || !data.length) return;
    const second = data.slice(GATE_ROW_TILES);
    fillGateTrack(a, data.slice(0, GATE_ROW_TILES));
    fillGateTrack(b, second.length ? second : data);
  } catch (e) { /* Swiper ist reine Deko – Fehler bewusst schlucken */ }
}

// Gate ausblenden. `animated` = Übergang Gate → Loading Screen nach einem
// frischen Login; ohne Animation wird nur aufgeräumt (Session war schon da).
function closeGate(animated) {
  const g = $('gate');
  const open = document.documentElement.classList.contains('gate-open');
  if (open && animated && g) {
    g.style.display = 'flex';              // übersteht das Entfernen von .gate-open
    document.documentElement.classList.remove('gate-open');
    window.MB?.startBootProgress?.();      // Loading Screen übernimmt darunter
    requestAnimationFrame(() => g.classList.add('hide'));
    setTimeout(() => g.remove(), 500);
    window.dispatchEvent(new Event('mb:gate-passed'));  // z. B. für die Walkthrough-Tour
    return;
  }
  document.documentElement.classList.remove('gate-open');
  g?.remove();
}

// Prüft die vorhandene Session und entscheidet Gate vs. App-Start.
// Rückgabe true = Zugriff ok, App darf booten.
async function initGate() {
  const { data: { session } } = await sb.auth.getSession();
  owner = isOwnerSession(session);
  hasSession = !!session;
  updateAdminUI();
  sb.auth.onAuthStateChange((_e, s) => {
    owner = isOwnerSession(s);
    hasSession = !!s;
    updateAdminUI();
  });
  if (session) {
    if (owner) { closeGate(false); return true; }
    // Freund: serverseitig prüfen, ob die Freigabe noch besteht
    // (könnte inzwischen gesperrt worden sein).
    const { data: ok, error } = await sb.rpc('gate_ok');
    if (!error && ok === true) { closeGate(false); return true; }
    if (!error) {
      await sb.auth.signOut();
      showGate('blocked');
      return false;
    }
    // Netzfehler beim Check: lieber die App versuchen als fälschlich aussperren.
    closeGate(false); return true;
  }
  showGate();
  return false;
}

async function gateFriendLogin(email, name) {
  const submit = $('gateSubmit');
  submit.disabled = true;
  gateStatus('checking');
  try {
    const { data, error } = await sb.functions.invoke('gate', {
      body: { action: 'login', email, name },
    });
    if (error || !data) { gateStatus('error'); return; }
    switch (data.status) {
      case 'ok': {
        const { error: e2 } = await sb.auth.setSession(data.session);
        if (e2) { gateStatus('error'); return; }
        try {
          localStorage.setItem('mb_gate_name', name);
          localStorage.setItem('mb_gate_email', email);
        } catch (e) {}
        gateStatus('welcome');
        closeGate(true);
        startApp();
        return;
      }
      case 'unknown': {
        // Noch keine Anfrage zu dieser E-Mail: direkt eine anlegen.
        const { data: r, error: e3 } = await sb.functions.invoke('gate', {
          body: { action: 'request', email, name },
        });
        if (e3 || !r) { gateStatus('error'); return; }
        try {
          localStorage.setItem('mb_gate_name', name);
          localStorage.setItem('mb_gate_email', email);
        } catch (e) {}
        gateStatus(r.status === 'blocked' ? 'blocked' : 'requested');
        return;
      }
      case 'pending':       gateStatus('pending');  return;
      case 'blocked':       gateStatus('blocked');  return;
      case 'name_mismatch': gateStatus('mismatch'); return;
      default:              gateStatus('error');    return;
    }
  } catch (e) {
    gateStatus('error');
  } finally {
    submit.disabled = false;
  }
}

async function gateOwnerLogin(email, password) {
  const submit = $('gateSubmit');
  submit.disabled = true;
  gateStatus('checking');
  const { error } = await sb.auth.signInWithPassword({ email, password });
  submit.disabled = false;
  if (error) { gateStatus('error'); return; }
  gateStatus('welcome');
  closeGate(true);
  startApp();
}

function initGateUI() {
  const gate = $('gate');
  if (!gate) return;
  $('gateForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = ($('gateEmail')?.value || '').trim().toLowerCase();
    if (gate.dataset.mode === 'owner') {
      const pw = $('gatePassword')?.value || '';
      if (!email || !pw) { gateStatus('invalid'); return; }
      gateOwnerLogin(email, pw);
      return;
    }
    const name = ($('gateName')?.value || '').trim().replace(/\s+/g, ' ');
    if (!email || name.length < 2) { gateStatus('invalid'); return; }
    gateFriendLogin(email, name);
  });
  $('gateOwnerLink')?.addEventListener('click', () => {
    const ownerMode = gate.dataset.mode === 'owner';
    if (ownerMode) delete gate.dataset.mode; else gate.dataset.mode = 'owner';
    $('gateOwnerLink').textContent = ownerMode ? 'Owner-Login' : 'Zurück zum normalen Login';
    gateStatus('');
  });
  // Nutzungshinweise (runder i-Button)
  const pop = $('gateInfoPopup');
  $('gateInfoBtn')?.addEventListener('click', () => pop.classList.add('show'));
  $('gateInfoClose')?.addEventListener('click', () => pop.classList.remove('show'));
  pop?.addEventListener('click', (e) => { if (e.target === pop) pop.classList.remove('show'); });
}

function openLoginModal() {
  $('loginModal').classList.add('show');
  setTimeout(() => $('loginEmail')?.focus(), 60);
}
function closeLoginModal() {
  $('loginModal').classList.remove('show');
  if ($('loginPassword')) $('loginPassword').value = '';
}

async function handleLoginBtn() {
  if (hasSession) {
    // Abmelden (Owner wie Freund) – danach steht wieder das Gate.
    await sb.auth.signOut();
    location.reload();
    return;
  }
  openLoginModal();
}

async function submitLogin() {
  const email = ($('loginEmail')?.value || '').trim().toLowerCase();
  const password = $('loginPassword')?.value || '';
  if (!email || !password) { toast('Bitte E-Mail und Passwort eingeben'); return; }
  const btn = $('loginSubmit');
  btn.disabled = true; btn.textContent = 'Wird geprüft…';
  const { error } = await sb.auth.signInWithPassword({ email, password });
  btn.disabled = false; btn.textContent = 'Einloggen';
  if (error) {
    const msg = /invalid login credentials/i.test(error.message || '')
      ? 'Falsche E-Mail oder falsches Passwort'
      : 'Login fehlgeschlagen: ' + (error.message || 'unbekannter Fehler');
    toast(msg);
    return;
  }
  closeLoginModal();
  toast('Eingeloggt ✓');
}

// ── DOM refs ────────────────────────────────────────────
const gridEl         = $('grid');
const gridWrap       = $('gridWrap');
const gridEnd        = $('gridEnd');
const gridEndText    = $('gridEndText');
const dropdown       = $('dropdown');
const bottomSheet    = $('bottomSheet');
const sheetOverlay   = $('sheetOverlay');
const lightbox       = $('lightbox');
const lbInner        = $('lbInner');
const fileInput      = $('fileInput');
const progressBar    = $('progress');
const toastEl        = $('toast');
const editorWrap     = $('editorWrap');
const actionBar      = $('actionBar');
const actionBarMoods = $('actionBarMoods');
const actionBarCount = $('actionBarCount');
const actionBarTitle = $('actionBarTitle');
const lbAmbient      = $('lbAmbient');
const MAX_PX         = 1920;
const THUMB_PX       = 600;   // Kantenlänge der Grid-Thumbnails

// ── Share Link (deep link to a single item) ─────────────
function buildShareUrl(it){
  return `${location.origin}${location.pathname}#mb=${encodeURIComponent(it.id)}`;
}
async function copyText(text){
  try { await navigator.clipboard.writeText(text); return true; }
  catch(e){
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position='fixed'; ta.style.opacity='0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove();
      return true;
    } catch(e2){ return false; }
  }
}
function parseShareHash(){
  const m = (location.hash || '').slice(1).match(/^mb=(.+)$/);
  if(!m) return null;
  return { id: decodeURIComponent(m[1]) };
}
let pendingShare = parseShareHash();
function tryOpenPendingShare(){
  if(!pendingShare) return;
  const it = S().items.find(x => x.id === pendingShare.id);
  if(!it){ if(S().items.length){ pendingShare = null; toast('Geteiltes Item nicht gefunden'); } return; }
  let idx = S().currentItems.findIndex(x => x.id === pendingShare.id);
  if(idx < 0){ S().currentItems = [it, ...S().currentItems]; idx = 0; }
  pendingShare = null;
  openLightbox(idx);
}
window.addEventListener('hashchange', () => {
  const p = parseShareHash();
  if(p){ pendingShare = p; tryOpenPendingShare(); }
});

// ── Ambient Mode (lightbox background glow) ─────────────
// Der Hintergrund spiegelt das aktuelle Medium wider: eine stark
// vergrößerte, unscharfe & gesättigte Kopie des Bildes/Videos sorgt für
// kräftige Farben rund um das scharfe Motiv ("knallig" außen, scharf
// innen). Es wird KEIN Canvas mehr ausgelesen – dadurch entfällt der
// CORS-/Taint-Fehler, der bisher fast immer auf die lila Default-Farbe
// zurückfiel. Zwei Ebenen werden weich überblendet, damit beim Blättern
// nichts flackert.
const AMBIENT_FALLBACK =
  'radial-gradient(45% 55% at 28% 30%, rgba(90,100,150,.55), transparent 70%),'+
  'radial-gradient(45% 55% at 72% 70%, rgba(150,80,130,.5), transparent 70%)';

let ambientLayers = null;
let ambientActive = 0;
let ambientToken  = 0;

function ensureAmbientLayers(){
  if(ambientLayers) return ambientLayers;
  const a = document.createElement('div');
  const b = document.createElement('div');
  a.className = b.className = 'lb-ambient-layer';
  lbAmbient.append(a, b);
  ambientLayers = [a, b];
  return ambientLayers;
}

// Blendet auf die inaktive Ebene über und räumt die alte danach auf.
function ambientSwap(fill){
  const layers = ensureAmbientLayers();
  const curr = layers[ambientActive];
  const next = layers[ambientActive ^ 1];
  next.innerHTML = '';
  next.style.backgroundImage = '';
  fill(next);
  next.classList.add('active');
  curr.classList.remove('active');
  ambientActive ^= 1;
  setTimeout(() => {
    if(!curr.classList.contains('active')){
      curr.querySelectorAll('video').forEach(v => { try{ v.pause(); }catch(e){} v.removeAttribute('src'); v.load(); });
      curr.innerHTML = '';
      curr.style.backgroundImage = '';
    }
  }, 700);
}

function setAmbientFor(it){
  const token = ++ambientToken;
  lbAmbient.style.opacity = '';
  // Clips (Videos & konvertierte GIFs) als Ambient-Video – openLightbox ruft
  // setAmbientFor für Clips erst auf, wenn das Hauptvideo abspielbereit ist,
  // die Datei kommt hier also praktisch komplett aus dem Browser-Cache.
  if(isClip(it)){
    ambientSwap(layer => {
      const v = document.createElement('video');
      v.src = it.media_url; v.muted = true; v.loop = true;
      v.autoplay = true; v.playsInline = true; v.preload = 'auto';
      const p = v.play(); if(p && p.catch) p.catch(() => {});
      layer.appendChild(v);
    });
    return;
  }
  // Für den (ohnehin stark unscharfen) Hintergrund reicht das kleine
  // Thumbnail völlig aus – es ist meist schon aus dem Grid gecached, startet
  // also sofort und spart das Dekodieren der Volldatei. Nur falls kein
  // Thumbnail existiert, auf die Volldatei zurückfallen.
  const ambSrc = it.thumb_url || it.media_url;
  const pre = new Image();
  pre.onload = () => {
    if(token !== ambientToken || !lightbox.classList.contains('show')) return;
    ambientSwap(layer => { layer.style.backgroundImage = `url("${ambSrc}")`; });
  };
  pre.onerror = () => {
    if(token !== ambientToken) return;
    ambientSwap(layer => { layer.style.backgroundImage = AMBIENT_FALLBACK; });
  };
  pre.src = ambSrc;
}

// ── Mood Icon Map (Platzhalter – später anpassen) ────────
const MOOD_ICONS = {
  'All':    '🎞️',
  'Summer': '☀️',
  'Winter': '❄️',
  'Cozy':   '🕯️',
  'Dark':   '🌑',
  'Work':   '💼',
  'Family': '🏠',
  'Travel': '✈️',
  'Misc':   '🏷️',
};
function moodIcon(m){ return MOOD_ICONS[m] || '🏷️'; }

// ── Active Filter State ────────────────────────────────────
let activeMoods = new Set(JSON.parse(localStorage.getItem('active_moods')||'[]'));

// ── Grid Column Swipe Control ──────────────────────────────
function getColRange(){
  return window.innerWidth <= 600
    ? { min: 1, max: 5 }
    : { min: 3, max: 10 };
}
function getDefaultCols(){
  const r = getColRange();
  return Math.round((r.min + r.max) / 2);
}

let gridCols = (() => {
  const saved = localStorage.getItem('grid_cols');
  if(saved !== null){ const v = parseInt(saved); if(v >= getColRange().min && v <= getColRange().max) return v; }
  return getDefaultCols();
})();

function saveFilterState(){
  localStorage.setItem('active_moods', JSON.stringify([...activeMoods]));
  localStorage.setItem('grid_cols', String(gridCols));
}

// ── Autoplay-Killswitch (GIFs & Videos im Grid) ────────────
// Pro-Browser-Schalter: steuert nur, ob animierte Medien IM GRID autoplayen.
// Bewusst in localStorage (nicht in der DB), damit jeder Besucher das für sich
// allein entscheidet – schaltet einer aus, läuft es bei allen anderen weiter.
// Standard: an (autoplay).
let autoplayMedia = localStorage.getItem('autoplay_media') !== '0';

function elementInViewport(el){
  const r = el.getBoundingClientRect();
  const vh = window.innerHeight || document.documentElement.clientHeight;
  const vw = window.innerWidth || document.documentElement.clientWidth;
  return r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
}

// Friert ein animiertes GIF ein, indem der aktuelle Frame auf ein Canvas
// gezeichnet und über das <img> gelegt wird (das <img> wird ausgeblendet, damit
// die Animation stoppt). Bewusst KEIN toDataURL – das würde bei Cross-Origin-
// Storage-URLs am getainteten Canvas scheitern; das Canvas direkt anzeigen geht.
function freezeGif(img){
  if(img.dataset.frozen === '1') return;
  const capture = () => {
    if(autoplayMedia) return; // Schalter ist zwischenzeitlich wieder an
    const w = img.naturalWidth, h = img.naturalHeight;
    if(!w || !h) return;
    const cell = img.parentElement;
    if(!cell) return;
    let canvas = cell.querySelector('canvas.gif-frozen');
    if(!canvas){
      canvas = document.createElement('canvas');
      canvas.className = 'gif-frozen';
      img.insertAdjacentElement('afterend', canvas);
    }
    canvas.width = w; canvas.height = h;
    try { canvas.getContext('2d').drawImage(img, 0, 0, w, h); }
    catch(_){ canvas.remove(); return; }
    img.classList.add('gif-paused');
    img.dataset.frozen = '1';
  };
  if(img.complete && img.naturalWidth) capture();
  else img.addEventListener('load', capture, { once:true });
}

function unfreezeGif(img){
  const cell = img.parentElement;
  const canvas = cell && cell.querySelector('canvas.gif-frozen');
  if(canvas) canvas.remove();
  if(img.dataset.frozen === '1'){
    img.classList.remove('gif-paused');
    img.dataset.frozen = '0';
  }
}

// Wendet den aktuellen Schalter-Zustand auf bereits gerenderte Kacheln an.
// Ohne Argument werden Haupt-Grid und Moods-Ansicht behandelt.
function applyAutoplayState(root){
  const scopes = root
    ? [root]
    : [gridEl, document.getElementById('moodsGrid')].filter(Boolean);
  scopes.forEach(scope => {
    scope.querySelectorAll('img[data-gif="1"], .mood-tile img[src*=".gif"]').forEach(img => {
      if(autoplayMedia) unfreezeGif(img); else freezeGif(img);
    });
    scope.querySelectorAll('video').forEach(v => {
      if(autoplayMedia){
        if(elementInViewport(v)){ v.muted = true; v.play().catch(()=>{}); }
      } else {
        try { v.pause(); } catch(_){}
      }
    });
  });
}

function applyGridCols(cols){
  gridCols = cols;
  document.getElementById('grid').style.gridTemplateColumns =
    cols === 1 ? '1fr' : `repeat(${cols}, 1fr)`;
  updateSwipeUI();
  saveFilterState();
}

// ── Swipe Control DOM ──────────────────────────────────────
const swipeThumb = document.getElementById('swipeThumb');
const swipeTrack = document.getElementById('swipeTrack');
const swipeFill  = document.getElementById('swipeFill');
const swipeValue = document.getElementById('swipeValue');
const colDec     = document.getElementById('colDec');
const colInc     = document.getElementById('colInc');

function updateSwipeUI(){
  const r = getColRange();
  const pct = r.max > r.min ? ((gridCols - r.min) / (r.max - r.min)) * 100 : 50;
  swipeThumb.style.left = pct + '%';
  swipeFill.style.width = pct + '%';
  swipeValue.textContent = gridCols;
}

// ── Mouse / Touch Drag ─────────────────────────────────────
let _drag = false;

function startDrag(e){
  _drag = true;
  swipeThumb.classList.add('dragging');
  e.preventDefault();
}
function moveDrag(cx){
  if(!_drag) return;
  const rect = swipeTrack.getBoundingClientRect();
  let pct = (cx - rect.left) / rect.width;
  pct = Math.max(0, Math.min(1, pct));
  const r = getColRange();
  const cols = Math.round(r.min + pct * (r.max - r.min));
  if(cols !== gridCols) applyGridCols(cols);
}
function endDrag(){
  if(!_drag) return;
  _drag = false;
  swipeThumb.classList.remove('dragging');
}

// Touch
swipeThumb.addEventListener('touchstart', startDrag, { passive: false });
document.addEventListener('touchmove', e => { if(_drag) moveDrag(e.touches[0].clientX); }, { passive: true });
document.addEventListener('touchend', endDrag, { passive: true });
// Mouse
swipeThumb.addEventListener('mousedown', startDrag);
document.addEventListener('mousemove', e => { if(_drag) moveDrag(e.clientX); });
document.addEventListener('mouseup', endDrag);

// Click on track to jump
swipeTrack.addEventListener('click', e => {
  if(e.target === swipeThumb) return;
  moveDrag(e.clientX);
});

// Arrow buttons
colDec.onclick = () => {
  const r = getColRange();
  if(gridCols > r.min) applyGridCols(gridCols - 1);
};
colInc.onclick = () => {
  const r = getColRange();
  if(gridCols < r.max) applyGridCols(gridCols + 1);
};

// ── Autoplay-Toggle (im Kachelgröße-Popup) ─────────────────
const autoplayToggle = document.getElementById('autoplayToggle');
function syncAutoplayToggleUI(){
  if(!autoplayToggle) return;
  autoplayToggle.classList.toggle('on', autoplayMedia);
  autoplayToggle.setAttribute('aria-checked', autoplayMedia ? 'true' : 'false');
}
syncAutoplayToggleUI();
if(autoplayToggle){
  autoplayToggle.onclick = () => {
    autoplayMedia = !autoplayMedia;
    localStorage.setItem('autoplay_media', autoplayMedia ? '1' : '0');
    syncAutoplayToggleUI();
    applyAutoplayState();
  };
}



// ── Tabs (dropdown + bottom sheet) ───────────────────────
function bindTabs(rootId){
  const root = $(rootId); if(!root) return;
  const tabs = root.querySelectorAll('.dd-tab');
  const panels = root.querySelectorAll('.dd-panel');
  tabs.forEach(btn => btn.onclick = () => {
    const t = btn.dataset.tab;
    tabs.forEach(b => b.classList.toggle('active', b === btn));
    panels.forEach(p => p.classList.toggle('show', p.dataset.panel === t));
  });
}
bindTabs('dropdown'); bindTabs('bottomSheet');

// ── Quick-Add via URL ────────────────────────────────────
function bindQuickAdd(suffix){
  const g = k => $(k + (suffix||''));
  const btn = g('quickAddBtn'); const inp = g('quickAddUrl');
  if(!btn || !inp) return;
  const run = async () => {
    const url = inp.value.trim();
    if(!url) return;
    if(!/^https?:\/\//i.test(url)){ toast('Ungültige URL'); return; }
    const isVideo = /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url);
    const item = {
      title: ((url.split('/').pop()||'Link').split('?')[0] || 'Link').slice(0, 80),
      moods: [], tags: [],
      media_url: url,
      media_type: isVideo ? 'video' : 'image'
    };
    btn.disabled = true;
    const {data:ins, error} = await sb.from(S().table).insert(item).select().single();
    btn.disabled = false;
    if(error){ toast('Fehler: '+error.message); return; }
    S().items.unshift({...item, id: ins.id});
    inp.value = '';
    toast('Hinzugefügt ✓'); renderGrid(); closeMenu();
  };
  btn.onclick = run;
  inp.onkeydown = e => { if(e.key === 'Enter') run(); };
}
bindQuickAdd(''); bindQuickAdd('Sheet');

// ── View tab actions (delegate to existing controls) ─────
function bindView(suffix){
  const g = k => $(k + (suffix||''));
  const f = g('ddFilterBtn'); const s = g('ddShuffleBtn');
  if(f) f.onclick = () => {
    closeMenu();
    if(!filterPopup.classList.contains('show')) window.MB.closeOtherPopups?.('filter');
    filterPopup.classList.toggle('show');
  };
  if(s) s.onclick = () => { closeMenu(); doShuffle(); };
}
bindView(''); bindView('Sheet');

// ── Shared Logic (same as before) ─────────────────────────
function toast(t){
  toastEl.textContent=t;
  if(typeof gsap !== 'undefined'){
    gsap.killTweensOf(toastEl);
    // Zentrierung läuft rein über CSS (left/right:0 + margin:auto), darum animiert
    // GSAP hier nur opacity/y – der transform verschiebt nichts mehr horizontal.
    gsap.fromTo(toastEl,{opacity:0,y:10},{opacity:1,y:0,duration:0.22,ease:'power2.out'});
    clearTimeout(toast._t);
    toast._t=setTimeout(()=>gsap.to(toastEl,{opacity:0,y:10,duration:0.2,ease:'power2.in'}),1800);
  } else {
    toastEl.classList.add('show');
    clearTimeout(toast._t);
    toast._t=setTimeout(()=>toastEl.classList.remove('show'),1600);
  }
}
function isVid(n){ return /\.(mp4|webm|mov|m4v)$/i.test(n||''); }
function isGif(n){ return /\.gif$/i.test(n||''); }
// Wird dieses Item als <video> gerendert? Echte Videos UND zu MP4 konvertierte
// GIFs – letztere behalten media_type 'gif' (u. a. für den Mood-Chat-Filter),
// ihre media_url zeigt aber auf eine .mp4-Datei.
function isClip(it){ return it.media_type === 'video' || /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(it.media_url || ''); }
function prog(p){ progressBar.style.width=p+'%'; if(p>=100) setTimeout(()=>progressBar.style.width='0',600); }
function compress(file, maxPx=MAX_PX, q=0.88){
  // GIFs gehen durch den Gifsicle-Pfad (WASM), der die Animation erhält –
  // ein Canvas würde nur den ersten Frame erfassen.
  if(isGif(file.name)) return compressGif(file);
  return new Promise(res=>{
    // Videos nicht anfassen.
    if(isVid(file.name)){ res(file); return; }
    const img=new Image(), url=URL.createObjectURL(file);
    img.onload=()=>{
      URL.revokeObjectURL(url);
      let w=img.width, h=img.height;
      // Nur verkleinern, wenn nötig – aber immer zu WebP re-enkodieren.
      if(w>maxPx || h>maxPx){
        const r=Math.min(maxPx/w, maxPx/h); w=Math.round(w*r); h=Math.round(h*r);
      }
      const c=document.createElement('canvas'); c.width=w; c.height=h;
      c.getContext('2d').drawImage(img,0,0,w,h);
      const outType='image/webp', outName=file.name.replace(/\.[^.]+$/,'.webp');
      // Fallback: schlägt die Umwandlung fehl, die Originaldatei behalten.
      c.toBlob(b=>res(b ? new File([b],outName,{type:outType}) : file),outType,q);
    };
    img.onerror=()=>{ URL.revokeObjectURL(url); res(file); };
    img.src=url;
  });
}
// Kleines Grid-Thumbnail (WebP) aus einer Bilddatei erzeugen. Bewusst nur für
// statische Bilder gedacht – GIFs/Videos werden nie hierdurch geschickt, damit
// die Animation erhalten bleibt. Gibt bei Fehlern null zurück (Fallback: Volldatei).
function makeThumb(file, maxPx=THUMB_PX, q=0.7){
  return new Promise(res=>{
    const img=new Image(), url=URL.createObjectURL(file);
    img.onload=()=>{
      URL.revokeObjectURL(url);
      const scale=Math.min(1, maxPx/Math.max(img.width, img.height));
      const w=Math.max(1,Math.round(img.width*scale)), h=Math.max(1,Math.round(img.height*scale));
      const c=document.createElement('canvas'); c.width=w; c.height=h;
      c.getContext('2d').drawImage(img,0,0,w,h);
      c.toBlob(b=>res(b ? new File([b],'thumb.webp',{type:'image/webp'}) : null),'image/webp',q);
    };
    img.onerror=()=>{ URL.revokeObjectURL(url); res(null); };
    img.src=url;
  });
}
// ── GIF-KOMPRESSION (Gifsicle als WebAssembly) ───────────
// Animierte GIFs lassen sich nicht über Canvas verkleinern, ohne die Animation
// zu zerstören. Stattdessen läuft das echte Gifsicle als WASM im Browser:
// Frames re-optimieren (-O3), leicht verlustbehaftet komprimieren (--lossy)
// und auf eine sinnvolle Kantenlänge verkleinern – die Animation bleibt
// vollständig erhalten. Die Bibliothek (~150 KB gzipped) wird erst beim ersten
// GIF nachgeladen, normale Besuche kostet sie nichts.
const GIF_MAX_PX   = 720;  // Kantenlänge der Volldatei (Lightbox)
const GIF_THUMB_PX = 480;  // Kantenlänge des animierten Grid-Thumbnails
const GIF_LOSSY    = 80;   // kaum sichtbar, spart typisch 30–60 % Dateigröße

let _gifsicle = null;
function loadGifsicle(){
  if(!_gifsicle){
    _gifsicle = import('https://cdn.jsdelivr.net/npm/gifsicle-wasm-browser@1.5.19/dist/gifsicle.min.js')
      .then(m => m.default);
    // Bei Netzwerkfehler beim nächsten GIF erneut versuchen statt dauerhaft kaputt.
    _gifsicle.catch(() => { _gifsicle = null; });
  }
  return _gifsicle;
}
// Gifsicle über eine Datei laufen lassen; gibt das Ergebnis-File oder null zurück.
// --resize-fit verkleinert nur (vergrößert nie) und erhält das Seitenverhältnis.
// --colors 256 verhindert, dass beim Resampling >256 Farben pro Frame entstehen
// (lokale Colormaps würden die Datei sonst wieder aufblähen).
async function runGifsicle(file, maxPx, lossy){
  const gifsicle = await loadGifsicle();
  const out = await gifsicle.run({
    input: [{ file, name: 'in.gif' }],
    command: [`-O3 --lossy=${lossy} --colors 256 --resize-fit ${maxPx}x${maxPx} in.gif -o /out/out.gif`],
  });
  const f = out && out[0];
  return (f && f.size > 0) ? f : null;
}
// Volldatei: Ergebnis nur übernehmen, wenn es wirklich spürbar spart – sonst
// bleibt das Original (Qualität geht nie grundlos verloren). Fehler (z. B.
// CDN nicht erreichbar) fallen transparent aufs Original zurück.
async function compressGif(file){
  try{
    const f = await runGifsicle(file, GIF_MAX_PX, GIF_LOSSY);
    if(f && f.size < file.size * 0.95) return new File([f], file.name, { type: 'image/gif' });
  }catch(e){}
  return file;
}
// Animiertes Grid-Thumbnail: kleinere Kante + etwas stärkeres Lossy. Nur
// sinnvoll, wenn deutlich kleiner als die Volldatei – sonst null (das Grid
// nutzt dann wie bisher die Volldatei).
async function makeGifThumb(file, maxPx=GIF_THUMB_PX){
  try{
    const f = await runGifsicle(file, maxPx, GIF_LOSSY + 40);
    if(f && f.size < file.size * 0.75) return new File([f], 'thumb.gif', { type: 'image/gif' });
  }catch(e){}
  return null;
}
// ── GIF → MP4 (ffmpeg.wasm) ──────────────────────────────
// Wandelt animierte GIFs nach H.264-MP4: typisch 5–20× kleiner, hardware-
// dekodiert und streambar. Läuft NICHT automatisch beim Upload, sondern nur
// über den Owner-Button "GIFs → Video (MP4) konvertieren". media_type bleibt
// 'gif' (u. a. für den Mood-Chat), gerendert wird als <video muted loop> mit
// Autoplay – verhält sich also exakt wie das GIF. ffmpeg.wasm (~10 MB Core)
// wird erst beim ersten Einsatz nachgeladen – normale Besuche kostet es nichts.
// Bewusst die UMD-Builds: die ESM-Worker-Datei hat relative Imports und lässt
// sich deshalb nicht als (nötige) Blob-URL instanziieren – der UMD-Worker-Chunk
// (814.ffmpeg.js) ist dagegen self-contained.
const FFMPEG_PKG  = 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/umd';
const FFMPEG_UTIL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/umd/index.js';
// Core bewusst als ESM: mit classWorkerURL läuft der Worker als module-Worker,
// der den Core per import() lädt – dafür braucht es den Build mit default-Export.
const FFMPEG_CORE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm';
function loadScriptTag(src){
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('script '+src));
    document.head.appendChild(s);
  });
}
let _ffmpeg = null;
function loadFFmpeg(){
  if(!_ffmpeg){
    _ffmpeg = (async () => {
      if(!window.FFmpegWASM) await loadScriptTag(`${FFMPEG_PKG}/ffmpeg.js`);
      if(!window.FFmpegUtil) await loadScriptTag(FFMPEG_UTIL);
      const { FFmpeg } = window.FFmpegWASM;
      const { toBlobURL } = window.FFmpegUtil;
      const ff = new FFmpeg();
      // Worker & Core als Blob-URLs: cross-origin lassen sie sich nicht
      // direkt vom CDN instanziieren.
      await ff.load({
        coreURL:        await toBlobURL(`${FFMPEG_CORE}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL:        await toBlobURL(`${FFMPEG_CORE}/ffmpeg-core.wasm`, 'application/wasm'),
        classWorkerURL: await toBlobURL(`${FFMPEG_PKG}/814.ffmpeg.js`, 'text/javascript'),
      });
      return ff;
    })();
    // Bei Netzwerkfehler beim nächsten Versuch neu laden statt dauerhaft kaputt.
    _ffmpeg.catch(() => { _ffmpeg = null; });
  }
  return _ffmpeg;
}
// GIF-Datei nach MP4 konvertieren; gibt null zurück, wenn irgendetwas schief
// geht (CDN offline, exotisches GIF …) – der Aufrufer fällt dann transparent
// auf den bisherigen Gifsicle-Weg zurück, es geht also nie etwas kaputt.
async function gifToMp4(file){
  try{
    const ff = await loadFFmpeg();
    await ff.writeFile('in.gif', new Uint8Array(await file.arrayBuffer()));
    // yuv420p + gerade Kantenlängen sind Pflicht für H.264; Deckel bei
    // GIF_MAX_PX, kleinere GIFs behalten ihre Größe. veryfast, weil der
    // WASM-Encoder single-threaded läuft.
    await ff.exec([
      '-i', 'in.gif',
      '-vf', `scale=trunc(min(iw\\,${GIF_MAX_PX})/2)*2:-2`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '25',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-an',
      'out.mp4',
    ]);
    const data = await ff.readFile('out.mp4');
    try{ await ff.deleteFile('in.gif'); }catch(e){}
    try{ await ff.deleteFile('out.mp4'); }catch(e){}
    if(data && data.length > 0){
      const name = file.name.replace(/\.gif$/i, '') + '.mp4';
      return new File([data], name, { type: 'video/mp4' });
    }
  }catch(e){}
  return null;
}
let _lockedScrollY = 0;
function updateBodyLock(){
  const lock = (typeof lightbox!=='undefined' && lightbox.classList.contains('show'))
    || (typeof moodCreateModal!=='undefined' && moodCreateModal && moodCreateModal.classList.contains('show'))
    || bottomSheet.classList.contains('show')
    || (typeof moodsMgmtPopup!=='undefined' && moodsMgmtPopup && moodsMgmtPopup.classList.contains('show'))
    || (typeof confirmPopup!=='undefined' && confirmPopup && confirmPopup.classList.contains('show'))
    || !!document.getElementById('infoPage')?.classList.contains('show')
    || !!document.getElementById('gbPage')?.classList.contains('show');
  const isLocked = document.documentElement.classList.contains('no-scroll');
  if(lock && !isLocked){
    _lockedScrollY = window.scrollY || window.pageYOffset || 0;
    document.documentElement.classList.add('no-scroll');
    document.body.classList.add('no-scroll');
    document.body.style.top = `-${_lockedScrollY}px`;
  } else if(!lock && isLocked){
    document.documentElement.classList.remove('no-scroll');
    document.body.classList.remove('no-scroll');
    document.body.style.top = '';
    window.scrollTo(0, _lockedScrollY);
  }
}
function openMenu(){
  if(window.innerWidth<=600){ bottomSheet.classList.add('show'); sheetOverlay.classList.add('show'); updateBodyLock(); }
  else dropdown.classList.toggle('show');
}
function closeMenu(){ dropdown.classList.remove('show'); bottomSheet.classList.remove('show'); sheetOverlay.classList.remove('show'); editorWrap.classList.remove('show'); updateBodyLock(); }
function closeAllOverlays(){
  closeMenu();
  filterPopup.classList.remove('show');
  editorWrap.classList.remove('show');
  const sp = document.getElementById('spotifyPopup');
  if(sp){ sp.classList.remove('show'); document.getElementById('spotifyBtn').classList.remove('active'); }
  if(typeof closePageNav === 'function') closePageNav();
  window.MB?.closeChat?.();
}
function isAnyOverlayOpen(){
  return dropdown.classList.contains('show') ||
         bottomSheet.classList.contains('show') ||
         filterPopup.classList.contains('show') ||
         editorWrap.classList.contains('show') ||
         !!document.getElementById('spotifyPopup')?.classList.contains('show') ||
         !!document.getElementById('moodChatPanel')?.classList.contains('show');
}
$('menuBtn').onclick = e => { e.stopPropagation(); openMenu(); };
sheetOverlay.onclick = closeMenu;
document.addEventListener('click', e => { if(!e.target.closest('#dropdown') && !e.target.closest('#menuBtn')) dropdown.classList.remove('show'); });

// Klick auf den Titel = komplettes Neu-Mischen (hebt Chat-Suche auf und
// kehrt zur Archiv-Ansicht zurück) – der Pill-Button mischt dagegen nur
// innerhalb der aktuellen Ansicht (doShuffleInView).
$('boardTitle').onclick = () => { $('boardTitle').blur(); doShuffle(); };

function renderMoodChips(){
  document.querySelectorAll('[data-mood-chip]').forEach(chip => {
    const m = chip.dataset.moodChip;
    chip.classList.toggle('active', activeMoods.has(m));
    chip.onclick = () => {
      if(activeMoods.has(m)) activeMoods.delete(m); else activeMoods.add(m);
      // Filter ordnet das Grid neu → wie Shuffle/Suche instant nach oben +
      // rendern (renderFromTop), sonst spinnern die sichtbaren Kacheln.
      saveFilterState(); renderFromTop(); renderMoodChips();
    };
  });
}
// ── Ende-der-Liste-Disclaimer ──────────────────────────
// Wechselnde Sprüche, die unter dem Grid auftauchen, sobald man ganz
// durchgescrollt hat – egal ob gefiltert, gemischt oder per Chat gesucht.
const END_DISCLAIMERS = [
  'Du bist unten angekommen. Pack dein Handy weg und mach was Sinnvolles. 📵',
  'Das war alles. Mehr gibt’s gerade nicht – Zeit, den Blick mal zu heben.',
  'Ende der Fahnenstange. Glückwunsch, du Scroll-Champion. 🏆',
  'Du hast alles gesehen. Jetzt raus an die frische Luft, ja?',
  'Hier ist Schluss. Der Rest des Tages wartet da draußen auf dich.',
];
let _lastDisclaimer = '';
// Bei jedem Render einen neuen Spruch ziehen (nie zweimal denselben in Folge).
function pickDisclaimer(){
  if(END_DISCLAIMERS.length < 2) return END_DISCLAIMERS[0] || '';
  let txt;
  do { txt = END_DISCLAIMERS[Math.floor(Math.random() * END_DISCLAIMERS.length)]; }
  while(txt === _lastDisclaimer);
  _lastDisclaimer = txt;
  return txt;
}
// Disclaimer nur zeigen, wenn tatsächlich Kacheln da sind, durch die man
// scrollen kann – bei leerem Grid bzw. während des Boots bleibt er versteckt.
function updateGridEnd(count){
  if(!gridEnd) return;
  if(count > 0){
    gridEndText.textContent = pickDisclaimer();
    gridEnd.hidden = false;
  } else {
    gridEnd.hidden = true;
  }
}

function scrollToTop(){
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
}

// Neu-Anordnen des Grids (Shuffle, Suche, Filter, View-Wechsel): IMMER erst
// INSTANT nach oben springen, DANN rendern – identisch zum Shuffle-Schema.
// Grund: die sofort geladenen "eager"-Kacheln sind stets die ERSTEN in
// DOM-Reihenfolge (die obersten). Rendert man in alter Scroll-Tiefe, laden
// also die UNSICHTBAREN oberen Kacheln sofort, während die tatsächlich
// sichtbaren nur ein data-src tragen und erst der Prefetch-Observer sie
// nachzieht → lange Spinner. Ein HINTERHER gestarteter Smooth-Scroll macht es
// noch schlimmer: der Observer meldet JEDE überflogene Reihe und verstopft die
// Warteschlange, bevor die sichtbaren Kacheln an der Reihe sind. Sofort nach
// oben + eager oben = sichtbare Kacheln sind sofort geladen (smoothes Schema).
function renderFromTop(){
  window.scrollTo(0, 0);
  renderGrid();
}

// ── GRID RENDERING ─────────────────────────────────────
function renderGrid(){
  const s = S();
  // Dedup by id — guards against race conditions during concurrent uploads
  const seen = new Set();
  s.items = s.items.filter(i => { if(seen.has(i.id)) return false; seen.add(i.id); return true; });
  let arr;
  if(chatResultIds){
    // Mood-Chat aktiv: nur die Treffer in der Reihenfolge der IDs zeigen –
    // anfangs das Ranking, nach dem Pill-Shuffle die permutierte Reihenfolge
    // (Mood-Filter und sortNewest werden hier bewusst übersprungen).
    const byId = new Map(s.items.map(i => [i.id, i]));
    arr = chatResultIds.map(id => byId.get(id)).filter(Boolean);
  } else {
    // Drop any active mood filters that no longer exist in the moods list
    // (e.g. the mood was renamed/deleted on another device).
    const validMoods = new Set(s.moods);
    for(const m of [...activeMoods]) if(!validMoods.has(m)) activeMoods.delete(m);
    // Filter: if activeMoods has entries, show items matching ANY selected mood (OR)
    arr = activeMoods.size > 0
      ? s.items.filter(i => (Array.isArray(i.moods) && i.moods.some(m => activeMoods.has(m))))
      : s.items;
    // If a filter is active but matches nothing (e.g. items were retagged on
    // another device), drop the filter so the user always sees content.
    if(activeMoods.size > 0 && arr.length === 0 && s.items.length > 0){
      activeMoods.clear();
      saveFilterState();
      arr = s.items;
    }
    // Sortierung: entweder zufällig (shuffle) oder nach Erstelldatum (neueste zuerst)
    if(sortNewest){
      // Items bleiben in ihrer DB-Reihenfolge (created_at DESC)
    } else {
      // Fisher-Yates shuffle
      arr = [...arr];
      for(let i = arr.length - 1; i > 0; i--){
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
    }
  }
  s.currentItems = arr;
  if(_observer){ _observer.disconnect(); _observer=null; }
  // Erste Reihen sofort & priorisiert laden (statt pauschal "lazy"), damit
  // der sichtbare Bereich direkt nach dem Boot gefüllt ist; der Rest bleibt
  // lazy. Beim allerersten Boot lädt der Loading Screen ~40 Bilder vor.
  const eagerCount = Math.min(arr.length, _bootPending ? BOOT_EAGER_COUNT : Math.max(gridCols * 4, 8));
  // Noch laufende Downloads der ALTEN Kacheln abbrechen: nach einem Re-Render
  // (Shuffle/Filter/Sync) würden sie sonst unsichtbar weiterladen und den
  // neuen, tatsächlich sichtbaren Bildern die Bandbreite streitig machen.
  // Bewusst NICHT während des Boots: das erste Laden steuert revealWhenReady
  // exklusiv, da darf ein Zwischen-Render nichts abwürgen.
  if(!_bootPending){
    for(const im of gridEl.querySelectorAll('img')){
      if(im.src && !im.complete){ im.removeAttribute('data-full'); im.src = ''; }
    }
  }
  gridEl.innerHTML = arr.map((it, idx) => {
    const eager = idx < eagerCount;
    // Nicht-eager Bilder bekommen KEIN natives loading="lazy" mehr – ihr
    // Laden steuert die Prefetch-Warteschlange (s. u.), und loading="lazy"
    // würde den vorausschauenden Abruf wieder bis kurz vor den Viewport
    // verzögern.
    const loadAttr = eager
      ? 'loading="eager" fetchpriority="high" data-eager="1"'
      : '';
    let media;
    if(isClip(it)){
      // Konvertierte GIFs (MP4) verhalten sich wie GIFs: Autoplay/Loop macht
      // der Video-Observer, data-gif kennzeichnet sie fürs Killswitch-Umfeld.
      const gifClip = it.media_type !== 'video';
      // Bewusst KEIN poster/Thumbnail: Videos zeigen direkt ihren ersten
      // Frame und starten per Autoplay (Video-Observer beim Sichtbarwerden).
      // Erste Reihen bzw. Boot laden die Metadaten sofort, der Rest
      // aufgeschoben, bis der Observer die Kachel sieht.
      const preload = (eager || _bootPending) ? 'metadata' : 'none';
      media = `<video src="${it.media_url}" muted loop playsinline${gifClip ? ' data-gif="1"' : ''} preload="${preload}"></video>`;
    } else {
      // Statische Bilder nutzen das kleine WebP-Thumbnail, GIFs ihr
      // verkleinertes animiertes GIF-Thumbnail (falls vorhanden) – die
      // Animation bleibt so erhalten, lädt aber deutlich schneller. Fällt
      // ein Thumbnail aus, wird transparent auf die Volldatei zurückgeschaltet.
      const useThumb = (it.media_type==='image' || it.media_type==='gif') && it.thumb_url;
      const src = useThumb ? it.thumb_url : it.media_url;
      // Bei Thumbnail-Fehler wird per delegiertem 'error'-Listener (s. u.) auf
      // die Volldatei zurückgeschaltet – dafür hier die Voll-URL hinterlegen.
      const full = useThumb ? ` data-full="${it.media_url}"` : '';
      // GIFs markieren (auch per-URL hinzugefügte mit media_type 'image'), damit
      // der Autoplay-Killswitch sie einfrieren kann.
      const isGifItem = it.media_type==='gif' || /\.gif(\?|#|$)/i.test(it.media_url||'');
      const gifAttr = isGifItem ? ' data-gif="1"' : '';
      // Nur Eager-Bilder außerhalb des Boots laden sofort per src. Alle
      // anderen bekommen ihre URL als data-src: die Boot-Bilder lädt
      // revealWhenReady() kontrolliert in Batches (GIFs zuerst), die
      // restlichen holt die Prefetch-Warteschlange beim Scrollen vorab.
      const srcAttr = (eager && !_bootPending) ? `src="${src}"` : `data-src="${src}"`;
      media = `<img ${srcAttr} ${loadAttr}${gifAttr} decoding="async" alt=""${full}><div class="grid-spinner" aria-hidden="true"></div>`;
    }
    return `
    <div class="cell${isClip(it) ? '' : ' loading'}" data-id="${it.id}">
      <input class="selcheck" type="checkbox" data-id="${it.id}">
      ${media}
    </div>`;
  }).join('');

  // Eingangs-Animation nur für die sofort sichtbaren Kacheln (erste Reihen).
  // Früher wurde über ALLE Kacheln getweent – bei großen Boards blockierte das
  // GSAP-Stagger den Main-Thread sekundenlang und ließ das Einblenden haken.
  // Die weiter unten liegenden Kacheln erscheinen beim Lazy-Load ganz ohne Tween.
  // Solange der Loading Screen das Grid verdeckt, wird der Tween aufgeschoben –
  // revealWhenReady() spielt ihn beim Ausblenden des Screens ab.
  if(_isInitialLoad && !_bootPending && typeof gsap !== 'undefined' && arr.length > 0){
    const cells = gridEl.children;
    const n = Math.min(cells.length, eagerCount);
    const targets = [];
    for(let i = 0; i < n; i++) targets.push(cells[i]);
    gsap.from(targets, {
      opacity: 0, y: 12, duration: 0.4,
      stagger: { amount: Math.min(0.35, n * 0.03), from: 'start' },
      ease: 'power2.out', clearProps: 'transform,opacity'
    });
    _isInitialLoad = false;
  }

  // Spaltenbreite direkt setzen statt über applyGridCols() – beim reinen
  // Neu-Rendern (Shuffle/Filter/Sync) ändert sich gridCols nicht, daher kein
  // erneuter localStorage-Write und kein Swipe-UI-Update nötig (Performance).
  gridEl.style.gridTemplateColumns = gridCols === 1 ? '1fr' : `repeat(${gridCols}, 1fr)`;

  // IntersectionObserver nur für Video-Kacheln (Autoplay beim Sichtbarwerden).
  // Reine Bild-Boards beobachten dadurch gar nichts – kein O(n)-Observe-Loop.
  // (Ein evtl. alter Observer wurde oben bereits getrennt.)
  const videoCells = gridEl.querySelectorAll('.cell:has(video)');
  if(videoCells.length){
    _observer = new IntersectionObserver(entries => entries.forEach(e => {
      const v = e.target.querySelector('video'); if(!v) return;
      if(e.isIntersecting){
        // Aufgeschobene Videos (preload="none") jetzt Metadaten laden lassen,
        // damit das erste Standbild als Poster erscheint.
        if(v.preload === 'none') v.preload = 'metadata';
        // Autoplay nur, wenn der Killswitch das erlaubt – sonst pausiert das
        // Video (erster Frame bleibt als Standbild stehen).
        if(autoplayMedia){ v.muted=true; v.play().catch(()=>{}); }
        else v.pause();
      }
      else { v.pause(); v.currentTime=0; }
    }), { threshold:0.25, rootMargin:'100px' });
    videoCells.forEach(c => _observer.observe(c));
  }

  // Prefetch-Observer im Instagram-Stil: dank fester aspect-ratio der Zellen
  // steht das Layout sofort, daher meldet der große rootMargin Kacheln
  // zuverlässig ~3 Viewports vor Sichtbarkeit. Deren Bilder wandern in die
  // Batch-Warteschlange (max. LAZY_CONCURRENCY parallel, in Scroll-Richtung
  // sortiert, da die Einträge in DOM-Reihenfolge kommen).
  if(_lazyObserver){ _lazyObserver.disconnect(); _lazyObserver = null; }
  _imgQueue.length = 0;
  _imgActive = 0;
  const lazyCells = gridEl.querySelectorAll('.cell:has(img[data-src]:not([data-eager]))');
  if(lazyCells.length){
    _lazyObserver = new IntersectionObserver(entries => {
      for(const e of entries){
        if(!e.isIntersecting) continue;
        _lazyObserver.unobserve(e.target);
        const im = e.target.querySelector('img[data-src]');
        if(im) _imgQueue.push(im);
      }
      pumpImgQueue();
    }, { rootMargin:'150% 0px 300% 0px' });
    lazyCells.forEach(c => _lazyObserver.observe(c));
  }

  // Bei deaktiviertem Autoplay direkt nach dem Rendern anwenden (GIFs einfrieren).
  if(!autoplayMedia) applyAutoplayState(gridEl);

  // Klick/Kontextmenü über Event-Delegation EINMALIG am Grid-Container statt
  // pro Kachel – das spart bei großen Boards hunderte Listener-Anbindungen
  // (vorher die Haupt-Ursache fürs Haken direkt nach dem Boot-Spinner).
  wireGridDelegation();

  // Selection-Mode-Status (Checkbox sichtbar/aktiv) nur setzen, wenn der Modus
  // wirklich aktiv ist – beim normalen Initial-Load entfällt dieser Loop ganz.
  if(selMode){
    gridEl.querySelectorAll('.cell').forEach(c => {
      const chk = c.querySelector('.selcheck');
      if(!chk) return;
      chk.classList.add('visible');
      if(selectedIds.has(c.dataset.id)){ chk.checked = true; c.classList.add('sel-highlight'); }
    });
  }

  // Wechselnden Ende-Disclaimer unter dem Grid setzen/verstecken.
  updateGridEnd(arr.length);
}

// Container-Listener: einmal anbinden, danach kümmert sich Delegation um alle
// (auch künftig nachgerenderten) Kacheln.
let _gridWired = false;
function wireGridDelegation(){
  if(_gridWired) return;
  _gridWired = true;

  // Lade-Spinner pro Kachel entfernen, sobald das Bild fertig ist. 'load'/'error'
  // blubbern nicht, werden aber in der Capture-Phase am Container abgefangen –
  // so genügt EIN Listener-Paar für alle Bilder (eager wie lazy).
  gridEl.addEventListener('load', e => {
    const t = e.target;
    if(t.tagName !== 'IMG') return;
    t.closest('.cell')?.classList.remove('loading');
    // Lazy nachgeladene GIFs bei deaktiviertem Autoplay sofort einfrieren.
    if(!autoplayMedia && t.dataset.gif === '1') freezeGif(t);
  }, true);
  gridEl.addEventListener('error', e => {
    const t = e.target;
    if(t.tagName !== 'IMG') return;
    const full = t.dataset.full;
    // Thumbnail fehlgeschlagen → transparent auf die Volldatei zurückschalten.
    if(full && t.src !== full){ delete t.dataset.full; t.src = full; return; }
    t.closest('.cell')?.classList.remove('loading');
  }, true);

  gridEl.addEventListener('click', e => {
    const c = e.target.closest('.cell');
    if(!c || !gridEl.contains(c)) return;
    if(selMode){
      const chk = c.querySelector('.selcheck');
      const id = c.dataset.id;
      if(e.target !== chk) chk.checked = !chk.checked;
      chk.checked ? selectedIds.add(id) : selectedIds.delete(id);
      c.classList.toggle('sel-highlight', chk.checked);
      updateActionBarCount();
      return;
    }
    if(isAnyOverlayOpen()){ closeAllOverlays(); e.stopPropagation(); return; }
    const idx = S().currentItems.findIndex(x => x.id === c.dataset.id);
    openLightbox(idx);
  });

  gridEl.addEventListener('contextmenu', e => {
    const c = e.target.closest('.cell');
    if(!c || !gridEl.contains(c)) return;
    e.preventDefault();
    if(!selMode) openEditor(c.dataset.id);
  });
}



function updateActionBarCount(){
    actionBarCount.textContent = selectedIds.size + ' ausgewählt';
  }

// ── SELECTION MODE ──────────────────────────────────────
function exitSelMode(){
  selMode=null; selectedIds.clear();
  actionBar.classList.remove('show'); renderGrid();
}
$('abCancel').onclick = () => { $('deleteFloatingBtn')?.remove(); exitSelMode(); };



// ── Lightbox Navigation ─────────────────────────────────
function openLightbox(idx){
  if(idx<0 || idx>=S().currentItems.length) return;
  // Unterscheide echtes Öffnen vom Weiterblättern (Swipe/Pfeile):
  // beim Blättern darf NICHT die ganze Lightbox kurz transparent werden,
  // sonst blitzt die Archiv-Seite samt Pill im Hintergrund auf.
  const isOpening = !lightbox.classList.contains('show');
  // Beim echten Öffnen merken, von welcher Kachel aus gestartet wurde –
  // beim Schließen wird nur dann nachgescrollt, wenn man weitergeblättert hat.
  if(isOpening) lbOpenIndex = idx;
  lbIndex = idx;
  const it = S().currentItems[idx];
  lbInner.querySelectorAll('img,video').forEach(e=>e.remove());
  if(isClip(it)){
    const v = document.createElement('video');
    v.src=it.media_url; v.controls=false; v.autoplay=true; v.muted=true; v.loop=true; v.playsInline=true;
    v.preload='auto';
    if(it.media_type === 'video'){
      v.addEventListener('click', () => {
        lbIsMuted = !lbIsMuted;
        v.muted = lbIsMuted;
        updateMuteSvg(lbIsMuted);
      });
      lbIsMuted=true; updateMuteSvg(true);
    } else {
      // Konvertiertes GIF: kein Ton, kein Mute-Toggle – Klick schließt die
      // Lightbox wie bei Bildern (s. lightbox.onclick).
      v.dataset.gif = '1';
    }
    lbInner.appendChild(v);
  } else {
    const img = document.createElement('img');
    img.style.pointerEvents='none';
    img.decoding = 'async';
    // Sofort das (bereits aus dem Grid gecachte) Thumbnail zeigen, damit die
    // Lightbox ohne Wartezeit aufgeht, und im Hintergrund transparent auf die
    // scharfe Volldatei wechseln, sobald sie geladen ist.
    if(it.thumb_url){
      img.src = it.thumb_url;
      const full = new Image();
      full.decoding = 'async';
      full.onload = () => { if(lbIndex === idx) img.src = it.media_url; };
      full.src = it.media_url;
    } else {
      img.src = it.media_url;
    }
    lbInner.appendChild(img);
  }
  lightbox.classList.add('show');
  if(typeof gsap !== 'undefined'){
    const media = lbInner.querySelector('img,video');
    // Ganze Lightbox nur beim ersten Öffnen einblenden, nicht beim Blättern.
    if(isOpening) gsap.fromTo(lightbox, {opacity:0},{opacity:1,duration:0.22,ease:'power2.out'});
    else gsap.set(lightbox, {opacity:1});
    if(media){
      // Bug-Fix gegen das "Springen": Das Medium zunächst unsichtbar setzen und
      // die Einblend-Animation ERST starten, wenn echte Maße vorliegen. Sonst
      // beginnt die Animation, während das Bild noch Höhe 0 hat – sobald es
      // dann dekodiert, wächst es aus der vertikal zentrierten Mitte heraus und
      // die Oberkante "springt" sichtbar nach oben.
      gsap.set(media, {scale:0.94, opacity:0, willChange:'transform, opacity'});
      const reveal = () => gsap.to(media, {
        scale:1, opacity:1, duration:0.4,
        ease:'power3.out', overwrite:true,
        onComplete(){ media.style.willChange=''; }
      });
      if(media.tagName === 'IMG'){
        // decode() löst aus, sobald das Bild dekodiert & paint-bereit ist –
        // bei gecachten Thumbnails praktisch sofort (kein Performance-Verlust),
        // bei großen Volldateien wartet es kurz statt zu ruckeln.
        if(media.complete && media.naturalWidth){
          reveal();
        } else if(media.decode){
          media.decode().then(reveal).catch(reveal);
        } else {
          media.addEventListener('load', reveal, {once:true});
          media.addEventListener('error', reveal, {once:true});
        }
      } else {
        // Video: Maße stehen mit den Metadaten fest.
        if(media.readyState >= 1) reveal();
        else media.addEventListener('loadedmetadata', reveal, {once:true});
      }
    }
  }
  lightbox.classList.toggle('has-video', it.media_type === 'video');
  // Bei Clips laden Ambient-Video (gleiche Datei!) und Nachbar-Preload sonst
  // parallel zum Hauptvideo und stehlen ihm die Bandbreite – die Lightbox
  // öffnete dadurch spürbar langsamer. Deshalb erst starten, wenn das
  // Hauptvideo abspielbereit ist (das Ambient-Video kommt dann praktisch
  // komplett aus dem Browser-Cache).
  const mainClip = isClip(it) ? lbInner.querySelector('video') : null;
  if(mainClip && mainClip.readyState < 3){
    const deferred = () => {
      if(lbIndex !== idx || !lightbox.classList.contains('show')) return;
      setAmbientFor(it);
      preloadNeighbors(idx);
    };
    mainClip.addEventListener('canplay', deferred, { once:true });
    mainClip.addEventListener('error', deferred, { once:true });
  } else {
    setAmbientFor(it);
    preloadNeighbors(idx);
  }
  updateBodyLock();
}
// Nachbar-Medien schon mal in den Browser-Cache holen, damit das Blättern
// (Swipe/Pfeile) ohne sichtbare Ladezeit erfolgt. Videos wärmen über ein
// detached <video preload="auto"> vor; die Elemente werden kurz festgehalten,
// damit der Browser den Download nicht per Garbage Collection abbricht.
const _warmVideos = [];
function preloadNeighbors(idx){
  [idx - 1, idx + 1].forEach(i => {
    const n = S().currentItems[i];
    if(!n) return;
    if(isClip(n)){
      if(_warmVideos.some(w => w.src === n.media_url)) return;
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.preload = 'auto';
      v.src = n.media_url;
      _warmVideos.push(v);
      while(_warmVideos.length > 4){
        const old = _warmVideos.shift();
        old.removeAttribute('src'); old.load();
      }
    } else if(n.media_type === 'image'){
      const im = new Image();
      im.decoding = 'async';
      im.src = n.media_url;
    }
  });
}
function lbNavigate(dir){
  const next=lbIndex+dir;
  if(next<0 || next>=S().currentItems.length) return;
  lbInner.querySelectorAll('video').forEach(v=>v.pause());
  openLightbox(next);
}
lightbox.onclick = e => {
  // Klicks auf echte Videos toggeln den Ton (eigener Listener); konvertierte
  // GIFs (data-gif) schließen wie Bilder.
  const v = e.target.closest('video');
  if(!v || v.dataset.gif) closeLb();
};
function closeLb(){
  lightbox.classList.remove('show');
  lightbox.classList.remove('has-video');
  lightbox.classList.remove('sleep');
  updateBodyLock();
  // Hat man in der Lightbox weitergeblättert, in der Grid-Ansicht zur zuletzt
  // betrachteten Kachel scrollen, statt zur ursprünglichen Position (updateBodyLock).
  if(lbIndex !== lbOpenIndex){
    const it = S().currentItems[lbIndex];
    const cell = it && gridEl.querySelector(`.cell[data-id="${CSS.escape(String(it.id))}"]`);
    if(cell) cell.scrollIntoView({ block:'center' });
  }
  lbAmbient.style.opacity = '0';
  lbInner.querySelectorAll('video').forEach(v=>v.pause());
}

// ── Sleep / Wake-up ──────────────────────────────────────
function wakeUp() {
  lightbox.classList.remove('sleep');
  clearTimeout(sleepTimeout);
  if (slideshowActive) {
    sleepTimeout = setTimeout(() => {
      if (slideshowActive) lightbox.classList.add('sleep');
    }, 4000);
  }
}
lightbox.addEventListener('click',      wakeUp, { capture: true });
lightbox.addEventListener('touchstart', wakeUp, { passive: true, capture: true });
lightbox.addEventListener('mousemove',  wakeUp, { passive: true });

function updateMuteSvg(muted){
  const svg = document.getElementById('lbMuteSvg');
  if(!svg) return;
  if(muted){
    svg.innerHTML = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>';
  } else {
    svg.innerHTML = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>';
  }
}

let txS=0, tyS=0;
lightbox.addEventListener('touchstart', e=>{ txS=e.touches[0].clientX; tyS=e.touches[0].clientY; }, {passive:true});
lightbox.addEventListener('touchend', e=>{
  const dx=e.changedTouches[0].clientX-txS, dy=e.changedTouches[0].clientY-tyS;
  if(Math.abs(dx)>Math.abs(dy) && Math.abs(dx)>40) lbNavigate(dx<0?1:-1);
  else if(Math.abs(dy)>Math.abs(dx) && Math.abs(dy)>40) lbNavigate(dy<0?1:-1);
}, {passive:true});


document.addEventListener('keydown', e => {
  if(lightbox.classList.contains('show')){
    if(e.key==='ArrowLeft') lbNavigate(-1);
    else if(e.key==='ArrowRight') lbNavigate(1);
    else if(e.key==='Escape') closeLb();
    return;
  }
  if(e.key==='Escape'){
    if(isInfoPageOpen()){ closeInfoPage(); return; }
    if(selMode) exitSelMode(); else closeMenu();
  }
});

// ── SHUFFLE-OVERLAY ──────────────────────────────────────
// Beim Neu-Mischen legt sich ~1 s ein Overlay über das Grid (Topbar und
// Bottombar-Pill bleiben sichtbar, s. css/shuffle.css): Mini-Kacheln im
// 9:16-Format wirbeln in mehreren Runden durcheinander. Sobald das Overlay
// deckt, wird darunter unbemerkt gemischt, gerendert und nach oben
// gescrollt – beim Ausblenden steht das Grid oben mit neuer Reihenfolge.
let _shuffleBusy = false;
function playShuffleOverlay(applyFn){
  const COLS = 3, ROWS = 2, W = 36, H = 64, GAP = 7;
  const overlay = document.createElement('div');
  overlay.className = 'shuffle-overlay';
  const stage = document.createElement('div');
  stage.className = 'shuffle-stage';
  stage.style.width  = (COLS*W + (COLS-1)*GAP) + 'px';
  stage.style.height = (ROWS*H + (ROWS-1)*GAP) + 'px';
  const slots = [];
  for(let r = 0; r < ROWS; r++) for(let c = 0; c < COLS; c++) slots.push([c*(W+GAP), r*(H+GAP)]);
  const tiles = slots.map(p => {
    const t = document.createElement('div');
    t.className = 'shuffle-tile';
    t.style.width = W + 'px'; t.style.height = H + 'px';
    t.style.transform = `translate(${p[0]}px,${p[1]}px)`;
    stage.appendChild(t);
    return t;
  });
  const label = document.createElement('div');
  label.className = 'shuffle-label';
  label.innerHTML = 'MISCHEN<span class="ls-dots"><span class="ls-dot">.</span><span class="ls-dot">.</span><span class="ls-dot">.</span></span>';
  overlay.append(stage, label);
  document.body.appendChild(overlay);

  // Jede Runde: Slot-Zuordnung per Fisher-Yates permutieren, die Kacheln
  // gleiten per CSS-Transition auf ihre neuen Plätze.
  const order = tiles.map((_, i) => i);
  const swapRound = () => {
    for(let i = order.length - 1; i > 0; i--){
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    tiles.forEach((t, i) => {
      const p = slots[order[i]];
      t.style.transform = `translate(${p[0]}px,${p[1]}px)`;
    });
  };

  // Doppeltes rAF: erst nach dem Initial-Paint .show setzen, sonst
  // überspringt der Browser die Eingangs-Transition.
  requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add('show')));
  // Overlay deckt nach ~180 ms → Grid darunter unbemerkt austauschen.
  setTimeout(applyFn, 180);
  [140, 380, 620, 860].forEach(t => setTimeout(swapRound, t));
  setTimeout(() => {
    overlay.classList.add('hide');
    setTimeout(() => { overlay.remove(); _shuffleBusy = false; }, 320);
  }, 1000);
}

// Gemeinsamer Ablauf beider Shuffle-Varianten (Header & Pill): identisches
// Schema mit Misch-Overlay bzw. Toast bei reduzierter Bewegung. `mutateFn`
// stellt nur den jeweiligen Ziel-Zustand her, gerendert wird hier.
function runShuffle(mutateFn) {
  if(_shuffleBusy) return;
  const apply = () => {
    mutateFn();
    // Sofort nach oben + rendern (s. renderFromTop): sonst lange Spinner, weil
    // die eager geladenen obersten Kacheln nicht die sichtbaren wären.
    renderFromTop();
  };
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){
    apply();
    toast('Neu gemischt');
    return;
  }
  _shuffleBusy = true;
  playShuffleOverlay(apply);
}

// Komplettes Neu-Mischen (Header: Titel-Klick & Menü "Zufällig anordnen"):
// hebt eine aktive Mood-Chat-Suche auf und kehrt zur Archiv-Ansicht zurück.
function doShuffle() {
  runShuffle(() => {
    sortNewest = false;
    chatResultIds = null;   // Header-Shuffle hebt eine aktive Mood-Chat-Suche auf
    // Shuffle ist die Archiv-Ansicht: aus "Zuletzt hinzugefügt" zurückwechseln
    if(currentView === 'recent') currentView = 'archive';
  });
}

// Shuffle in der Bottombar-Pill: mischt IN der aktuellen Ansicht. Eine aktive
// Mood-Chat-/Kategorie-Suche bleibt bestehen – nur deren Treffer werden neu
// angeordnet (die IDs selbst permutieren, renderGrid zeigt sie 1:1 in dieser
// Reihenfolge). Ohne Chat-Suche wie das komplette Mischen, inkl. aktivem
// Mood-Filter (renderGrid mischt innerhalb des Filters).
function doShuffleInView() {
  runShuffle(() => {
    if(chatResultIds){
      const ids = [...chatResultIds];
      for(let i = ids.length - 1; i > 0; i--){
        const j = Math.floor(Math.random() * (i + 1));
        [ids[i], ids[j]] = [ids[j], ids[i]];
      }
      chatResultIds = ids;
    } else {
      sortNewest = false;
      if(currentView === 'recent') currentView = 'archive';
    }
  });
}
$('shuffleBtn').onclick = () => { $('shuffleBtn').blur(); doShuffleInView(); };
$('uploadBtn').onclick = () => { fileInput.click(); closeMenu(); };
$('uploadBtnSheet').onclick = () => { fileInput.click(); closeMenu(); };
fileInput.onchange = e => upload(e.target.files);



// ── AUTO MOOD SUGGESTION (Gemini Vision) ─────────────────
async function autoSuggestMoods(imageUrl) {
  const moods = S().moods.filter(m => m !== 'All');
  if (!moods.length) return [];
  try {
    const res = await fetch('/api/suggest-moods', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl, moods }),
    });
    if (!res.ok) return [];
    const { moods: suggested } = await res.json();
    return Array.isArray(suggested) ? suggested : [];
  } catch { return []; }
}

// ── UPLOAD ───────────────────────────────────────────────
async function upload(files){
  const arr = Array.from(files);
  if(!arr.length) return;
  toast(`${arr.length} Datei${arr.length>1?'en':''} wird${arr.length>1?'en':''} hochgeladen…`);
  let done = 0;
  const uploadOne = async (f) => {
    // GIFs bleiben beim Upload GIFs (Gifsicle-Kompression via compress) –
    // nach MP4 konvertiert wird nur noch bewusst über den Owner-Button
    // "GIFs → Video (MP4) konvertieren".
    const cf = await compress(f);
    const ext = cf.name.split('.').pop().toLowerCase();
    const path = `${Date.now().toString(36)}${Math.random().toString(36).slice(2,6)}.${ext}`;
    // cacheControl auf 1 Jahr: Die Dateinamen sind einmalig und werden nie
    // überschrieben (immutable), daher dürfen Browser & CDN sie unbegrenzt
    // cachen. Ohne diese Angabe nutzt Supabase nur 1h – wiederkehrende Besuche
    // müssten alle Bilder erneut laden.
    const {error:e1} = await sb.storage.from(BUCKET).upload(path, cf, {upsert:false, contentType:cf.type, cacheControl:'31536000'});
    if(e1){ toast('Upload-Fehler: '+e1.message); return null; }
    const {data:pub} = sb.storage.from(BUCKET).getPublicUrl(path);
    const mediaType = isVid(f.name) ? 'video' : isGif(f.name) ? 'gif' : 'image';
    // Kleines Grid-Thumbnail erzeugen & hochladen: statische Bilder als WebP,
    // GIFs als verkleinertes animiertes GIF-Thumbnail. Videos bekommen KEIN
    // Poster/Thumbnail – sie laufen im Grid direkt als Autoplay-Video.
    let thumbUrl = null;
    const tf = mediaType === 'image' ? await makeThumb(cf)
             : mediaType === 'gif'   ? await makeGifThumb(cf)
             : null;
    if(tf){
      const tpath = `thumb/${path}`;
      const {error:te} = await sb.storage.from(BUCKET).upload(tpath, tf, {upsert:false, contentType:tf.type, cacheControl:'31536000'});
      if(!te) thumbUrl = sb.storage.from(BUCKET).getPublicUrl(tpath).data.publicUrl;
    }
    const suggestedMoods = mediaType === 'image' ? await autoSuggestMoods(pub.publicUrl) : [];
    const item = { title:f.name.replace(/\.[^.]+$/,''), moods:suggestedMoods, tags:[], media_url:pub.publicUrl, media_type:mediaType, thumb_url:thumbUrl};
    const {data:ins, error:e2} = await sb.from(S().table).insert(item).select().single();
    if(e2){ toast('DB-Fehler: '+e2.message); return null; }
    done++;
    prog(Math.round(done/arr.length*90));
    return {...item, id:ins.id};
  };
  const CONCURRENCY = 3;
  const results = [];
  for(let i=0; i<arr.length; i+=CONCURRENCY){
    const batch = arr.slice(i, i+CONCURRENCY);
    const batchResults = await Promise.all(batch.map(uploadOne));
    results.push(...batchResults.filter(Boolean));
  }
  if(results.length){
    const newIds = results.map(i => i.id);
    await refetchItems();
    renderGrid();
    newIds.forEach(id => animateNewCell(id));
  }
  prog(100); toast(`${results.length} Datei${results.length!==1?'en':''} hochgeladen ✓`); fileInput.value='';
}

// ── DELETE MODE ─────────────────────────────────────────
function startDeleteMode(){
  closeMenu(); selMode='delete'; selectedIds.clear();
  actionBarTitle.textContent='Bilder löschen';
  actionBarMoods.innerHTML='';
  actionBar.classList.add('show'); renderGrid(); updateActionBarCount();
  $('deleteFloatingBtn')?.remove();
  const btn = document.createElement('button');
  btn.id='deleteFloatingBtn';
  btn.innerHTML='<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:20px;height:20px;display:block"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
  btn.style.cssText='position:fixed;left:20px;bottom:100px;z-index:60;width:46px;height:46px;border-radius:999px;border:1px solid rgba(255,255,255,.12);background:rgba(255,60,60,.2);color:#fff;cursor:pointer;font-size:18px;display:grid;place-items:center;backdrop-filter:blur(16px);box-shadow:0 8px 24px rgba(0,0,0,.3)';
  btn.onclick = async () => {
    if(!selectedIds.size){ toast('Nichts ausgewählt'); return; }
    showConfirmPopup(selectedIds.size+' Bilder', async () => {
      await sbDeleteMany([...selectedIds]);
      S().items = S().items.filter(i=>!selectedIds.has(i.id));
      toast('Gelöscht'); btn.remove(); exitSelMode();
    });
  };
  document.body.appendChild(btn);
}
$('pickDeleteBtn').onclick = startDeleteMode;
$('pickDeleteBtnSheet').onclick = startDeleteMode;

// ── THUMBNAIL-/WEBP-/GIF-BACKFILL (Owner) ────────────────
// Für bestehende statische Bilder: (1) Volldatei nach WebP konvertieren, falls
// sie noch kein WebP ist (verkleinert auf MAX_PX), media_url umstellen und die
// alte Datei aufräumen; (2) ein kleines Grid-Thumbnail erzeugen. Videos werden
// übersprungen. GIFs werden per Gifsicle (WASM) verlustarm re-komprimiert und
// bekommen ein verkleinertes animiertes Grid-Thumbnail – die Animation bleibt.
async function backfillThumbs(){
  if(!owner){ toast('Nur als Owner möglich'); return; }
  const marker = `/public/${BUCKET}/`;
  // Bilder erfassen, denen entweder das Thumbnail ODER das WebP-Format fehlt.
  const todo = S().items.filter(it =>
    it.media_type === 'image' && (!it.thumb_url || !/\.webp(\?|$)/i.test(it.media_url || '')));
  // GIFs ohne thumb_url gelten als unoptimiert (thumb_url dient als Marker,
  // dass Gifsicle schon drüber lief). Nur Bucket-Dateien – extern verlinkte
  // GIFs (Quick-Add per URL) lassen sich nicht ersetzen.
  const gifTodo = S().items.filter(it =>
    it.media_type === 'gif' && !it.thumb_url && /\.gif(\?|#|$)/i.test(it.media_url || '')
    && (it.media_url || '').includes(marker));
  const total = todo.length + gifTodo.length;
  if(total === 0){ toast('Alles schon optimiert ✓'); return; }
  if(!window.confirm(`${todo.length} Bilder → WebP + Thumbnail, ${gifTodo.length} GIFs → komprimieren + Thumbnail.\nJetzt starten? Das kann etwas dauern.`)) return;
  closeMenu();
  let done = 0, failed = 0, converted = 0, gifShrunk = 0;
  toast(`Verarbeite… 0/${total}`);
  for(const it of todo){
    try{
      const i = it.media_url.indexOf(marker);
      if(i < 0) throw new Error('path');                       // externe URL (Quick-Add) → überspringen
      const path = it.media_url.slice(i + marker.length).split('?')[0];
      const resp = await fetch(it.media_url);
      if(!resp.ok) throw new Error('fetch');
      const blob = await resp.blob();
      const srcFile = new File([blob], 'src', { type: blob.type || 'image/webp' });

      // (1) Volldatei → WebP, falls noch nicht WebP
      let finalPath = path, newMediaUrl = null;
      const alreadyWebp = /\.webp$/i.test(path);
      if(!alreadyWebp){
        const full = await makeThumb(srcFile, MAX_PX, 0.88);   // verkleinert nur, re-enkodiert nach WebP
        if(full){
          const wpath = path.replace(/\.[^.]+$/, '') + '.webp';
          const {error:fe} = await sb.storage.from(BUCKET).upload(wpath, full, { upsert:true, contentType:'image/webp', cacheControl:'31536000' });
          if(fe) throw fe;
          finalPath = wpath;
          newMediaUrl = sb.storage.from(BUCKET).getPublicUrl(wpath).data.publicUrl;
        }
      }

      // (2) Thumbnail (immer WebP) – Pfad parallel zur finalen Volldatei
      const tf = await makeThumb(srcFile);
      if(!tf) throw new Error('thumb');
      const tpath = `thumb/${finalPath}`;
      const {error:te} = await sb.storage.from(BUCKET).upload(tpath, tf, { upsert:true, contentType:'image/webp', cacheControl:'31536000' });
      if(te) throw te;
      const turl = sb.storage.from(BUCKET).getPublicUrl(tpath).data.publicUrl;

      const patch = { thumb_url: turl };
      if(newMediaUrl) patch.media_url = newMediaUrl;
      const {error:ue} = await sb.from(S().table).update(patch).eq('id', it.id);
      if(ue) throw ue;
      it.thumb_url = turl;
      if(newMediaUrl){ it.media_url = newMediaUrl; converted++; }

      // Alte Nicht-WebP-Originaldatei aufräumen (Pfad hat sich geändert)
      if(newMediaUrl && finalPath !== path){
        try{ await sb.storage.from(BUCKET).remove([path]); }catch(e){}
      }
    }catch(e){ failed++; }
    done++;
    prog(Math.round(done / total * 100));
    if(done % 5 === 0 || done === total) toast(`Verarbeite… ${done}/${total}`);
  }
  for(const it of gifTodo){
    try{
      const i = it.media_url.indexOf(marker);
      const path = it.media_url.slice(i + marker.length).split('?')[0];
      const resp = await fetch(it.media_url);
      if(!resp.ok) throw new Error('fetch');
      const blob = await resp.blob();
      const srcFile = new File([blob], 'src.gif', { type: 'image/gif' });

      // (1) Volldatei re-komprimieren; nur ersetzen, wenn es wirklich spart.
      // Neuer Pfad nötig: die alte Datei ist 1 Jahr immutable gecacht, ein
      // Upsert auf denselben Pfad würde Besuchern weiter die alte liefern.
      const opt = await compressGif(srcFile);
      let finalFile = srcFile, finalPath = path, newMediaUrl = null;
      if(opt !== srcFile){
        const wpath = path.replace(/\.gif$/i, '') + '-o.gif';
        const {error:fe} = await sb.storage.from(BUCKET).upload(wpath, opt, { upsert:true, contentType:'image/gif', cacheControl:'31536000' });
        if(fe) throw fe;
        finalFile = opt; finalPath = wpath;
        newMediaUrl = sb.storage.from(BUCKET).getPublicUrl(wpath).data.publicUrl;
      }

      // (2) Animiertes Grid-Thumbnail – Pfad parallel zur finalen Volldatei.
      let turl = null;
      const tf = await makeGifThumb(finalFile);
      if(tf){
        const tpath = `thumb/${finalPath}`;
        const {error:te} = await sb.storage.from(BUCKET).upload(tpath, tf, { upsert:true, contentType:'image/gif', cacheControl:'31536000' });
        if(te) throw te;
        turl = sb.storage.from(BUCKET).getPublicUrl(tpath).data.publicUrl;
      }

      // thumb_url immer setzen (notfalls auf die Volldatei), damit das GIF als
      // verarbeitet markiert ist und der Backfill es nicht erneut anfasst.
      const patch = { thumb_url: turl || newMediaUrl || it.media_url };
      if(newMediaUrl) patch.media_url = newMediaUrl;
      const {error:ue} = await sb.from(S().table).update(patch).eq('id', it.id);
      if(ue) throw ue;
      it.thumb_url = patch.thumb_url;
      if(newMediaUrl){ it.media_url = newMediaUrl; gifShrunk++; }

      // Alte, größere Originaldatei aufräumen (Pfad hat sich geändert).
      if(newMediaUrl && finalPath !== path){
        try{ await sb.storage.from(BUCKET).remove([path]); }catch(e){}
      }
    }catch(e){ failed++; }
    done++;
    prog(Math.round(done / total * 100));
    if(done % 5 === 0 || done === total) toast(`Verarbeite… ${done}/${total}`);
  }
  renderGrid();
  toast(`Fertig ✓ (${total - failed} ok, ${converted}× WebP, ${gifShrunk}× GIF verkleinert${failed ? `, ${failed} Fehler` : ''})`);
}
$('thumbBackfillBtn')?.addEventListener('click', backfillThumbs);
$('thumbBackfillBtnSheet')?.addEventListener('click', backfillThumbs);

// ── GIF → MP4 KONVERTIERUNG (Owner) ──────────────────────
// Wandelt bereits hochgeladene GIFs auf Knopfdruck in MP4 um (Uploads bleiben
// unangetastet – konvertiert wird NUR über diesen Button). media_type bleibt
// 'gif'; Clips bekommen kein Poster/Thumbnail, alte GIF-Dateien (Volldatei +
// animiertes Thumbnail) werden nach erfolgreichem Umstieg aufgeräumt.
async function convertGifsToMp4(){
  if(!owner){ toast('Nur als Owner möglich'); return; }
  const marker = `/public/${BUCKET}/`;
  // Nur Bucket-GIFs, deren Volldatei noch .gif ist – extern verlinkte lassen
  // sich nicht ersetzen, bereits konvertierte (.mp4) sind fertig.
  const todo = S().items.filter(it =>
    it.media_type === 'gif' && /\.gif(\?|#|$)/i.test(it.media_url || '')
    && (it.media_url || '').includes(marker));
  if(!todo.length){ toast('Keine GIFs zu konvertieren ✓'); return; }
  if(!window.confirm(`${todo.length} GIF${todo.length>1?'s':''} → MP4 konvertieren?\nJetzt starten? Das kann etwas dauern.`)) return;
  closeMenu();
  let done = 0, failed = 0;
  toast(`Konvertiere… 0/${todo.length}`);
  for(const it of todo){
    try{
      const i = it.media_url.indexOf(marker);
      const path = it.media_url.slice(i + marker.length).split('?')[0];
      const resp = await fetch(it.media_url);
      if(!resp.ok) throw new Error('fetch');
      const srcFile = new File([await resp.blob()], 'src.gif', { type:'image/gif' });

      const mp4 = await gifToMp4(srcFile);
      if(!mp4) throw new Error('convert');
      // Neuer Pfad statt Upsert auf .gif: die alte URL ist 1 Jahr immutable
      // gecacht, Besucher bekämen sonst weiter die alte Datei.
      const vpath = path.replace(/\.gif$/i, '') + '.mp4';
      const {error:ve} = await sb.storage.from(BUCKET).upload(vpath, mp4, { upsert:true, contentType:'video/mp4', cacheControl:'31536000' });
      if(ve) throw ve;
      const vurl = sb.storage.from(BUCKET).getPublicUrl(vpath).data.publicUrl;

      // Kein Poster/Thumbnail für Clips – das Video zeigt direkt seinen
      // ersten Frame und läuft per Autoplay.
      const oldThumb = it.thumb_url;
      const {error:ue} = await sb.from(S().table).update({ media_url: vurl, thumb_url: null }).eq('id', it.id);
      if(ue) throw ue;
      it.media_url = vurl; it.thumb_url = null;

      // Alte Dateien aufräumen: GIF-Volldatei + evtl. animiertes GIF-Thumbnail.
      const oldPaths = [path];
      if(oldThumb && oldThumb.includes(marker)){
        const op = oldThumb.slice(oldThumb.indexOf(marker) + marker.length).split('?')[0];
        if(op !== path) oldPaths.push(op);
      }
      try{ await sb.storage.from(BUCKET).remove(oldPaths); }catch(e){}
    }catch(e){ failed++; }
    done++;
    prog(Math.round(done / todo.length * 100));
    if(done % 3 === 0 || done === todo.length) toast(`Konvertiere… ${done}/${todo.length}`);
  }
  renderGrid();
  toast(`Fertig ✓ (${todo.length - failed} GIF${todo.length - failed !== 1 ? 's' : ''} → MP4${failed ? `, ${failed} Fehler` : ''})`);
}
$('gifConvertBtn')?.addEventListener('click', convertGifsToMp4);
$('gifConvertBtnSheet')?.addEventListener('click', convertGifsToMp4);

function openEditor(id){
  editId=id; const it=S().items.find(x=>x.id===id); if(!it) return;
  $('editorTitle').textContent = it.title||'Item';
  $('tagInput').value = (it.tags||[]).join(', ');
  editorWrap.classList.add('show'); renderTagChips(); dropdown.classList.add('show');
}
function renderTagChips(){
  const it = S().items.find(x=>x.id===editId);
  $('tagChips').innerHTML = S().moods.filter(m=>m!=='All').map(m =>
    `<button class="tchip ${it&&Array.isArray(it.moods) && it.moods.includes(m)?'active':''}" data-m="${m}">${m}</button>`).join('');
  document.querySelectorAll('.tchip').forEach(b => b.onclick = () => {
    const it=S().items.find(x=>x.id===editId); if(!it) return;
    if(!Array.isArray(it.moods)) it.moods = [];
    const m = b.dataset.m;
    const idx = it.moods.indexOf(m);
    if(idx > -1) it.moods.splice(idx, 1); else it.moods.push(m);
    sbUpdate(it); renderGrid(); renderTagChips();
  });
}
$('saveTagsBtn').onclick = () => {
  const it=S().items.find(x=>x.id===editId); if(!it) return;
  it.tags = $('tagInput').value.split(',').map(s=>s.trim()).filter(Boolean);
  sbUpdate(it); renderGrid(); toast('Tags gespeichert');
};

// Boot-Bilder, die noch auf ihre URL warten (data-src), sofort normal
// anstoßen – Fallback, falls der Loading Screen schon weg ist, das Timeout
// zuschlägt oder ein Re-Render während des Boots neue Kacheln erzeugt hat.
// (Nur die Eager-Bilder: die restlichen gehören der Prefetch-Warteschlange.)
function flushBootSrcs(){
  gridEl.querySelectorAll('img[data-src][data-eager="1"]').forEach(im => {
    im.src = im.dataset.src;
    im.removeAttribute('data-src');
  });
}

// Den Loading Screen erst ausblenden, wenn die vorgeladenen Kacheln (die
// ~40 "eager" markierten der ersten Reihen) wirklich fertig sind – GIFs
// eingeschlossen. Geladen wird in Batches: max. BOOT_CONCURRENCY parallel,
// GIFs zuerst (größte Dateien), sobald eins fertig ist startet das nächste.
// Der Fortschrittsbalken zeigt echten Fortschritt: bis ~12 % kriecht er
// während der Datenphase (Inline-Script in index.html), ab 15 % zählt er
// die geladenen Bilder hoch. Sicherheits-Timeout, damit der Screen nie
// hängen bleibt (langsames Netz/Fehler).
function revealWhenReady(){
  const boot = $('bootMsg');
  if(!boot){ _bootPending = false; flushBootSrcs(); pumpImgQueue(); return; }
  const queue = [...gridEl.querySelectorAll('img[data-src][data-eager="1"]')];
  // GIFs an den Anfang der Warteschlange: sie brauchen am längsten und
  // sollen beim Ausblenden sicher fertig sein.
  queue.sort((a, b) => (b.dataset.gif ? 1 : 0) - (a.dataset.gif ? 1 : 0));
  const fill = $('lsBarFill'), pct = $('lsPercent');
  const setProgress = f => {
    const p = Math.round(Math.max(0, Math.min(1, f)) * 100);
    if(fill) fill.style.width = p + '%';
    if(pct) pct.textContent = p + '%';
  };
  let done = false;
  const finish = () => {
    if(done) return; done = true;
    _bootPending = false;
    flushBootSrcs();
    // Jetzt darf der Prefetch loslegen: der Observer hat die Kacheln der
    // nächsten Viewports während des Boots bereits eingesammelt.
    pumpImgQueue();
    setProgress(1);
    // Die 100 % kurz stehen lassen, dann pixelig ausblenden und entfernen.
    setTimeout(() => {
      boot.classList.add('hide');
      setTimeout(() => boot.remove(), 500);
    }, 200);
    // Aufgeschobener Eingangs-Tween der ersten Kacheln – während des Boots
    // hat der Loading Screen das Grid verdeckt (s. renderGrid).
    if(_isInitialLoad && typeof gsap !== 'undefined'){
      const targets = [...gridEl.querySelectorAll('.cell')].slice(0, Math.max(queue.length, 12));
      if(targets.length){
        gsap.from(targets, {
          opacity: 0, y: 12, duration: 0.4,
          stagger: { amount: Math.min(0.35, targets.length * 0.03), from: 'start' },
          ease: 'power2.out', clearProps: 'transform,opacity'
        });
      }
      _isInitialLoad = false;
    }
  };
  if(queue.length === 0){ finish(); return; }
  let started = 0, loaded = 0;
  setProgress(0.15);
  const startNext = () => {
    if(started >= queue.length) return;
    const im = queue[started++];
    const step = () => {
      loaded++;
      setProgress(0.15 + 0.85 * (loaded / queue.length));
      if(loaded >= queue.length) finish(); else startNext();
    };
    im.addEventListener('load', step, { once:true });
    im.addEventListener('error', step, { once:true });
    im.src = im.dataset.src;
    im.removeAttribute('data-src');
  };
  for(let i = 0; i < BOOT_CONCURRENCY; i++) startNext();
  setTimeout(finish, 15000);
}

async function loadItems(){
  const {data,error} = await sb.from(S().table)
    .select('id,title,moods,tags,media_url,media_type,thumb_url')
    .order('created_at',{ascending:false});
  if(error){ toast('Ladefehler: '+error.message); gridEl.innerHTML='<div style="padding:24px;color:#fff">Kein Datenzugriff</div>'; _bootPending = false; $('bootMsg')?.remove(); return; }
  S().items=data||[];
  mergeMoodsFromItems();
  renderGrid(); revealWhenReady();
  renderMoodChips();
  if(typeof moodsViewOpen !== 'undefined' && moodsViewOpen) renderMoodsView();
  tryOpenPendingShare();
}

// Merge any mood tags found on items into the local moods list so moods
// created on another device appear here too. The moods list is otherwise
// only persisted per-device in localStorage.
function mergeMoodsFromItems(){
  const known = new Set(S().moods);
  let changed = false;
  for(const it of S().items){
    if(!Array.isArray(it.moods)) continue;
    for(const m of it.moods){
      if(typeof m !== 'string') continue;
      const trimmed = m.trim();
      if(!trimmed || known.has(trimmed)) continue;
      S().moods.push(trimmed);
      known.add(trimmed);
      changed = true;
    }
  }
  if(changed) saveMoodsList();
}
async function sbUpdate(item){
  if(!item) return;
  await sb.from(S().table).update({title:item.title||'', moods:item.moods||[], tags:item.tags||[], media_url:item.media_url, media_type:item.media_type}).eq('id',item.id);
}
async function sbDeleteMany(ids){
  if(!ids.length) return;
  await sb.from(S().table).delete().in('id',ids);
}

// ── Cross-device live sync ────────────────────────────────
// Refetch silently so other devices see uploads / mood-tag changes
// without a manual reload. Skipped while a modal/lightbox is open
// to avoid yanking state out from under the user.
let _syncTimer = null;
function isUiBusy(){
  return (typeof lightbox!=='undefined' && lightbox.classList.contains('show'))
    || (typeof moodCreateModal!=='undefined' && moodCreateModal && moodCreateModal.classList.contains('show'))
    || bottomSheet.classList.contains('show')
    || (typeof moodsMgmtPopup!=='undefined' && moodsMgmtPopup && moodsMgmtPopup.classList.contains('show'))
    || (typeof confirmPopup!=='undefined' && confirmPopup && confirmPopup.classList.contains('show'))
    || !!document.getElementById('infoPage')?.classList.contains('show')
    || !!document.getElementById('gbPage')?.classList.contains('show');
}
async function refetchItems(){
  if(isUiBusy()){ scheduleSync(1500); return; }
  const {data,error} = await sb.from(S().table)
    .select('id,title,moods,tags,media_url,media_type,thumb_url')
    .order('created_at',{ascending:false});
  if(error) return;
  S().items = data || [];
  mergeMoodsFromItems();
  // Kein renderGrid() – die aktuelle Ansicht bleibt erhalten.
  // Neu geladene Items erscheinen beim nächsten renderGrid()-Aufruf.
  renderMoodChips();
  if(typeof moodsViewOpen !== 'undefined' && moodsViewOpen) renderMoodsView();
}
function scheduleSync(delay){
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(refetchItems, delay ?? 400);
}
function subscribeRealtime(){
  try{
    sb.channel('moodboard_items_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'moodboard_items' },
          () => scheduleSync(300))
      .subscribe();
  }catch(e){}
}
document.addEventListener('visibilitychange', () => {
  if(document.visibilityState === 'visible') scheduleSync(0);
});
window.addEventListener('focus', () => scheduleSync(0));
window.addEventListener('online', () => scheduleSync(0));

// ── Moods Overview Page ───────────────────────────────────
let moodsViewOpen = false;
const moodsView = $('moodsView');
const moodsGrid = $('moodsGrid');
const boardTitle = $('boardTitle');

// Wählt ein zufälliges Item (Bild/Video) aus einer Mood aus
function pickMainItem(mood){
  const items = S().items.filter(x => Array.isArray(x.moods) && x.moods.includes(mood));
  return items.length ? items[Math.floor(Math.random() * items.length)] : null;
}

function renderMoodsView(){
  const moods = S().moods.filter(m => m !== 'All');
  const tilesHtml = moods.map((m, i) => {
    const it = pickMainItem(m);
    const count = S().items.filter(x => Array.isArray(x.moods) && x.moods.includes(m)).length;
    const media = it
      ? (isClip(it)
          ? `<video src="${it.media_url}" muted loop playsinline ${autoplayMedia ? 'autoplay ' : ''}preload="metadata"></video>`
          : `<img src="${it.media_url}" loading="lazy" decoding="async" alt="">`)
      : `<div class="mt-empty">Kein Bild</div>`;
    return `
      <div class="mood-tile" data-m="${m}">
        ${media}
        <div class="mt-overlay"></div>
        <div class="mt-label">
          <span class="mt-icon">${moodIcon(m)}</span>
          <span>${m}</span>
          <span class="mt-count">${count}</span>
        </div>
      </div>`;
  }).join('');
  const createTile = `
    <div class="mood-tile mood-tile-create" id="moodCreateTile" title="Neue Mood erstellen">
      <div class="mtc-inner">
        <div class="mtc-plus">+</div>
        <div class="mtc-label">Neue Mood</div>
      </div>
    </div>`;
  moodsGrid.innerHTML = tilesHtml + createTile;
  // GIFs in den Mood-Kacheln bei deaktiviertem Autoplay einfrieren.
  if(!autoplayMedia) applyAutoplayState(moodsGrid);
  const createBtn = document.getElementById('moodCreateTile');
  if(createBtn) createBtn.onclick = openMoodCreate;
  moodsGrid.querySelectorAll('.mood-tile:not(.mood-tile-create)').forEach(tile => {
    tile.onclick = e => {
      const m = tile.dataset.m;
      activeMoods = new Set([m]);
      saveFilterState();
      hideMoodsView();
      // renderGrid() wird bereits in hideMoodsView() aufgerufen
    };
  });
}

let _moodsAnimating = false;

function showMoodsView(){
  if(_moodsAnimating) return;
  _moodsAnimating = true;
  moodsViewOpen = true;
  // Ausstehenden Sync abbrechen – kein renderGrid() während der Animation
  clearTimeout(_syncTimer);
  closeMenu(); closeLb();
  // Selection-Mode zurücksetzen OHNE renderGrid() – das Grid wird gleich ausgeblendet
  selMode = null; selectedIds.clear();
  actionBar.classList.remove('show');
  // GridWrap ausblenden (scale down + fade)
  gridWrap.classList.add('hide-view');
  // Bottombar umschalten (Buttons schrumpfen)
  document.getElementById('bottombar').classList.add('moods-active');
  document.getElementById('moodsMgmtBtn').classList.add('show');
  // Nach der Ausblend-Animation: Grid verstecken, MoodsView einblenden
  setTimeout(() => {
    gridWrap.style.display = 'none';
    gridWrap.classList.remove('hide-view');
    moodsView.classList.add('show');
    boardTitle.classList.remove('active');
    renderMoodsView();
    window.scrollTo(0, 0);
    _moodsAnimating = false;
  }, 500);
  currentView = 'moods';
}
function hideMoodsView(target){
  if(_moodsAnimating) return;
  target = (target === 'recent') ? 'recent' : 'archive';
  _moodsAnimating = true;
  moodsViewOpen = false;
  // Ausstehenden Sync abbrechen – kein renderGrid() während der Animation
  clearTimeout(_syncTimer);
  // MoodsView ausblenden (scale down + fade) – funktioniert jetzt via visibility
  moodsView.classList.remove('show');
  // Bottombar zurücksetzen (Buttons wachsen)
  document.getElementById('bottombar').classList.remove('moods-active');
  document.getElementById('moodsMgmtBtn').classList.remove('show');
  // Nach der Ausblend-Animation: GridWrap einblenden
  setTimeout(() => {
    gridWrap.style.display = '';
    window.scrollTo(0, 0);   // vor dem Render nach oben – eager-Kacheln = sichtbare
    renderGrid(); // sortNewest steuert: shuffle (Archive) bzw. neueste zuerst (Recent)
    // Animation starten: kurz warten bis display gesetzt ist
    requestAnimationFrame(() => {
      gridWrap.classList.add('show-view');
      // Nach der Animation die Klasse entfernen
      setTimeout(() => {
        gridWrap.classList.remove('show-view');
        _moodsAnimating = false;
      }, 500);
    });
    boardTitle.classList.add('active');
  }, 500);
  currentView = target;
}
boardTitle.classList.add('active');

// ── VIEW-STATE / NAVIGATION ───────────────────────────────
let currentView = 'archive';   // 'archive' | 'recent' | 'moods'

// Gemeinsame Logik für die beiden Grid-Ansichten:
// 'archive' = zufällige Anordnung, 'recent' = zuletzt hinzugefügt zuerst
function showGridView(view){
  sortNewest = (view === 'recent');
  clearChatResults();
  if(currentView === 'moods'){
    hideMoodsView(view);       // animiert zurück, setzt State selbst
    return;
  }
  currentView = view;
  // Ansichtswechsel (Archive-Shuffle bzw. Recent) ordnet neu → instant nach
  // oben + rendern, damit die sichtbaren Kacheln sofort laden (renderFromTop).
  renderFromTop();
}

function goArchive(){ showGridView('archive'); }
function goRecent(){ showGridView('recent'); }

function goMoods(){
  if(currentView === 'moods') return;
  clearChatResults();
  showMoodsView();             // setzt State selbst
}

// ── Create Mood Modal ─────────────────────────────────────
const moodCreateModal = $('moodCreateModal');
const mcmInput = $('mcmInput');
const mcmError = $('mcmError');
function openMoodCreate(){
  mcmInput.value = '';
  mcmError.classList.remove('show');
  mcmError.innerHTML = '&nbsp;';
  moodCreateModal.classList.add('show');
  updateBodyLock();
  setTimeout(() => mcmInput.focus(), 60);
}
function closeMoodCreate(){
  moodCreateModal.classList.remove('show');
  updateBodyLock();
}
function showMcmError(msg){
  mcmError.textContent = msg;
  mcmError.classList.add('show');
}
async function confirmCreateMood(){
  const raw = mcmInput.value.trim();
  if(!raw){ showMcmError('Bitte einen Namen eingeben'); return; }
  if(raw.length < 2){ showMcmError('Mindestens 2 Zeichen'); return; }
  // case-insensitive duplicate check
  const exists = S().moods.some(m => m.toLowerCase() === raw.toLowerCase());
  if(exists){ showMcmError('Diese Mood existiert bereits'); return; }
  S().moods.push(raw);
  saveMoodsList();
  renderMoodChips();
  if(moodsViewOpen) renderMoodsView();
  closeMoodCreate();
  toast(`Mood „${raw}" erstellt ✓`);
}
$('mcmConfirm').onclick = confirmCreateMood;
$('mcmCancel').onclick = closeMoodCreate;
mcmInput.addEventListener('keydown', e => {
  if(e.key === 'Enter') confirmCreateMood();
  else if(e.key === 'Escape') closeMoodCreate();
});
moodCreateModal.addEventListener('click', e => {
  if(e.target === moodCreateModal) closeMoodCreate();
});

// ── Moods Management Popup ─────────────────────────────
const moodsMgmtPopup = $('moodsMgmtPopup');
const mmgList = $('mmgList');
const mmgInput = $('mmgInput');
const mmgAddBtn = $('mmgAddBtn');
const mmgClose = $('mmgClose');

function renderMoodsMgmt(){
  const moods = S().moods.filter(m => m !== 'All');
  mmgList.innerHTML = moods.map(m => {
    const count = S().items.filter(x => Array.isArray(x.moods) && x.moods.includes(m)).length;
    return `<div class="mmg-item">
      <span class="mmg-icon">${moodIcon(m)}</span>
      <span class="mmg-name">${m}</span>
      <span class="mmg-count">${count}</span>
      <button class="mmg-del" data-m="${m}" aria-label="Löschen">
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;display:block">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>`;
  }).join('');
  mmgList.querySelectorAll('.mmg-del').forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      const m = btn.dataset.m;
      showConfirmPopup(m, () => {
        S().moods = S().moods.filter(x => x !== m);
        saveMoodsList();
        for(const it of S().items){
          if(Array.isArray(it.moods)){
            const idx = it.moods.indexOf(m);
            if(idx >= 0){ it.moods.splice(idx, 1); sbUpdate(it); }
          }
        }
        renderMoodsMgmt();
        if(moodsViewOpen) renderMoodsView();
        renderGrid();
        toast(`Mood „${m}" gelöscht`);
      });
    };
  });
}

$('moodsMgmtBtn').onclick = () => {
  moodsMgmtPopup.classList.add('show');
  renderMoodsMgmt();
  updateBodyLock();
  setTimeout(() => mmgInput.focus(), 60);
};

function closeMoodsMgmt(){
  moodsMgmtPopup.classList.remove('show');
  updateBodyLock();
}

// ── Confirm Delete Popup ─────────────────────────────
const confirmPopup = $('confirmPopup');
const cfmMoodName = $('cfmMoodName');
const cfmYes = $('cfmYes');
const cfmNo = $('cfmNo');
const cfmClose = $('cfmClose');

let _cfmCallback = null;

function showConfirmPopup(moodName, onConfirm){
  cfmMoodName.textContent = `„${moodName}"`;
  confirmPopup.classList.add('show');
  updateBodyLock();
  _cfmCallback = onConfirm;
}

function closeConfirmPopup(){
  confirmPopup.classList.remove('show');
  updateBodyLock();
  _cfmCallback = null;
}

cfmYes.onclick = () => {
  const cb = _cfmCallback;
  closeConfirmPopup();
  if(cb) cb();
};

cfmNo.onclick = closeConfirmPopup;
cfmClose.onclick = closeConfirmPopup;
confirmPopup.addEventListener('click', e => {
  if(e.target === confirmPopup) closeConfirmPopup();
});

mmgClose.onclick = closeMoodsMgmt;
moodsMgmtPopup.addEventListener('click', e => {
  if(e.target === moodsMgmtPopup) closeMoodsMgmt();
});

mmgAddBtn.onclick = () => {
  const raw = mmgInput.value.trim();
  if(!raw){ toast('Bitte einen Namen eingeben'); return; }
  if(raw.length < 2){ toast('Mindestens 2 Zeichen'); return; }
  const exists = S().moods.some(m => m.toLowerCase() === raw.toLowerCase());
  if(exists){ toast('Diese Mood existiert bereits'); return; }
  S().moods.push(raw);
  saveMoodsList();
  renderMoodsMgmt();
  if(moodsViewOpen) renderMoodsView();
  renderGrid();
  mmgInput.value = '';
  toast(`Mood „${raw}" erstellt ✓`);
};

mmgInput.addEventListener('keydown', e => {
  if(e.key === 'Enter') mmgAddBtn.click();
  else if(e.key === 'Escape') closeMoodsMgmt();
});

// ── Info-Page ─────────────────────────────────────────────
// Öffnet sich innerhalb der App (keine Weiterleitung): eine vollflächige
// Seite legt sich über das Grid. Inhalt folgt später.
// will-change nur kurz während der Auf-/Zu-Animation setzen, danach wieder
// entfernen – ein dauerhaftes will-change würde den Compositor zwingen, die
// Vollbild-Ebene permanent als eigenen Layer vorzuhalten.
let _infoAnimTimer = null;
function markInfoAnimating(page){
  page.classList.add('is-animating');
  clearTimeout(_infoAnimTimer);
  _infoAnimTimer = setTimeout(() => page.classList.remove('is-animating'), 320);
}
function openInfoPage(){
  const page = $('infoPage');
  if(!page) return;
  closeAllOverlays();
  const sc = page.querySelector('.info-scroll');
  if(sc) sc.scrollTop = 0;
  markInfoAnimating(page);
  page.classList.add('show');
  page.setAttribute('aria-hidden','false');
  updateBodyLock();
}
function closeInfoPage(){
  const page = $('infoPage');
  if(!page) return;
  markInfoAnimating(page);
  page.classList.remove('show');
  page.setAttribute('aria-hidden','true');
  updateBodyLock();
}
function isInfoPageOpen(){ return !!$('infoPage')?.classList.contains('show'); }
$('infoBtn')?.addEventListener('click', e => { e.stopPropagation(); openInfoPage(); });
$('infoClose')?.addEventListener('click', closeInfoPage);

// ── Login-Modal-Bindings ──────────────────────────────────
$('loginBtn').onclick = handleLoginBtn;
$('loginSubmit').onclick = submitLogin;
$('loginClose').onclick = closeLoginModal;
$('loginEmail').addEventListener('keydown', e => { if (e.key === 'Enter') $('loginPassword')?.focus(); });
$('loginPassword')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') submitLogin();
  else if (e.key === 'Escape') closeLoginModal();
});
$('loginModal').addEventListener('click', e => { if (e.target === $('loginModal')) closeLoginModal(); });

// ── Brücke für den Mood-Chat (js/mood-chat.js) ────────────
// Der Chat ermittelt passende Bild-IDs (aus ai_tags) und übergibt sie hier.
// Die Treffer werden direkt im Haupt-Grid angezeigt – keine Extraseite.
function clearChatResults(){
  if(chatResultIds === null) return;
  chatResultIds = null;
  renderGrid();
}
function showChatResults(ids){
  // Erst auf eine Grid-Ansicht wechseln (goArchive räumt evtl. Chat-State ab),
  // DANN die Treffer setzen und rendern – sonst würde goArchive sie löschen.
  if(currentView === 'moods') goArchive();
  chatResultIds = Array.isArray(ids) ? ids : null;
  // Wie beim Shuffle: erst instant nach oben, DANN rendern (renderFromTop) –
  // so laden die sichtbaren Treffer sofort (smoothes Schema) statt lange zu
  // spinnern, wie es der frühere renderGrid()+Smooth-Scroll verursacht hat.
  renderFromTop();
  return S().currentItems.length;   // tatsächlich sichtbare Treffer
}
// Vom Mood-Chat aus zur Ansicht „Zuletzt hinzugefügt" wechseln (Chip unter den Emojis).
function showRecentView(){
  // Instant nach oben VOR dem Rendern (goRecent → renderGrid), damit die oben
  // sichtbaren Kacheln sofort laden statt zu spinnern (s. renderFromTop).
  window.scrollTo(0, 0);
  clearChatResults();
  goRecent();
}
// Object.assign statt Zuweisung: bewahrt Helfer, die zuvor gesetzt wurden
// (z. B. window.MB.closeSpotify aus dem Inline-Script in index.html).
window.MB = Object.assign(window.MB || {}, {
  showChatResults,
  clearChatResults,
  showRecentView,
  // Fürs Gästebuch (js/guestbook.js): Toasts und Scroll-Lock der Haupt-App.
  toast,
  updateBodyLock,
  // Lightbox der Haupt-App wiederverwenden (Swipe/Ambient inklusive).
  openItems(items, idx){
    state.moodboard.currentItems = items;
    openLightbox(idx);
  }
});

// ── Bottom-Bar-Popups gegenseitig ausschließen ─────────────
// Spotify, Kachelgröße (Filter) und Chat teilen sich denselben Platz über der
// Bottom-Bar. Öffnet man eins, schließen die anderen – per CSS-Transition
// entsteht so eine sanfte Überblendung statt eines Übereinanderstapelns.
window.MB.closeOtherPopups = function(except){
  if(except !== 'spotify') window.MB.closeSpotify?.();
  if(except !== 'filter')  window.MB.closeFilter?.();
  if(except !== 'chat')    window.MB.closeChat?.();
};

// ── Zugriffe-Verwaltung (nur Owner) ───────────────────────
// Liste der Gate-Anfragen: annehmen / ablehnen / sperren / entsperren.
// Lesen läuft über RLS (nur Owner), Entscheidungen über die Edge
// Function "gate", weil dafür Admin-Rechte (User anlegen/bannen) nötig sind.
const accessPopup = $('accessPopup');
const accList = $('accList');
const ACC_STATE_LABEL = { pending: 'Offen', approved: 'Frei', blocked: 'Gesperrt' };
const ACC_ACTIONS = {
  pending:  [['Annehmen', 'approve', 'yes'], ['Ablehnen', 'block', 'no']],
  approved: [['Sperren', 'block', 'no']],
  blocked:  [['Freigeben', 'unblock', 'yes']],
};

async function refreshAccessBadge() {
  if (!owner) return;
  const { count, error } = await sb.from('access_requests')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');
  if (error) return;
  $('hubAccessItem')?.classList.toggle('has-pending', (count ?? 0) > 0);
}

async function renderAccessList() {
  accList.innerHTML = '<div class="acc-empty">Lade…</div>';
  const { data, error } = await sb.from('access_requests')
    .select('id,name,email,status,created_at')
    .order('created_at', { ascending: false });
  if (error) { accList.innerHTML = '<div class="acc-empty">Fehler beim Laden</div>'; return; }
  if (!data?.length) { accList.innerHTML = '<div class="acc-empty">Noch keine Anfragen</div>'; return; }
  accList.innerHTML = '';
  for (const row of data) {
    const el = document.createElement('div');
    el.className = 'acc-row';
    const meta = document.createElement('div');
    meta.className = 'acc-meta';
    const nameEl = document.createElement('div');
    nameEl.className = 'acc-name';
    nameEl.textContent = row.name;          // textContent: Namen kommen von Fremden
    const mailEl = document.createElement('div');
    mailEl.className = 'acc-mail';
    mailEl.textContent = row.email;
    meta.append(nameEl, mailEl);
    const state = document.createElement('span');
    state.className = 'acc-state ' + row.status;
    state.textContent = ACC_STATE_LABEL[row.status] || row.status;
    const actions = document.createElement('div');
    actions.className = 'acc-actions';
    for (const [label, decision, cls] of (ACC_ACTIONS[row.status] || [])) {
      const b = document.createElement('button');
      b.className = 'acc-btn ' + cls;
      b.textContent = label;
      b.onclick = () => decideAccess(row.id, decision, b);
      actions.appendChild(b);
    }
    el.append(meta, state, actions);
    accList.appendChild(el);
  }
}

async function decideAccess(id, decision, btn) {
  btn.disabled = true;
  const { data, error } = await sb.functions.invoke('gate', {
    body: { action: 'decide', id, decision },
  });
  if (error || !data?.ok) {
    btn.disabled = false;
    toast('Aktion fehlgeschlagen');
    return;
  }
  toast(data.status === 'approved' ? 'Freigegeben ✓' : 'Gesperrt');
  renderAccessList();
  refreshAccessBadge();
}

$('accessBtn')?.addEventListener('click', () => {
  accessPopup.classList.add('show');
  renderAccessList();
});
$('accClose')?.addEventListener('click', () => accessPopup.classList.remove('show'));
accessPopup?.addEventListener('click', (e) => {
  if (e.target === accessPopup) accessPopup.classList.remove('show');
});

// ── App starten ───────────────────────────────────────────
// initGate() entscheidet: gültige Session → App booten; sonst bleibt das
// Gate stehen und startApp() wird erst nach erfolgreichem Login von dort
// aufgerufen. Doppelstart ist über _appStarted abgesichert.
let _appStarted = false;
function startApp() {
  if (_appStarted) return;
  _appStarted = true;
  renderMoodChips();
  applyGridCols(gridCols);
  loadItems();
  subscribeRealtime();
  refreshAccessBadge();
}

(async () => {
  initGateUI();
  const allowed = await initGate();
  if (allowed) startApp();
})();

window.addEventListener('resize', () => {
  // Clamp gridCols to the new range when crossing mobile/desktop boundary
  const r = getColRange();
  const clamped = Math.max(r.min, Math.min(r.max, gridCols));
  if(clamped !== gridCols) applyGridCols(clamped);
  else applyGridCols(gridCols);
});

// ── Filter popup open/close ────────────────────────────────
const filterPopup = document.getElementById('filterPopup');
const filterBtn   = document.getElementById('filterBtn');
window.MB.closeFilter = () => { filterPopup.classList.remove('show'); };
filterBtn.onclick = e => {
  e.stopPropagation();
  const willOpen = !filterPopup.classList.contains('show');
  if(willOpen) window.MB.closeOtherPopups?.('filter');
  filterPopup.classList.toggle('show');
};
document.addEventListener('click', e => {
  if(!e.target.closest('#filterPopup') && !e.target.closest('#filterBtn'))
    filterPopup.classList.remove('show');
});

// ── Neue Items beim Upload animieren ─────────────────────
function animateNewCell(id){
  const cell = gridEl.querySelector(`.cell[data-id="${id}"]`);
  if(cell && typeof gsap !== 'undefined'){
    gsap.fromTo(cell,{opacity:0,scale:0.85},{opacity:1,scale:1,duration:0.4,ease:'back.out(1.4)'});
  }
}

// ── „Nach oben"-Button im Ende-Disclaimer ────────────────
$('gridEndTop')?.addEventListener('click', scrollToTop);

