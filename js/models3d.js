// ============================================================================
// 3D-Modell-Inventar — Marvin's Place
// ----------------------------------------------------------------------------
// Öffnet sich als vollflächige, deckend schwarze Seite (wie Info-/Gästebuch-
// Seite) über den "3D Modelle"-Eintrag in der Navigations-Vorschau (js/nav.js).
// Aufbau: OBEN ein großes, live drehendes 3D-Modell (#m3dFeatured, genau ein
// WebGL-Viewer), DARUNTER ein cleanes Grid aus statischen Vorschaubildern aller
// Modelle (#m3dGrid, ohne Namen). Ein Klick auf eine Kachel lädt das Modell oben
// und scrollt dorthin; ein Tipp auf das große Modell öffnet es im Viewer-Overlay
// mit voller Steuerung (drehen/zoomen). Der Name steht unter der großen Ansicht.
//
// Tages-Rotation: Das Startmodell oben und die Reihenfolge des Grids richten
// sich nach einer pro Kalendertag zufälligen, aber deterministischen Reihenfolge
// (siehe dailyState): jedes Modell kommt einmal je Runde als „Modell des Tages"
// dran, danach beginnt die Runde neu gemischt. Deterministisch ⇒ für alle
// Besucher gleich und über Reloads stabil, ohne gespeicherten Zustand.
//
// Performance:
//  · Die Übersicht sind statische Bilder (kein WebGL pro Kachel); live läuft nur
//    das eine große Modell oben. So ist alles auf einen Blick sichtbar, ohne
//    dutzende Viewer/WebGL-Kontexte gleichzeitig.
//  · Vorschaubilder werden einmalig im Browser per <model-viewer>.toBlob()
//    erzeugt: beim Upload automatisch, für Altbestand per Owner-Backfill
//    („Vorschaubilder erzeugen"). Sie liegen im Storage unter models/thumbs/,
//    die URL in models_3d.thumb_url.
//  · Die <model-viewer>-Bibliothek wird erst beim ersten Öffnen dieser Seite
//    dynamisch importiert; die Modell-Liste wird gecacht und still abgeglichen.
//
// Verwaltung (nur Owner): Upload, Bearbeiten, Löschen und der Vorschaubild-
// Backfill laufen gebündelt im "3D-Modelle verwalten"-Popup (#m3dManage), das
// über den Verwalten-Tab des Header-Menüs geöffnet wird. Das Upload-Sheet
// (#m3dModal) dient auch als Editor; eine neue Datei ersetzt das Modell optional
// und erzeugt automatisch ein neues Vorschaubild.
//
// Die Datei landet im Storage-Bucket `moodboard` unter models/, der Datensatz
// in public.models_3d (RLS: lesen Mitglieder, schreiben/löschen nur Owner –
// siehe db/models_3d.sql).
// ============================================================================

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://uvfuxnwinuakbqanaxtp.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2ZnV4bndpbnVha2JxYW5heHRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxNzg3MDIsImV4cCI6MjA5NTc1NDcwMn0.quSvaycB3Yk2JXCnQz7AQmHpyATtx6u0U8aGQXD73fo';
const BUCKET = 'moodboard';
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = id => document.getElementById(id);

const page   = $('m3dPage');
const grid   = $('m3dGrid');
const featuredHost = $('m3dFeatured');   // große, drehende Modellansicht oben
const modal  = $('m3dModal');
const viewer = $('m3dViewer');
const manage = $('m3dManage');

function toast(t){ window.MB?.toast ? window.MB.toast(t) : console.log(t); }

async function isOwner(){
  try{
    const { data: { session } } = await sb.auth.getSession();
    return session?.user?.app_metadata?.role === 'owner';
  }catch(e){ return false; }
}

// ── <model-viewer> erst bei Bedarf laden ───────────────────────────────────
// Spart die komplette Bibliothek (inkl. Three.js) beim App-Start; sie wird
// beim ersten Öffnen der Seite geholt, während die Daten parallel laden.
let _libPromise = null;
function ensureViewerLib(){
  if(!_libPromise){
    _libPromise = customElements.get('model-viewer')
      ? Promise.resolve()
      : import('https://cdn.jsdelivr.net/npm/@google/model-viewer@3.5.0/dist/model-viewer.min.js')
          .catch(err => { _libPromise = null; throw err; });
  }
  return _libPromise;
}

// ── Kategorien ─────────────────────────────────────────────────────────────
// Feste Inventar-Kategorien (Slug ↔ Anzeigename). Die Reihenfolge bestimmt die
// Anzeige-Reihenfolge überall: Filter-Chips im Inventar, Auswahl im Upload-
// Sheet und die Gruppen im Verwalten-Popup. Der Slug steht in der Spalte
// models_3d.category (siehe db/models_3d.sql), der Anzeigename bleibt im UI.
const CATEGORIES = [
  { slug: 'chars',   label: 'Chars' },
  { slug: 'devices', label: 'Devices & Games' },
  { slug: 'sports',  label: 'Sports' },
  { slug: 'random',  label: 'Random Items' },
];
const DEFAULT_CAT = 'chars';   // Vorauswahl beim Hochladen (erste Kategorie)
const FALLBACK_CAT = 'random'; // für Altbestand/Unbekanntes ("Random Items")
const CAT_LABEL = Object.fromEntries(CATEGORIES.map(c => [c.slug, c.label]));
function catOf(m){ return CAT_LABEL[m?.category] ? m.category : FALLBACK_CAT; }

// ── Inventar-Zustand ───────────────────────────────────────────────────────
let _models   = null;    // Cache der geladenen Datensätze (neueste zuerst)
let _owner    = false;
let _featured = null;     // Modell, das gerade oben groß gedreht wird

// ── Seite öffnen / schließen ───────────────────────────────────────────────
let _animTimer = null;
function markAnimating(){
  page.classList.add('is-animating');
  clearTimeout(_animTimer);
  _animTimer = setTimeout(() => page.classList.remove('is-animating'), 320);
}
function openPage(){
  window.MB?.closeOtherPopups?.();
  window.MB?.closeInfoPage?.();
  window.MB?.closeGuestbook?.();   // nie zwei Vollbild-Seiten übereinander
  window.MB?.closeTama?.();
  markAnimating();
  page.classList.add('show');
  page.setAttribute('aria-hidden', 'false');
  window.MB?.updateBodyLock?.();
  window.MB?.kickAutoplay?.();
  ensureViewerLib().catch(() => {});   // Bibliothek parallel zu den Daten holen
  loadModels();
}
function closePage(){
  markAnimating();
  page.classList.remove('show');
  page.setAttribute('aria-hidden', 'true');
  closeViewer();
  window.MB?.updateBodyLock?.();
}
$('m3dClose')?.addEventListener('click', closePage);

// Fürs gegenseitige Ausschließen der Glas-Popups (app.js) und die Nav-Vorschau.
window.MB = Object.assign(window.MB || {}, { openModels: openPage, closeModels: closePage });

// ── Lazy-Mounting der 3D-Bühnen ────────────────────────────────────────────
// Jede Bühne startet als leichter Platzhalter (Spinner). Erst wenn
// sie in die Nähe des sichtbaren Bereichs scrollt, wird der <model-viewer>
// eingehängt – und beim Herausscrollen wieder entfernt (WebGL freigeben).
let _io = null;
let _gridPaused = false;   // true, solange der Vollbild-Viewer offen ist
function getIO(){
  if(_io) return _io;
  _io = new IntersectionObserver(entries => {
    for(const en of entries){
      if(en.isIntersecting){ if(!_gridPaused) mountStage(en.target); }
      else unmountStage(en.target);
    }
  }, { root: $('m3dScroll'), rootMargin: '200px 0px' });
  return _io;
}

// Live-Bühne anhalten/fortsetzen. Wird der große Viewer geöffnet, geben wir den
// laufenden <model-viewer> der Seite frei: sonst liegen dessen WebGL-Kontext
// plus der große Viewer (mit u. U. großem Modell) gleichzeitig auf der GPU –
// auf Mobilgeräten sprengt das schnell das Kontext-/Speicherlimit, der Tab
// stürzt ab und lädt neu. Beim Schließen lassen wir die Bühne wieder aufleben
// (erneutes observe → der Observer feuert für den aktuellen Sichtbarkeitsstand
// neu). Der Selektor deckt die große Bühne oben (#m3dFeatured) mit ab, die
// außerhalb von #m3dGrid liegt.
function pauseGrid(){
  _gridPaused = true;
  page.querySelectorAll('.m3d-stage').forEach(unmountStage);
}
function resumeGrid(){
  if(!_gridPaused) return;
  _gridPaused = false;
  const io = getIO();
  page.querySelectorAll('.m3d-stage').forEach(st => { io.unobserve(st); io.observe(st); });
}

async function mountStage(stage){
  if(_gridPaused || stage._mv || !stage._model) return;
  stage._mv = 'pending';
  try{ await ensureViewerLib(); }
  catch(e){
    if(stage._mv === 'pending') stage._mv = null;
    stageNote(stage, 'Modell-Anzeige konnte nicht geladen werden');
    return;
  }
  // Während des Wartens wieder aus dem Viewport gescrollt oder neu gerendert?
  if(stage._mv !== 'pending' || !stage.isConnected){
    if(stage._mv === 'pending') stage._mv = null;
    return;
  }
  const mv = makeMV(stage._model, false);
  mv.addEventListener('error', () => stageNote(stage, 'Modell konnte nicht geladen werden'));
  stage._mv = mv;
  stage.classList.add('is-live');
  stage.appendChild(mv);
}
function unmountStage(stage){
  if(stage._mv === 'pending'){ stage._mv = null; return; }
  if(stage._mv){ stage._mv.remove(); stage._mv = null; stage.classList.remove('is-live'); }
}
function stageNote(stage, text){
  const note = stage.querySelector('.m3d-stage-note');
  if(note){ note.hidden = false; note.textContent = text; }
}

// ── Einheitliche Einrahmung ────────────────────────────────────────────────
// model-viewers Auto-Radius rahmt jedes Modell an seiner Bounding-SPHÄRE ein,
// also an der Diagonale der Bounding-Box. Dadurch füllt ein runder Ball (Dia-
// gonale ≈ sichtbarer Durchmesser) die Bühne komplett, während eine schlanke,
// hohe Figur (Diagonale ≫ Silhouette) winzig wirkt – die Größen sehen uneinheit-
// lich aus. Wir rahmen stattdessen an der GRÖSSTEN EINZELACHSE ein: bei festem
// Sichtfeld setzen wir den Kamera-Radius so, dass die längste Kante jedes
// Modells denselben Anteil der Bühne einnimmt. So erscheinen alle Modelle
// gleich groß, egal ob Kugel, Würfel oder schlanke Figur.
const M3D_FOV = 28;   // vertikales Sichtfeld in Grad (fest → deterministische Rahmung)
function frameUniform(mv, fillFraction, polarDeg){
  let dims;
  try{ dims = mv.getDimensions?.(); }catch(e){ return; }
  if(!dims) return;
  const maxDim = Math.max(dims.x || 0, dims.y || 0, dims.z || 0);
  if(!(maxDim > 0)) return;
  // Radius so wählen, dass die halbe längste Kante fillFraction der halben
  // sichtbaren Höhe entspricht (quadratische Bühne ⇒ horizontal identisch).
  const fov = M3D_FOV * Math.PI / 180;
  const radius = (maxDim / 2) / (fillFraction * Math.tan(fov / 2));
  mv.cameraOrbit = `0deg ${polarDeg}deg ${radius.toFixed(4)}m`;
  mv.jumpCameraToGoal?.();   // sofort setzen, ohne Kamerafahrt
}

// ── Modell-Bühne bauen ─────────────────────────────────────────────────────
// Das eigentliche <model-viewer>-Element. Ein festes Sichtfeld plus die
// achsenbasierte Einrahmung (frameUniform) sorgt für einheitliche Größe aller
// Modelle in der Vitrine.
function makeMV(m, big){
  const mv = document.createElement('model-viewer');
  mv.className = big ? 'm3d-viewer-mv' : 'm3d-mv';
  mv.setAttribute('src', m.model_url);
  mv.setAttribute('alt', m.title || '3D-Modell');
  mv.setAttribute('shadow-intensity', '0.9');
  mv.setAttribute('shadow-softness', '1');
  mv.setAttribute('exposure', '1');
  mv.setAttribute('environment-image', 'neutral');
  mv.setAttribute('loading', 'lazy');
  mv.setAttribute('field-of-view', `${M3D_FOV}deg`);

  if(big){
    // Viewer-Overlay: dezenter gerahmt (mehr Luft), volle Steuerung. Der
    // Nutzer kann anschließend frei zoomen/drehen.
    mv.setAttribute('camera-orbit', `0deg 75deg auto`);
    mv.setAttribute('camera-controls', '');
    mv.setAttribute('auto-rotate', '');
    mv.setAttribute('touch-action', 'pan-y');
    mv.addEventListener('load', () => frameUniform(mv, 0.72, 75), { once: true });
  }else{
    // Grid-Bühne: nur drehen, keine Steuerung/Zoom. Einheitliche Rahmung an
    // der größten Einzelachse (siehe frameUniform) statt an der Bounding-Sphäre.
    mv.setAttribute('camera-orbit', `0deg 80deg auto`);
    mv.setAttribute('auto-rotate', '');
    mv.setAttribute('rotation-per-second', '22deg');
    mv.setAttribute('auto-rotate-delay', '0');
    mv.setAttribute('interaction-prompt', 'none');
    mv.setAttribute('disable-zoom', '');
    mv.setAttribute('disable-pan', '');
    mv.setAttribute('disable-tap', '');
    mv.addEventListener('load', () => frameUniform(mv, 0.82, 80), { once: true });
  }
  return mv;
}

// Bühne (nur Platzhalter/Halo); der <model-viewer> kommt später per Observer.
function makeStage(m){
  const stage = document.createElement('div');
  stage.className = 'm3d-stage';
  stage._model = m;

  const ph = document.createElement('div');
  ph.className = 'm3d-ph';
  ph.innerHTML = '<span></span>';
  stage.appendChild(ph);

  const note = document.createElement('div');
  note.className = 'm3d-stage-note';
  note.hidden = true;
  stage.appendChild(note);

  getIO().observe(stage);
  return stage;
}

// ── Vorschaubilder (Screenshots) ────────────────────────────────────────────
// Für die Grid-Ansicht wird pro Modell einmal ein statischer PNG-Screenshot
// erzeugt: das spart in der Übersicht komplett die WebGL-Kontexte (dutzende
// Bilder statt dutzende Viewer). Erzeugt wird direkt im Browser über
// <model-viewer>.toBlob() – beim Upload automatisch (aus der lokalen Datei,
// daher ohne CORS-Probleme) und für Altbestand per Owner-Backfill (aus der
// Modell-URL). Die Bilder landen im Storage unter models/thumbs/.
const THUMB_PX = 320;
let _captureHost = null;
function captureHost(){
  if(_captureHost) return _captureHost;
  _captureHost = document.createElement('div');
  _captureHost.className = 'm3d-capture';
  _captureHost.setAttribute('aria-hidden', 'true');
  document.body.appendChild(_captureHost);
  return _captureHost;
}

// Rendert das Modell (src = URL oder blob:) einmal ab und gibt einen PNG-Blob
// mit transparentem Hintergrund und einheitlicher Rahmung zurück.
async function captureThumb(src){
  await ensureViewerLib();
  const mv = document.createElement('model-viewer');
  mv.setAttribute('src', src);
  mv.setAttribute('camera-orbit', '0deg 80deg auto');
  mv.setAttribute('environment-image', 'neutral');
  mv.setAttribute('exposure', '1');
  mv.setAttribute('shadow-intensity', '0.9');
  mv.setAttribute('shadow-softness', '1');
  mv.setAttribute('field-of-view', `${M3D_FOV}deg`);
  mv.setAttribute('interaction-prompt', 'none');
  mv.setAttribute('loading', 'eager');
  mv.setAttribute('reveal', 'auto');
  mv.style.width = mv.style.height = `${THUMB_PX}px`;
  captureHost().appendChild(mv);
  try{
    await new Promise((res, rej) => {
      mv.addEventListener('load', res, { once: true });
      mv.addEventListener('error', () => rej(new Error('load-failed')), { once: true });
      setTimeout(() => rej(new Error('timeout')), 25000);
    });
    frameUniform(mv, 0.82, 80);
    // Zwei Frames warten, damit die neue Kamerastellung sicher gerendert ist.
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return await mv.toBlob({ mimeType: 'image/png', idealAspect: false });
  }finally{
    mv.remove();
  }
}

// Screenshot in den Storage laden und die öffentliche URL zurückgeben.
async function uploadThumb(blob){
  const path = `models/thumbs/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
  const { error } = await sb.storage.from(BUCKET)
    .upload(path, blob, { upsert: false, contentType: 'image/png', cacheControl: '31536000' });
  if(error) throw error;
  return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

// Screenshot erzeugen + hochladen; bei Fehler null (der Backfill kann es später
// nachholen). `local` = optionale lokale Datei (schneller, ohne Netz/CORS).
async function makeThumbUrl(modelUrl, localFile){
  let objUrl = null;
  try{
    const src = localFile ? (objUrl = URL.createObjectURL(localFile)) : modelUrl;
    const blob = await captureThumb(src);
    if(!blob) return null;
    return await uploadThumb(blob);
  }catch(e){
    return null;
  }finally{
    if(objUrl) URL.revokeObjectURL(objUrl);
  }
}

// ── Tages-Rotation ─────────────────────────────────────────────────────────
// Bestimmt das Modell des heutigen Tages. Jedes Modell kommt genau einmal je
// Runde dran (wird bis dahin „gestrichen"); ist die Runde durch, startet eine
// neue in frischer, zufälliger Reihenfolge. Die Wahl hängt nur vom Kalendertag
// ab – deterministisch, also für alle Besucher gleich und über Reloads stabil,
// ganz ohne gespeicherten Zustand.
function dayIndex(){
  const now = new Date();   // lokaler Kalendertag → Wechsel um Mitternacht
  return Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000);
}
// Kleiner, schneller PRNG (mulberry32) für eine reproduzierbare Reihenfolge.
function mulberry32(seed){
  let a = seed >>> 0;
  return function(){
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Deterministischer Fisher-Yates-Shuffle mit gegebenem Seed.
function seededShuffle(arr, seed){
  const a = [...arr];
  const rnd = mulberry32(seed);
  for(let i = a.length - 1; i > 0; i--){
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
// Tages-Zustand: die für heute zufällige (aber deterministische) Reihenfolge
// aller Modelle plus das Modell des Tages (Startmodell oben). Die Grid-Ansicht
// übernimmt dieselbe Reihenfolge, damit die Übersicht täglich variiert.
function dailyState(models){
  // Stabile Grundreihenfolge (unabhängig von der Ladereihenfolge), damit die
  // Rotation reproduzierbar bleibt.
  const base = [...models].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const n = base.length;
  const day = dayIndex();
  const cycle = Math.floor(day / n);   // wievielte volle Runde
  const pos = ((day % n) + n) % n;     // Position innerhalb der Runde
  // Pro Runde eine neue zufällige Reihenfolge ⇒ jedes Modell genau einmal je Runde.
  const order = seededShuffle(base, cycle + 1);
  return { order, daily: order[pos] };
}

// ── Rendern ────────────────────────────────────────────────────────────────
// Oben: das gewählte Modell groß und drehend (ein einziger WebGL-Viewer).
// Darunter: ein cleanes Grid aus statischen Vorschaubildern aller Modelle –
// per Klick wird das Modell oben geladen. So ist alles auf einen Blick sichtbar,
// ohne dutzende Viewer gleichzeitig laufen zu lassen.
function render(){
  // Alte Bühne(n) sauber abbauen, bevor neu befüllt wird.
  page.querySelectorAll('.m3d-stage').forEach(st => { _io?.unobserve(st); unmountStage(st); });

  if(!(_models && _models.length)){
    if(featuredHost) featuredHost.innerHTML = '';
    _featured = null;
    grid.innerHTML = _owner
      ? '<div class="m3d-status">Noch keine Modelle – lade dein erstes über „Verwalten → 3D-Modelle verwalten“ hoch 🧊</div>'
      : '<div class="m3d-status">Noch keine Modelle im Inventar 🧊</div>';
    return;
  }

  const { order, daily } = dailyState(_models);
  // Auswahl über einen Hintergrund-Abgleich hinweg beibehalten, sonst das
  // Tagesmodell zeigen.
  if(!_featured || !_models.some(m => m.id === _featured.id)) _featured = daily;
  else _featured = _models.find(m => m.id === _featured.id);

  renderFeatured(_featured, daily);
  renderGrid(order);
}

// Große, drehende Modellansicht oben. `daily` dient nur dem kleinen Label
// „Modell des Tages", wenn gerade das Tagesmodell gezeigt wird.
function renderFeatured(m, daily){
  if(!featuredHost) return;
  featuredHost.querySelectorAll('.m3d-stage').forEach(st => { _io?.unobserve(st); unmountStage(st); });
  featuredHost.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'm3d-featured';

  const kicker = document.createElement('div');
  kicker.className = 'm3d-featured-kicker';
  kicker.textContent = (daily && m.id === daily.id) ? 'Modell des Tages' : 'Ausgewählt';
  wrap.appendChild(kicker);

  const stage = makeStage(m);
  stage.classList.add('m3d-stage-big');
  stage.addEventListener('click', () => openViewer(m));
  wrap.appendChild(stage);

  const name = document.createElement('div');
  name.className = 'm3d-featured-name';
  name.textContent = m.title || '3D-Modell';
  wrap.appendChild(name);

  featuredHost.appendChild(wrap);
}

// Grid aus statischen Vorschaubildern (keine Namen). Ein Klick lädt das Modell
// oben und scrollt bei Bedarf zur großen Ansicht hoch.
function renderGrid(order){
  grid.innerHTML = '';

  const head = document.createElement('div');
  head.className = 'm3d-gridhead';
  const hName = document.createElement('span');
  hName.className = 'm3d-gridhead-name';
  hName.textContent = 'Alle Modelle';
  const hN = document.createElement('span');
  hN.className = 'm3d-gridhead-n';
  hN.textContent = order.length;
  head.append(hName, hN);
  grid.appendChild(head);

  const tiles = document.createElement('div');
  tiles.className = 'm3d-tiles';
  order.forEach((m, i) => tiles.appendChild(makeTile(m, i)));
  grid.appendChild(tiles);
}

// Eine Vorschau-Kachel: statisches Bild (falls vorhanden), sonst Platzhalter.
function makeTile(m, i){
  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = 'm3d-tile';
  tile.dataset.id = m.id;
  tile.setAttribute('aria-label', m.title || '3D-Modell');
  tile.style.animationDelay = `${Math.min(i, 12) * 0.03 + 0.04}s`;
  if(_featured && m.id === _featured.id) tile.classList.add('is-active');

  if(m.thumb_url){
    const img = document.createElement('img');
    img.className = 'm3d-tile-img';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = m.title || '3D-Modell';
    img.src = m.thumb_url;
    tile.appendChild(img);
  }else{
    const ph = document.createElement('span');
    ph.className = 'm3d-tile-ph';
    ph.innerHTML = '<span></span>';
    tile.appendChild(ph);
  }

  tile.addEventListener('click', () => selectModel(m));
  return tile;
}

// Ein Modell auswählen: oben laden, aktive Kachel markieren und (falls nötig)
// nach oben zur großen Ansicht scrollen.
function selectModel(m){
  _featured = m;
  const { daily } = dailyState(_models);
  renderFeatured(m, daily);
  grid.querySelectorAll('.m3d-tile').forEach(t =>
    t.classList.toggle('is-active', t.dataset.id === String(m.id)));
  $('m3dScroll')?.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Modelle laden ──────────────────────────────────────────────────────────
// Mit Cache: liegt schon eine Liste vor, wird sofort daraus gerendert und die
// Daten werden still im Hintergrund abgeglichen (nur bei Änderung neu malen).
async function loadModels(){
  const hadCache = !!_models;
  if(hadCache) render();
  else grid.innerHTML = '<div class="m3d-status">Lade…</div>';

  const [{ data, error }, owner] = await Promise.all([
    sb.from('models_3d')
      .select('id,title,model_url,thumb_url,category,created_at')
      .order('created_at', { ascending: false }),
    isOwner(),
  ]);

  if(error){
    if(!hadCache)
      grid.innerHTML = '<div class="m3d-status">Konnte das Inventar nicht laden. Versuch es gleich nochmal.</div>';
    return;
  }
  const changed = owner !== _owner || JSON.stringify(data) !== JSON.stringify(_models);
  _owner = owner;
  _models = data || [];
  if(!hadCache || changed){
    render();
    if(manage?.classList.contains('show')) renderManage();
  }
}

function storagePathFromUrl(url){
  const marker = `/object/public/${BUCKET}/`;
  const i = String(url).indexOf(marker);
  return i >= 0 ? decodeURIComponent(url.slice(i + marker.length)) : null;
}

// ── "3D-Modelle verwalten"-Popup (nur Owner) ───────────────────────────────
// Erreichbar über den Verwalten-Tab des Header-Menüs; bündelt Upload,
// Bearbeiten und Löschen, damit die Inventar-Seite selbst clean bleibt.
function closeHeaderMenu(){
  // Spiegelt app.js' closeMenu(): das Dropdown/Sheet schließen, bevor das
  // Verwalten-Popup darüber aufgeht.
  $('dropdown')?.classList.remove('show');
  $('bottomSheet')?.classList.remove('show');
  $('sheetOverlay')?.classList.remove('show');
  window.MB?.updateBodyLock?.();
}

async function openManage(){
  closeHeaderMenu();
  manage.classList.add('show');
  manage.setAttribute('aria-hidden', 'false');
  window.MB?.updateBodyLock?.();
  if(_models) renderManage();
  await loadModels();          // lädt (oder aktualisiert) und rendert die Liste
  renderManage();
}
function closeManage(){
  manage.classList.remove('show');
  manage.setAttribute('aria-hidden', 'true');
  window.MB?.updateBodyLock?.();
}
$('m3dManageBtn')?.addEventListener('click', openManage);
$('m3dManageBtnSheet')?.addEventListener('click', openManage);
$('m3dgClose')?.addEventListener('click', closeManage);
manage?.addEventListener('click', e => { if(e.target === manage) closeManage(); });

// ── Vorschaubilder nachträglich erzeugen (Owner-Backfill) ───────────────────
// Für Modelle ohne thumb_url (z. B. Altbestand): Modell aus seiner URL einmal
// abrendern, Screenshot hochladen und thumb_url speichern. Läuft nacheinander
// mit Fortschritt auf dem Button. Einzelne Fehlschläge (z. B. CORS) werden
// übersprungen und am Ende gemeldet.
let _backfilling = false;
function missingThumbs(){ return (_models || []).filter(m => !m.thumb_url); }
function updateThumbsBtn(){
  const btn = $('m3dgThumbsBtn');
  if(!btn) return;
  const n = missingThumbs().length;
  btn.hidden = n === 0;
  if(!_backfilling) btn.textContent = `Vorschaubilder erzeugen (${n})`;
}
async function runBackfill(){
  if(_backfilling) return;
  const todo = missingThumbs();
  if(!todo.length) return;
  const btn = $('m3dgThumbsBtn');
  _backfilling = true;
  if(btn) btn.disabled = true;
  let done = 0, failed = 0;
  for(const m of todo){
    if(btn) btn.textContent = `Erzeuge ${done + failed + 1}/${todo.length}…`;
    const thumb_url = await makeThumbUrl(m.model_url, null);
    if(!thumb_url){ failed++; continue; }
    const { error } = await sb.from('models_3d').update({ thumb_url }).eq('id', m.id);
    if(error){ failed++; continue; }
    // Storage aufräumen, falls direkt danach ein Fehler kam? Nicht nötig – Erfolg.
    const rec = (_models || []).find(x => x.id === m.id);
    if(rec) rec.thumb_url = thumb_url;
    done++;
    render();   // Grid nach jedem Bild aktualisieren
  }
  _backfilling = false;
  if(btn) btn.disabled = false;
  updateThumbsBtn();
  toast(failed ? `${done} erzeugt, ${failed} fehlgeschlagen` : `${done} Vorschaubild${done === 1 ? '' : 'er'} erzeugt ✓`);
}
$('m3dgThumbsBtn')?.addEventListener('click', runBackfill);

// Verwalten-Liste: nach Kategorie gruppiert, jede Gruppe mit Überschrift und
// Anzahl. Das macht auf einen Blick sichtbar, was wo einsortiert ist, statt
// eine lange, undifferenzierte Liste zu zeigen. Bearbeiten (inkl. Kategorie-
// Wechsel) und Löschen bleiben pro Zeile.
function renderManage(){
  const listEl = $('m3dgList');
  if(!listEl) return;

  updateThumbsBtn();

  const sub = $('m3dgSub');
  if(!_models || !_models.length){
    if(sub) sub.textContent = '';
    listEl.innerHTML = '<div class="m3dg-empty">Noch keine Modelle im Inventar.<br>Lade unten dein erstes 3D-Modell hoch 🧊</div>';
    return;
  }

  const usedCats = CATEGORIES.filter(c => _models.some(m => catOf(m) === c.slug)).length;
  if(sub) sub.textContent =
    `${_models.length} ${_models.length === 1 ? 'Modell' : 'Modelle'} · `
    + `${usedCats} ${usedCats === 1 ? 'Kategorie' : 'Kategorien'}`;

  listEl.innerHTML = '';
  for(const cat of CATEGORIES){
    const items = _models.filter(m => catOf(m) === cat.slug);
    if(!items.length) continue;

    const group = document.createElement('div');
    group.className = 'm3dg-group';

    const head = document.createElement('div');
    head.className = 'm3dg-grouphead';
    const hName = document.createElement('span');
    hName.className = 'm3dg-groupname';
    hName.textContent = cat.label;
    const hN = document.createElement('span');
    hN.className = 'm3dg-groupn';
    hN.textContent = items.length;
    head.append(hName, hN);
    group.appendChild(head);

    for(const m of items) group.appendChild(makeManageRow(m));
    listEl.appendChild(group);
  }
}

function makeManageRow(m){
  const row = document.createElement('div');
  row.className = 'm3dg-item';

  const name = document.createElement('span');
  name.className = 'm3dg-name';
  name.textContent = m.title;
  row.appendChild(name);

  const edit = document.createElement('button');
  edit.type = 'button';
  edit.setAttribute('aria-label', `„${m.title}“ bearbeiten`);
  edit.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/></svg>';
  edit.addEventListener('click', () => openModal(m));
  row.appendChild(edit);

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'm3dg-del';
  del.setAttribute('aria-label', `„${m.title}“ löschen`);
  del.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
  del.addEventListener('click', () => onDelete(m, del));
  row.appendChild(del);

  return row;
}

// Löschen zweistufig (wie im Gästebuch): erster Klick fragt nach, zweiter löscht.
async function onDelete(m, btn){
  if(!btn.dataset.armed){
    btn.dataset.armed = '1';
    btn.classList.add('armed');
    setTimeout(() => { delete btn.dataset.armed; btn.classList.remove('armed'); }, 2500);
    return;
  }
  const { error } = await sb.from('models_3d').delete().eq('id', m.id);
  if(error){ toast('Löschen fehlgeschlagen'); return; }
  // Dateien aus dem Storage entfernen (best effort – die Anzeige hängt nur am
  // Datensatz): Modell und – falls vorhanden – sein Vorschaubild.
  const paths = [storagePathFromUrl(m.model_url), storagePathFromUrl(m.thumb_url)].filter(Boolean);
  if(paths.length) sb.storage.from(BUCKET).remove(paths).catch(() => {});
  _models = (_models || []).filter(x => x.id !== m.id);
  render();
  renderManage();
  toast('Modell gelöscht');
}

// ── Viewer-Overlay ─────────────────────────────────────────────────────────
async function openViewer(m){
  const stageHost = $('m3dViewerStage');
  const titleEl = $('m3dViewerTitle');
  const metaEl = $('m3dViewerMeta');
  if(!stageHost) return;
  titleEl.textContent = m.title || '3D-Modell';
  if(metaEl){
    const date = m.created_at
      ? new Date(m.created_at).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' })
      : '';
    metaEl.textContent = date ? 'Im Inventar seit ' + date : '';
  }
  viewer.classList.add('show');
  viewer.setAttribute('aria-hidden', 'false');
  pauseGrid();   // Grid-WebGL-Kontexte freigeben, bevor der große Viewer startet
  stageHost.innerHTML = '';
  try{ await ensureViewerLib(); }catch(e){ toast('Anzeige konnte nicht geladen werden'); return; }
  if(!viewer.classList.contains('show')) return;   // inzwischen wieder geschlossen
  const mv = makeMV(m, true);
  mv.addEventListener('error', () => toast('Modell konnte nicht geladen werden'));
  stageHost.appendChild(mv);
}
function closeViewer(){
  viewer.classList.remove('show');
  viewer.setAttribute('aria-hidden', 'true');
  const stageHost = $('m3dViewerStage');
  if(stageHost) stageHost.innerHTML = '';   // WebGL-Kontext freigeben
  // Grid nur wieder aufwecken, wenn die Inventar-Seite noch offen ist (beim
  // Schließen der ganzen Seite entfernt closePage vorher die 'show'-Klasse).
  if(page.classList.contains('show')) resumeGrid();
}
$('m3dViewerClose')?.addEventListener('click', closeViewer);
viewer?.addEventListener('click', e => { if(e.target === viewer) closeViewer(); });

// ── Upload-/Bearbeiten-Sheet ───────────────────────────────────────────────
let pickedFile = null;
let editModel  = null;   // null = neues Modell, sonst der zu bearbeitende Datensatz

function showError(msg){
  const el = $('m3dmError');
  el.textContent = msg; el.classList.add('show');
}
function clearError(){
  const el = $('m3dmError');
  el.textContent = ''; el.classList.remove('show');
}

function dropIdleText(){
  return editModel ? 'Neue Datei wählen (nur zum Ersetzen)' : 'Datei wählen oder hierher ziehen';
}

function setFile(file){
  const drop = $('m3dmDrop');
  const main = $('m3dmDropMain');
  const okName = /\.(glb|gltf)$/i.test(file?.name || '');
  if(!file || !okName){
    pickedFile = null;
    drop.classList.remove('has-file');
    main.textContent = dropIdleText();
    if(file) showError('Bitte eine .glb- oder .gltf-Datei wählen');
    return;
  }
  pickedFile = file;
  clearError();
  drop.classList.add('has-file');
  main.textContent = file.name;
  // Titel automatisch aus dem Dateinamen vorbelegen, wenn noch leer.
  const titleInput = $('m3dmTitle');
  if(titleInput && !titleInput.value.trim())
    titleInput.value = file.name.replace(/\.(glb|gltf)$/i, '').replace(/[_-]+/g, ' ').trim().slice(0, 80);
}

// Öffnet das Sheet: ohne Argument als Upload, mit Modell als Editor.
function openModal(m = null){
  editModel = m;
  pickedFile = null;
  $('m3dmHeading').textContent = m ? 'Modell bearbeiten' : '3D-Modell hochladen';
  $('m3dmSave').textContent = m ? 'Speichern' : 'Hochladen';
  $('m3dmTitle').value = m ? (m.title || '') : '';
  const catSel = $('m3dmCategory');
  if(catSel) catSel.value = m ? catOf(m) : DEFAULT_CAT;
  $('m3dmFile').value = '';
  $('m3dmDrop').classList.remove('has-file');
  $('m3dmDropMain').textContent = dropIdleText();
  clearError();
  modal.classList.add('show');
}
function closeModal(){ modal.classList.remove('show'); }

$('m3dgUploadBtn')?.addEventListener('click', () => openModal());
$('m3dmCancel')?.addEventListener('click', closeModal);
modal?.addEventListener('click', e => { if(e.target === modal) closeModal(); });
$('m3dmFile')?.addEventListener('change', e => setFile(e.target.files?.[0]));

// Drag & Drop auf die Dropzone.
const drop = $('m3dmDrop');
['dragenter','dragover'].forEach(ev => drop?.addEventListener(ev, e => {
  e.preventDefault(); drop.classList.add('dragover');
}));
['dragleave','drop'].forEach(ev => drop?.addEventListener(ev, e => {
  e.preventDefault(); if(ev !== 'dragover') drop.classList.remove('dragover');
}));
drop?.addEventListener('drop', e => { setFile(e.dataTransfer?.files?.[0]); });

// Datei in den Storage laden und die öffentliche URL zurückgeben.
async function uploadFile(file){
  const ext = /\.gltf$/i.test(file.name) ? 'gltf' : 'glb';
  const path = `models/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const contentType = ext === 'glb' ? 'model/gltf-binary' : 'model/gltf+json';
  const { error } = await sb.storage.from(BUCKET)
    .upload(path, file, { upsert: false, contentType, cacheControl: '31536000' });
  if(error) throw error;
  return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

// Speichern: neues Modell anlegen ODER bestehendes aktualisieren.
$('m3dmSave')?.addEventListener('click', async () => {
  const title = $('m3dmTitle').value.trim();
  const category = CAT_LABEL[$('m3dmCategory')?.value] ? $('m3dmCategory').value : DEFAULT_CAT;
  if(!title){ showError('Bitte einen Titel eintragen'); return; }
  if(!editModel && !pickedFile){ showError('Bitte eine .glb- oder .gltf-Datei wählen'); return; }
  if(pickedFile && pickedFile.size > 60 * 1024 * 1024){ showError('Datei ist zu groß (max. 60 MB)'); return; }

  const btn = $('m3dmSave');
  btn.disabled = true;
  const oldLabel = btn.textContent;
  btn.textContent = pickedFile ? 'Lade hoch…' : 'Speichere…';
  try{
    if(editModel){
      const patch = { title: title.slice(0, 80), category };
      if(pickedFile){
        patch.model_url = await uploadFile(pickedFile);
        // Neue Datei ⇒ neues Vorschaubild (aus der lokalen Datei, ohne CORS).
        // Klappt es nicht, wird thumb_url geleert (Grid zeigt Platzhalter, per
        // Backfill nachholbar) – nie das alte, jetzt falsche Bild behalten.
        btn.textContent = 'Erzeuge Vorschau…';
        patch.thumb_url = await makeThumbUrl(patch.model_url, pickedFile);
      }
      const { error } = await sb.from('models_3d').update(patch).eq('id', editModel.id);
      if(error) throw error;
      // Alte Dateien erst nach erfolgreichem Update entfernen (best effort).
      if(pickedFile){
        const oldPaths = [storagePathFromUrl(editModel.model_url), storagePathFromUrl(editModel.thumb_url)].filter(Boolean);
        if(oldPaths.length) sb.storage.from(BUCKET).remove(oldPaths).catch(() => {});
      }
      toast('Modell aktualisiert ✓');
    }else{
      const url = await uploadFile(pickedFile);
      btn.textContent = 'Erzeuge Vorschau…';
      const thumb_url = await makeThumbUrl(url, pickedFile);
      const { error } = await sb.from('models_3d')
        .insert({ title: title.slice(0, 80), model_url: url, thumb_url, category });
      if(error) throw error;
      toast('Modell hinzugefügt 🧊');
    }
    closeModal();
    _models = null;          // Cache verwerfen → frisch laden
    await loadModels();
    renderManage();
  }catch(e){
    showError(editModel ? 'Speichern fehlgeschlagen. Versuch es gleich nochmal.'
                        : 'Upload fehlgeschlagen. Versuch es gleich nochmal.');
  }finally{
    btn.disabled = false;
    btn.textContent = oldLabel;
  }
});

// Escape schließt von innen nach außen: Viewer → Sheet → Verwalten → Seite.
document.addEventListener('keydown', e => {
  if(e.key !== 'Escape') return;
  if(viewer.classList.contains('show')) closeViewer();
  else if(modal.classList.contains('show')) closeModal();
  else if(manage.classList.contains('show')) closeManage();
  else if(page.classList.contains('show')) closePage();
});
