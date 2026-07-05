// ============================================================================
// 3D-Modell-Inventar — Marvin's Place
// ----------------------------------------------------------------------------
// Öffnet sich als vollflächige Seite (wie Info-/Gästebuch-Seite) über den
// "3D Modelle"-Eintrag in der Navigations-Vorschau (js/nav.js). Zeigt alle
// hochgeladenen 3D-Modelle als Inventar in einem festen 3er-Grid: jedes Modell
// dreht sich live auf einem kleinen Podest ("Plattform"). Ein Tipp öffnet das
// Modell groß im Viewer-Overlay mit voller Steuerung (drehen/zoomen).
//
// Der Owner lädt Modelle über ein Sheet hoch: Titel, .glb/.gltf-Datei und ein
// Dropdown für die Podest-Art. Die Datei landet im Storage-Bucket `moodboard`
// unter models/, der Datensatz in public.models_3d (RLS: lesen Mitglieder,
// schreiben/löschen nur Owner – siehe db/models_3d.sql).
//
// Die 3D-Anzeige nutzt Googles <model-viewer> (per CDN in index.html geladen).
// Das framt jedes Modell automatisch ein, sodass ALLE Modelle unabhängig von
// ihrer Ursprungsgröße gleich groß in der Vitrine stehen ("beim Upload an die
// Größe angepasst").
// ============================================================================

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://uvfuxnwinuakbqanaxtp.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2ZnV4bndpbnVha2JxYW5heHRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxNzg3MDIsImV4cCI6MjA5NTc1NDcwMn0.quSvaycB3Yk2JXCnQz7AQmHpyATtx6u0U8aGQXD73fo';
const BUCKET = 'moodboard';
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = id => document.getElementById(id);

const page   = $('m3dPage');
const grid   = $('m3dGrid');
const modal  = $('m3dModal');
const viewer = $('m3dViewer');

// Podest-Arten fürs Dropdown (Key muss zum CHECK in db/models_3d.sql passen).
const PEDESTALS = [
  ['obsidian', 'Obsidian – dunkler Stein'],
  ['marble',   'Marmor – hell & edel'],
  ['neon',     'Neon – leuchtender Ring'],
  ['gold',     'Gold – warmes Metall'],
  ['glass',    'Glas – klare Scheibe'],
  ['wood',     'Holz – warm gemasert'],
];
const PEDESTAL_KEYS = new Set(PEDESTALS.map(p => p[0]));

const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

function toast(t){ window.MB?.toast ? window.MB.toast(t) : console.log(t); }

async function isOwner(){
  try{
    const { data: { session } } = await sb.auth.getSession();
    return session?.user?.app_metadata?.role === 'owner';
  }catch(e){ return false; }
}

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
  window.MB?.closeGuestbook?.();   // nie zwei Glas-Popups übereinander
  markAnimating();
  page.classList.add('show');
  page.setAttribute('aria-hidden', 'false');
  window.MB?.updateBodyLock?.();
  window.MB?.kickAutoplay?.();
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

// ── Modell-Bühne bauen ─────────────────────────────────────────────────────
// Ein <model-viewer> für die kleine Vitrine im Grid: dreht automatisch, keine
// Nutzer-Interaktion (Tippen öffnet stattdessen den großen Viewer). Die
// Auto-Einrahmung sorgt für einheitliche Größe aller Modelle.
function makeStage(m, big){
  const stage = document.createElement('div');
  stage.className = big ? 'm3d-viewer-stage' : 'm3d-stage';
  const ped = PEDESTAL_KEYS.has(m.pedestal) ? m.pedestal : 'obsidian';
  if(!big) stage.dataset.pedestal = ped;

  const mv = document.createElement('model-viewer');
  mv.className = big ? 'm3d-viewer-mv' : 'm3d-mv';
  mv.setAttribute('src', m.model_url);
  mv.setAttribute('alt', m.title || '3D-Modell');
  mv.setAttribute('camera-orbit', '0deg 75deg auto');   // auto-Radius = einheitliche Einrahmung
  mv.setAttribute('shadow-intensity', '0.9');
  mv.setAttribute('shadow-softness', '1');
  mv.setAttribute('exposure', '1');
  mv.setAttribute('environment-image', 'neutral');
  mv.setAttribute('loading', 'lazy');

  if(big){
    mv.setAttribute('camera-controls', '');
    mv.setAttribute('auto-rotate', '');
    mv.setAttribute('touch-action', 'pan-y');
  }else{
    // Grid-Kachel: nur drehen, keine Steuerung/Zoom.
    mv.setAttribute('auto-rotate', '');
    mv.setAttribute('rotation-per-second', '22deg');
    mv.setAttribute('auto-rotate-delay', '0');
    mv.setAttribute('interaction-prompt', 'none');
    mv.setAttribute('disable-zoom', '');
    mv.setAttribute('disable-pan', '');
    mv.setAttribute('disable-tap', '');
  }
  stage.appendChild(mv);

  if(!big){
    const podium = document.createElement('div');
    podium.className = 'm3d-podium';
    podium.innerHTML = '<span class="pod-side"></span><span class="pod-top"></span>';
    stage.appendChild(podium);

    const note = document.createElement('div');
    note.className = 'm3d-stage-note';
    note.hidden = true;
    stage.appendChild(note);
    mv.addEventListener('error', () => {
      note.hidden = false; note.textContent = 'Modell konnte nicht geladen werden';
    });
  }
  return stage;
}

// ── Modelle laden & rendern ────────────────────────────────────────────────
async function loadModels(){
  grid.innerHTML = '<div class="m3d-status">Lade…</div>';
  const [{ data, error }, owner] = await Promise.all([
    sb.from('models_3d')
      .select('id,title,model_url,pedestal,created_at')
      .order('created_at', { ascending: false }),
    isOwner(),
  ]);

  if(error){
    grid.innerHTML = '<div class="m3d-status">Konnte das Inventar nicht laden. Versuch es gleich nochmal.</div>';
    return;
  }
  if(!data || !data.length){
    grid.innerHTML = owner
      ? '<div class="m3d-status">Noch keine Modelle – lade unten dein erstes 3D-Modell hoch 🧊</div>'
      : '<div class="m3d-status">Noch keine Modelle im Inventar 🧊</div>';
    return;
  }

  grid.innerHTML = '';
  for(const m of data){
    const tile = document.createElement('div');
    tile.className = 'm3d-tile';
    tile.dataset.id = m.id;

    const stage = makeStage(m, false);
    stage.addEventListener('click', () => openViewer(m));
    tile.appendChild(stage);

    const cap = document.createElement('div');
    cap.className = 'm3d-cap';
    const title = document.createElement('span');
    title.className = 'm3d-cap-title';
    title.textContent = m.title;
    cap.appendChild(title);

    if(owner){
      const del = document.createElement('button');
      del.className = 'm3d-del';
      del.type = 'button';
      del.setAttribute('aria-label', 'Modell löschen');
      del.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;display:block"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      del.addEventListener('click', (e) => { e.stopPropagation(); onDelete(m, del); });
      cap.appendChild(del);
    }
    tile.appendChild(cap);
    grid.appendChild(tile);
  }
}

// Löschen zweistufig (wie im Gästebuch): erster Klick fragt nach, zweiter löscht.
async function onDelete(m, btn){
  if(!btn.dataset.armed){
    btn.dataset.armed = '1';
    btn.style.opacity = '1';
    btn.style.color = '#ff7b7b';
    setTimeout(() => { delete btn.dataset.armed; btn.style.opacity = ''; btn.style.color = ''; }, 2500);
    return;
  }
  const { error } = await sb.from('models_3d').delete().eq('id', m.id);
  if(error){ toast('Löschen fehlgeschlagen'); return; }
  // Datei aus dem Storage entfernen (best effort – die Anzeige hängt nur am Datensatz).
  const path = storagePathFromUrl(m.model_url);
  if(path) sb.storage.from(BUCKET).remove([path]).catch(() => {});
  btn.closest('.m3d-tile')?.remove();
  if(!grid.querySelector('.m3d-tile'))
    grid.innerHTML = '<div class="m3d-status">Noch keine Modelle – lade unten dein erstes 3D-Modell hoch 🧊</div>';
}

function storagePathFromUrl(url){
  const marker = `/object/public/${BUCKET}/`;
  const i = String(url).indexOf(marker);
  return i >= 0 ? decodeURIComponent(url.slice(i + marker.length)) : null;
}

// ── Viewer-Overlay ─────────────────────────────────────────────────────────
function openViewer(m){
  const stageHost = $('m3dViewerStage');
  const titleEl = $('m3dViewerTitle');
  if(!stageHost) return;
  titleEl.textContent = m.title || '3D-Modell';
  stageHost.innerHTML = '';
  stageHost.appendChild(makeStage(m, true).firstChild);   // nur das <model-viewer>
  viewer.classList.add('show');
  viewer.setAttribute('aria-hidden', 'false');
}
function closeViewer(){
  viewer.classList.remove('show');
  viewer.setAttribute('aria-hidden', 'true');
  const stageHost = $('m3dViewerStage');
  if(stageHost) stageHost.innerHTML = '';   // WebGL-Kontext freigeben
}
$('m3dViewerClose')?.addEventListener('click', closeViewer);
viewer?.addEventListener('click', e => { if(e.target === viewer) closeViewer(); });

// ── Upload-Sheet ───────────────────────────────────────────────────────────
let pickedFile = null;

function fillPedestalSelect(){
  const sel = $('m3dmPedestal');
  if(!sel || sel.options.length) return;
  for(const [val, label] of PEDESTALS){
    const opt = document.createElement('option');
    opt.value = val; opt.textContent = label;
    sel.appendChild(opt);
  }
}

function showError(msg){
  const el = $('m3dmError');
  el.textContent = msg; el.classList.add('show');
}
function clearError(){
  const el = $('m3dmError');
  el.textContent = ''; el.classList.remove('show');
}

function setFile(file){
  const drop = $('m3dmDrop');
  const main = $('m3dmDropMain');
  const okName = /\.(glb|gltf)$/i.test(file?.name || '');
  if(!file || !okName){
    pickedFile = null;
    drop.classList.remove('has-file');
    main.textContent = 'Datei wählen oder hierher ziehen';
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

function openModal(){
  fillPedestalSelect();
  pickedFile = null;
  $('m3dmTitle').value = '';
  $('m3dmFile').value = '';
  $('m3dmPedestal').selectedIndex = 0;
  $('m3dmDrop').classList.remove('has-file');
  $('m3dmDropMain').textContent = 'Datei wählen oder hierher ziehen';
  clearError();
  modal.classList.add('show');
}
function closeModal(){ modal.classList.remove('show'); }

$('m3dAddBtn')?.addEventListener('click', openModal);
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

// Speichern: Datei in den Storage, Datensatz in models_3d.
$('m3dmSave')?.addEventListener('click', async () => {
  const title = $('m3dmTitle').value.trim();
  const pedestal = $('m3dmPedestal').value;
  if(!title){ showError('Bitte einen Titel eintragen'); return; }
  if(!pickedFile){ showError('Bitte eine .glb- oder .gltf-Datei wählen'); return; }
  if(pickedFile.size > 60 * 1024 * 1024){ showError('Datei ist zu groß (max. 60 MB)'); return; }

  const btn = $('m3dmSave');
  btn.disabled = true;
  const oldLabel = btn.textContent;
  btn.textContent = 'Lade hoch…';
  try{
    const ext = /\.gltf$/i.test(pickedFile.name) ? 'gltf' : 'glb';
    const path = `models/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const contentType = ext === 'glb' ? 'model/gltf-binary' : 'model/gltf+json';
    const { error: ue } = await sb.storage.from(BUCKET)
      .upload(path, pickedFile, { upsert: false, contentType, cacheControl: '31536000' });
    if(ue) throw ue;
    const url = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    const { error: ie } = await sb.from('models_3d')
      .insert({ title: title.slice(0, 80), model_url: url, pedestal });
    if(ie) throw ie;
    closeModal();
    toast('Modell hinzugefügt 🧊');
    loadModels();
  }catch(e){
    showError('Upload fehlgeschlagen. Versuch es gleich nochmal.');
  }finally{
    btn.disabled = false;
    btn.textContent = oldLabel;
  }
});

// Escape schließt von innen nach außen: Viewer → Modal → Seite.
document.addEventListener('keydown', e => {
  if(e.key !== 'Escape') return;
  if(viewer.classList.contains('show')) closeViewer();
  else if(modal.classList.contains('show')) closeModal();
  else if(page.classList.contains('show')) closePage();
});
