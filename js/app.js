// MIGRATION: ALTER TABLE moodboard_items ADD COLUMN IF NOT EXISTS favorite BOOLEAN DEFAULT FALSE;
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://uvfuxnwinuakbqanaxtp.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2ZnV4bndpbnVha2JxYW5heHRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxNzg3MDIsImV4cCI6MjA5NTc1NDcwMn0.quSvaycB3Yk2JXCnQz7AQmHpyATtx6u0U8aGQXD73fo';
const BUCKET = 'moodboard';
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

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
let favFilterActive = false;
let sortNewest = localStorage.getItem('sort_newest') === 'true';
let _isInitialLoad = true;
let sleepTimeout = null;
const SLIDESHOW_INTERVAL = 5000;
let slideshowActive = false;
let slideshowTimer  = null;

const $ = id => document.getElementById(id);

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
function openSharePopup(){
  const it = S().currentItems[lbIndex]; if(!it) return;
  $('sharePopupUrl').value = buildShareUrl(it);
  $('sharePopup').classList.add('show');
  setTimeout(() => { try { $('sharePopupUrl').select(); } catch(e){} }, 80);
}
function closeSharePopup(){ $('sharePopup').classList.remove('show'); }
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
      media_type: isVideo ? 'video' : 'image',
      favorite: false
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
  if(s) s.onclick = () => { closeMenu(); renderGrid(); toast('Neu gemischt'); };
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
  if(typeof moodsViewOpen !== 'undefined' && moodsViewOpen) hideMoodsView();
  activeMoods.clear();
  favFilterActive = false;
  $('favBtn').classList.remove('fav-active');
  saveFilterState();
  renderGrid();
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

function renderGrid(){
  const s = S();
  // Drop any active mood filters that no longer exist in the moods list
  // (e.g. the mood was renamed/deleted on another device).
  const validMoods = new Set(s.moods);
  for(const m of [...activeMoods]) if(!validMoods.has(m)) activeMoods.delete(m);
  // Filter: if activeMoods has entries, show items matching ANY selected mood (OR)
  let arr = activeMoods.size > 0
    ? s.items.filter(i => (Array.isArray(i.moods) && i.moods.some(m => activeMoods.has(m))))
    : s.items;
  // Favoriten-Filter
  if (favFilterActive) arr = arr.filter(i => i.favorite);
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
    arr = [...arr].sort(() => Math.random()-.5);
  }
  s.currentItems = arr;
  if(_observer){ _observer.disconnect(); _observer=null; }
  gridEl.innerHTML = arr.map(it => `
    <div class="cell" data-id="${it.id}">
      <input class="selcheck" type="checkbox" data-id="${it.id}">
      <div class="cell-heart ${it.favorite ? 'visible' : ''}">&#9829;</div>
      <div class="heart-flash">&#9829;</div>
      ${it.media_type==='video'
        ? `<video src="${it.media_url}" muted loop playsinline preload="none"></video>`
        : `<img src="${it.media_url}" loading="lazy" decoding="async" alt="">`}
    </div>`).join('');

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
  gridEl.querySelectorAll('.cell').forEach(c => {
    _observer.observe(c);
    const chk = c.querySelector('.selcheck');
    c.onclick = e => {
      if(selMode){
        const id = c.dataset.id;
        if(e.target !== chk) chk.checked = !chk.checked;
        chk.checked ? selectedIds.add(id) : selectedIds.delete(id);
        c.classList.toggle('sel-highlight', chk.checked);
        updateActionBarCount();
        return;
      }
      if(isAnyOverlayOpen()){ closeAllOverlays(); e.stopPropagation(); return; }
      const idx = S().currentItems.findIndex(x => x.id===c.dataset.id); openLightbox(idx);
    };
    c.oncontextmenu = e => { e.preventDefault(); if(!selMode) openEditor(c.dataset.id); };
    if(selMode){ chk.classList.add('visible'); if(selectedIds.has(c.dataset.id)){ chk.checked=true; c.classList.add('sel-highlight'); } }
    // Doppelklick-Favorit
    let lastTap = 0;
    c.addEventListener('dblclick', e => {
      if (selMode) return;
      e.preventDefault();
      e.stopPropagation();
      toggleFavorite(c.dataset.id, c);
    });
    // Mobile: doppeltes Tippen (touchend-Heuristik)
    c.addEventListener('touchend', e => {
      const now = Date.now();
      if (now - lastTap < 300) {
        e.preventDefault();
        toggleFavorite(c.dataset.id, c);
        lastTap = 0;
      } else {
        lastTap = now;
      }
    }, { passive: false });
  });
}

async function toggleFavorite(id, cellEl) {
  const item = S().items.find(x => x.id === id);
  if (!item) return;

  const newVal = !item.favorite;
  item.favorite = newVal;           // optimistisch updaten (kein Flicker)

  // Herz-Icon auf der Kachel
  const heartEl = cellEl.querySelector('.cell-heart');
  if (heartEl) {
    heartEl.textContent = '♥';
    heartEl.classList.toggle('visible', newVal);
    heartEl.classList.remove('pop');
    void heartEl.offsetWidth;       // reflow für Animation-Restart
    if (newVal) heartEl.classList.add('pop');
  }

  // Großes Flash-Herz (nur beim Favorisieren, nicht beim Entfernen)
  if (newVal) {
    const flash = cellEl.querySelector('.heart-flash');
    if (flash) {
      flash.classList.remove('play');
      void flash.offsetWidth;
      flash.classList.add('play');
      flash.addEventListener('animationend', () => flash.classList.remove('play'), { once: true });
    }
    toast('Zu Favoriten hinzugefügt ♥');
  } else {
    toast('Aus Favoriten entfernt');
  }

  // Falls Favoriten-Filter aktiv ist und Item un-favorisiert wurde: Grid neu rendern
  if (favFilterActive && !newVal) {
    setTimeout(() => renderGrid(), 400);   // kurze Verzögerung damit Animation fertig ist
  }

  // Supabase persistieren (fire & forget mit Fehler-Feedback)
  const { error } = await sb
    .from(S().table)
    .update({ favorite: newVal })
    .eq('id', id);

  if (error) {
    item.favorite = !newVal;          // Rollback
    const heartEl2 = cellEl.querySelector('.cell-heart');
    if (heartEl2) heartEl2.classList.toggle('visible', !newVal);
    toast('Fehler beim Speichern');
  }
}

function updateActionBarCount(){
    actionBarCount.textContent = selectedIds.size + ' ausgewählt';
    $('abFavAll').style.display = selectedIds.size > 0 ? '' : 'none';
  }

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



// ── PILL + BUTTONS VERDRAHTEN ──────────────────────────
let lbPillOpen = false;

function closeLbPill() {
  lbPillOpen = false;
  $('lbPill').classList.remove('open');
  $('lbPillToggle').classList.remove('open');
  $('lbMoodPopup').classList.remove('show');
  closeSharePopup();
}

$('lbPillToggle').onclick = e => {
  e.stopPropagation();
  lbPillOpen = !lbPillOpen;
  $('lbPill').classList.toggle('open', lbPillOpen);
  $('lbPillToggle').classList.toggle('open', lbPillOpen);
  if (!lbPillOpen) {
    $('lbMoodPopup').classList.remove('show');
    closeSharePopup();
  }
};

$('lbBarHeart').onclick = e => {
  e.stopPropagation();
  const it = S().currentItems[lbIndex]; if (!it) return;
  const cellEl = gridEl.querySelector(`.cell[data-id="${it.id}"]`);
  toggleFavorite(it.id, cellEl || document.createElement('div'));
  $('lbBarHeart').classList.toggle('is-fav', it.favorite);
};

$('lbPillShare').onclick = e => {
  e.stopPropagation();
  const moodPopup = $('lbMoodPopup');
  moodPopup.classList.remove('show');
  openSharePopup();
};

// Mute: identische Toggle-Logik
$('lbPillMute').onclick = e => {
  e.stopPropagation();
  const v = lbInner.querySelector('video');
  if (!v) return;
  lbIsMuted = !lbIsMuted;
  v.muted = lbIsMuted;
  updateMuteSvg(lbIsMuted);
};

// Mood-Popup aus Pill:
$('lbPillMood').onclick = e => {
  e.stopPropagation();
  const popup = $('lbMoodPopup');
  if (popup.classList.contains('show')) {
    popup.classList.remove('show'); return;
  }
  closeSharePopup();
  const it = S().currentItems[lbIndex]; if (!it) return;
  const moods = S().moods.filter(m => m !== 'All');
  popup.innerHTML = moods.map(m => `
    <button class="lb-mood-chip ${Array.isArray(it.moods) && it.moods.includes(m) ? 'active' : ''}" data-mood="${m}">${m}</button>
  `).join('');
  popup.querySelectorAll('.lb-mood-chip').forEach(chip => {
    chip.onclick = async ev => {
      ev.stopPropagation();
      const mood = chip.dataset.mood;
      const moods = Array.isArray(it.moods) ? [...it.moods] : [];
      const idx = moods.indexOf(mood);
      if (idx > -1) moods.splice(idx, 1);
      else moods.push(mood);
      it.moods = moods;
      chip.classList.toggle('active', moods.includes(mood));
      await sb.from(S().table).update({ moods }).eq('id', it.id);
    };
  });
  popup.classList.add('show');
};

// Klick auf Stage schliesst Pill + Popups:
$('lbPrev').addEventListener('click', e => e.stopPropagation());
$('lbNext').addEventListener('click', e => e.stopPropagation());
lightbox.addEventListener('click', e => {
  if (!e.target.closest('.lb-bottombar') &&
      !e.target.closest('.lb-topbar') &&
      !e.target.closest('.lb-mood-popup') &&
      !e.target.closest('.share-popup')) {
    closeLbPill();
  }
});

$('lbCloseBtn').onclick = closeLb;

// ── Lightbox Navigation ─────────────────────────────────
function openLightbox(idx){
  if(idx<0 || idx>=S().currentItems.length) return;
  lbIndex = idx;
  const it = S().currentItems[idx];
  lbInner.querySelectorAll('img,video').forEach(e=>e.remove());
  if(it.media_type==='video'){
    const v = document.createElement('video');
    v.src=it.media_url; v.controls=true; v.autoplay=true; v.muted=false; v.loop=true;
    lbInner.appendChild(v);
    lbIsMuted=false; updateMuteSvg(false);
  } else {
    const img = document.createElement('img');
    img.src=it.media_url; img.style.pointerEvents='none';
    lbInner.appendChild(img);
  }
  lightbox.classList.add('show');
  if(typeof gsap !== 'undefined'){
    const media = lbInner.querySelector('img,video');
    gsap.fromTo(lightbox, {opacity:0},{opacity:1,duration:0.22,ease:'power2.out'});
    if(media) gsap.fromTo(media,{scale:0.93,opacity:0},{scale:1,opacity:1,duration:0.3,ease:'power2.out'});
  }
  $('lbBarHeart').classList.toggle('is-fav', !!it.favorite);
  lightbox.classList.toggle('has-video', it.media_type === 'video');
  closeLbPill();
  setAmbientFor(it);
  updateLbArrows();
  updateBodyLock();
}
function updateLbArrows(){
  $('lbPrev').style.opacity = lbIndex>0 ? '1' : '0.2';
  $('lbNext').style.opacity = lbIndex<S().currentItems.length-1 ? '1' : '0.2';
}
function lbNavigate(dir){
  const next=lbIndex+dir;
  if(next<0 || next>=S().currentItems.length) return;
  closeLbPill();
  lbInner.querySelectorAll('video').forEach(v=>v.pause());
  openLightbox(next);
}
$('lbPrev').onclick = e => { e.stopPropagation(); lbNavigate(-1); };
$('lbNext').onclick = e => { e.stopPropagation(); lbNavigate(1); };
lightbox.onclick = e => {
  if(!e.target.closest('.lb-arrow') && !e.target.closest('video')) closeLb();
};
function closeLb(){
  lightbox.classList.remove('show');
  lightbox.classList.remove('has-video');
  if (slideshowActive) stopSlideshow();
  lightbox.classList.remove('sleep');
  closeLbPill();
  closeSharePopup();
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

// ── Fullscreen API ───────────────────────────────────────
async function enterFullscreen() {
  try {
    const el = document.documentElement;
    if (el.requestFullscreen) await el.requestFullscreen();
    else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
  } catch(e) {}
}
function exitFullscreen() {
  try {
    if (document.exitFullscreen && document.fullscreenElement)
      document.exitFullscreen();
    else if (document.webkitExitFullscreen && document.webkitFullscreenElement)
      document.webkitExitFullscreen();
  } catch(e) {}
}
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && slideshowActive) stopSlideshow();
});
document.addEventListener('webkitfullscreenchange', () => {
  if (!document.webkitFullscreenElement && slideshowActive) stopSlideshow();
});

// ── Slideshow Logik ──────────────────────────────────────
function updateSlideshowIcon(playing) {
  $('lbPillSlideshow').innerHTML = playing
    ? `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;display:block"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`
    : `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;display:block"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
}
function startSlideshow() {
  slideshowActive = true;
  $('lbPillSlideshow').classList.add('active');
  updateSlideshowIcon(true);
  enterFullscreen();
  closeLbPill();
  sleepTimeout = setTimeout(() => lightbox.classList.add('sleep'), 1200);
  slideshowTimer = setInterval(() => {
    const next = lbIndex + 1;
    if (next >= S().currentItems.length) lbNavigate(-(S().currentItems.length - 1));
    else lbNavigate(1);
  }, SLIDESHOW_INTERVAL);
}
function stopSlideshow() {
  slideshowActive = false;
  clearInterval(slideshowTimer);
  clearTimeout(sleepTimeout);
  slideshowTimer = null;
  $('lbPillSlideshow').classList.remove('active');
  updateSlideshowIcon(false);
  lightbox.classList.remove('sleep');
  exitFullscreen();
}
$('lbPillSlideshow').onclick = e => {
  e.stopPropagation();
  slideshowActive ? stopSlideshow() : startSlideshow();
};

// Share-Popup events
$('sharePopup').addEventListener('click', e => e.stopPropagation());
$('sharePopupCopy').onclick = async e => {
  e.stopPropagation();
  const ok = await copyText($('sharePopupUrl').value);
  toast(ok ? 'Link kopiert ✓' : 'Kopieren fehlgeschlagen');
  closeSharePopup();
};
document.addEventListener('click', e => {
  if(!$('sharePopup').classList.contains('show')) return;
  if(e.target.closest('#sharePopup')) return;
  closeSharePopup();
});
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

$('shuffleBtn').onclick = () => { $('shuffleBtn').blur(); renderGrid(); };
$('uploadBtn').onclick = () => { fileInput.click(); closeMenu(); };
$('uploadBtnSheet').onclick = () => { fileInput.click(); closeMenu(); };
fileInput.onchange = e => upload(e.target.files);

$('favBtn').onclick = () => {
  favFilterActive = !favFilterActive;
  $('favBtn').classList.toggle('fav-active', favFilterActive);
  closeAllOverlays();
  renderGrid();
  if (favFilterActive) toast('Nur Favoriten ♥');
};

$('abFavAll').onclick = async () => {
  for (const id of selectedIds) {
    const item = S().items.find(x => x.id === id);
    if (item && !item.favorite) {
      await toggleFavorite(id, gridEl.querySelector(`.cell[data-id="${id}"]`) || document.createElement('div'));
    }
  }
  exitSelMode();
};

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
    const item = { title:f.name.replace(/\.[^.]+$/,''), moods:[], tags:[], media_url:pub.publicUrl, media_type:mediaType, favorite:false };
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
  results.forEach(item => S().items.unshift(item));
  if(results.length){
    renderGrid();
    results.forEach(item => animateNewCell(item.id));
  }
  prog(100); toast(`${results.length} Datei${results.length!==1?'en':''} hochgeladen ✓`); fileInput.value='';
}

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
    .select('id,title,moods,tags,media_url,media_type,favorite')
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
  await sb.from(S().table).update({title:item.title||'', moods:item.moods||[], tags:item.tags||[], media_url:item.media_url, media_type:item.media_type, favorite:item.favorite||false}).eq('id',item.id);
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
    .select('id,title,moods,tags,media_url,media_type,favorite')
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
const moodsNavBtn = $('moodsNavBtn');
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
    const count = favFilterActive
      ? S().items.filter(i => i.favorite && (Array.isArray(i.moods) && i.moods.includes(m))).length
      : S().items.filter(x => Array.isArray(x.moods) && x.moods.includes(m)).length;
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
    moodsNavBtn.classList.add('active');
    boardTitle.classList.remove('active');
    renderMoodsView();
    window.scrollTo(0, 0);
    _moodsAnimating = false;
  }, 500);
}
function hideMoodsView(){
  if(_moodsAnimating) return;
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
    renderGrid(); // Immer shufflen beim Zurückkehren zur Main-Ansicht
    // Animation starten: kurz warten bis display gesetzt ist
    requestAnimationFrame(() => {
      gridWrap.classList.add('show-view');
      // Nach der Animation die Klasse entfernen
      setTimeout(() => {
        gridWrap.classList.remove('show-view');
        _moodsAnimating = false;
      }, 500);
    });
    moodsNavBtn.classList.remove('active');
    boardTitle.classList.add('active');
  }, 500);
}

moodsNavBtn.onclick = () => {
  if(moodsViewOpen) hideMoodsView();
  else showMoodsView();
};
boardTitle.classList.add('active');

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

renderMoodChips();
applyGridCols(gridCols);
loadItems();
subscribeRealtime();
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

// ── "Zuletzt hinzugefügt" Sortierung ────────────────────────
const sortNewestBtn = document.getElementById('sortNewestBtn');
function updateSortNewestUI(){
  sortNewestBtn.classList.toggle('active', sortNewest);
}
sortNewestBtn.onclick = () => {
  sortNewest = !sortNewest;
  localStorage.setItem('sort_newest', sortNewest);
  updateSortNewestUI();
  renderGrid();
  toast(sortNewest ? 'Sortiert: Zuletzt hinzugefügt' : 'Zufällige Anordnung');
};
updateSortNewestUI();
