// ============================================================================
// 3D-Modell-Inventar — Marvin's Place
// ----------------------------------------------------------------------------
// Öffnet sich als vollflächige, deckend schwarze Seite (wie Info-/Gästebuch-
// Seite) über den "3D Modelle"-Eintrag in der Navigations-Vorschau (js/nav.js).
// Zeigt alle hochgeladenen 3D-Modelle als cleanes Inventar in einem festen
// 3er-Grid: jedes Modell dreht sich live und schwebt frei im Bühnen-Halo –
// ohne Podest, Kachel oder Karte drumherum. Ein Tipp öffnet das Modell groß
// im Viewer-Overlay mit voller Steuerung (drehen/zoomen).
//
// Inventar-Funktionen: kleiner Such-Button (Feld fährt aus), kleiner
// Sortier-Button (Menü: neu/alt/A–Z) und Zähler.
//
// Verwaltung (nur Owner): Upload, Bearbeiten und Löschen laufen NICHT auf der
// Seite selbst, sondern gebündelt im "3D-Modelle verwalten"-Popup (#m3dManage),
// das über den Verwalten-Tab des Header-Menüs (#m3dManageBtn/-Sheet) geöffnet
// wird. Das Upload-Sheet (#m3dModal) dient dabei auch als Editor: der Titel
// ist änderbar, eine neue Datei ersetzt das Modell optional.
//
// Performance:
//  · Die <model-viewer>-Bibliothek wird NICHT beim App-Start geladen, sondern
//    erst beim ersten Öffnen dieser Seite dynamisch importiert.
//  · Pro Bühne wird der <model-viewer> erst erzeugt, wenn sie in die Nähe des
//    Viewports scrollt (IntersectionObserver) – und wieder entfernt, wenn sie
//    weit genug herausscrollt. So existieren nie dutzende WebGL-Kontexte
//    gleichzeitig, egal wie groß das Inventar wird.
//  · Die Modell-Liste wird gecacht: erneutes Öffnen rendert sofort aus dem
//    Cache und gleicht die Daten still im Hintergrund ab.
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

// ── Inventar-Zustand ───────────────────────────────────────────────────────
let _models = null;      // Cache der geladenen Datensätze (neueste zuerst)
let _owner  = false;
let _query  = '';
let _sort   = 'new';     // 'new' | 'old' | 'az'

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

// Grid-Bühnen anhalten/fortsetzen. Wird der große Viewer geöffnet, geben wir
// ALLE laufenden Grid-<model-viewer> frei: sonst liegen deren WebGL-Kontexte
// plus der große Viewer (mit u. U. großem Modell) gleichzeitig auf der GPU –
// auf Mobilgeräten sprengt das schnell das Kontext-/Speicherlimit, der Tab
// stürzt ab und lädt neu. Beim Schließen lassen wir die sichtbaren Bühnen
// wieder aufleben (erneutes observe → der Observer feuert für den aktuellen
// Sichtbarkeitsstand neu).
function pauseGrid(){
  _gridPaused = true;
  grid.querySelectorAll('.m3d-stage').forEach(unmountStage);
}
function resumeGrid(){
  if(!_gridPaused) return;
  _gridPaused = false;
  const io = getIO();
  grid.querySelectorAll('.m3d-stage').forEach(st => { io.unobserve(st); io.observe(st); });
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

// ── Filtern / Sortieren / Rendern ──────────────────────────────────────────
function visibleModels(){
  let list = _models ? [..._models] : [];
  const q = _query.trim().toLowerCase();
  if(q) list = list.filter(m => (m.title || '').toLowerCase().includes(q));
  if(_sort === 'old') list.reverse();
  else if(_sort === 'az')
    list.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'de', { sensitivity: 'base' }));
  return list;
}

function render(){
  // Alte Bühnen sauber abbauen, bevor das Grid neu befüllt wird.
  grid.querySelectorAll('.m3d-stage').forEach(st => { _io?.unobserve(st); unmountStage(st); });

  const toolbar = $('m3dToolbar');
  const hasAny = !!(_models && _models.length);
  if(toolbar) toolbar.hidden = !hasAny;

  if(!hasAny){
    grid.innerHTML = _owner
      ? '<div class="m3d-status">Noch keine Modelle – lade dein erstes über „Verwalten → 3D-Modelle verwalten“ hoch 🧊</div>'
      : '<div class="m3d-status">Noch keine Modelle im Inventar 🧊</div>';
    return;
  }

  const count = $('m3dCount');
  const list = visibleModels();
  if(count) count.textContent = _query.trim()
    ? `${list.length} / ${_models.length}`
    : `${_models.length} ${_models.length === 1 ? 'Modell' : 'Modelle'}`;

  grid.innerHTML = '';
  if(!list.length){
    grid.innerHTML = '<div class="m3d-status">Kein Modell passt zu deiner Suche.</div>';
    return;
  }

  list.forEach((m, i) => {
    const item = document.createElement('div');
    item.className = 'm3d-item';
    item.dataset.id = m.id;
    item.style.animationDelay = `${Math.min(i, 8) * 0.04 + 0.04}s`;

    const stage = makeStage(m);
    stage.addEventListener('click', () => openViewer(m));
    item.appendChild(stage);

    const title = document.createElement('div');
    title.className = 'm3d-item-title';
    title.textContent = m.title;
    item.appendChild(title);

    grid.appendChild(item);
  });
}

// ── Toolbar: kleiner Such-Button (Feld fährt aus) + Sortier-Menü ──────────
let _searchTimer = 0;
const searchWrap  = $('m3dSearchWrap');
const searchInput = $('m3dSearch');

$('m3dSearchBtn')?.addEventListener('click', () => {
  const open = !searchWrap.classList.contains('open');
  searchWrap.classList.toggle('open', open);
  $('m3dSearchBtn').setAttribute('aria-expanded', String(open));
  if(open){
    searchInput.focus();
  }else if(_query){
    // Zuklappen verwirft die Suche – zurück zum vollen Inventar.
    searchInput.value = '';
    _query = '';
    render();
  }
});
searchInput?.addEventListener('input', e => {
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(() => { _query = e.target.value || ''; render(); }, 140);
});

const sortMenu = $('m3dSortMenu');
$('m3dSortBtn')?.addEventListener('click', e => {
  e.stopPropagation();
  const open = !sortMenu.classList.contains('show');
  sortMenu.classList.toggle('show', open);
  $('m3dSortBtn').setAttribute('aria-expanded', String(open));
});
sortMenu?.querySelectorAll('button').forEach(btn => {
  btn.addEventListener('click', () => {
    _sort = btn.dataset.sort;
    sortMenu.querySelectorAll('button').forEach(b => {
      b.classList.toggle('active', b === btn);
      b.setAttribute('aria-checked', String(b === btn));
    });
    closeSortMenu();
    render();
  });
});
function closeSortMenu(){
  sortMenu?.classList.remove('show');
  $('m3dSortBtn')?.setAttribute('aria-expanded', 'false');
}
document.addEventListener('click', e => {
  if(!e.target.closest('.m3d-sortwrap')) closeSortMenu();
});

// ── Modelle laden ──────────────────────────────────────────────────────────
// Mit Cache: liegt schon eine Liste vor, wird sofort daraus gerendert und die
// Daten werden still im Hintergrund abgeglichen (nur bei Änderung neu malen).
async function loadModels(){
  const hadCache = !!_models;
  if(hadCache) render();
  else grid.innerHTML = '<div class="m3d-status">Lade…</div>';

  const [{ data, error }, owner] = await Promise.all([
    sb.from('models_3d')
      .select('id,title,model_url,created_at')
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

function renderManage(){
  const listEl = $('m3dgList');
  if(!listEl) return;
  if(!_models || !_models.length){
    listEl.innerHTML = '<div class="m3dg-empty">Noch keine Modelle im Inventar.<br>Lade unten dein erstes 3D-Modell hoch 🧊</div>';
    return;
  }
  listEl.innerHTML = '';
  for(const m of _models){
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

    listEl.appendChild(row);
  }
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
  // Datei aus dem Storage entfernen (best effort – die Anzeige hängt nur am Datensatz).
  const path = storagePathFromUrl(m.model_url);
  if(path) sb.storage.from(BUCKET).remove([path]).catch(() => {});
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
  if(!title){ showError('Bitte einen Titel eintragen'); return; }
  if(!editModel && !pickedFile){ showError('Bitte eine .glb- oder .gltf-Datei wählen'); return; }
  if(pickedFile && pickedFile.size > 60 * 1024 * 1024){ showError('Datei ist zu groß (max. 60 MB)'); return; }

  const btn = $('m3dmSave');
  btn.disabled = true;
  const oldLabel = btn.textContent;
  btn.textContent = pickedFile ? 'Lade hoch…' : 'Speichere…';
  try{
    if(editModel){
      const patch = { title: title.slice(0, 80) };
      if(pickedFile) patch.model_url = await uploadFile(pickedFile);
      const { error } = await sb.from('models_3d').update(patch).eq('id', editModel.id);
      if(error) throw error;
      // Alte Datei erst nach erfolgreichem Update entfernen (best effort).
      if(pickedFile){
        const oldPath = storagePathFromUrl(editModel.model_url);
        if(oldPath) sb.storage.from(BUCKET).remove([oldPath]).catch(() => {});
      }
      toast('Modell aktualisiert ✓');
    }else{
      const url = await uploadFile(pickedFile);
      const { error } = await sb.from('models_3d')
        .insert({ title: title.slice(0, 80), model_url: url });
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
