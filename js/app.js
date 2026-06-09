// ════════════════════════════════════════════════════════
// Marvin's Place — Moodboard
// Vanilla ES module, Supabase backend, minimal UI.
// ════════════════════════════════════════════════════════

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// ── Config ──────────────────────────────────────────────
const SUPABASE_URL = 'https://uvfuxnwinuakbqanaxtp.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2ZnV4bndpbnVha2JxYW5heHRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxNzg3MDIsImV4cCI6MjA5NTc1NDcwMn0.quSvaycB3Yk2JXCnQz7AQmHpyATtx6u0U8aGQXD73fo';
const BUCKET = 'moodboard';
const TABLE = 'moodboard_items';
const OWNER_EMAIL = 'marvin.stowermann1@gmail.com';
const MAX_PX = 1920;
const UPLOAD_CONCURRENCY = 3;
const SLIDESHOW_INTERVAL = 5000;

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Helpers ─────────────────────────────────────────────
const $ = id => document.getElementById(id);
const isVid = n => /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(n || '');
const isGif = n => /\.gif(\?|#|$)/i.test(n || '');

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function slugify(s){
  return String(s).toLowerCase().trim()
    .replace(/[äöü]/g, m => ({'ä':'ae','ö':'oe','ü':'ue'}[m]))
    .replace(/ß/g,'ss')
    .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'') || 'seite';
}
function shuffleArray(arr){
  const a = [...arr];
  for(let i = a.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
async function copyText(text){
  try { await navigator.clipboard.writeText(text); return true; }
  catch(e){
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove();
      return true;
    } catch(e2){ return false; }
  }
}

const toastEl = $('toast');
function toast(t){
  toastEl.textContent = t;
  if(typeof gsap !== 'undefined'){
    gsap.killTweensOf(toastEl);
    toastEl.classList.add('show');
    gsap.fromTo(toastEl, {opacity:0, y:8}, {opacity:1, y:0, duration:.2, ease:'power2.out'});
    clearTimeout(toast._t);
    toast._t = setTimeout(() => gsap.to(toastEl, {opacity:0, y:8, duration:.18, ease:'power2.in',
      onComplete: () => toastEl.classList.remove('show')}), 1800);
  } else {
    toastEl.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toastEl.classList.remove('show'), 1600);
  }
}

// ── State ───────────────────────────────────────────────
const DEFAULT_MOODS = ['All','Summer','Winter','Cozy','Dark'];
function loadMoodsList(){
  try{
    const v = JSON.parse(localStorage.getItem('mb_moods_list') || 'null');
    if(Array.isArray(v) && v.length && v[0] === 'All') return v;
  }catch(e){}
  return [...DEFAULT_MOODS];
}

const state = {
  items: [],
  currentItems: [],
  moods: loadMoodsList(),
  pages: [],
};

let owner = false;
let editId = null;
let lbIndex = 0;
let lbIsMuted = true;
let selMode = false;
let selectedIds = new Set();
let gridObserver = null;
let isInitialLoad = true;
let slideshowActive = false;
let slideshowTimer = null;
let sleepTimeout = null;
let currentView = 'archive';   // 'archive' | 'moods' | 'page'
let currentPageSlug = null;
let moodsViewOpen = false;
let viewAnimating = false;
let sortNewest = localStorage.getItem('sort_newest') === 'true';
let activeMoods = new Set(JSON.parse(localStorage.getItem('active_moods') || '[]'));

function saveMoodsList(){
  try{ localStorage.setItem('mb_moods_list', JSON.stringify(state.moods)); }catch(e){}
}
function saveFilterState(){
  localStorage.setItem('active_moods', JSON.stringify([...activeMoods]));
  localStorage.setItem('grid_cols', String(gridCols));
}

// ── DOM refs ────────────────────────────────────────────
const gridEl = $('grid');
const gridWrap = $('gridWrap');
const lightbox = $('lightbox');
const lbInner = $('lbInner');
const lbAmbient = $('lbAmbient');
const fileInput = $('fileInput');
const progressBar = $('progress');
const menu = $('menu');
const menuOverlay = $('menuOverlay');
const filterPopup = $('filterPopup');
const actionBar = $('actionBar');
const moodsView = $('moodsView');
const moodsGrid = $('moodsGrid');
const customPageView = $('customPageView');
const customPageInner = $('customPageInner');
const itemCountEl = $('itemCount');

// ── Auth ────────────────────────────────────────────────
function updateAdminUI(){
  document.body.classList.toggle('owner', owner);
  $('loginBtn').classList.toggle('is-owner', owner);
}
async function initAuth(){
  const { data: { session } } = await sb.auth.getSession();
  owner = !!(session && session.user.email === OWNER_EMAIL);
  updateAdminUI();
  sb.auth.onAuthStateChange((_e, session) => {
    owner = !!(session && session.user.email === OWNER_EMAIL);
    updateAdminUI();
  });
}
function openLoginModal(){
  $('loginModal').classList.add('show');
  updateBodyLock();
  setTimeout(() => $('loginPassword')?.focus(), 60);
}
function closeLoginModal(){
  $('loginModal').classList.remove('show');
  updateBodyLock();
  if($('loginPassword')) $('loginPassword').value = '';
}
async function submitLogin(){
  const email = ($('loginEmail')?.value || '').trim().toLowerCase();
  const password = $('loginPassword')?.value || '';
  if(!email || !password){ toast('Bitte E-Mail und Passwort eingeben'); return; }
  const btn = $('loginSubmit');
  btn.disabled = true; btn.textContent = 'Wird geprüft';
  const { error } = await sb.auth.signInWithPassword({ email, password });
  btn.disabled = false; btn.textContent = 'Einloggen';
  if(error){ toast('Falsches Passwort oder E-Mail'); return; }
  closeLoginModal();
  toast('Eingeloggt');
}
$('loginBtn').onclick = async () => {
  if(owner){ await sb.auth.signOut(); toast('Abgemeldet'); return; }
  openLoginModal();
};
$('loginSubmit').onclick = submitLogin;
$('loginClose').onclick = closeLoginModal;
$('loginEmail').addEventListener('keydown', e => { if(e.key === 'Enter') $('loginPassword')?.focus(); });
$('loginPassword').addEventListener('keydown', e => {
  if(e.key === 'Enter') submitLogin();
  else if(e.key === 'Escape') closeLoginModal();
});
$('loginModal').addEventListener('click', e => { if(e.target === $('loginModal')) closeLoginModal(); });

// ── Body-Scroll-Lock ────────────────────────────────────
let lockedScrollY = 0;
function updateBodyLock(){
  const lock = lightbox.classList.contains('show')
    || !!document.querySelector('.modal.show')
    || (menu.classList.contains('show') && window.innerWidth <= 600);
  const isLocked = document.documentElement.classList.contains('no-scroll');
  if(lock && !isLocked){
    lockedScrollY = window.scrollY || 0;
    document.documentElement.classList.add('no-scroll');
    document.body.classList.add('no-scroll');
    document.body.style.top = `-${lockedScrollY}px`;
  } else if(!lock && isLocked){
    document.documentElement.classList.remove('no-scroll');
    document.body.classList.remove('no-scroll');
    document.body.style.top = '';
    window.scrollTo(0, lockedScrollY);
  }
}
function isUiBusy(){
  return lightbox.classList.contains('show') || !!document.querySelector('.modal.show');
}

// ── Grid-Spalten ────────────────────────────────────────
function getColRange(){
  return window.innerWidth <= 600 ? { min:1, max:5 } : { min:3, max:10 };
}
function getDefaultCols(){
  const r = getColRange();
  return Math.round((r.min + r.max) / 2);
}
let gridCols = (() => {
  const saved = localStorage.getItem('grid_cols');
  if(saved !== null){
    const v = parseInt(saved);
    const r = getColRange();
    if(v >= r.min && v <= r.max) return v;
  }
  return getDefaultCols();
})();

const swipeThumb = $('swipeThumb');
const swipeTrack = $('swipeTrack');
const swipeFill = $('swipeFill');
const swipeValue = $('swipeValue');

function updateColsUI(){
  const r = getColRange();
  const pct = r.max > r.min ? ((gridCols - r.min) / (r.max - r.min)) * 100 : 50;
  swipeThumb.style.left = pct + '%';
  swipeFill.style.width = pct + '%';
  swipeValue.textContent = gridCols;
}
function applyGridCols(cols){
  gridCols = cols;
  gridEl.style.gridTemplateColumns = cols === 1 ? '1fr' : `repeat(${cols}, 1fr)`;
  updateColsUI();
  saveFilterState();
}

let colsDragging = false;
function colsDragMove(cx){
  if(!colsDragging) return;
  const rect = swipeTrack.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (cx - rect.left) / rect.width));
  const r = getColRange();
  const cols = Math.round(r.min + pct * (r.max - r.min));
  if(cols !== gridCols) applyGridCols(cols);
}
swipeThumb.addEventListener('mousedown', e => { colsDragging = true; swipeThumb.classList.add('dragging'); e.preventDefault(); });
swipeThumb.addEventListener('touchstart', e => { colsDragging = true; swipeThumb.classList.add('dragging'); e.preventDefault(); }, { passive:false });
document.addEventListener('mousemove', e => colsDragMove(e.clientX));
document.addEventListener('touchmove', e => { if(colsDragging) colsDragMove(e.touches[0].clientX); }, { passive:true });
document.addEventListener('mouseup', () => { colsDragging = false; swipeThumb.classList.remove('dragging'); });
document.addEventListener('touchend', () => { colsDragging = false; swipeThumb.classList.remove('dragging'); }, { passive:true });
swipeTrack.addEventListener('click', e => {
  if(e.target === swipeThumb) return;
  colsDragging = true; colsDragMove(e.clientX); colsDragging = false;
});
$('colDec').onclick = () => { if(gridCols > getColRange().min) applyGridCols(gridCols - 1); };
$('colInc').onclick = () => { if(gridCols < getColRange().max) applyGridCols(gridCols + 1); };

window.addEventListener('resize', () => {
  const r = getColRange();
  applyGridCols(Math.max(r.min, Math.min(r.max, gridCols)));
});

// ── Grid-Rendering ──────────────────────────────────────
function renderGrid(){
  // Dedup nach id — schützt vor Race-Conditions bei parallelen Uploads
  const seen = new Set();
  state.items = state.items.filter(i => { if(seen.has(i.id)) return false; seen.add(i.id); return true; });

  // Filter auf existierende Moods beschränken (Mood könnte auf anderem Gerät gelöscht sein)
  const validMoods = new Set(state.moods);
  for(const m of [...activeMoods]) if(!validMoods.has(m)) activeMoods.delete(m);

  // OR-Filter über aktive Moods
  let arr = activeMoods.size > 0
    ? state.items.filter(i => Array.isArray(i.moods) && i.moods.some(m => activeMoods.has(m)))
    : state.items;

  // Leerer Treffer trotz Filter: Filter fallen lassen, damit immer Inhalt sichtbar ist
  if(activeMoods.size > 0 && arr.length === 0 && state.items.length > 0){
    activeMoods.clear();
    saveFilterState();
    arr = state.items;
  }

  arr = sortNewest ? arr : shuffleArray(arr);
  state.currentItems = arr;
  itemCountEl.textContent = arr.length || '';
  $('filterBtn').classList.toggle('active', activeMoods.size > 0);

  if(gridObserver){ gridObserver.disconnect(); gridObserver = null; }
  gridEl.innerHTML = arr.map(it => `
    <div class="cell" data-id="${it.id}">
      <input class="selcheck" type="checkbox" data-id="${it.id}">
      ${it.media_type === 'video'
        ? `<video src="${it.media_url}" muted loop playsinline preload="metadata"></video>`
        : `<img src="${it.media_url}" loading="lazy" decoding="async" alt="">`}
    </div>`).join('');

  if(isInitialLoad && typeof gsap !== 'undefined' && arr.length > 0){
    gsap.from(gridEl.querySelectorAll('.cell'), {
      opacity:0, scale:.96, duration:.35,
      stagger:{ amount: Math.min(.5, arr.length * .03), from:'start' },
      ease:'power2.out', clearProps:'transform,opacity'
    });
    isInitialLoad = false;
  }

  // Autoplay für Videos im Viewport
  gridObserver = new IntersectionObserver(entries => entries.forEach(e => {
    const v = e.target.querySelector('video'); if(!v) return;
    if(e.isIntersecting){ v.muted = true; v.play().catch(() => {}); }
    else { v.pause(); v.currentTime = 0; }
  }), { threshold:.25, rootMargin:'100px' });

  applyGridCols(gridCols);
  gridEl.querySelectorAll('.cell').forEach(c => {
    gridObserver.observe(c);
    const chk = c.querySelector('.selcheck');
    c.onclick = e => {
      if(selMode){
        const id = c.dataset.id;
        if(e.target !== chk) chk.checked = !chk.checked;
        chk.checked ? selectedIds.add(id) : selectedIds.delete(id);
        c.classList.toggle('sel-highlight', chk.checked);
        updateSelCount();
        return;
      }
      if(isAnyPopoverOpen()){ closeAllPopovers(); e.stopPropagation(); return; }
      openLightbox(state.currentItems.findIndex(x => x.id === c.dataset.id));
    };
    c.oncontextmenu = e => { e.preventDefault(); if(!selMode && owner) openEditor(c.dataset.id); };
    if(selMode){
      chk.classList.add('visible');
      if(selectedIds.has(c.dataset.id)){ chk.checked = true; c.classList.add('sel-highlight'); }
    }
  });
}

function animateNewCell(id){
  const cell = gridEl.querySelector(`.cell[data-id="${id}"]`);
  if(cell && typeof gsap !== 'undefined'){
    gsap.fromTo(cell, {opacity:0, scale:.9}, {opacity:1, scale:1, duration:.35, ease:'power2.out'});
  }
}

// ── Popover-Verwaltung (Menü, Filter, Spotify) ──────────
function isAnyPopoverOpen(){
  return menu.classList.contains('show')
    || filterPopup.classList.contains('show')
    || $('spotifyPopup').classList.contains('show')
    || $('pageNavMenu').classList.contains('show');
}
function closeAllPopovers(){
  closeMenu();
  filterPopup.classList.remove('show');
  $('filterBtn').classList.toggle('active', activeMoods.size > 0);
  $('spotifyPopup').classList.remove('show');
  $('spotifyBtn').classList.remove('active');
  closePageNav();
}

function openMenu(){ menu.classList.add('show'); menuOverlay.classList.add('show'); updateBodyLock(); }
function closeMenu(){ menu.classList.remove('show'); menuOverlay.classList.remove('show'); updateBodyLock(); }
$('menuBtn').onclick = e => { e.stopPropagation(); menu.classList.contains('show') ? closeMenu() : openMenu(); };
menuOverlay.onclick = closeMenu;
document.addEventListener('click', e => {
  if(!e.target.closest('#menu') && !e.target.closest('#menuBtn')) closeMenu();
  if(!e.target.closest('#filterPopup') && !e.target.closest('#filterBtn') && !e.target.closest('#mFilterBtn'))
    filterPopup.classList.remove('show');
});

// ── Filter-Popup ────────────────────────────────────────
$('filterBtn').onclick = e => {
  e.stopPropagation();
  renderFilterChips();
  filterPopup.classList.toggle('show');
};
function renderFilterChips(){
  const chips = state.moods.filter(m => m !== 'All');
  $('filterChips').innerHTML = chips.length
    ? chips.map(m => `<button class="chip ${activeMoods.has(m) ? 'active' : ''}" data-m="${escapeHtml(m)}">${escapeHtml(m)}</button>`).join('')
    : '<span class="mmg-empty">Keine Moods</span>';
  $('filterChips').querySelectorAll('.chip').forEach(chip => {
    chip.onclick = () => {
      const m = chip.dataset.m;
      activeMoods.has(m) ? activeMoods.delete(m) : activeMoods.add(m);
      saveFilterState();
      renderGrid();
      renderFilterChips();
    };
  });
}

// ── Sortierung / Shuffle ────────────────────────────────
function updateSortUI(){ $('sortNewestBtn').classList.toggle('active', sortNewest); }
function doShuffle(){
  if(sortNewest){ sortNewest = false; localStorage.setItem('sort_newest','false'); updateSortUI(); }
  renderGrid();
  toast('Neu gemischt');
}
$('shuffleBtn').onclick = () => { $('shuffleBtn').blur(); doShuffle(); };
$('sortNewestBtn').onclick = () => {
  sortNewest = !sortNewest;
  localStorage.setItem('sort_newest', sortNewest);
  updateSortUI();
  renderGrid();
  toast(sortNewest ? 'Sortiert: Zuletzt hinzugefügt' : 'Zufällige Anordnung');
};

// ── Menü-Aktionen ───────────────────────────────────────
$('uploadBtn').onclick = () => { fileInput.click(); closeMenu(); };
fileInput.onchange = e => upload(e.target.files);
$('mFilterBtn').onclick = e => { e.stopPropagation(); closeMenu(); renderFilterChips(); filterPopup.classList.add('show'); };
$('mShuffleBtn').onclick = () => { closeMenu(); doShuffle(); };
$('mSelectBtn').onclick = () => { closeMenu(); enterSelMode(); };
$('mMoodsBtn').onclick = () => { closeMenu(); openMoodsMgmt(); };
$('mPageBtn').onclick = () => { closeMenu(); openPageCreate(); };

// Quick-Add via URL
async function quickAdd(){
  const inp = $('quickAddUrl');
  const url = inp.value.trim();
  if(!url) return;
  if(!/^https?:\/\//i.test(url)){ toast('Ungültige URL'); return; }
  const item = {
    title: ((url.split('/').pop() || 'Link').split('?')[0] || 'Link').slice(0, 80),
    moods: [], tags: [],
    media_url: url,
    media_type: isVid(url) ? 'video' : 'image'
  };
  $('quickAddBtn').disabled = true;
  const { data:ins, error } = await sb.from(TABLE).insert(item).select().single();
  $('quickAddBtn').disabled = false;
  if(error){ toast('Fehler: ' + error.message); return; }
  state.items.unshift({ ...item, id: ins.id });
  inp.value = '';
  toast('Hinzugefügt');
  renderGrid();
  closeMenu();
}
$('quickAddBtn').onclick = quickAdd;
$('quickAddUrl').onkeydown = e => { if(e.key === 'Enter') quickAdd(); };

// ── Upload ──────────────────────────────────────────────
function prog(p){
  progressBar.style.width = p + '%';
  if(p >= 100) setTimeout(() => progressBar.style.width = '0', 600);
}
function compress(file, maxPx = MAX_PX, q = .88){
  return new Promise(res => {
    if(isVid(file.name) || isGif(file.name)){ res(file); return; }
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.width, h = img.height;
      if(w <= maxPx && h <= maxPx){ res(file); return; }
      const r = Math.min(maxPx / w, maxPx / h);
      w = Math.round(w * r); h = Math.round(h * r);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      const outName = file.name.replace(/\.[^.]+$/, '.webp');
      c.toBlob(b => res(new File([b], outName, { type:'image/webp' })), 'image/webp', q);
    };
    img.src = url;
  });
}

// KI-Mood-Vorschlag (Gemini Vision via /api/suggest-moods)
async function autoSuggestMoods(imageUrl){
  const moods = state.moods.filter(m => m !== 'All');
  if(!moods.length) return [];
  try {
    const res = await fetch('/api/suggest-moods', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ imageUrl, moods }),
    });
    if(!res.ok) return [];
    const { moods: suggested } = await res.json();
    return Array.isArray(suggested) ? suggested : [];
  } catch { return []; }
}

async function upload(files){
  const arr = Array.from(files);
  if(!arr.length) return;
  toast(`${arr.length} Datei${arr.length > 1 ? 'en' : ''} wird${arr.length > 1 ? 'en' : ''} hochgeladen`);
  let done = 0;
  const uploadOne = async f => {
    const cf = await compress(f);
    const ext = cf.name.split('.').pop().toLowerCase();
    const path = `${Date.now().toString(36)}${Math.random().toString(36).slice(2,6)}.${ext}`;
    const { error:e1 } = await sb.storage.from(BUCKET).upload(path, cf, { upsert:false, contentType:cf.type });
    if(e1){ toast('Upload-Fehler: ' + e1.message); return null; }
    const { data:pub } = sb.storage.from(BUCKET).getPublicUrl(path);
    const mediaType = isVid(f.name) ? 'video' : isGif(f.name) ? 'gif' : 'image';
    const suggestedMoods = mediaType === 'image' ? await autoSuggestMoods(pub.publicUrl) : [];
    const item = {
      title: f.name.replace(/\.[^.]+$/, ''),
      moods: suggestedMoods, tags: [],
      media_url: pub.publicUrl, media_type: mediaType
    };
    const { data:ins, error:e2 } = await sb.from(TABLE).insert(item).select().single();
    if(e2){ toast('DB-Fehler: ' + e2.message); return null; }
    done++;
    prog(Math.round(done / arr.length * 90));
    return { ...item, id: ins.id };
  };
  const results = [];
  for(let i = 0; i < arr.length; i += UPLOAD_CONCURRENCY){
    const batch = arr.slice(i, i + UPLOAD_CONCURRENCY);
    const batchResults = await Promise.all(batch.map(uploadOne));
    results.push(...batchResults.filter(Boolean));
  }
  if(results.length){
    const newIds = results.map(i => i.id);
    await refetchItems();
    renderGrid();
    newIds.forEach(animateNewCell);
  }
  prog(100);
  toast(`${results.length} Datei${results.length !== 1 ? 'en' : ''} hochgeladen`);
  fileInput.value = '';
}

// Drag-and-Drop-Upload
const dropOverlay = $('dropOverlay');
let dragDepth = 0;
document.addEventListener('dragenter', e => {
  if(!owner || !e.dataTransfer?.types?.includes('Files')) return;
  e.preventDefault();
  dragDepth++;
  dropOverlay.classList.add('show');
});
document.addEventListener('dragover', e => { if(owner) e.preventDefault(); });
document.addEventListener('dragleave', e => {
  if(!owner) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if(dragDepth === 0) dropOverlay.classList.remove('show');
});
document.addEventListener('drop', e => {
  if(!owner) return;
  e.preventDefault();
  dragDepth = 0;
  dropOverlay.classList.remove('show');
  if(e.dataTransfer?.files?.length) upload(e.dataTransfer.files);
});

// Einfügen aus der Zwischenablage
document.addEventListener('paste', e => {
  if(!owner || isUiBusy()) return;
  if(e.target.closest('input,textarea')) return;
  const files = [...(e.clipboardData?.files || [])].filter(f => /^(image|video)\//.test(f.type));
  if(files.length) upload(files);
});

// ── Auswahl- / Lösch-Modus ──────────────────────────────
function updateSelCount(){
  $('abCount').textContent = selectedIds.size + ' ausgewählt';
}
function enterSelMode(){
  selMode = true;
  selectedIds.clear();
  closeMenu();
  actionBar.classList.add('show');
  renderGrid();
  updateSelCount();
}
function exitSelMode(){
  selMode = false;
  selectedIds.clear();
  actionBar.classList.remove('show');
  renderGrid();
}
$('abCancel').onclick = exitSelMode;
$('abDelete').onclick = () => {
  if(!selectedIds.size){ toast('Nichts ausgewählt'); return; }
  showConfirm(`${selectedIds.size} Item${selectedIds.size !== 1 ? 's' : ''} endgültig löschen?`, async () => {
    await sb.from(TABLE).delete().in('id', [...selectedIds]);
    state.items = state.items.filter(i => !selectedIds.has(i.id));
    toast('Gelöscht');
    exitSelMode();
  });
};

// ── Bestätigungs-Dialog ─────────────────────────────────
const confirmPopup = $('confirmPopup');
let confirmCallback = null;
function showConfirm(text, onConfirm){
  $('cfmText').textContent = text;
  confirmPopup.classList.add('show');
  updateBodyLock();
  confirmCallback = onConfirm;
}
function closeConfirm(){
  confirmPopup.classList.remove('show');
  updateBodyLock();
  confirmCallback = null;
}
$('cfmYes').onclick = () => { const cb = confirmCallback; closeConfirm(); if(cb) cb(); };
$('cfmNo').onclick = closeConfirm;
confirmPopup.addEventListener('click', e => { if(e.target === confirmPopup) closeConfirm(); });

// ── Editor (Rechtsklick auf Zelle) ──────────────────────
const editModal = $('editModal');
function openEditor(id){
  editId = id;
  const it = state.items.find(x => x.id === id);
  if(!it) return;
  $('emTitle').textContent = it.title || 'Bearbeiten';
  $('emTags').value = (it.tags || []).join(', ');
  renderEditorChips();
  editModal.classList.add('show');
  updateBodyLock();
}
function closeEditor(){
  editModal.classList.remove('show');
  updateBodyLock();
}
function renderEditorChips(){
  const it = state.items.find(x => x.id === editId);
  $('emChips').innerHTML = state.moods.filter(m => m !== 'All').map(m =>
    `<button class="chip ${it && Array.isArray(it.moods) && it.moods.includes(m) ? 'active' : ''}" data-m="${escapeHtml(m)}">${escapeHtml(m)}</button>`
  ).join('');
  $('emChips').querySelectorAll('.chip').forEach(b => b.onclick = () => {
    const it = state.items.find(x => x.id === editId);
    if(!it) return;
    if(!Array.isArray(it.moods)) it.moods = [];
    const m = b.dataset.m;
    const idx = it.moods.indexOf(m);
    if(idx > -1) it.moods.splice(idx, 1); else it.moods.push(m);
    sbUpdate(it);
    renderEditorChips();
  });
}
$('emSave').onclick = () => {
  const it = state.items.find(x => x.id === editId);
  if(!it) return;
  it.tags = $('emTags').value.split(',').map(s => s.trim()).filter(Boolean);
  sbUpdate(it);
  renderGrid();
  closeEditor();
  toast('Gespeichert');
};
$('emClose').onclick = closeEditor;
editModal.addEventListener('click', e => { if(e.target === editModal) closeEditor(); });

// ── Share-Links (Deep-Link auf einzelnes Item) ──────────
function buildShareUrl(it){
  return `${location.origin}${location.pathname}#mb=${encodeURIComponent(it.id)}`;
}
function parseShareHash(){
  const m = (location.hash || '').slice(1).match(/^mb=(.+)$/);
  return m ? { id: decodeURIComponent(m[1]) } : null;
}
let pendingShare = parseShareHash();
function tryOpenPendingShare(){
  if(!pendingShare) return;
  const it = state.items.find(x => x.id === pendingShare.id);
  if(!it){
    if(state.items.length){ pendingShare = null; toast('Geteiltes Item nicht gefunden'); }
    return;
  }
  let idx = state.currentItems.findIndex(x => x.id === pendingShare.id);
  if(idx < 0){ state.currentItems = [it, ...state.currentItems]; idx = 0; }
  pendingShare = null;
  openLightbox(idx);
}
window.addEventListener('hashchange', () => {
  const p = parseShareHash();
  if(p){ pendingShare = p; tryOpenPendingShare(); }
});

// ── Ambient (Lightbox-Hintergrund) ──────────────────────
const ambientCache = new Map();
function getDominantColor(url){
  if(ambientCache.has(url)) return Promise.resolve(ambientCache.get(url));
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const W = 16, H = 16;
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, W, H);
        const d = ctx.getImageData(0, 0, W, H).data;
        let r = 0, g = 0, b = 0, n = 0;
        for(let i = 0; i < d.length; i += 4){
          if(d[i+3] < 128) continue;
          const lum = (d[i] + d[i+1] + d[i+2]) / 3;
          if(lum < 18 || lum > 240) continue;
          r += d[i]; g += d[i+1]; b += d[i+2]; n++;
        }
        const color = n ? [Math.round(r/n), Math.round(g/n), Math.round(b/n)] : null;
        ambientCache.set(url, color);
        resolve(color);
      } catch(e){ ambientCache.set(url, null); resolve(null); }
    };
    img.onerror = () => { ambientCache.set(url, null); resolve(null); };
    img.src = url;
  });
}
async function setAmbientFor(it){
  lbAmbient.style.opacity = '0';
  let c = 'rgba(90,95,130,.5)';
  if(it.media_type !== 'video'){
    const color = await getDominantColor(it.media_url);
    if(color) c = `rgba(${color[0]},${color[1]},${color[2]},.55)`;
  }
  if(!lightbox.classList.contains('show') || state.currentItems[lbIndex] !== it) return;
  lbAmbient.style.setProperty('--ambient', c);
  requestAnimationFrame(() => { lbAmbient.style.opacity = ''; });
}

// ── Lightbox ────────────────────────────────────────────
function preloadNeighbors(idx){
  [idx - 1, idx + 1].forEach(i => {
    const it = state.currentItems[i];
    if(it && it.media_type !== 'video') new Image().src = it.media_url;
  });
}
function updateMuteSvg(muted){
  const svg = $('lbMuteSvg');
  svg.innerHTML = muted
    ? '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>'
    : '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>';
}
function updateLbChrome(){
  $('lbCounter').textContent = `${lbIndex + 1} / ${state.currentItems.length}`;
  $('lbPrev').classList.toggle('disabled', lbIndex <= 0);
  $('lbNext').classList.toggle('disabled', lbIndex >= state.currentItems.length - 1);
}

function openLightbox(idx){
  if(idx < 0 || idx >= state.currentItems.length) return;
  lbIndex = idx;
  const it = state.currentItems[idx];
  lbInner.querySelectorAll('img,video').forEach(e => e.remove());
  if(it.media_type === 'video'){
    const v = document.createElement('video');
    v.src = it.media_url;
    v.autoplay = true; v.muted = true; v.loop = true; v.playsInline = true;
    v.addEventListener('click', () => {
      lbIsMuted = !lbIsMuted;
      v.muted = lbIsMuted;
      updateMuteSvg(lbIsMuted);
    });
    lbInner.appendChild(v);
    lbIsMuted = true;
    updateMuteSvg(true);
  } else {
    const img = document.createElement('img');
    img.src = it.media_url;
    img.style.pointerEvents = 'none';
    lbInner.appendChild(img);
  }
  lightbox.classList.add('show');
  lightbox.classList.toggle('has-video', it.media_type === 'video');
  if(typeof gsap !== 'undefined'){
    const media = lbInner.querySelector('img,video');
    if(media) gsap.fromTo(media, {scale:.97, opacity:0}, {scale:1, opacity:1, duration:.25, ease:'power2.out'});
  }
  $('lbMoodPopup').classList.remove('show');
  setAmbientFor(it);
  updateLbChrome();
  preloadNeighbors(idx);
  updateBodyLock();
}
function lbNavigate(dir){
  const next = lbIndex + dir;
  if(next < 0 || next >= state.currentItems.length) return;
  lbInner.querySelectorAll('video').forEach(v => v.pause());
  openLightbox(next);
}
function closeLb(){
  lightbox.classList.remove('show', 'has-video', 'sleep');
  if(slideshowActive) stopSlideshow();
  $('lbMoodPopup').classList.remove('show');
  lbAmbient.style.opacity = '0';
  lbInner.querySelectorAll('video').forEach(v => v.pause());
  updateBodyLock();
}
$('lbPrev').onclick = e => { e.stopPropagation(); lbNavigate(-1); };
$('lbNext').onclick = e => { e.stopPropagation(); lbNavigate(1); };
$('lbClose').onclick = closeLb;
lightbox.addEventListener('click', e => {
  if(e.target.closest('.lb-bar') || e.target.closest('.lb-top') ||
     e.target.closest('.lb-arrow') || e.target.closest('.lb-mood-popup') ||
     e.target.closest('video')) return;
  closeLb();
});

// Teilen: Link direkt kopieren
$('lbShare').onclick = async e => {
  e.stopPropagation();
  const it = state.currentItems[lbIndex]; if(!it) return;
  const ok = await copyText(buildShareUrl(it));
  toast(ok ? 'Link kopiert' : 'Kopieren fehlgeschlagen');
};

// Download des aktuellen Items
$('lbDownload').onclick = async e => {
  e.stopPropagation();
  const it = state.currentItems[lbIndex]; if(!it) return;
  const ext = (it.media_url.split('?')[0].match(/\.[a-z0-9]+$/i) || [''])[0];
  try {
    const res = await fetch(it.media_url);
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (it.title || 'media') + ext;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch(err){
    window.open(it.media_url, '_blank');
  }
};

// Mute-Toggle
$('lbMute').onclick = e => {
  e.stopPropagation();
  const v = lbInner.querySelector('video');
  if(!v) return;
  lbIsMuted = !lbIsMuted;
  v.muted = lbIsMuted;
  updateMuteSvg(lbIsMuted);
};

// Mood-Zuweisung im Lightbox
$('lbMoodBtn').onclick = e => {
  e.stopPropagation();
  const popup = $('lbMoodPopup');
  if(popup.classList.contains('show')){ popup.classList.remove('show'); return; }
  const it = state.currentItems[lbIndex]; if(!it) return;
  const moods = state.moods.filter(m => m !== 'All');
  popup.innerHTML = moods.map(m =>
    `<button class="chip ${Array.isArray(it.moods) && it.moods.includes(m) ? 'active' : ''}" data-m="${escapeHtml(m)}">${escapeHtml(m)}</button>`
  ).join('');
  popup.querySelectorAll('.chip').forEach(chip => {
    chip.onclick = async ev => {
      ev.stopPropagation();
      const mood = chip.dataset.m;
      const moods = Array.isArray(it.moods) ? [...it.moods] : [];
      const idx = moods.indexOf(mood);
      if(idx > -1) moods.splice(idx, 1); else moods.push(mood);
      it.moods = moods;
      chip.classList.toggle('active', moods.includes(mood));
      await sb.from(TABLE).update({ moods }).eq('id', it.id);
    };
  });
  popup.classList.add('show');
};

// Touch-Swipe-Navigation
let touchX = 0, touchY = 0;
lightbox.addEventListener('touchstart', e => {
  touchX = e.touches[0].clientX;
  touchY = e.touches[0].clientY;
}, { passive:true });
lightbox.addEventListener('touchend', e => {
  const dx = e.changedTouches[0].clientX - touchX;
  const dy = e.changedTouches[0].clientY - touchY;
  if(Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 40) lbNavigate(dx < 0 ? 1 : -1);
}, { passive:true });

// Tastatur
document.addEventListener('keydown', e => {
  if(lightbox.classList.contains('show')){
    if(e.key === 'ArrowLeft') lbNavigate(-1);
    else if(e.key === 'ArrowRight') lbNavigate(1);
    else if(e.key === 'Escape') closeLb();
    return;
  }
  if(e.key === 'Escape'){
    if(selMode) exitSelMode();
    else closeAllPopovers();
  }
});

// ── Slideshow ───────────────────────────────────────────
async function enterFullscreen(){
  try {
    const el = document.documentElement;
    if(el.requestFullscreen) await el.requestFullscreen();
    else if(el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
  } catch(e){}
}
function exitFullscreen(){
  try {
    if(document.exitFullscreen && document.fullscreenElement) document.exitFullscreen();
    else if(document.webkitExitFullscreen && document.webkitFullscreenElement) document.webkitExitFullscreen();
  } catch(e){}
}
document.addEventListener('fullscreenchange', () => {
  if(!document.fullscreenElement && slideshowActive) stopSlideshow();
});
document.addEventListener('webkitfullscreenchange', () => {
  if(!document.webkitFullscreenElement && slideshowActive) stopSlideshow();
});

function updateSlideshowIcon(playing){
  $('lbSlideshowSvg').innerHTML = playing
    ? '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>'
    : '<polygon points="6 4 20 12 6 20 6 4"/>';
}
function startSlideshow(){
  slideshowActive = true;
  $('lbSlideshow').classList.add('active');
  updateSlideshowIcon(true);
  enterFullscreen();
  sleepTimeout = setTimeout(() => lightbox.classList.add('sleep'), 1200);
  slideshowTimer = setInterval(() => {
    openLightbox((lbIndex + 1) % state.currentItems.length);
  }, SLIDESHOW_INTERVAL);
}
function stopSlideshow(){
  slideshowActive = false;
  clearInterval(slideshowTimer);
  clearTimeout(sleepTimeout);
  slideshowTimer = null;
  $('lbSlideshow').classList.remove('active');
  updateSlideshowIcon(false);
  lightbox.classList.remove('sleep');
  exitFullscreen();
}
$('lbSlideshow').onclick = e => {
  e.stopPropagation();
  slideshowActive ? stopSlideshow() : startSlideshow();
};

// Sleep / Aufwachen während Slideshow
function wakeUp(){
  lightbox.classList.remove('sleep');
  clearTimeout(sleepTimeout);
  if(slideshowActive){
    sleepTimeout = setTimeout(() => {
      if(slideshowActive) lightbox.classList.add('sleep');
    }, 4000);
  }
}
lightbox.addEventListener('click', wakeUp, { capture:true });
lightbox.addEventListener('touchstart', wakeUp, { passive:true, capture:true });
lightbox.addEventListener('mousemove', wakeUp, { passive:true });

// ── Moods-Übersicht ─────────────────────────────────────
function pickMainItem(mood){
  const items = state.items.filter(x => Array.isArray(x.moods) && x.moods.includes(mood));
  return items.length ? items[Math.floor(Math.random() * items.length)] : null;
}
function renderMoodsView(){
  const moods = state.moods.filter(m => m !== 'All');
  const tilesHtml = moods.map(m => {
    const it = pickMainItem(m);
    const count = state.items.filter(x => Array.isArray(x.moods) && x.moods.includes(m)).length;
    const media = it
      ? (it.media_type === 'video'
          ? `<video src="${it.media_url}" muted loop playsinline autoplay preload="metadata"></video>`
          : `<img src="${it.media_url}" loading="lazy" decoding="async" alt="">`)
      : '<div class="mt-empty">Kein Bild</div>';
    return `
      <div class="mood-tile" data-m="${escapeHtml(m)}">
        ${media}
        <div class="mt-overlay"></div>
        <div class="mt-label">
          <span class="mt-name">${escapeHtml(m)}</span>
          <span class="mt-count">${count}</span>
        </div>
      </div>`;
  }).join('');
  const createTile = owner ? `
    <div class="mood-tile mood-tile-create" id="moodCreateTile">
      <div class="mtc-inner">Neue Mood</div>
    </div>` : '';
  moodsGrid.innerHTML = tilesHtml + createTile;
  const createBtn = $('moodCreateTile');
  if(createBtn) createBtn.onclick = openMoodCreate;
  moodsGrid.querySelectorAll('.mood-tile:not(.mood-tile-create)').forEach(tile => {
    tile.onclick = () => {
      activeMoods = new Set([tile.dataset.m]);
      saveFilterState();
      hideMoodsView();
    };
  });
}

function showMoodsView(){
  if(viewAnimating) return;
  viewAnimating = true;
  moodsViewOpen = true;
  clearTimeout(syncTimer);
  closeAllPopovers();
  closeLb();
  selMode = false; selectedIds.clear();
  actionBar.classList.remove('show');
  gridWrap.classList.add('hide-view');
  document.body.classList.add('in-moods');
  setTimeout(() => {
    gridWrap.style.display = 'none';
    gridWrap.classList.remove('hide-view');
    moodsView.classList.add('show');
    renderMoodsView();
    window.scrollTo(0, 0);
    viewAnimating = false;
  }, 500);
  currentView = 'moods'; currentPageSlug = null;
  setPageLabel('Moods'); updatePageNavActive();
}
function hideMoodsView(){
  if(viewAnimating) return;
  viewAnimating = true;
  moodsViewOpen = false;
  clearTimeout(syncTimer);
  moodsView.classList.remove('show');
  document.body.classList.remove('in-moods');
  setTimeout(() => {
    gridWrap.style.display = '';
    renderGrid();
    requestAnimationFrame(() => {
      gridWrap.classList.add('show-view');
      setTimeout(() => {
        gridWrap.classList.remove('show-view');
        viewAnimating = false;
      }, 500);
    });
  }, 500);
  currentView = 'archive'; currentPageSlug = null;
  setPageLabel('Archive'); updatePageNavActive();
}
function forceCloseMoods(){
  moodsViewOpen = false; viewAnimating = false;
  clearTimeout(syncTimer);
  moodsView.classList.remove('show');
  document.body.classList.remove('in-moods');
}

// ── Mood erstellen ──────────────────────────────────────
const moodCreateModal = $('moodCreateModal');
function openMoodCreate(){
  $('mcmInput').value = '';
  $('mcmError').classList.remove('show');
  moodCreateModal.classList.add('show');
  updateBodyLock();
  setTimeout(() => $('mcmInput').focus(), 60);
}
function closeMoodCreate(){
  moodCreateModal.classList.remove('show');
  updateBodyLock();
}
function addMood(raw){
  raw = raw.trim();
  if(!raw) return 'Bitte einen Namen eingeben';
  if(raw.length < 2) return 'Mindestens 2 Zeichen';
  if(state.moods.some(m => m.toLowerCase() === raw.toLowerCase())) return 'Diese Mood existiert bereits';
  state.moods.push(raw);
  saveMoodsList();
  renderFilterChips();
  if(moodsViewOpen) renderMoodsView();
  return null;
}
$('mcmConfirm').onclick = () => {
  const err = addMood($('mcmInput').value);
  if(err){ $('mcmError').textContent = err; $('mcmError').classList.add('show'); return; }
  closeMoodCreate();
  toast('Mood erstellt');
};
$('mcmCancel').onclick = closeMoodCreate;
$('mcmInput').addEventListener('keydown', e => {
  if(e.key === 'Enter') $('mcmConfirm').click();
  else if(e.key === 'Escape') closeMoodCreate();
});
moodCreateModal.addEventListener('click', e => { if(e.target === moodCreateModal) closeMoodCreate(); });

// ── Moods verwalten ─────────────────────────────────────
const moodsMgmtPopup = $('moodsMgmtPopup');
function renderMoodsMgmt(){
  const moods = state.moods.filter(m => m !== 'All');
  $('mmgList').innerHTML = moods.length ? moods.map(m => {
    const count = state.items.filter(x => Array.isArray(x.moods) && x.moods.includes(m)).length;
    return `<div class="mmg-item">
      <span class="mmg-name">${escapeHtml(m)}</span>
      <span class="mmg-count">${count}</span>
      <button class="mmg-del" data-m="${escapeHtml(m)}" aria-label="Löschen">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>`;
  }).join('') : '<div class="mmg-empty">Keine Moods vorhanden</div>';
  $('mmgList').querySelectorAll('.mmg-del').forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      const m = btn.dataset.m;
      showConfirm(`Mood "${m}" löschen? Die Zuordnung wird von allen Items entfernt.`, () => {
        state.moods = state.moods.filter(x => x !== m);
        saveMoodsList();
        for(const it of state.items){
          if(Array.isArray(it.moods)){
            const idx = it.moods.indexOf(m);
            if(idx >= 0){ it.moods.splice(idx, 1); sbUpdate(it); }
          }
        }
        renderMoodsMgmt();
        renderFilterChips();
        if(moodsViewOpen) renderMoodsView();
        renderGrid();
        toast('Mood gelöscht');
      });
    };
  });
}
function openMoodsMgmt(){
  moodsMgmtPopup.classList.add('show');
  renderMoodsMgmt();
  updateBodyLock();
}
function closeMoodsMgmt(){
  moodsMgmtPopup.classList.remove('show');
  updateBodyLock();
}
$('moodsMgmtBtn').onclick = openMoodsMgmt;
$('mmgClose').onclick = closeMoodsMgmt;
moodsMgmtPopup.addEventListener('click', e => { if(e.target === moodsMgmtPopup) closeMoodsMgmt(); });
$('mmgAddBtn').onclick = () => {
  const err = addMood($('mmgInput').value);
  if(err){ toast(err); return; }
  renderMoodsMgmt();
  renderGrid();
  $('mmgInput').value = '';
  toast('Mood erstellt');
};
$('mmgInput').addEventListener('keydown', e => {
  if(e.key === 'Enter') $('mmgAddBtn').click();
  else if(e.key === 'Escape') closeMoodsMgmt();
});

// ── Seiten-Navigation ───────────────────────────────────
const pageNavBtn = $('pageNavBtn');
const pageNavMenu = $('pageNavMenu');

function setPageLabel(name){ $('pageNavLabel').textContent = name; }
function updatePageNavActive(){
  pageNavMenu.querySelectorAll('.pn-item').forEach(el => {
    const isActive =
      (el.dataset.nav === 'archive' && currentView === 'archive') ||
      (el.dataset.nav === 'moods' && currentView === 'moods') ||
      (el.dataset.slug && currentView === 'page' && el.dataset.slug === currentPageSlug);
    el.classList.toggle('active', !!isActive);
  });
}
function renderPageNav(){
  let html = '';
  html += '<button class="pn-item" data-nav="archive">Archive</button>';
  html += '<button class="pn-item" data-nav="moods">Moods</button>';
  state.pages.forEach(p => {
    html += `<button class="pn-item" data-slug="${escapeHtml(p.slug)}">${escapeHtml(p.name)}</button>`;
  });
  html += '<div class="pn-divider admin-only"></div>';
  html += '<button class="pn-item admin-only" id="pnAdd">Neue Seite</button>';
  pageNavMenu.innerHTML = html;
  pageNavMenu.querySelectorAll('[data-nav]').forEach(el => {
    el.onclick = () => { closePageNav(); navigate(el.dataset.nav); };
  });
  pageNavMenu.querySelectorAll('[data-slug]').forEach(el => {
    el.onclick = () => { closePageNav(); navigateToPage(el.dataset.slug); };
  });
  const addBtn = $('pnAdd');
  if(addBtn) addBtn.onclick = () => { closePageNav(); openPageCreate(); };
  updatePageNavActive();
}
async function loadPages(){
  const { data, error } = await sb.from('pages').select('*').order('sort_order').order('created_at');
  if(!error && Array.isArray(data)) state.pages = data;
  renderPageNav();
}
function openPageNav(){ pageNavMenu.classList.add('show'); pageNavBtn.classList.add('open'); }
function closePageNav(){ pageNavMenu.classList.remove('show'); pageNavBtn.classList.remove('open'); }
pageNavBtn.onclick = e => {
  e.stopPropagation();
  if(pageNavMenu.classList.contains('show')) closePageNav();
  else { renderPageNav(); openPageNav(); }
};
document.addEventListener('click', e => { if(!e.target.closest('#pageNav')) closePageNav(); });

function navigate(target){
  if(target === 'archive') goArchive();
  else if(target === 'moods') goMoods();
}
function goArchive(){
  if(currentView === 'moods'){ hideMoodsView(); return; }
  if(currentView === 'page'){
    customPageView.classList.remove('show');
    gridWrap.style.display = '';
    renderGrid();
  }
  currentView = 'archive'; currentPageSlug = null;
  setPageLabel('Archive'); updatePageNavActive();
}
function goMoods(){
  if(currentView === 'moods') return;
  if(currentView === 'page'){
    customPageView.classList.remove('show');
    gridWrap.style.display = '';
  }
  showMoodsView();
}
function navigateToPage(slug){
  const p = state.pages.find(x => x.slug === slug);
  if(!p) return;
  if(currentView === 'moods') forceCloseMoods();
  gridWrap.style.display = 'none';
  moodsView.classList.remove('show');
  customPageView.classList.add('show');
  currentView = 'page'; currentPageSlug = slug;
  setPageLabel(p.name); updatePageNavActive();
  renderCustomPage(p);
  window.scrollTo(0, 0);
}
function renderCustomPage(p){
  customPageInner.innerHTML = `
    <div class="cpv-empty">
      <div class="cpv-empty-title">${escapeHtml(p.name)}</div>
      <div class="cpv-empty-sub">Diese Seite ist noch leer.</div>
      ${owner ? '<button class="btn danger" id="cpvDel">Seite löschen</button>' : ''}
    </div>`;
  const del = $('cpvDel');
  if(del) del.onclick = () => showConfirm(`Seite "${p.name}" löschen?`, () => deletePage(p));
}

$('boardTitle').onclick = () => {
  goArchive();
  activeMoods.clear();
  saveFilterState();
  if(!moodsViewOpen) renderGrid();
};

// ── Seiten erstellen / löschen ──────────────────────────
const pageCreateModal = $('pageCreateModal');
function openPageCreate(){
  $('pcmInput').value = '';
  $('pcmError').classList.remove('show');
  pageCreateModal.classList.add('show');
  updateBodyLock();
  setTimeout(() => $('pcmInput').focus(), 60);
}
function closePageCreate(){
  pageCreateModal.classList.remove('show');
  updateBodyLock();
}
async function createPage(name){
  name = name.trim();
  if(!name){ $('pcmError').textContent = 'Bitte einen Namen eingeben'; $('pcmError').classList.add('show'); return; }
  const slug = slugify(name) + '-' + Math.random().toString(36).slice(2,6);
  const { data, error } = await sb.from('pages')
    .insert({ name, slug, sort_order: state.pages.length })
    .select().single();
  if(error){ $('pcmError').textContent = 'Fehler: ' + error.message; $('pcmError').classList.add('show'); return; }
  state.pages.push(data);
  renderPageNav();
  closePageCreate();
  navigateToPage(data.slug);
  toast('Seite erstellt');
}
async function deletePage(p){
  const { error } = await sb.from('pages').delete().eq('id', p.id);
  if(error){ toast('Fehler: ' + error.message); return; }
  state.pages = state.pages.filter(x => x.id !== p.id);
  renderPageNav();
  goArchive();
  toast('Seite gelöscht');
}
$('pcmConfirm').onclick = () => createPage($('pcmInput').value);
$('pcmCancel').onclick = closePageCreate;
$('pcmInput').addEventListener('keydown', e => {
  if(e.key === 'Enter') createPage($('pcmInput').value);
  else if(e.key === 'Escape') closePageCreate();
});
pageCreateModal.addEventListener('click', e => { if(e.target === pageCreateModal) closePageCreate(); });

// ── Daten laden / Sync ──────────────────────────────────
async function sbUpdate(item){
  if(!item) return;
  await sb.from(TABLE).update({
    title: item.title || '',
    moods: item.moods || [],
    tags: item.tags || [],
    media_url: item.media_url,
    media_type: item.media_type
  }).eq('id', item.id);
}

// Moods von Items in die lokale Liste übernehmen, damit Moods
// von anderen Geräten auch hier auftauchen (Liste ist nur lokal persistiert).
function mergeMoodsFromItems(){
  const known = new Set(state.moods);
  let changed = false;
  for(const it of state.items){
    if(!Array.isArray(it.moods)) continue;
    for(const m of it.moods){
      if(typeof m !== 'string') continue;
      const trimmed = m.trim();
      if(!trimmed || known.has(trimmed)) continue;
      state.moods.push(trimmed);
      known.add(trimmed);
      changed = true;
    }
  }
  if(changed) saveMoodsList();
}

async function loadItems(){
  const { data, error } = await sb.from(TABLE)
    .select('id,title,moods,tags,media_url,media_type')
    .order('created_at', { ascending:false });
  if(error){
    toast('Ladefehler: ' + error.message);
    $('bootMsg').textContent = 'Kein Datenzugriff';
    return;
  }
  state.items = data || [];
  mergeMoodsFromItems();
  renderGrid();
  $('bootMsg')?.remove();
  renderFilterChips();
  if(moodsViewOpen) renderMoodsView();
  tryOpenPendingShare();
}

// Stiller Refetch, damit andere Geräte Uploads / Mood-Änderungen sehen.
// Während Modal/Lightbox offen ist, wird verschoben.
let syncTimer = null;
async function refetchItems(){
  if(isUiBusy()){ scheduleSync(1500); return; }
  const { data, error } = await sb.from(TABLE)
    .select('id,title,moods,tags,media_url,media_type')
    .order('created_at', { ascending:false });
  if(error) return;
  state.items = data || [];
  mergeMoodsFromItems();
  // Kein renderGrid: aktuelle Ansicht bleibt erhalten,
  // neue Items erscheinen beim nächsten Render.
  renderFilterChips();
  if(moodsViewOpen) renderMoodsView();
}
function scheduleSync(delay){
  clearTimeout(syncTimer);
  syncTimer = setTimeout(refetchItems, delay ?? 400);
}
function subscribeRealtime(){
  try{
    sb.channel('moodboard_items_changes')
      .on('postgres_changes', { event:'*', schema:'public', table:TABLE }, () => scheduleSync(300))
      .subscribe();
  }catch(e){}
}
document.addEventListener('visibilitychange', () => {
  if(document.visibilityState === 'visible') scheduleSync(0);
});
window.addEventListener('focus', () => scheduleSync(0));
window.addEventListener('online', () => scheduleSync(0));

// ── Spotify ─────────────────────────────────────────────
$('spotifyBtn').onclick = e => {
  e.stopPropagation();
  const open = $('spotifyPopup').classList.toggle('show');
  $('spotifyBtn').classList.toggle('active', open);
};
document.addEventListener('click', e => {
  if(!e.target.closest('#spotifyPopup') && !e.target.closest('#spotifyBtn')){
    $('spotifyPopup').classList.remove('show');
    $('spotifyBtn').classList.remove('active');
  }
});

// ── Start ───────────────────────────────────────────────
(async () => {
  await initAuth();
  renderFilterChips();
  renderPageNav();
  loadPages();
  applyGridCols(gridCols);
  updateSortUI();
  loadItems();
  subscribeRealtime();
})();
