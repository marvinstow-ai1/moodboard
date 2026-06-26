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

let editId=null, lbIndex=0, selMode=null, lbIsMuted=false;
let selectedIds=new Set();
let _observer = null;
let sortNewest = false;
let _isInitialLoad = true;
let sleepTimeout = null;
const SLIDESHOW_INTERVAL = 5000;
let slideshowActive = false;
let slideshowTimer  = null;

const $ = id => document.getElementById(id);

// ── AUTH ─────────────────────────────────────────────────
function updateAdminUI() {
  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = owner ? '' : 'none';
  });
  const btn = $('loginBtn');
  if (btn) btn.classList.toggle('is-owner', owner);
}

function isOwnerSession(session) {
  return !!(session && session.user.app_metadata?.role === 'owner');
}

async function initAuth() {
  const { data: { session } } = await sb.auth.getSession();
  owner = isOwnerSession(session);
  updateAdminUI();
  sb.auth.onAuthStateChange((_e, session) => {
    owner = isOwnerSession(session);
    updateAdminUI();
  });
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
  if (owner) {
    await sb.auth.signOut();
    toast('Abgemeldet');
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
const ambientCache = new Map();
const AMBIENT_DEFAULT_1 = 'rgba(80,90,140,.5)';
const AMBIENT_DEFAULT_2 = 'rgba(140,70,120,.45)';
function getDominantColor(url){
  if(ambientCache.has(url)) return Promise.resolve(ambientCache.get(url));
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const W=16, H=16;
        const c = document.createElement('canvas');
        c.width=W; c.height=H;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, W, H);
        const d = ctx.getImageData(0,0,W,H).data;
        let r=0,g=0,b=0,n=0;
        for(let i=0; i<d.length; i+=4){
          if(d[i+3] < 128) continue;
          // skip near-black/near-white pixels to avoid muddy averages
          const lum = (d[i]+d[i+1]+d[i+2])/3;
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
function applyAmbient(c1, c2){
  lbAmbient.style.setProperty('--ambient-1', c1);
  lbAmbient.style.setProperty('--ambient-2', c2);
}
async function setAmbientFor(it){
  // fade out before swap so transitions feel intentional
  lbAmbient.style.opacity = '0';
  let c1 = AMBIENT_DEFAULT_1, c2 = AMBIENT_DEFAULT_2;
  if(it.media_type !== 'video'){
    const color = await getDominantColor(it.media_url);
    if(color){
      const [r,g,b] = color;
      c1 = `rgba(${r},${g},${b},.6)`;
      c2 = `rgba(${Math.min(255,r+35)},${Math.max(0,g-10)},${Math.min(255,b+50)},.5)`;
    }
  }
  // bail if user navigated away
  if(!lightbox.classList.contains('show') || S().currentItems[lbIndex] !== it) return;
  applyAmbient(c1, c2);
  requestAnimationFrame(() => { lbAmbient.style.opacity = ''; });
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
  if(f) f.onclick = () => { closeMenu(); filterPopup.classList.toggle('show'); };
  if(s) s.onclick = () => { closeMenu(); doShuffle(); };
}
bindView(''); bindView('Sheet');

// ── Shared Logic (same as before) ─────────────────────────
function toast(t){
  toastEl.textContent=t;
  if(typeof gsap !== 'undefined'){
    gsap.killTweensOf(toastEl);
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
function prog(p){ progressBar.style.width=p+'%'; if(p>=100) setTimeout(()=>progressBar.style.width='0',600); }
function compress(file, maxPx=MAX_PX, q=0.88){
  return new Promise(res=>{
    if(isVid(file.name) || isGif(file.name)){ res(file); return; }
    const img=new Image(), url=URL.createObjectURL(file);
    img.onload=()=>{
      URL.revokeObjectURL(url);
      let w=img.width, h=img.height;
      if(w<=maxPx && h<=maxPx){ res(file); return; }
      const r=Math.min(maxPx/w, maxPx/h); w=Math.round(w*r); h=Math.round(h*r);
      const c=document.createElement('canvas'); c.width=w; c.height=h;
      c.getContext('2d').drawImage(img,0,0,w,h);
      const outType='image/webp', outName=file.name.replace(/\.[^.]+$/,'.webp');
      c.toBlob(b=>res(new File([b],outName,{type:outType})),outType,q);
    };
    img.src=url;
  });
}
let _lockedScrollY = 0;
function updateBodyLock(){
  const lock = (typeof lightbox!=='undefined' && lightbox.classList.contains('show'))
    || (typeof moodCreateModal!=='undefined' && moodCreateModal && moodCreateModal.classList.contains('show'))
    || bottomSheet.classList.contains('show')
    || (typeof moodsMgmtPopup!=='undefined' && moodsMgmtPopup && moodsMgmtPopup.classList.contains('show'))
    || (typeof confirmPopup!=='undefined' && confirmPopup && confirmPopup.classList.contains('show'));
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
}
function isAnyOverlayOpen(){
  return dropdown.classList.contains('show') ||
         bottomSheet.classList.contains('show') ||
         filterPopup.classList.contains('show') ||
         editorWrap.classList.contains('show') ||
         !!document.getElementById('spotifyPopup')?.classList.contains('show');
}
$('menuBtn').onclick = e => { e.stopPropagation(); openMenu(); };
sheetOverlay.onclick = closeMenu;
document.addEventListener('click', e => { if(!e.target.closest('#dropdown') && !e.target.closest('#menuBtn')) dropdown.classList.remove('show'); });

$('boardTitle').onclick = () => {
  goArchive();
  activeMoods.clear();
  saveFilterState();
  if(!moodsViewOpen) renderGrid();
};

function renderMoodChips(){
  document.querySelectorAll('[data-mood-chip]').forEach(chip => {
    const m = chip.dataset.moodChip;
    chip.classList.toggle('active', activeMoods.has(m));
    chip.onclick = () => {
      if(activeMoods.has(m)) activeMoods.delete(m); else activeMoods.add(m);
      saveFilterState(); renderGrid(); renderMoodChips();
    };
  });
}
function renderMoodChipsSheet(){ renderMoodChips(); }

// ── GRID RENDERING ─────────────────────────────────────
// Zell-Cache: Wir behalten die einmal erstellten DOM-Knoten (inkl. der
// bereits geladenen <img>/<video>) und sortieren sie beim Shuffle/Filter
// nur um, statt sie via innerHTML komplett neu zu bauen. Dadurch lädt der
// Browser bereits geladene Bilder nicht erneut und es flackert nicht.
const _cellCache = new Map();

function createCell(it){
  const cell = document.createElement('div');
  cell.className = 'cell';
  cell.dataset.id = it.id;

  const chk = document.createElement('input');
  chk.className = 'selcheck';
  chk.type = 'checkbox';
  chk.dataset.id = it.id;
  cell.appendChild(chk);

  let media;
  if(it.media_type === 'video'){
    media = document.createElement('video');
    media.src = it.media_url;
    media.muted = true; media.loop = true; media.playsInline = true;
    media.setAttribute('playsinline', '');
    media.preload = 'metadata';
  } else {
    media = document.createElement('img');
    media.src = it.media_url;
    media.loading = 'lazy';
    media.decoding = 'async';
    media.alt = '';
  }
  cell.appendChild(media);

  // Listener einmalig binden (Knoten wird wiederverwendet, nicht neu erstellt).
  // selMode/selectedIds sind modul-scoped → die Closures lesen immer den
  // aktuellen Stand zur Klickzeit.
  cell.onclick = e => {
    if(selMode){
      const id = cell.dataset.id;
      if(e.target !== chk) chk.checked = !chk.checked;
      chk.checked ? selectedIds.add(id) : selectedIds.delete(id);
      cell.classList.toggle('sel-highlight', chk.checked);
      updateActionBarCount();
      return;
    }
    if(isAnyOverlayOpen()){ closeAllOverlays(); e.stopPropagation(); return; }
    const idx = S().currentItems.findIndex(x => x.id === cell.dataset.id);
    openLightbox(idx);
  };
  cell.oncontextmenu = e => { e.preventDefault(); if(!selMode) openEditor(cell.dataset.id); };
  cell.addEventListener('dblclick', e => {
    if(selMode) return;
    e.preventDefault();
    e.stopPropagation();
  });
  // Mobile: doppeltes Tippen (touchend-Heuristik)
  let lastTap = 0;
  cell.addEventListener('touchend', e => {
    const now = Date.now();
    if(now - lastTap < 300){ e.preventDefault(); lastTap = 0; }
    else lastTap = now;
  }, { passive: false });

  return cell;
}

function renderGrid(){
  const s = S();
  // Dedup by id — guards against race conditions during concurrent uploads
  const seen = new Set();
  s.items = s.items.filter(i => { if(seen.has(i.id)) return false; seen.add(i.id); return true; });
  // Drop any active mood filters that no longer exist in the moods list
  // (e.g. the mood was renamed/deleted on another device).
  const validMoods = new Set(s.moods);
  for(const m of [...activeMoods]) if(!validMoods.has(m)) activeMoods.delete(m);
  // Filter: if activeMoods has entries, show items matching ANY selected mood (OR)
  let arr = activeMoods.size > 0
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
  s.currentItems = arr;
  if(_observer){ _observer.disconnect(); _observer=null; }

  // Grid aus wiederverwendeten Knoten zusammenbauen: bereits geladene
  // Bilder/Videos werden beim Shuffle nur umsortiert, nicht neu geladen.
  // Cache-Knoten von Items, die es nicht mehr gibt (gelöscht), aufräumen.
  const validIds = new Set(s.items.map(i => i.id));
  for(const [id, cell] of _cellCache){
    if(!validIds.has(id)){ cell.remove(); _cellCache.delete(id); }
  }
  // In neuer Reihenfolge einsammeln (vorhandene Knoten werden verschoben,
  // herausgefilterte bleiben im Cache, nur vom DOM gelöst).
  const frag = document.createDocumentFragment();
  for(const it of arr){
    let cell = _cellCache.get(it.id);
    if(!cell){ cell = createCell(it); _cellCache.set(it.id, cell); }
    frag.appendChild(cell);
  }
  gridEl.replaceChildren(frag);

  // GSAP stagger on initial load
  if(_isInitialLoad && typeof gsap !== 'undefined' && arr.length > 0){
    gsap.from(gridEl.querySelectorAll('.cell'), {
      opacity: 0, scale: 0.9, duration: 0.4,
      stagger: { amount: Math.min(0.6, arr.length * 0.04), from: 'start' },
      ease: 'power2.out', clearProps: 'transform,opacity'
    });
    _isInitialLoad = false;
  }

  _observer = new IntersectionObserver(entries => entries.forEach(e => {
    const v = e.target.querySelector('video'); if(!v) return;
    if(e.isIntersecting){ v.muted=true; v.play().catch(()=>{}); }
    else { v.pause(); v.currentTime=0; }
  }), { threshold:0.25, rootMargin:'100px' });

  applyGridCols(gridCols);
  // Listener sind bereits in createCell gebunden – hier nur Observer
  // anhängen und die Selektions-Visuals pro Render aktualisieren.
  gridEl.querySelectorAll('.cell').forEach(c => {
    _observer.observe(c);
    const chk = c.querySelector('.selcheck');
    if(selMode){
      chk.classList.add('visible');
      const isSel = selectedIds.has(c.dataset.id);
      chk.checked = isSel;
      c.classList.toggle('sel-highlight', isSel);
    } else {
      chk.classList.remove('visible');
      chk.checked = false;
      c.classList.remove('sel-highlight');
    }
  });
}



function updateActionBarCount(){
    actionBarCount.textContent = selectedIds.size + ' ausgewählt';
  }

// ── SELECTION MODE ──────────────────────────────────────
function enterSelMode(){
  selMode='delete'; selectedIds.clear(); closeMenu();
  actionBarTitle.textContent = 'Bilder löschen';
  actionBarMoods.innerHTML='';
  actionBar.classList.add('show'); renderGrid(); updateActionBarCount();
}
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
  lbIndex = idx;
  const it = S().currentItems[idx];
  lbInner.querySelectorAll('img,video').forEach(e=>e.remove());
  if(it.media_type==='video'){
    const v = document.createElement('video');
    v.src=it.media_url; v.controls=false; v.autoplay=true; v.muted=true; v.loop=true; v.playsInline=true;
    v.addEventListener('click', () => {
      lbIsMuted = !lbIsMuted;
      v.muted = lbIsMuted;
      updateMuteSvg(lbIsMuted);
    });
    lbInner.appendChild(v);
    lbIsMuted=true; updateMuteSvg(true);
  } else {
    const img = document.createElement('img');
    img.src=it.media_url; img.style.pointerEvents='none';
    lbInner.appendChild(img);
  }
  lightbox.classList.add('show');
  if(typeof gsap !== 'undefined'){
    const media = lbInner.querySelector('img,video');
    // Ganze Lightbox nur beim ersten Öffnen einblenden, nicht beim Blättern.
    if(isOpening) gsap.fromTo(lightbox, {opacity:0},{opacity:1,duration:0.22,ease:'power2.out'});
    else gsap.set(lightbox, {opacity:1});
    if(media) gsap.fromTo(media,{scale:0.93,opacity:0},{scale:1,opacity:1,duration:0.3,ease:'power2.out'});
  }
  lightbox.classList.toggle('has-video', it.media_type === 'video');
  setAmbientFor(it);
  updateBodyLock();
}
function lbNavigate(dir){
  const next=lbIndex+dir;
  if(next<0 || next>=S().currentItems.length) return;
  lbInner.querySelectorAll('video').forEach(v=>v.pause());
  openLightbox(next);
}
lightbox.onclick = e => {
  if(!e.target.closest('video')) closeLb();
};
function closeLb(){
  lightbox.classList.remove('show');
  lightbox.classList.remove('has-video');
  lightbox.classList.remove('sleep');
  updateBodyLock();
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
}, {passive:true});


document.addEventListener('keydown', e => {
  if(lightbox.classList.contains('show')){
    if(e.key==='ArrowLeft') lbNavigate(-1);
    else if(e.key==='ArrowRight') lbNavigate(1);
    else if(e.key==='Escape') closeLb();
    return;
  }
  if(e.key==='Escape'){ if(selMode) exitSelMode(); else closeMenu(); }
});

function doShuffle() {
  sortNewest = false;
  // Shuffle ist die Archiv-Ansicht: aus "Zuletzt hinzugefügt" zurückwechseln
  if(currentView === 'recent'){
    currentView = 'archive'; currentPageSlug = null;
    setPageLabel('Archive'); updatePageNavActive();
  }
  renderGrid();
  toast('Neu gemischt');
}
$('shuffleBtn').onclick = () => { $('shuffleBtn').blur(); doShuffle(); };
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
    const cf = await compress(f);
    const ext = cf.name.split('.').pop().toLowerCase();
    const path = `${Date.now().toString(36)}${Math.random().toString(36).slice(2,6)}.${ext}`;
    const {error:e1} = await sb.storage.from(BUCKET).upload(path, cf, {upsert:false, contentType:cf.type});
    if(e1){ toast('Upload-Fehler: '+e1.message); return null; }
    const {data:pub} = sb.storage.from(BUCKET).getPublicUrl(path);
    const mediaType = isVid(f.name) ? 'video' : isGif(f.name) ? 'gif' : 'image';
    const suggestedMoods = mediaType === 'image' ? await autoSuggestMoods(pub.publicUrl) : [];
    const item = { title:f.name.replace(/\.[^.]+$/,''), moods:suggestedMoods, tags:[], media_url:pub.publicUrl, media_type:mediaType};
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

async function loadItems(){
  const {data,error} = await sb.from(S().table)
    .select('id,title,moods,tags,media_url,media_type')
    .order('created_at',{ascending:false});
  if(error){ toast('Ladefehler: '+error.message); gridEl.innerHTML='<div style="padding:24px;color:#fff">Kein Datenzugriff</div>'; return; }
  S().items=data||[];
  mergeMoodsFromItems();
  renderGrid(); $('bootMsg')?.remove();
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
    || (typeof confirmPopup!=='undefined' && confirmPopup && confirmPopup.classList.contains('show'));
}
async function refetchItems(){
  if(isUiBusy()){ scheduleSync(1500); return; }
  const {data,error} = await sb.from(S().table)
    .select('id,title,moods,tags,media_url,media_type')
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
      ? (it.media_type === 'video'
          ? `<video src="${it.media_url}" muted loop playsinline autoplay preload="metadata"></video>`
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
  currentView = 'moods'; currentPageSlug = null;
  setPageLabel('Moods'); updatePageNavActive();
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
  currentView = target; currentPageSlug = null;
  setPageLabel(target === 'recent' ? 'Zuletzt hinzugefügt' : 'Archive');
  updatePageNavActive();
}
boardTitle.classList.add('active');

// ── PAGE NAVIGATION (Dropdown + dynamische Unterseiten) ───
let pages = [];
let currentView = 'archive';   // 'archive' | 'recent' | 'moods' | 'page'
let currentPageSlug = null;

const pageNavBtn    = $('pageNavBtn');
const pageNavLabel  = $('pageNavLabel');
const pageNavMenu   = $('pageNavMenu');
const customPageView  = $('customPageView');
const customPageInner = $('customPageInner');

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function slugify(s){
  return String(s).toLowerCase().trim()
    .replace(/[äöü]/g, m => ({'ä':'ae','ö':'oe','ü':'ue'}[m]))
    .replace(/ß/g,'ss')
    .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'') || 'seite';
}

function setPageLabel(name){ if(pageNavLabel) pageNavLabel.textContent = name; }

function updatePageNavActive(){
  pageNavMenu.querySelectorAll('.pn-item').forEach(el => {
    const isActive =
      (el.dataset.nav === 'archive' && currentView === 'archive') ||
      (el.dataset.nav === 'recent'  && currentView === 'recent')  ||
      (el.dataset.nav === 'moods'   && currentView === 'moods')   ||
      (el.dataset.slug && currentView === 'page' && el.dataset.slug === currentPageSlug);
    el.classList.toggle('active', !!isActive);
  });
}

function renderPageNav(){
  let html = '';
  html += `<button class="pn-item" data-nav="archive">Archive</button>`;
  html += `<button class="pn-item" data-nav="recent">Zuletzt hinzugefügt</button>`;
  html += `<button class="pn-item" data-nav="moods">Moods</button>`;
  pages.forEach(p => {
    html += `<button class="pn-item" data-slug="${escapeHtml(p.slug)}">${escapeHtml(p.name)}</button>`;
  });
  html += `<div class="pn-divider admin-only"></div>`;
  html += `<button class="pn-item pn-add admin-only" id="pnAdd">+ Neue Seite</button>`;
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
  updateAdminUI();
}

async function loadPages(){
  const { data, error } = await sb.from('pages').select('*').order('sort_order').order('created_at');
  if(!error && Array.isArray(data)) pages = data;
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

// ── Navigation zwischen Views ─────────────────────────────
function forceCloseMoods(){
  moodsViewOpen = false; _moodsAnimating = false;
  clearTimeout(_syncTimer);
  moodsView.classList.remove('show');
  document.getElementById('bottombar').classList.remove('moods-active');
  document.getElementById('moodsMgmtBtn').classList.remove('show');
}

function navigate(target){
  if(target === 'archive') goArchive();
  else if(target === 'recent') goRecent();
  else if(target === 'moods') goMoods();
}

// Gemeinsame Logik für die beiden Grid-Ansichten:
// 'archive' = zufällige Anordnung, 'recent' = zuletzt hinzugefügt zuerst
function showGridView(view){
  sortNewest = (view === 'recent');
  const label = view === 'recent' ? 'Zuletzt hinzugefügt' : 'Archive';
  if(currentView === 'moods'){
    hideMoodsView(view);       // animiert zurück, setzt State selbst
    return;
  }
  if(currentView === 'page'){
    customPageView.classList.remove('show');
    gridWrap.style.display = '';
  }
  currentView = view; currentPageSlug = null;
  setPageLabel(label); updatePageNavActive();
  renderGrid();
}

function goArchive(){ showGridView('archive'); }
function goRecent(){ showGridView('recent'); }

function goMoods(){
  if(currentView === 'moods') return;
  if(currentView === 'page'){
    customPageView.classList.remove('show');
    gridWrap.style.display = '';
  }
  showMoodsView();             // setzt State + Label selbst
}

function navigateToPage(slug){
  const p = pages.find(x => x.slug === slug);
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
      ${owner ? `<button class="cpv-del-btn" id="cpvDel">Seite löschen</button>` : ''}
    </div>`;
  const del = $('cpvDel');
  if(del) del.onclick = () => deletePage(p);
}

// ── Seite erstellen / löschen ─────────────────────────────
const pageCreateModal = $('pageCreateModal');
const pcmInput   = $('pcmInput');
const pcmError   = $('pcmError');

function openPageCreate(){
  pcmInput.value = '';
  pcmError.classList.remove('show');
  pageCreateModal.classList.add('show');
  setTimeout(() => pcmInput.focus(), 60);
}
function closePageCreate(){ pageCreateModal.classList.remove('show'); }

async function createPage(name){
  name = name.trim();
  if(!name){ pcmError.textContent = 'Bitte einen Namen eingeben'; pcmError.classList.add('show'); return; }
  const slug = slugify(name) + '-' + Math.random().toString(36).slice(2,6);
  const { data, error } = await sb.from('pages')
    .insert({ name, slug, sort_order: pages.length })
    .select().single();
  if(error){ pcmError.textContent = 'Fehler: ' + error.message; pcmError.classList.add('show'); return; }
  pages.push(data);
  renderPageNav();
  closePageCreate();
  navigateToPage(data.slug);
  toast('Seite erstellt');
}

async function deletePage(p){
  const { error } = await sb.from('pages').delete().eq('id', p.id);
  if(error){ toast('Fehler: ' + error.message); return; }
  pages = pages.filter(x => x.id !== p.id);
  renderPageNav();
  goArchive();
  toast('Seite gelöscht');
}

$('pcmConfirm').onclick = () => createPage(pcmInput.value);
$('pcmCancel').onclick = closePageCreate;
pcmInput.addEventListener('keydown', e => {
  if(e.key === 'Enter') createPage(pcmInput.value);
  else if(e.key === 'Escape') closePageCreate();
});
pageCreateModal.addEventListener('click', e => { if(e.target === pageCreateModal) closePageCreate(); });

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

// ── App starten ───────────────────────────────────────────
(async () => {
  await initAuth();
  renderMoodChips();
  renderPageNav();
  loadPages();
  applyGridCols(gridCols);
  loadItems();
  subscribeRealtime();
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
filterBtn.onclick = e => {
  e.stopPropagation();
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

