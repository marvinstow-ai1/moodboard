// ============================================================================
// Gästebuch — Einträge mit Name, Instagram & gemalter Unterschrift
// ----------------------------------------------------------------------------
// Öffnet sich als vollflächige Seite (wie die Info-Page) über den Buch-Button
// in der Bottom-Bar. "Eintragen" öffnet ein Modal mit Name + Instagram und
// einem Unterschrift-Feld; ein Tipp darauf öffnet das Malfeld (Canvas).
// Die Unterschrift wird als zugeschnittenes, transparentes PNG in den
// Storage-Bucket (guestbook/) hochgeladen, der Eintrag landet in
// public.guestbook_entries (RLS: nur Mitglieder, siehe db/guestbook.sql).
// ============================================================================

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://uvfuxnwinuakbqanaxtp.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2ZnV4bndpbnVha2JxYW5heHRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxNzg3MDIsImV4cCI6MjA5NTc1NDcwMn0.quSvaycB3Yk2JXCnQz7AQmHpyATtx6u0U8aGQXD73fo';
const BUCKET = 'moodboard';
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = id => document.getElementById(id);

const page    = $('gbPage');
const list    = $('gbList');
const modal   = $('gbModal');
const draw    = $('gbDraw');
const canvas  = $('gbdCanvas');
const wrap    = $('gbdCanvasWrap');
const sigBox  = $('gbmSigBox');
const sigPrev = $('gbmSigPreview');
const sigHint = $('gbmSigHint');

const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function toast(t){ window.MB?.toast ? window.MB.toast(t) : console.log(t); }

// ── Seite öffnen / schließen ───────────────────────────────────────────────
// will-change nur während der Animation (gleiches Muster wie die Info-Page).
let _animTimer = null;
function markAnimating(){
  page.classList.add('is-animating');
  clearTimeout(_animTimer);
  _animTimer = setTimeout(() => page.classList.remove('is-animating'), 320);
}

function openPage(){
  window.MB?.closeOtherPopups?.();
  markAnimating();
  page.classList.add('show');
  page.setAttribute('aria-hidden', 'false');
  window.MB?.updateBodyLock?.();
  loadEntries();
}
function closePage(){
  markAnimating();
  page.classList.remove('show');
  page.setAttribute('aria-hidden', 'true');
  window.MB?.updateBodyLock?.();
}

$('guestbookBtn')?.addEventListener('click', e => { e.stopPropagation(); openPage(); });
$('gbClose').addEventListener('click', closePage);

// ── Einträge laden & rendern ───────────────────────────────────────────────
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
    list.innerHTML = '<div class="gb-status">Konnte das Gästebuch nicht laden. Versuch es gleich nochmal.</div>';
    return;
  }
  if(!data || !data.length){
    list.innerHTML = '<div class="gb-status">Noch keine Einträge – sei die/der Erste! ✍️</div>';
    return;
  }
  list.innerHTML = data.map(e => {
    const handle = (e.instagram || '').replace(/^@/, '');
    const insta = handle
      ? `<a class="gb-entry-insta" href="https://instagram.com/${encodeURIComponent(handle)}" target="_blank" rel="noopener noreferrer">@${esc(handle)}</a>`
      : '';
    const del = owner
      ? `<button class="gb-entry-del" data-del="${esc(e.id)}" aria-label="Eintrag löschen">
           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px;display:block">
             <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
           </svg>
         </button>`
      : '';
    return `
      <div class="gb-entry">
        <div class="gb-entry-meta">
          <span class="gb-entry-name">${esc(e.name)} <span class="gb-entry-warhier">war hier</span></span>
          ${insta}
          <span class="gb-entry-date">${fmtDate(e.created_at)}</span>
        </div>
        <span class="gb-entry-sig"><img src="${esc(e.signature_url)}" loading="lazy" decoding="async" alt="Unterschrift von ${esc(e.name)}"></span>
        ${del}
      </div>`;
  }).join('');

  list.querySelectorAll('[data-del]').forEach(btn => {
    btn.onclick = async () => {
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
        list.innerHTML = '<div class="gb-status">Noch keine Einträge – sei die/der Erste! ✍️</div>';
    };
  });
}

// ── Eintrags-Modal ─────────────────────────────────────────────────────────
let sigBlob = null;   // fertige Unterschrift als PNG-Blob (null = noch keine)

function showError(msg){
  const el = $('gbmError');
  el.textContent = msg;
  el.classList.add('show');
}
function clearError(){
  const el = $('gbmError');
  el.innerHTML = '&nbsp;';
  el.classList.remove('show');
}

function openModal(){
  sigBlob = null;
  sigPrev.hidden = true;
  sigPrev.removeAttribute('src');
  sigHint.style.display = '';
  sigBox.classList.remove('has-sig');
  $('gbmName').value = localStorage.getItem('mb_gate_name') || '';
  $('gbmInsta').value = '';
  clearError();
  modal.classList.add('show');
}
function closeModal(){ modal.classList.remove('show'); }

// Führendes @ direkt beim Tippen entfernen – das feste @ steht schon davor.
$('gbmInsta').addEventListener('input', e => {
  if(e.target.value.startsWith('@')) e.target.value = e.target.value.replace(/^@+/, '');
});

$('gbAddBtn').addEventListener('click', openModal);
$('gbmCancel').addEventListener('click', closeModal);
modal.addEventListener('click', e => { if(e.target === modal) closeModal(); });

// ── Malfeld (Canvas) ───────────────────────────────────────────────────────
const ctx = canvas.getContext('2d');
let drawing = false, hasInk = false, lastX = 0, lastY = 0;
let penColor = '#ffffff';   // aktuelle Stiftfarbe (Swatches unterm Titel)

// Farbauswahl: Klick auf einen Swatch wechselt die Stiftfarbe; bereits
// Gemaltes bleibt stehen, nur neue Striche bekommen die neue Farbe.
const colorsRow = $('gbdColors');
colorsRow?.querySelectorAll('.gbd-color').forEach(btn => {
  btn.addEventListener('click', () => {
    penColor = btn.dataset.color;
    ctx.strokeStyle = penColor;
    colorsRow.querySelector('.is-active')?.classList.remove('is-active');
    btn.classList.add('is-active');
  });
});

// Canvas in Gerätepixeln aufziehen, damit die Linie auch auf Retina knackig ist.
function setupCanvas(){
  const r = wrap.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width  = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = penColor;
  ctx.lineWidth = 3;
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
  // Punkt setzen, damit auch ein einzelner Tap sichtbar ist.
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
  // Erst nach dem Einblenden vermessen – vorher hat der Wrap keine Größe.
  requestAnimationFrame(setupCanvas);
}
function closeDraw(){ draw.classList.remove('show'); }

sigBox.addEventListener('click', openDraw);
$('gbdClear').addEventListener('click', () => {
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
  hasInk = false;
  wrap.classList.remove('has-ink');
});
$('gbdCancel').addEventListener('click', closeDraw);
draw.addEventListener('click', e => { if(e.target === draw) closeDraw(); });

// Unterschrift auf ihre Bounding-Box zuschneiden (mit etwas Rand), damit sie
// im Eintrag ohne Riesen-Leerraum skaliert. Liefert einen PNG-Blob.
function trimmedSignature(){
  const w = canvas.width, h = canvas.height;
  const img = ctx.getImageData(0, 0, w, h).data;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for(let y = 0; y < h; y++){
    for(let x = 0; x < w; x++){
      if(img[(y * w + x) * 4 + 3] > 0){
        if(x < minX) minX = x;
        if(x > maxX) maxX = x;
        if(y < minY) minY = y;
        if(y > maxY) maxY = y;
      }
    }
  }
  if(maxX < 0) return Promise.resolve(null);   // leer
  const pad = 12;
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad); maxY = Math.min(h - 1, maxY + pad);
  const out = document.createElement('canvas');
  out.width = maxX - minX + 1;
  out.height = maxY - minY + 1;
  out.getContext('2d').drawImage(canvas, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return new Promise(res => out.toBlob(res, 'image/png'));
}

$('gbdDone').addEventListener('click', async () => {
  if(!hasInk){ closeDraw(); return; }
  const blob = await trimmedSignature();
  if(!blob){ closeDraw(); return; }
  sigBlob = blob;
  if(sigPrev.src) URL.revokeObjectURL(sigPrev.src);
  sigPrev.src = URL.createObjectURL(blob);
  sigPrev.hidden = false;
  sigHint.style.display = 'none';
  sigBox.classList.add('has-sig');
  clearError();
  closeDraw();
});

// ── Speichern ──────────────────────────────────────────────────────────────
$('gbmSave').addEventListener('click', async () => {
  const name = $('gbmName').value.trim();
  const insta = $('gbmInsta').value.trim().replace(/^@/, '').replace(/^(https?:\/\/)?(www\.)?instagram\.com\//i, '').replace(/\/.*$/, '');
  if(!name){ showError('Bitte deinen Namen eintragen'); return; }
  if(!sigBlob){ showError('Bitte noch unterschreiben ✍️'); return; }

  const btn = $('gbmSave');
  btn.disabled = true;
  btn.textContent = 'Speichere…';
  try{
    const path = `guestbook/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    const { error: ue } = await sb.storage.from(BUCKET)
      .upload(path, sigBlob, { upsert: false, contentType: 'image/png', cacheControl: '31536000' });
    if(ue) throw ue;
    const url = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    const { error: ie } = await sb.from('guestbook_entries')
      .insert({ name, instagram: insta || null, signature_url: url });
    if(ie) throw ie;
    closeModal();
    toast('Danke für deinen Eintrag ✍️');
    loadEntries();
  }catch(e){
    showError('Speichern fehlgeschlagen. Versuch es gleich nochmal.');
  }finally{
    btn.disabled = false;
    btn.textContent = 'Eintragen';
  }
});

// Escape schließt von innen nach außen: Malfeld → Modal → Seite.
document.addEventListener('keydown', e => {
  if(e.key !== 'Escape') return;
  if(draw.classList.contains('show')) closeDraw();
  else if(modal.classList.contains('show')) closeModal();
  else if(page.classList.contains('show')) closePage();
});
