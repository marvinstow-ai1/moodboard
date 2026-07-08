// ============================================================================
// Freundebuch — jede/r Freund/in gestaltet die eigene Steckbrief-DOPPELSEITE
// ----------------------------------------------------------------------------
// Öffnet sich als vollflächige Seite (wie die Info-Page) über den Buch-Button
// in der Bottom-Bar. "Eintragen" öffnet den Editor: oben/links eine LIVE-
// Vorschau mit Seiten-Umschalter — Seite 1 ist der Steckbrief (Name, Wohnort,
// Instagram, Hobbys, Lieblingsmusik/-sport/-serie, Profilbild, Unterschrift),
// Seite 2 ("Mehr über mich") ist vorerst eine leere Linien-Seite; die Inhalte
// dafür folgen später. Schriftart, Hintergrundfarbe und eigenes Hintergrund-
// bild gelten immer für BEIDE Seiten. Das Profilbild wird beim Auswählen
// clientseitig quadratisch zugeschnitten (Data-URL) — so umschließt der Kreis
// das Bild exakt und html2canvas rendert es zuverlässig (vorher wurde es
// teils nur halb geladen). Beim "Fertig" werden beide Seiten mit html2canvas
// gerendert und nebeneinander — mit Buchfalz-Schatten in der Mitte — zu EINEM
// breiten Doppelseiten-JPEG zusammengesetzt, in den Storage-Bucket
// (guestbook/) hochgeladen und als Eintrag in public.guestbook_entries
// abgelegt (RLS: nur Mitglieder, siehe db/guestbook.sql). Die fertigen
// Doppelseiten erscheinen groß, eine pro Zeile (css/guestbook.css) und lassen
// sich per Tipp in einer Lightbox ansehen.
// ============================================================================

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://uvfuxnwinuakbqanaxtp.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2ZnV4bndpbnVha2JxYW5heHRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxNzg3MDIsImV4cCI6MjA5NTc1NDcwMn0.quSvaycB3Yk2JXCnQz7AQmHpyATtx6u0U8aGQXD73fo';
const BUCKET = 'moodboard';
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = id => document.getElementById(id);

const page   = $('gbPage');
const list   = $('gbList');
const draw   = $('gbDraw');
const canvas = $('gbdCanvas');
const wrap   = $('gbdCanvasWrap');
const area   = $('gbdCanvasArea');

// Editor + Vorschau (Seite 1 = Steckbrief, Seite 2 = "Mehr über mich")
const editor   = $('fbEditor');
const fbCard   = $('fbCard');
const fbCardBg = $('fbCardBg');
const fbCard2  = $('fbCard2');
const fbCardBg2= $('fbCardBg2');
const CARDS    = [fbCard, fbCard2];

const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function toast(t){ window.MB?.toast ? window.MB.toast(t) : console.log(t); }

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
  window.MB?.closeModels?.();
  window.MB?.closeTama?.();
  markAnimating();
  page.classList.add('show');
  page.setAttribute('aria-hidden', 'false');
  window.MB?.updateBodyLock?.();
  window.MB?.kickAutoplay?.();
  loadEntries();
}
function closePage(){
  markAnimating();
  page.classList.remove('show');
  page.setAttribute('aria-hidden', 'true');
  window.MB?.updateBodyLock?.();
}

$('gbClose')?.addEventListener('click', closePage);
window.MB = Object.assign(window.MB || {}, { closeGuestbook: closePage, openGuestbook: openPage });

// ── Einträge laden & rendern (das "Fotobuch") ──────────────────────────────
async function isOwner(){
  try{
    const { data: { session } } = await sb.auth.getSession();
    return session?.user?.app_metadata?.role === 'owner';
  }catch(e){ return false; }
}

function fmtDate(iso){
  try{
    return new Date(iso).toLocaleDateString('de-DE', { day:'2-digit', month:'2-digit', year:'numeric' });
  }catch(e){ return ''; }
}

async function loadEntries(){
  list.innerHTML = '<div class="gb-status">Lade…</div>';
  const [{ data, error }, owner] = await Promise.all([
    sb.from('guestbook_entries')
      .select('id,name,instagram,signature_url,created_at')
      .order('created_at', { ascending: false }),
    isOwner(),
  ]);
  if(error){
    list.innerHTML = '<div class="gb-status">Konnte das Freundebuch nicht laden. Versuch es gleich nochmal.</div>';
    return;
  }
  if(!data || !data.length){
    list.innerHTML = '<div class="gb-status">Noch keine Seiten – sei die/der Erste! ✏️</div>';
    return;
  }
  list.innerHTML = data.map(e => {
    const handle = (e.instagram || '').replace(/^@/, '');
    const insta = handle
      ? `<a class="gb-entry-insta" href="https://instagram.com/${encodeURIComponent(handle)}" target="_blank" rel="noopener noreferrer">@${esc(handle)}</a>`
      : '';
    const del = owner
      ? `<button class="gb-entry-del" data-del="${esc(e.id)}" aria-label="Seite löschen">
           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px;display:block">
             <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
           </svg>
         </button>`
      : '';
    return `
      <div class="gb-entry">
        <div class="gb-entry-media" data-lightbox="${esc(e.signature_url)}" role="button" tabindex="0" aria-label="Seite von ${esc(e.name)} ansehen">
          <img src="${esc(e.signature_url)}" loading="lazy" decoding="async" alt="Freundebuch-Seite von ${esc(e.name)}">
          ${del}
        </div>
        <div class="gb-entry-meta">
          <span class="gb-entry-name">${esc(e.name)} <span class="gb-entry-warhier">war hier</span></span>
          <div class="gb-entry-sub">
            ${insta}
            <span class="gb-entry-date">${fmtDate(e.created_at)}</span>
          </div>
        </div>
      </div>`;
  }).join('');

  // Tipp auf eine Kachel → Lightbox (Klick auf Löschen nicht durchreichen).
  list.querySelectorAll('[data-lightbox]').forEach(el => {
    const open = ev => {
      if(ev.target.closest('[data-del]')) return;
      openLightbox(el.dataset.lightbox);
    };
    el.addEventListener('click', open);
    el.addEventListener('keydown', ev => { if(ev.key === 'Enter' || ev.key === ' '){ ev.preventDefault(); open(ev); } });
  });

  list.querySelectorAll('[data-del]').forEach(btn => {
    btn.onclick = async (ev) => {
      ev.stopPropagation();
      // Zweistufig: erster Klick fragt nach, zweiter löscht.
      if(!btn.dataset.armed){
        btn.dataset.armed = '1';
        btn.style.opacity = '1';
        btn.style.color = '#ff7b7b';
        setTimeout(() => { delete btn.dataset.armed; btn.style.opacity = ''; btn.style.color = ''; }, 2500);
        return;
      }
      const { error: de } = await sb.from('guestbook_entries').delete().eq('id', btn.dataset.del);
      if(de){ toast('Löschen fehlgeschlagen'); return; }
      btn.closest('.gb-entry')?.remove();
      if(!list.querySelector('.gb-entry'))
        list.innerHTML = '<div class="gb-status">Noch keine Seiten – sei die/der Erste! ✏️</div>';
    };
  });
}

// ── Lightbox ───────────────────────────────────────────────────────────────
const lightbox = $('fbLightbox');
function openLightbox(url){
  $('fbLightboxImg').src = url;
  lightbox.classList.add('show');
  lightbox.setAttribute('aria-hidden', 'false');
}
function closeLightbox(){
  lightbox.classList.remove('show');
  lightbox.setAttribute('aria-hidden', 'true');
  $('fbLightboxImg').removeAttribute('src');
}
$('fbLightboxClose')?.addEventListener('click', closeLightbox);
lightbox?.addEventListener('click', e => { if(e.target === lightbox) closeLightbox(); });

// ── Editor: Live-Vorschau ───────────────────────────────────────────────────
// Jedes Feld schreibt live in die passende Zeile der Vorschau-Karte.
let profileURL = null;   // Data-URL des quadratisch zugeschnittenen Profilbilds
let bgImgURL   = null;   // Object-URL des Hintergrundbilds
let sigBlob    = null;   // gemalte Unterschrift als PNG-Blob
let bgColor    = '#fff7e6';

const FIELD_MAP = [
  ['fbName',  'fbvName',  false],
  ['fbOrt',   'fbvOrt',   false],
  ['fbInsta', 'fbvInsta', true ],   // true = @ voranstellen
  ['fbHobby', 'fbvHobby', false],
  ['fbMusik', 'fbvMusik', false],
  ['fbSport', 'fbvSport', false],
  ['fbSerie', 'fbvSerie', false],
];

function bindField(inputId, spanId, insta){
  const input = $(inputId), span = $(spanId);
  input.addEventListener('input', () => {
    // Führendes @ direkt beim Tippen entfernen – das feste @ steht schon davor.
    if(insta && input.value.startsWith('@')) input.value = input.value.replace(/^@+/, '');
    let v = input.value.trim();
    if(insta){
      v = v.replace(/^@/, '').replace(/^(https?:\/\/)?(www\.)?instagram\.com\//i, '').replace(/\/.*$/, '');
    }
    span.textContent = insta && v ? '@' + v : v;
    span.dataset.empty = v ? '0' : '1';
  });
}
FIELD_MAP.forEach(([i, s, insta]) => bindField(i, s, insta));

// ── Schriftart-Auswahl ─────────────────────────────────────────────────────
const FONTS = [
  { css: "'Patrick Hand', cursive",      label: 'Handschrift' },
  { css: "'Caveat', cursive",            label: 'Schwung'     },
  { css: "'Gochi Hand', cursive",        label: 'Krakel'      },
  { css: "'Comic Neue', 'DM Sans', sans-serif", label: 'Comic' },
  { css: "'Schoolbell', cursive",        label: 'Schulheft'   },
  { css: "'Shadows Into Light', cursive",label: 'Filzstift'   },
];
const fontsRow = $('fbFonts');
FONTS.forEach((f, i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'fb-font-chip' + (i === 0 ? ' is-active' : '');
  b.textContent = f.label;
  b.style.fontFamily = f.css;
  b.addEventListener('click', () => {
    CARDS.forEach(c => { c.style.fontFamily = f.css; });
    fontsRow.querySelector('.is-active')?.classList.remove('is-active');
    b.classList.add('is-active');
  });
  fontsRow.appendChild(b);
});
CARDS.forEach(c => { c.style.fontFamily = FONTS[0].css; });

// ── Hintergrundfarbe ────────────────────────────────────────────────────────
const BG_COLORS = ['#fff7e6','#ffe1ec','#e3f2ff','#e7ffe6','#fff0b3','#f0e6ff','#ffffff','#ffd9c2'];
const bgRow = $('fbBgColors');
BG_COLORS.forEach((c, i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'fb-swatch' + (i === 0 ? ' is-active' : '');
  b.style.setProperty('--c', c);
  b.setAttribute('aria-label', 'Farbe ' + c);
  b.addEventListener('click', () => {
    bgColor = c;
    if(!bgImgURL) CARDS.forEach(cd => { cd.style.backgroundColor = c; });
    bgRow.querySelector('.is-active')?.classList.remove('is-active');
    b.classList.add('is-active');
  });
  bgRow.appendChild(b);
});
CARDS.forEach(cd => { cd.style.backgroundColor = bgColor; });

// ── Seiten-Umschalter (Vorschau: Seite 1 / Seite 2) ─────────────────────────
let curPage = 1;
function showPage(n){
  curPage = n;
  fbCard.hidden  = n !== 1;
  fbCard2.hidden = n !== 2;
  $('fbPageSwitch').querySelectorAll('.fb-pgbtn').forEach(b => {
    const active = Number(b.dataset.page) === n;
    b.classList.toggle('is-active', active);
    b.setAttribute('aria-selected', active ? 'true' : 'false');
  });
}
$('fbPageSwitch').querySelectorAll('.fb-pgbtn').forEach(b => {
  b.addEventListener('click', () => showPage(Number(b.dataset.page)));
});

// ── Bild-Uploads (Profil + Hintergrund) ─────────────────────────────────────
function pickFile(input){ input.value = ''; input.click(); }

// Profilbild quadratisch (mittig) zuschneiden und als Data-URL zurückgeben.
// Der Kreis auf der Seite umschließt das Bild damit exakt — und html2canvas
// rendert Data-URLs zuverlässig (Object-URLs luden vorher teils nur halb).
async function cropSquare(file){
  const objURL = URL.createObjectURL(file);
  try{
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = objURL; });
    const src  = Math.min(img.naturalWidth, img.naturalHeight);
    const size = Math.min(src, 900);
    const c = document.createElement('canvas');
    c.width = c.height = size;
    c.getContext('2d').drawImage(
      img,
      (img.naturalWidth - src) / 2, (img.naturalHeight - src) / 2, src, src,
      0, 0, size, size
    );
    return c.toDataURL('image/jpeg', 0.92);
  }finally{
    URL.revokeObjectURL(objURL);
  }
}

const openPhotoPicker = () => pickFile($('fbPhotoInput'));
$('fbPhotoBtn').addEventListener('click', openPhotoPicker);
// Nutzerfreundlich: Tipp direkt auf den Foto-Kreis in der Vorschau.
$('fbPhotoSlot').addEventListener('click', openPhotoPicker);
$('fbPhotoSlot').addEventListener('keydown', e => {
  if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); openPhotoPicker(); }
});
$('fbPhotoInput').addEventListener('change', async e => {
  const file = e.target.files?.[0];
  if(!file) return;
  try{
    profileURL = await cropSquare(file);
  }catch(err){
    toast('Das Bild konnte nicht geladen werden');
    return;
  }
  const img = $('fbPhotoImg');
  img.src = profileURL;
  img.hidden = false;
  $('fbPhotoPh').hidden = true;
  $('fbPhotoSlot').classList.add('has-photo');
  $('fbPhotoBtnLbl').textContent = 'Foto ändern';
});

$('fbBgImgBtn').addEventListener('click', () => pickFile($('fbBgImgInput')));
$('fbBgImgInput').addEventListener('change', e => {
  const file = e.target.files?.[0];
  if(!file) return;
  if(bgImgURL) URL.revokeObjectURL(bgImgURL);
  bgImgURL = URL.createObjectURL(file);
  [fbCardBg, fbCardBg2].forEach(bg => { bg.style.backgroundImage = `url("${bgImgURL}")`; });
  CARDS.forEach(c => c.classList.add('has-bg-img'));
  $('fbBgImgClear').hidden = false;
});
$('fbBgImgClear').addEventListener('click', () => {
  if(bgImgURL) URL.revokeObjectURL(bgImgURL);
  bgImgURL = null;
  [fbCardBg, fbCardBg2].forEach(bg => { bg.style.backgroundImage = ''; });
  CARDS.forEach(c => { c.classList.remove('has-bg-img'); c.style.backgroundColor = bgColor; });
  $('fbBgImgClear').hidden = true;
});

// ── Editor öffnen / schließen ───────────────────────────────────────────────
function openEditor(){
  // Vorbelegen: gespeicherter Name aus dem Gate.
  const saved = localStorage.getItem('mb_gate_name') || '';
  $('fbName').value = saved;
  $('fbvName').textContent = saved;
  $('fbvName').dataset.empty = saved ? '0' : '1';
  clearError();
  showPage(1);
  editor.classList.add('show');
  editor.setAttribute('aria-hidden', 'false');
}
function closeEditor(){
  editor.classList.remove('show');
  editor.setAttribute('aria-hidden', 'true');
}
$('gbAddBtn').addEventListener('click', openEditor);
$('fbCancel').addEventListener('click', closeEditor);

function showError(msg){
  const el = $('fbError');
  el.textContent = msg;
  el.classList.add('show');
  el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
function clearError(){
  const el = $('fbError');
  el.innerHTML = '&nbsp;';
  el.classList.remove('show');
}

// ── Malfeld (Canvas) für die Unterschrift ───────────────────────────────────
const ctx = canvas.getContext('2d');
let drawing = false, hasInk = false, lastX = 0, lastY = 0;
let penColor = '#000000';    // dunkle Tinte passt zur hellen Karte
let sigBgColor = '#ffffff';  // heller Unterschrift-Hintergrund

const colorsRow = $('gbdColors');
colorsRow?.querySelectorAll('.gbd-color').forEach(btn => {
  btn.addEventListener('click', () => {
    penColor = btn.dataset.color;
    ctx.strokeStyle = penColor;
    colorsRow.querySelector('.is-active')?.classList.remove('is-active');
    btn.classList.add('is-active');
  });
});

function isLightColor(hex){
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) > 150;
}
const bgColorsRow = $('gbdBgColors');
bgColorsRow?.querySelectorAll('.gbd-color').forEach(btn => {
  btn.addEventListener('click', () => {
    sigBgColor = btn.dataset.color;
    wrap.style.backgroundColor = sigBgColor;
    wrap.classList.toggle('light-bg', isLightColor(sigBgColor));
    bgColorsRow.querySelector('.is-active')?.classList.remove('is-active');
    btn.classList.add('is-active');
  });
});

const CANVAS_RATIO = 4 / 5;
function setupCanvas(){
  const a = area.getBoundingClientRect();
  let w = a.width, h = w / CANVAS_RATIO;
  if(h > a.height){ h = a.height; w = h * CANVAS_RATIO; }
  wrap.style.width  = `${Math.round(w)}px`;
  wrap.style.height = `${Math.round(h)}px`;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width  = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = penColor;
  ctx.lineWidth = 3;
  // Wrap-Hintergrund an die aktuelle Signatur-Hintergrundfarbe angleichen,
  // damit die Vorschau dem Export entspricht.
  wrap.style.backgroundColor = sigBgColor;
  wrap.classList.toggle('light-bg', isLightColor(sigBgColor));
  hasInk = false;
  wrap.classList.remove('has-ink');
}

function pos(e){
  const r = canvas.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}
canvas.addEventListener('pointerdown', e => {
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  drawing = true;
  [lastX, lastY] = pos(e);
  ctx.beginPath();
  ctx.arc(lastX, lastY, ctx.lineWidth / 2, 0, Math.PI * 2);
  ctx.fillStyle = penColor;
  ctx.fill();
  hasInk = true;
  wrap.classList.add('has-ink');
});
canvas.addEventListener('pointermove', e => {
  if(!drawing) return;
  const [x, y] = pos(e);
  ctx.beginPath();
  ctx.moveTo(lastX, lastY);
  ctx.lineTo(x, y);
  ctx.stroke();
  [lastX, lastY] = [x, y];
});
const stopDraw = () => { drawing = false; };
canvas.addEventListener('pointerup', stopDraw);
canvas.addEventListener('pointercancel', stopDraw);

function openDraw(){
  draw.classList.add('show');
  requestAnimationFrame(setupCanvas);
}
function closeDraw(){ draw.classList.remove('show'); }

$('fbSignBtn').addEventListener('click', openDraw);
// Nutzerfreundlich: Tipp direkt auf die Unterschrift-Zeile in der Vorschau.
$('fbSignSlot').addEventListener('click', openDraw);
$('fbSignSlot').addEventListener('keydown', e => {
  if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); openDraw(); }
});
$('gbdClear').addEventListener('click', () => {
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
  hasInk = false;
  wrap.classList.remove('has-ink');
});
$('gbdCancel').addEventListener('click', closeDraw);
draw.addEventListener('click', e => { if(e.target === draw) closeDraw(); });

// Unterschrift exportieren (Hintergrundfarbe eingebacken, auf max. 700px verkleinert).
function exportSignature(){
  const scale = Math.min(1, 700 / canvas.width);
  const out = document.createElement('canvas');
  out.width  = Math.round(canvas.width * scale);
  out.height = Math.round(canvas.height * scale);
  const octx = out.getContext('2d');
  octx.fillStyle = sigBgColor;
  octx.fillRect(0, 0, out.width, out.height);
  octx.drawImage(canvas, 0, 0, out.width, out.height);
  return new Promise(res => out.toBlob(res, 'image/png'));
}

$('gbdDone').addEventListener('click', async () => {
  if(!hasInk){ closeDraw(); return; }
  const blob = await exportSignature();
  if(!blob){ closeDraw(); return; }
  sigBlob = blob;
  const img = $('fbSignImg');
  if(img.src) URL.revokeObjectURL(img.src);
  img.src = URL.createObjectURL(blob);
  img.hidden = false;
  $('fbSignBtnLbl').textContent = 'Unterschrift ändern';
  closeDraw();
});

// ── Rendern: Vorschau-Karte → JPEG ──────────────────────────────────────────
let _h2cPromise = null;
function loadHtml2Canvas(){
  if(window.html2canvas) return Promise.resolve(window.html2canvas);
  if(_h2cPromise) return _h2cPromise;
  _h2cPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
    s.onload = () => resolve(window.html2canvas);
    s.onerror = () => reject(new Error('html2canvas konnte nicht geladen werden'));
    document.head.appendChild(s);
  });
  return _h2cPromise;
}

async function waitImages(){
  const imgs = [$('fbPhotoImg'), $('fbSignImg')].filter(i => i && !i.hidden && i.src);
  await Promise.all(imgs.map(i => (i.decode ? i.decode().catch(() => {}) : Promise.resolve())));
}

// Zwei Frames warten, bis das Layout nach einem Seitenwechsel steht.
function settleFrames(){
  return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
}

async function renderCard(h2c, card){
  const w = card.offsetWidth || 360;
  const scale = Math.max(1.5, Math.min(3, 1080 / w));
  card.classList.add('is-render');   // Editor-Rahmen/Rundung nicht mitrendern
  try{
    return await h2c(card, {
      backgroundColor: bgImgURL ? null : bgColor,
      scale,
      useCORS: true,
      allowTaint: true,
      logging: false,
    });
  }finally{
    card.classList.remove('is-render');
  }
}

// Beide Seiten rendern und nebeneinander zu EINEM Doppelseiten-Bild
// zusammensetzen — mit dezentem Falz-Schatten in der Buchmitte.
async function renderSpreadToBlob(){
  const h2c = await loadHtml2Canvas();
  try{ await (document.fonts?.ready ?? Promise.resolve()); }catch(e){}
  await waitImages();

  const prevPage = curPage;
  showPage(1); await settleFrames();
  const c1 = await renderCard(h2c, fbCard);
  showPage(2); await settleFrames();
  const c2 = await renderCard(h2c, fbCard2);
  showPage(prevPage);

  const w = c1.width, h = c1.height;
  const out = document.createElement('canvas');
  out.width = w * 2;
  out.height = h;
  const octx = out.getContext('2d');
  octx.drawImage(c1, 0, 0, w, h);
  octx.drawImage(c2, w, 0, w, h);

  // Buchfalz: weicher Schatten über der Mittelkante.
  const spread = w * 0.045;
  const g = octx.createLinearGradient(w - spread, 0, w + spread, 0);
  g.addColorStop(0,   'rgba(0,0,0,0)');
  g.addColorStop(0.5, 'rgba(0,0,0,.18)');
  g.addColorStop(1,   'rgba(0,0,0,0)');
  octx.fillStyle = g;
  octx.fillRect(w - spread, 0, spread * 2, h);

  return new Promise(res => out.toBlob(res, 'image/jpeg', 0.92));
}

// ── Speichern ────────────────────────────────────────────────────────────────
$('fbSave').addEventListener('click', async () => {
  const name = $('fbName').value.trim();
  if(!name){ showError('Bitte trag deinen Namen ein ✏️'); return; }

  const btn = $('fbSave');
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = 'Speichere…';
  try{
    const insta = $('fbInsta').value.trim()
      .replace(/^@/, '')
      .replace(/^(https?:\/\/)?(www\.)?instagram\.com\//i, '')
      .replace(/\/.*$/, '') || null;

    const blob = await renderSpreadToBlob();
    if(!blob) throw new Error('render');

    const path = `guestbook/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    const { error: ue } = await sb.storage.from(BUCKET)
      .upload(path, blob, { upsert: false, contentType: 'image/jpeg', cacheControl: '31536000' });
    if(ue) throw ue;
    const url = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

    const { error: ie } = await sb.from('guestbook_entries')
      .insert({ name, instagram: insta, signature_url: url });
    if(ie) throw ie;

    closeEditor();
    resetEditor();
    toast('Danke, deine Seite ist im Freundebuch ✏️');
    loadEntries();
  }catch(e){
    showError('Speichern fehlgeschlagen. Versuch es gleich nochmal.');
  }finally{
    btn.disabled = false;
    btn.textContent = orig;
  }
});

// Editor nach erfolgreichem Speichern leeren (fürs nächste Mal).
function resetEditor(){
  FIELD_MAP.forEach(([i, s]) => { $(i).value = ''; $(s).textContent = ''; $(s).dataset.empty = '1'; });
  profileURL = null;   // Data-URL, kein revoke nötig
  $('fbPhotoImg').hidden = true; $('fbPhotoImg').removeAttribute('src');
  $('fbPhotoPh').hidden = false; $('fbPhotoSlot').classList.remove('has-photo');
  $('fbPhotoBtnLbl').textContent = 'Foto auswählen';
  if(sigBlob){ sigBlob = null; }
  const sig = $('fbSignImg');
  if(sig.src) URL.revokeObjectURL(sig.src);
  sig.hidden = true; sig.removeAttribute('src');
  $('fbSignBtnLbl').textContent = 'Unterschrift malen';
  if(bgImgURL){ URL.revokeObjectURL(bgImgURL); bgImgURL = null; }
  [fbCardBg, fbCardBg2].forEach(bg => { bg.style.backgroundImage = ''; });
  CARDS.forEach(c => { c.classList.remove('has-bg-img'); c.style.backgroundColor = bgColor; });
  showPage(1);
}

// Escape schließt von innen nach außen: Malfeld → Editor → Lightbox → Seite.
document.addEventListener('keydown', e => {
  if(e.key !== 'Escape') return;
  if(draw.classList.contains('show')) closeDraw();
  else if(editor.classList.contains('show')) closeEditor();
  else if(lightbox.classList.contains('show')) closeLightbox();
  else if(page.classList.contains('show')) closePage();
});
