import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://uvfuxnwinuakbqanaxtp.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2ZnV4bndpbnVha2JxYW5heHRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxNzg3MDIsImV4cCI6MjA5NTc1NDcwMn0.quSvaycB3Yk2JXCnQz7AQmHpyATtx6u0U8aGQXD73fo';
const BUCKET = 'moodboard';
const OWNER_EMAIL = 'marvin.stowermann1@gmail.com';
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── AUTH STATE ───────────────────────────────────────────
let owner = false;

function updateAdminUI() {
  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = owner ? '' : 'none';
  });
  const loginBtn = $('loginBtn');
  if (loginBtn) {
    loginBtn.title = owner ? 'Abmelden' : 'Login';
    loginBtn.classList.toggle('is-owner', owner);
  }
  const menuBtn = $('menuBtn');
  if (menuBtn) menuBtn.style.display = owner ? '' : 'none';
}

function cleanAuthUrl() {
  // Token-/Error-Reste aus der URL entfernen (Magic-Link-Callback)
  if (location.hash && /(access_token|error|refresh_token|type=)/.test(location.hash)) {
    history.replaceState(null, '', location.pathname + location.search);
  }
}

async function initAuth() {
  // Fehlerhafter / abgelaufener Magic-Link → freundliche Meldung statt kaputtem Zustand
  const hash = location.hash || '';
  if (hash.includes('error')) {
    const params = new URLSearchParams(hash.replace(/^#/, ''));
    const desc = params.get('error_description');
    toast(desc ? 'Login fehlgeschlagen: ' + decodeURIComponent(desc.replace(/\+/g, ' ')) : 'Login-Link ungültig oder abgelaufen');
    cleanAuthUrl();
  }

  const { data: { session } } = await sb.auth.getSession();
  owner = !!session;
  updateAdminUI();
  if (owner) cleanAuthUrl();

  sb.auth.onAuthStateChange((_event, session) => {
    const wasOwner = owner;
    owner = !!session;
    updateAdminUI();
    if (owner && !wasOwner) { toast('Eingeloggt ✓'); cleanAuthUrl(); }
  });
}

async function handleLoginBtn() {
  if (owner) {
    await sb.auth.signOut();
    owner = false;
    updateAdminUI();
    toast('Abgemeldet');
    return;
  }
  openLoginModal();
}

function openLoginModal() {
  $('loginModal').classList.add('show');
  setTimeout(() => $('loginEmail')?.focus(), 60);
  updateBodyLock();
}
function closeLoginModal() {
  $('loginModal').classList.remove('show');
  updateBodyLock();
}

async function submitLogin() {
  const email = ($('loginEmail')?.value || '').trim().toLowerCase();
  if (!email) { toast('Bitte E-Mail eingeben'); return; }
  if (email !== OWNER_EMAIL) { toast('Nicht autorisiert'); return; }
  const btn = $('loginSubmit');
  btn.disabled = true;
  btn.textContent = 'Wird gesendet…';
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: 'https://uvfuxnwinuakbqanaxtp.supabase.co/functions/v1/auth-callback' } });
  btn.disabled = false;
  btn.textContent = 'Magic Link senden';
  if (error) { toast('Fehler: ' + error.message); return; }
  toast('Magic Link gesendet — check deine Mails ✓');
  closeLoginModal();
}

// ── WELCOME TOUR ─────────────────────────────────────────
const WELCOME_KEY = 'mb_welcome_seen';
const WELCOME_STEPS = [
  { icon: '👋', title: "Willkommen auf Marvins Place", text: "Mein persönliches Moodboard. Hier teile ich was mich inspiriert, bewegt und begeistert." },
  { icon: '🎞️', title: "Filter nach Moods", text: "Oben findest du Mood-Filter — klick drauf um nur bestimmte Stimmungen zu sehen." },
  { icon: '🔍', title: "Entdecken", text: "Klick auf ein Bild um es größer zu sehen. Swipe oder Pfeiltasten zum Navigieren." },
];
let welcomeStep = 0;

function showWelcomeIfNew() {
  if (localStorage.getItem(WELCOME_KEY)) return;
  welcomeStep = 0;
  renderWelcomeStep();
  $('welcomeModal').classList.add('show');
  updateBodyLock();
}
function renderWelcomeStep() {
  const s = WELCOME_STEPS[welcomeStep];
  $('welcomeIcon').textContent = s.icon;
  $('welcomeTitle').textContent = s.title;
  $('welcomeText').textContent = s.text;
  $('welcomeDots').querySelectorAll('.wd').forEach((d, i) => d.classList.toggle('active', i === welcomeStep));
  $('welcomeNext').textContent = welcomeStep < WELCOME_STEPS.length - 1 ? 'Weiter →' : 'Los geht\'s 🚀';
}
function advanceWelcome() {
  if (welcomeStep < WELCOME_STEPS.length - 1) {
    welcomeStep++;
    renderWelcomeStep();
  } else {
    dismissWelcome();
  }
}
function dismissWelcome() {
  localStorage.setItem(WELCOME_KEY, '1');
  $('welcomeModal').classList.remove('show');
  updateBodyLock();
}

// ── STATE ────────────────────────────────────────────────
const DEFAULT_MOODS = ['Summer', 'Winter', 'Cozy', 'Dark'];
const mb = {
  items: [],
  currentItems: [],
  moods: ['All', ...DEFAULT_MOODS],
  table: 'moodboard_items'
};

let editId = null, lbIndex = 0, selMode = null, lbIsMuted = false;
let selectedIds = new Set();
let _observer = null;
let sortNewest = localStorage.getItem('sort_newest') === 'true';
let _isInitialLoad = true;
let sleepTimeout = null;
const SLIDESHOW_INTERVAL = 5000;
let slideshowActive = false;
let slideshowTimer = null;

const $ = id => document.getElementById(id);

// ── DOM REFS ─────────────────────────────────────────────
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

// ── SHARE LINK ────────────────────────────────────────────
function buildShareUrl(it) {
  return `${location.origin}${location.pathname}#mb=${encodeURIComponent(it.id)}`;
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove();
      return true;
    } catch (e2) { return false; }
  }
}
function openSharePopup() {
  const it = mb.currentItems[lbIndex]; if (!it) return;
  $('sharePopupUrl').value = buildShareUrl(it);
  $('sharePopup').classList.add('show');
  setTimeout(() => { try { $('sharePopupUrl').select(); } catch (e) {} }, 80);
}
function closeSharePopup() { $('sharePopup').classList.remove('show'); }
function parseShareHash() {
  const m = (location.hash || '').slice(1).match(/^mb=(.+)$/);
  if (!m) return null;
  return { id: decodeURIComponent(m[1]) };
}
let pendingShare = parseShareHash();
function tryOpenPendingShare() {
  if (!pendingShare) return;
  const it = mb.items.find(x => x.id === pendingShare.id);
  if (!it) { if (mb.items.length) { pendingShare = null; toast('Geteiltes Item nicht gefunden'); } return; }
  let idx = mb.currentItems.findIndex(x => x.id === pendingShare.id);
  if (idx < 0) { mb.currentItems = [it, ...mb.currentItems]; idx = 0; }
  pendingShare = null;
  openLightbox(idx);
}
window.addEventListener('hashchange', () => {
  const p = parseShareHash();
  if (p) { pendingShare = p; tryOpenPendingShare(); }
});

// ── AMBIENT GLOW ─────────────────────────────────────────
const ambientCache = new Map();
const AMBIENT_DEFAULT_1 = 'rgba(80,90,140,.5)';
const AMBIENT_DEFAULT_2 = 'rgba(140,70,120,.45)';
function getDominantColor(url) {
  if (ambientCache.has(url)) return Promise.resolve(ambientCache.get(url));
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
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] < 128) continue;
          const lum = (d[i] + d[i + 1] + d[i + 2]) / 3;
          if (lum < 18 || lum > 240) continue;
          r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
        }
        const color = n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : null;
        ambientCache.set(url, color);
        resolve(color);
      } catch (e) { ambientCache.set(url, null); resolve(null); }
    };
    img.onerror = () => { ambientCache.set(url, null); resolve(null); };
    img.src = url;
  });
}
function applyAmbient(c1, c2) {
  lbAmbient.style.setProperty('--ambient-1', c1);
  lbAmbient.style.setProperty('--ambient-2', c2);
}
async function setAmbientFor(it) {
  lbAmbient.style.opacity = '0';
  let c1 = AMBIENT_DEFAULT_1, c2 = AMBIENT_DEFAULT_2;
  if (it.media_type !== 'video') {
    const color = await getDominantColor(it.media_url);
    if (color) {
      const [r, g, b] = color;
      c1 = `rgba(${r},${g},${b},.6)`;
      c2 = `rgba(${Math.min(255, r + 35)},${Math.max(0, g - 10)},${Math.min(255, b + 50)},.5)`;
    }
  }
  if (!lightbox.classList.contains('show') || mb.currentItems[lbIndex] !== it) return;
  applyAmbient(c1, c2);
  requestAnimationFrame(() => { lbAmbient.style.opacity = ''; });
}

// ── MOOD ICONS ────────────────────────────────────────────
const MOOD_ICONS = {
  'All': '🎞️', 'Summer': '☀️', 'Winter': '❄️', 'Cozy': '🕯️',
  'Dark': '🌑', 'Work': '💼', 'Family': '🏠', 'Travel': '✈️', 'Misc': '🏷️',
};
function moodIcon(m) { return MOOD_ICONS[m] || '🏷️'; }

// ── FILTER STATE ──────────────────────────────────────────
let activeMoods = new Set(JSON.parse(localStorage.getItem('active_moods') || '[]'));

// ── GRID COLUMNS ─────────────────────────────────────────
function getColRange() {
  return window.innerWidth <= 600 ? { min: 1, max: 5 } : { min: 3, max: 10 };
}
function getDefaultCols() {
  const r = getColRange();
  return Math.round((r.min + r.max) / 2);
}
let gridCols = (() => {
  const saved = localStorage.getItem('grid_cols');
  if (saved !== null) { const v = parseInt(saved); if (v >= getColRange().min && v <= getColRange().max) return v; }
  return getDefaultCols();
})();

function saveFilterState() {
  localStorage.setItem('active_moods', JSON.stringify([...activeMoods]));
  localStorage.setItem('grid_cols', String(gridCols));
}
function applyGridCols(cols) {
  gridCols = cols;
  gridEl.style.gridTemplateColumns = cols === 1 ? '1fr' : `repeat(${cols}, 1fr)`;
  updateSwipeUI();
  saveFilterState();
}

// ── SWIPE CONTROL ─────────────────────────────────────────
const swipeThumb = $('swipeThumb');
const swipeTrack = $('swipeTrack');
const swipeFill  = $('swipeFill');
const swipeValue = $('swipeValue');
const colDec     = $('colDec');
const colInc     = $('colInc');

function updateSwipeUI() {
  const r = getColRange();
  const pct = r.max > r.min ? ((gridCols - r.min) / (r.max - r.min)) * 100 : 50;
  swipeThumb.style.left = pct + '%';
  swipeFill.style.width = pct + '%';
  swipeValue.textContent = gridCols;
}

let _drag = false;
function startDrag(e) { _drag = true; swipeThumb.classList.add('dragging'); e.preventDefault(); }
function moveDrag(cx) {
  if (!_drag) return;
  const rect = swipeTrack.getBoundingClientRect();
  let pct = (cx - rect.left) / rect.width;
  pct = Math.max(0, Math.min(1, pct));
  const r = getColRange();
  const cols = Math.round(r.min + pct * (r.max - r.min));
  if (cols !== gridCols) applyGridCols(cols);
}
function endDrag() {
  if (!_drag) return;
  _drag = false;
  swipeThumb.classList.remove('dragging');
}
swipeThumb.addEventListener('touchstart', startDrag, { passive: false });
document.addEventListener('touchmove', e => { if (_drag) moveDrag(e.touches[0].clientX); }, { passive: true });
document.addEventListener('touchend', endDrag, { passive: true });
swipeThumb.addEventListener('mousedown', startDrag);
document.addEventListener('mousemove', e => { if (_drag) moveDrag(e.clientX); });
document.addEventListener('mouseup', endDrag);
swipeTrack.addEventListener('click', e => { if (e.target === swipeThumb) return; moveDrag(e.clientX); });
colDec.onclick = () => { const r = getColRange(); if (gridCols > r.min) applyGridCols(gridCols - 1); };
colInc.onclick = () => { const r = getColRange(); if (gridCols < r.max) applyGridCols(gridCols + 1); };

// ── TABS ─────────────────────────────────────────────────
function bindTabs(rootId) {
  const root = $(rootId); if (!root) return;
  const tabs = root.querySelectorAll('.dd-tab');
  const panels = root.querySelectorAll('.dd-panel');
  tabs.forEach(btn => btn.onclick = () => {
    const t = btn.dataset.tab;
    tabs.forEach(b => b.classList.toggle('active', b === btn));
    panels.forEach(p => p.classList.toggle('show', p.dataset.panel === t));
  });
}
bindTabs('dropdown'); bindTabs('bottomSheet');

// ── QUICK ADD ─────────────────────────────────────────────
function bindQuickAdd(suffix) {
  const g = k => $(k + (suffix || ''));
  const btn = g('quickAddBtn'); const inp = g('quickAddUrl');
  if (!btn || !inp) return;
  const run = async () => {
    const url = inp.value.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) { toast('Ungültige URL'); return; }
    const isVideo = /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url);
    const item = {
      title: ((url.split('/').pop() || 'Link').split('?')[0] || 'Link').slice(0, 80),
      moods: [], tags: [],
      media_url: url,
      media_type: isVideo ? 'video' : 'image'
    };
    btn.disabled = true;
    const { data: ins, error } = await sb.from(mb.table).insert(item).select().single();
    btn.disabled = false;
    if (error) { toast('Fehler: ' + error.message); return; }
    mb.items.unshift({ ...item, id: ins.id });
    inp.value = '';
    toast('Hinzugefügt ✓'); renderGrid(); closeMenu();
  };
  btn.onclick = run;
  inp.onkeydown = e => { if (e.key === 'Enter') run(); };
}
bindQuickAdd(''); bindQuickAdd('Sheet');

// ── VIEW TAB ─────────────────────────────────────────────
function bindView(suffix) {
  const g = k => $(k + (suffix || ''));
  const f = g('ddFilterBtn'); const s = g('ddShuffleBtn');
  if (f) f.onclick = () => { closeMenu(); filterPopup.classList.toggle('show'); };
  if (s) s.onclick = () => { closeMenu(); renderGrid(); toast('Neu gemischt'); };
}
bindView(''); bindView('Sheet');

// ── TOAST ─────────────────────────────────────────────────
function toast(t) {
  toastEl.textContent = t;
  if (typeof gsap !== 'undefined') {
    gsap.killTweensOf(toastEl);
    gsap.fromTo(toastEl, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.22, ease: 'power2.out' });
    clearTimeout(toast._t);
    toast._t = setTimeout(() => gsap.to(toastEl, { opacity: 0, y: 10, duration: 0.2, ease: 'power2.in' }), 1800);
  } else {
    toastEl.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toastEl.classList.remove('show'), 1600);
  }
}

// ── UTILS ─────────────────────────────────────────────────
function isVid(n) { return /\.(mp4|webm|mov|m4v)$/i.test(n || ''); }
function isGif(n) { return /\.gif$/i.test(n || ''); }
function prog(p) { progressBar.style.width = p + '%'; if (p >= 100) setTimeout(() => progressBar.style.width = '0', 600); }
function compress(file, maxPx = MAX_PX, q = 0.88) {
  return new Promise(res => {
    if (isVid(file.name) || isGif(file.name)) { res(file); return; }
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.width, h = img.height;
      if (w <= maxPx && h <= maxPx) { res(file); return; }
      const r = Math.min(maxPx / w, maxPx / h); w = Math.round(w * r); h = Math.round(h * r);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      const outType = 'image/webp', outName = file.name.replace(/\.[^.]+$/, '.webp');
      c.toBlob(b => res(new File([b], outName, { type: outType })), outType, q);
    };
    img.src = url;
  });
}

// ── BODY SCROLL LOCK ─────────────────────────────────────
let _lockedScrollY = 0;
function updateBodyLock() {
  const lock = lightbox.classList.contains('show')
    || bottomSheet.classList.contains('show')
    || ($('loginModal')?.classList.contains('show'))
    || ($('welcomeModal')?.classList.contains('show'))
    || ($('moodCreateModal')?.classList.contains('show'))
    || ($('moodsMgmtPopup')?.classList.contains('show'))
    || ($('confirmPopup')?.classList.contains('show'));
  const isLocked = document.documentElement.classList.contains('no-scroll');
  if (lock && !isLocked) {
    _lockedScrollY = window.scrollY || window.pageYOffset || 0;
    document.documentElement.classList.add('no-scroll');
    document.body.classList.add('no-scroll');
    document.body.style.top = `-${_lockedScrollY}px`;
  } else if (!lock && isLocked) {
    document.documentElement.classList.remove('no-scroll');
    document.body.classList.remove('no-scroll');
    document.body.style.top = '';
    window.scrollTo(0, _lockedScrollY);
  }
}

// ── MENU ─────────────────────────────────────────────────
function openMenu() {
  if (window.innerWidth <= 600) { bottomSheet.classList.add('show'); sheetOverlay.classList.add('show'); updateBodyLock(); }
  else dropdown.classList.toggle('show');
}
function closeMenu() {
  dropdown.classList.remove('show');
  bottomSheet.classList.remove('show');
  sheetOverlay.classList.remove('show');
  editorWrap.classList.remove('show');
  updateBodyLock();
}
function closeAllOverlays() {
  closeMenu();
  filterPopup.classList.remove('show');
  editorWrap.classList.remove('show');
  const sp = $('spotifyPopup');
  if (sp) { sp.classList.remove('show'); $('spotifyBtn').classList.remove('active'); }
}
function isAnyOverlayOpen() {
  return dropdown.classList.contains('show') ||
    bottomSheet.classList.contains('show') ||
    filterPopup.classList.contains('show') ||
    editorWrap.classList.contains('show') ||
    !!$('spotifyPopup')?.classList.contains('show');
}

$('menuBtn').onclick = e => { e.stopPropagation(); openMenu(); };
sheetOverlay.onclick = closeMenu;
document.addEventListener('click', e => {
  if (!e.target.closest('#dropdown') && !e.target.closest('#menuBtn')) dropdown.classList.remove('show');
});

// ── BOARD TITLE CLICK → reset filter ─────────────────────
$('boardTitle').onclick = () => {
  if (typeof moodsViewOpen !== 'undefined' && moodsViewOpen) hideMoodsView();
  activeMoods.clear();
  saveFilterState();
  renderGrid();
};

// ── MOOD CHIPS ────────────────────────────────────────────
function renderMoodChips() {
  document.querySelectorAll('[data-mood-chip]').forEach(chip => {
    const m = chip.dataset.moodChip;
    chip.classList.toggle('active', activeMoods.has(m));
    chip.onclick = () => {
      if (activeMoods.has(m)) activeMoods.delete(m); else activeMoods.add(m);
      saveFilterState(); renderGrid(); renderMoodChips();
    };
  });
}

// ── GRID ─────────────────────────────────────────────────
function renderGrid() {
  const seen = new Set();
  mb.items = mb.items.filter(i => { if (seen.has(i.id)) return false; seen.add(i.id); return true; });

  const validMoods = new Set(mb.moods);
  for (const m of [...activeMoods]) if (!validMoods.has(m)) activeMoods.delete(m);

  let arr = activeMoods.size > 0
    ? mb.items.filter(i => Array.isArray(i.moods) && i.moods.some(m => activeMoods.has(m)))
    : mb.items;

  if (activeMoods.size > 0 && arr.length === 0 && mb.items.length > 0) {
    activeMoods.clear(); saveFilterState(); arr = mb.items;
  }

  if (!sortNewest) arr = [...arr].sort(() => Math.random() - .5);

  mb.currentItems = arr;
  if (_observer) { _observer.disconnect(); _observer = null; }

  gridEl.innerHTML = arr.map(it => `
    <div class="cell" data-id="${it.id}">
      <input class="selcheck" type="checkbox" data-id="${it.id}">
      ${it.media_type === 'video'
        ? `<video src="${it.media_url}" muted loop playsinline preload="none"></video>`
        : `<img src="${it.media_url}" loading="lazy" decoding="async" alt="">`}
    </div>`).join('');

  if (_isInitialLoad && typeof gsap !== 'undefined' && arr.length > 0) {
    gsap.from(gridEl.querySelectorAll('.cell'), {
      opacity: 0, scale: 0.9, duration: 0.4,
      stagger: { amount: Math.min(0.6, arr.length * 0.04), from: 'start' },
      ease: 'power2.out', clearProps: 'transform,opacity'
    });
    _isInitialLoad = false;
  }

  _observer = new IntersectionObserver(entries => entries.forEach(e => {
    const v = e.target.querySelector('video'); if (!v) return;
    if (e.isIntersecting) { v.muted = true; v.play().catch(() => {}); }
    else { v.pause(); v.currentTime = 0; }
  }), { threshold: 0.25, rootMargin: '100px' });

  applyGridCols(gridCols);
  gridEl.querySelectorAll('.cell').forEach(c => {
    _observer.observe(c);
    const chk = c.querySelector('.selcheck');
    c.onclick = e => {
      if (selMode) {
        if (e.target !== chk) chk.checked = !chk.checked;
        chk.checked ? selectedIds.add(c.dataset.id) : selectedIds.delete(c.dataset.id);
        c.classList.toggle('sel-highlight', chk.checked);
        updateActionBarCount();
        return;
      }
      if (isAnyOverlayOpen()) { closeAllOverlays(); e.stopPropagation(); return; }
      const idx = mb.currentItems.findIndex(x => x.id === c.dataset.id);
      openLightbox(idx);
    };
    // Right-click/long-press opens editor — only for owner
    c.oncontextmenu = e => { e.preventDefault(); if (owner && !selMode) openEditor(c.dataset.id); };
    if (selMode) {
      chk.classList.add('visible');
      if (selectedIds.has(c.dataset.id)) { chk.checked = true; c.classList.add('sel-highlight'); }
    }
  });
}

function updateActionBarCount() {
  actionBarCount.textContent = selectedIds.size + ' ausgewählt';
}

// ── SELECTION MODE ────────────────────────────────────────
function enterSelMode() {
  selMode = 'delete'; selectedIds.clear(); closeMenu();
  actionBarTitle.textContent = 'Bilder löschen';
  actionBarMoods.innerHTML = '';
  actionBar.classList.add('show'); renderGrid(); updateActionBarCount();
}
function exitSelMode() {
  selMode = null; selectedIds.clear();
  actionBar.classList.remove('show'); renderGrid();
}
$('abCancel').onclick = () => { $('deleteFloatingBtn')?.remove(); exitSelMode(); };

// ── LIGHTBOX PILL ─────────────────────────────────────────
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
  if (!lbPillOpen) { $('lbMoodPopup').classList.remove('show'); closeSharePopup(); }
};
$('lbPillShare').onclick = e => {
  e.stopPropagation();
  $('lbMoodPopup').classList.remove('show');
  openSharePopup();
};
$('lbPillMute').onclick = e => {
  e.stopPropagation();
  const v = lbInner.querySelector('video'); if (!v) return;
  lbIsMuted = !lbIsMuted; v.muted = lbIsMuted; updateMuteSvg(lbIsMuted);
};
$('lbPillMood').onclick = e => {
  e.stopPropagation();
  if (!owner) return; // guests can't tag moods
  const popup = $('lbMoodPopup');
  if (popup.classList.contains('show')) { popup.classList.remove('show'); return; }
  closeSharePopup();
  const it = mb.currentItems[lbIndex]; if (!it) return;
  const moods = mb.moods.filter(m => m !== 'All');
  popup.innerHTML = moods.map(m =>
    `<button class="lb-mood-chip ${Array.isArray(it.moods) && it.moods.includes(m) ? 'active' : ''}" data-mood="${m}">${m}</button>`
  ).join('');
  popup.querySelectorAll('.lb-mood-chip').forEach(chip => {
    chip.onclick = async ev => {
      ev.stopPropagation();
      const mood = chip.dataset.mood;
      const moods = Array.isArray(it.moods) ? [...it.moods] : [];
      const idx = moods.indexOf(mood);
      if (idx > -1) moods.splice(idx, 1); else moods.push(mood);
      it.moods = moods;
      chip.classList.toggle('active', moods.includes(mood));
      await sb.from(mb.table).update({ moods }).eq('id', it.id);
    };
  });
  popup.classList.add('show');
};
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

// ── LIGHTBOX ──────────────────────────────────────────────
function openLightbox(idx) {
  if (idx < 0 || idx >= mb.currentItems.length) return;
  lbIndex = idx;
  const it = mb.currentItems[idx];
  lbInner.querySelectorAll('img,video').forEach(e => e.remove());
  if (it.media_type === 'video') {
    const v = document.createElement('video');
    v.src = it.media_url; v.controls = true; v.autoplay = true; v.muted = false; v.loop = true;
    lbInner.appendChild(v);
    lbIsMuted = false; updateMuteSvg(false);
  } else {
    const img = document.createElement('img');
    img.src = it.media_url; img.style.pointerEvents = 'none';
    lbInner.appendChild(img);
  }
  lightbox.classList.add('show');
  if (typeof gsap !== 'undefined') {
    const media = lbInner.querySelector('img,video');
    gsap.fromTo(lightbox, { opacity: 0 }, { opacity: 1, duration: 0.22, ease: 'power2.out' });
    if (media) gsap.fromTo(media, { scale: 0.93, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.3, ease: 'power2.out' });
  }
  // hide mood button for guests
  $('lbPillMood').style.display = owner ? '' : 'none';
  lightbox.classList.toggle('has-video', it.media_type === 'video');
  closeLbPill();
  setAmbientFor(it);
  updateLbArrows();
  updateBodyLock();
}
function updateLbArrows() {
  $('lbPrev').style.opacity = lbIndex > 0 ? '1' : '0.2';
  $('lbNext').style.opacity = lbIndex < mb.currentItems.length - 1 ? '1' : '0.2';
}
function lbNavigate(dir) {
  const next = lbIndex + dir;
  if (next < 0 || next >= mb.currentItems.length) return;
  closeLbPill();
  lbInner.querySelectorAll('video').forEach(v => v.pause());
  openLightbox(next);
}
$('lbPrev').onclick = e => { e.stopPropagation(); lbNavigate(-1); };
$('lbNext').onclick = e => { e.stopPropagation(); lbNavigate(1); };
lightbox.onclick = e => { if (!e.target.closest('.lb-arrow') && !e.target.closest('video')) closeLb(); };
function closeLb() {
  lightbox.classList.remove('show', 'has-video', 'sleep');
  if (slideshowActive) stopSlideshow();
  closeLbPill(); closeSharePopup();
  updateBodyLock();
  lbAmbient.style.opacity = '0';
  lbInner.querySelectorAll('video').forEach(v => v.pause());
}

// ── SLEEP / WAKE ──────────────────────────────────────────
function wakeUp() {
  lightbox.classList.remove('sleep');
  clearTimeout(sleepTimeout);
  if (slideshowActive) sleepTimeout = setTimeout(() => { if (slideshowActive) lightbox.classList.add('sleep'); }, 4000);
}
lightbox.addEventListener('click', wakeUp, { capture: true });
lightbox.addEventListener('touchstart', wakeUp, { passive: true, capture: true });
lightbox.addEventListener('mousemove', wakeUp, { passive: true });

// ── FULLSCREEN ────────────────────────────────────────────
async function enterFullscreen() {
  try {
    const el = document.documentElement;
    if (el.requestFullscreen) await el.requestFullscreen();
    else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
  } catch (e) {}
}
function exitFullscreen() {
  try {
    if (document.exitFullscreen && document.fullscreenElement) document.exitFullscreen();
    else if (document.webkitExitFullscreen && document.webkitFullscreenElement) document.webkitExitFullscreen();
  } catch (e) {}
}
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && slideshowActive) stopSlideshow(); });
document.addEventListener('webkitfullscreenchange', () => { if (!document.webkitFullscreenElement && slideshowActive) stopSlideshow(); });

// ── SLIDESHOW ─────────────────────────────────────────────
function updateSlideshowIcon(playing) {
  $('lbPillSlideshow').innerHTML = playing
    ? `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;display:block"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`
    : `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;display:block"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
}
function startSlideshow() {
  slideshowActive = true; $('lbPillSlideshow').classList.add('active');
  updateSlideshowIcon(true); enterFullscreen(); closeLbPill();
  sleepTimeout = setTimeout(() => lightbox.classList.add('sleep'), 1200);
  slideshowTimer = setInterval(() => {
    const next = lbIndex + 1;
    if (next >= mb.currentItems.length) lbNavigate(-(mb.currentItems.length - 1));
    else lbNavigate(1);
  }, SLIDESHOW_INTERVAL);
}
function stopSlideshow() {
  slideshowActive = false; clearInterval(slideshowTimer); clearTimeout(sleepTimeout);
  slideshowTimer = null; $('lbPillSlideshow').classList.remove('active');
  updateSlideshowIcon(false); lightbox.classList.remove('sleep'); exitFullscreen();
}
$('lbPillSlideshow').onclick = e => { e.stopPropagation(); slideshowActive ? stopSlideshow() : startSlideshow(); };

// ── SHARE POPUP ───────────────────────────────────────────
$('sharePopup').addEventListener('click', e => e.stopPropagation());
$('sharePopupCopy').onclick = async e => {
  e.stopPropagation();
  const ok = await copyText($('sharePopupUrl').value);
  toast(ok ? 'Link kopiert ✓' : 'Kopieren fehlgeschlagen');
  closeSharePopup();
};
document.addEventListener('click', e => {
  if (!$('sharePopup').classList.contains('show')) return;
  if (e.target.closest('#sharePopup')) return;
  closeSharePopup();
});

function updateMuteSvg(muted) {
  const svg = $('lbMuteSvg'); if (!svg) return;
  svg.innerHTML = muted
    ? '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>'
    : '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>';
}

// ── TOUCH SWIPE IN LIGHTBOX ───────────────────────────────
let txS = 0, tyS = 0;
lightbox.addEventListener('touchstart', e => { txS = e.touches[0].clientX; tyS = e.touches[0].clientY; }, { passive: true });
lightbox.addEventListener('touchend', e => {
  const dx = e.changedTouches[0].clientX - txS, dy = e.changedTouches[0].clientY - tyS;
  if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 40) lbNavigate(dx < 0 ? 1 : -1);
}, { passive: true });

// ── KEYBOARD ──────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (lightbox.classList.contains('show')) {
    if (e.key === 'ArrowLeft') lbNavigate(-1);
    else if (e.key === 'ArrowRight') lbNavigate(1);
    else if (e.key === 'Escape') closeLb();
    return;
  }
  if (e.key === 'Escape') { if (selMode) exitSelMode(); else closeMenu(); }
});

// ── BUTTONS ───────────────────────────────────────────────
$('shuffleBtn').onclick = () => { $('shuffleBtn').blur(); renderGrid(); };
$('uploadBtn').onclick = () => { fileInput.click(); closeMenu(); };
$('uploadBtnSheet').onclick = () => { fileInput.click(); closeMenu(); };
fileInput.onchange = e => upload(e.target.files);

// ── AUTO MOOD SUGGESTION ──────────────────────────────────
async function autoSuggestMoods(imageUrl) {
  const moods = mb.moods.filter(m => m !== 'All');
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

// ── UPLOAD ────────────────────────────────────────────────
async function upload(files) {
  if (!owner) { toast('Nur für eingeloggte User'); return; }
  const arr = Array.from(files);
  if (!arr.length) return;
  toast(`${arr.length} Datei${arr.length > 1 ? 'en' : ''} wird${arr.length > 1 ? 'en' : ''} hochgeladen…`);
  let done = 0;
  const uploadOne = async (f) => {
    const cf = await compress(f);
    const ext = cf.name.split('.').pop().toLowerCase();
    const path = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.${ext}`;
    const { error: e1 } = await sb.storage.from(BUCKET).upload(path, cf, { upsert: false, contentType: cf.type });
    if (e1) { toast('Upload-Fehler: ' + e1.message); return null; }
    const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path);
    const mediaType = isVid(f.name) ? 'video' : isGif(f.name) ? 'gif' : 'image';
    const suggestedMoods = mediaType === 'image' ? await autoSuggestMoods(pub.publicUrl) : [];
    const item = { title: f.name.replace(/\.[^.]+$/, ''), moods: suggestedMoods, tags: [], media_url: pub.publicUrl, media_type: mediaType };
    const { data: ins, error: e2 } = await sb.from(mb.table).insert(item).select().single();
    if (e2) { toast('DB-Fehler: ' + e2.message); return null; }
    done++;
    prog(Math.round(done / arr.length * 90));
    return { ...item, id: ins.id };
  };
  const CONCURRENCY = 3;
  const results = [];
  for (let i = 0; i < arr.length; i += CONCURRENCY) {
    const batch = arr.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map(uploadOne));
    results.push(...batchResults.filter(Boolean));
  }
  if (results.length) {
    const newIds = results.map(i => i.id);
    await refetchItems();
    renderGrid();
    newIds.forEach(id => animateNewCell(id));
  }
  prog(100); toast(`${results.length} Datei${results.length !== 1 ? 'en' : ''} hochgeladen ✓`); fileInput.value = '';
}

// ── DELETE MODE ───────────────────────────────────────────
function startDeleteMode() {
  if (!owner) return;
  closeMenu(); selMode = 'delete'; selectedIds.clear();
  actionBarTitle.textContent = 'Bilder löschen';
  actionBarMoods.innerHTML = '';
  actionBar.classList.add('show'); renderGrid(); updateActionBarCount();
  $('deleteFloatingBtn')?.remove();
  const btn = document.createElement('button');
  btn.id = 'deleteFloatingBtn';
  btn.innerHTML = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:20px;height:20px;display:block"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
  btn.style.cssText = 'position:fixed;left:20px;bottom:100px;z-index:60;width:46px;height:46px;border-radius:999px;border:1px solid rgba(255,255,255,.12);background:rgba(255,60,60,.2);color:#fff;cursor:pointer;font-size:18px;display:grid;place-items:center;backdrop-filter:blur(16px);box-shadow:0 8px 24px rgba(0,0,0,.3)';
  btn.onclick = async () => {
    if (!selectedIds.size) { toast('Nichts ausgewählt'); return; }
    showConfirmPopup(selectedIds.size + ' Bilder', async () => {
      await sbDeleteMany([...selectedIds]);
      mb.items = mb.items.filter(i => !selectedIds.has(i.id));
      toast('Gelöscht'); btn.remove(); exitSelMode();
    });
  };
  document.body.appendChild(btn);
}
$('pickDeleteBtn').onclick = startDeleteMode;
$('pickDeleteBtnSheet').onclick = startDeleteMode;

// ── EDITOR ────────────────────────────────────────────────
function openEditor(id) {
  if (!owner) return;
  editId = id; const it = mb.items.find(x => x.id === id); if (!it) return;
  $('editorTitle').textContent = it.title || 'Item';
  $('tagInput').value = (it.tags || []).join(', ');
  editorWrap.classList.add('show'); renderTagChips(); dropdown.classList.add('show');
}
function renderTagChips() {
  const it = mb.items.find(x => x.id === editId);
  $('tagChips').innerHTML = mb.moods.filter(m => m !== 'All').map(m =>
    `<button class="tchip ${it && Array.isArray(it.moods) && it.moods.includes(m) ? 'active' : ''}" data-m="${m}">${m}</button>`
  ).join('');
  document.querySelectorAll('.tchip').forEach(b => b.onclick = () => {
    const it = mb.items.find(x => x.id === editId); if (!it) return;
    if (!Array.isArray(it.moods)) it.moods = [];
    const m = b.dataset.m;
    const idx = it.moods.indexOf(m);
    if (idx > -1) it.moods.splice(idx, 1); else it.moods.push(m);
    sbUpdate(it); renderGrid(); renderTagChips();
  });
}
$('saveTagsBtn').onclick = () => {
  const it = mb.items.find(x => x.id === editId); if (!it) return;
  it.tags = $('tagInput').value.split(',').map(s => s.trim()).filter(Boolean);
  sbUpdate(it); renderGrid(); toast('Tags gespeichert');
};

// ── DB OPS ────────────────────────────────────────────────
async function loadItems() {
  const { data, error } = await sb.from(mb.table)
    .select('id,title,moods,tags,media_url,media_type')
    .order('created_at', { ascending: false });
  if (error) { toast('Ladefehler: ' + error.message); gridEl.innerHTML = '<div style="padding:24px;color:#fff">Kein Datenzugriff</div>'; return; }
  mb.items = data || [];
  mergeMoodsFromItems();
  renderGrid(); $('bootMsg')?.remove();
  renderMoodChips();
  if (typeof moodsViewOpen !== 'undefined' && moodsViewOpen) renderMoodsView();
  tryOpenPendingShare();
}

async function loadMoodsFromDB() {
  const { data, error } = await sb.from('moods').select('name').order('id');
  if (error || !data?.length) return;
  const dbMoods = data.map(r => r.name);
  const known = new Set(mb.moods);
  for (const m of dbMoods) if (!known.has(m)) { mb.moods.push(m); known.add(m); }
}

function mergeMoodsFromItems() {
  const known = new Set(mb.moods);
  for (const it of mb.items) {
    if (!Array.isArray(it.moods)) continue;
    for (const m of it.moods) {
      if (typeof m !== 'string') continue;
      const trimmed = m.trim();
      if (!trimmed || known.has(trimmed)) continue;
      mb.moods.push(trimmed); known.add(trimmed);
    }
  }
}

async function sbUpdate(item) {
  if (!item) return;
  await sb.from(mb.table).update({ title: item.title || '', moods: item.moods || [], tags: item.tags || [], media_url: item.media_url, media_type: item.media_type }).eq('id', item.id);
}
async function sbDeleteMany(ids) {
  if (!ids.length) return;
  await sb.from(mb.table).delete().in('id', ids);
}

// ── REALTIME SYNC ─────────────────────────────────────────
let _syncTimer = null;
function isUiBusy() {
  return lightbox.classList.contains('show')
    || bottomSheet.classList.contains('show')
    || !!$('moodCreateModal')?.classList.contains('show')
    || !!$('moodsMgmtPopup')?.classList.contains('show')
    || !!$('confirmPopup')?.classList.contains('show');
}
async function refetchItems() {
  if (isUiBusy()) { scheduleSync(1500); return; }
  const { data, error } = await sb.from(mb.table)
    .select('id,title,moods,tags,media_url,media_type')
    .order('created_at', { ascending: false });
  if (error) return;
  mb.items = data || [];
  mergeMoodsFromItems();
  renderMoodChips();
  if (typeof moodsViewOpen !== 'undefined' && moodsViewOpen) renderMoodsView();
}
function scheduleSync(delay) {
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(refetchItems, delay ?? 400);
}
function subscribeRealtime() {
  try {
    sb.channel('moodboard_items_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'moodboard_items' }, () => scheduleSync(300))
      .subscribe();
  } catch (e) {}
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scheduleSync(0); });
window.addEventListener('focus', () => scheduleSync(0));
window.addEventListener('online', () => scheduleSync(0));

// ── MOODS VIEW ────────────────────────────────────────────
let moodsViewOpen = false;
const moodsView = $('moodsView');
const moodsGrid = $('moodsGrid');
const moodsNavBtn = $('moodsNavBtn');
const boardTitle = $('boardTitle');

function pickMainItem(mood) {
  const items = mb.items.filter(x => Array.isArray(x.moods) && x.moods.includes(mood));
  return items.length ? items[0] : null;
}

function renderMoodsView() {
  const moods = mb.moods.filter(m => m !== 'All');
  const tilesHtml = moods.map(m => {
    const it = pickMainItem(m);
    const count = mb.items.filter(x => Array.isArray(x.moods) && x.moods.includes(m)).length;
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
  const createTile = owner ? `
    <div class="mood-tile mood-tile-create admin-only" id="moodCreateTile">
      <div class="mtc-inner"><div class="mtc-plus">+</div><div class="mtc-label">Neue Mood</div></div>
    </div>` : '';
  moodsGrid.innerHTML = tilesHtml + createTile;
  const createBtn = $('moodCreateTile');
  if (createBtn) createBtn.onclick = openMoodCreate;
  moodsGrid.querySelectorAll('.mood-tile:not(.mood-tile-create)').forEach(tile => {
    tile.onclick = () => {
      activeMoods = new Set([tile.dataset.m]);
      saveFilterState(); hideMoodsView();
    };
  });
}

let _moodsAnimating = false;
function showMoodsView() {
  if (_moodsAnimating) return;
  _moodsAnimating = true; moodsViewOpen = true;
  clearTimeout(_syncTimer);
  closeMenu(); closeLb();
  selMode = null; selectedIds.clear(); actionBar.classList.remove('show');
  gridWrap.classList.add('hide-view');
  $('bottombar').classList.add('moods-active');
  $('moodsMgmtBtn').classList.add('show');
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
function hideMoodsView() {
  if (_moodsAnimating) return;
  _moodsAnimating = true; moodsViewOpen = false;
  clearTimeout(_syncTimer);
  moodsView.classList.remove('show');
  $('bottombar').classList.remove('moods-active');
  $('moodsMgmtBtn').classList.remove('show');
  setTimeout(() => {
    gridWrap.style.display = '';
    renderGrid();
    requestAnimationFrame(() => {
      gridWrap.classList.add('show-view');
      setTimeout(() => { gridWrap.classList.remove('show-view'); _moodsAnimating = false; }, 500);
    });
    moodsNavBtn.classList.remove('active');
    boardTitle.classList.add('active');
  }, 500);
}
moodsNavBtn.onclick = () => { moodsViewOpen ? hideMoodsView() : showMoodsView(); };
boardTitle.classList.add('active');

// ── CREATE MOOD MODAL ─────────────────────────────────────
const moodCreateModal = $('moodCreateModal');
const mcmInput = $('mcmInput');
const mcmError = $('mcmError');
function openMoodCreate() {
  mcmInput.value = ''; mcmError.classList.remove('show'); mcmError.innerHTML = '&nbsp;';
  moodCreateModal.classList.add('show'); updateBodyLock();
  setTimeout(() => mcmInput.focus(), 60);
}
function closeMoodCreate() { moodCreateModal.classList.remove('show'); updateBodyLock(); }
function showMcmError(msg) { mcmError.textContent = msg; mcmError.classList.add('show'); }
async function confirmCreateMood() {
  const raw = mcmInput.value.trim();
  if (!raw) { showMcmError('Bitte einen Namen eingeben'); return; }
  if (raw.length < 2) { showMcmError('Mindestens 2 Zeichen'); return; }
  if (mb.moods.some(m => m.toLowerCase() === raw.toLowerCase())) { showMcmError('Diese Mood existiert bereits'); return; }
  mb.moods.push(raw);
  // persist to DB
  await sb.from('moods').insert({ name: raw }).select();
  renderMoodChips();
  if (moodsViewOpen) renderMoodsView();
  closeMoodCreate();
  toast(`Mood „${raw}" erstellt ✓`);
}
$('mcmConfirm').onclick = confirmCreateMood;
$('mcmCancel').onclick = closeMoodCreate;
mcmInput.addEventListener('keydown', e => { if (e.key === 'Enter') confirmCreateMood(); else if (e.key === 'Escape') closeMoodCreate(); });
moodCreateModal.addEventListener('click', e => { if (e.target === moodCreateModal) closeMoodCreate(); });

// ── MOODS MANAGEMENT ─────────────────────────────────────
const moodsMgmtPopup = $('moodsMgmtPopup');
const mmgList = $('mmgList');
const mmgInput = $('mmgInput');
const mmgAddBtn = $('mmgAddBtn');
const mmgClose = $('mmgClose');

function renderMoodsMgmt() {
  const moods = mb.moods.filter(m => m !== 'All');
  mmgList.innerHTML = moods.map(m => {
    const count = mb.items.filter(x => Array.isArray(x.moods) && x.moods.includes(m)).length;
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
      showConfirmPopup(m, async () => {
        mb.moods = mb.moods.filter(x => x !== m);
        await sb.from('moods').delete().eq('name', m);
        for (const it of mb.items) {
          if (Array.isArray(it.moods)) {
            const idx = it.moods.indexOf(m);
            if (idx >= 0) { it.moods.splice(idx, 1); sbUpdate(it); }
          }
        }
        renderMoodsMgmt();
        if (moodsViewOpen) renderMoodsView();
        renderGrid();
        toast(`Mood „${m}" gelöscht`);
      });
    };
  });
}
$('moodsMgmtBtn').onclick = () => {
  if (!owner) return;
  moodsMgmtPopup.classList.add('show'); renderMoodsMgmt(); updateBodyLock();
  setTimeout(() => mmgInput.focus(), 60);
};
function closeMoodsMgmt() { moodsMgmtPopup.classList.remove('show'); updateBodyLock(); }
mmgClose.onclick = closeMoodsMgmt;
moodsMgmtPopup.addEventListener('click', e => { if (e.target === moodsMgmtPopup) closeMoodsMgmt(); });
mmgAddBtn.onclick = async () => {
  const raw = mmgInput.value.trim();
  if (!raw) { toast('Bitte einen Namen eingeben'); return; }
  if (raw.length < 2) { toast('Mindestens 2 Zeichen'); return; }
  if (mb.moods.some(m => m.toLowerCase() === raw.toLowerCase())) { toast('Diese Mood existiert bereits'); return; }
  mb.moods.push(raw);
  await sb.from('moods').insert({ name: raw }).select();
  renderMoodsMgmt();
  if (moodsViewOpen) renderMoodsView();
  renderGrid();
  mmgInput.value = ''; toast(`Mood „${raw}" erstellt ✓`);
};
mmgInput.addEventListener('keydown', e => { if (e.key === 'Enter') mmgAddBtn.click(); else if (e.key === 'Escape') closeMoodsMgmt(); });

// ── CONFIRM POPUP ─────────────────────────────────────────
const confirmPopup = $('confirmPopup');
const cfmMoodName = $('cfmMoodName');
const cfmYes = $('cfmYes');
const cfmNo = $('cfmNo');
const cfmClose = $('cfmClose');
let _cfmCallback = null;
function showConfirmPopup(moodName, onConfirm) {
  cfmMoodName.textContent = `„${moodName}"`; confirmPopup.classList.add('show'); updateBodyLock();
  _cfmCallback = onConfirm;
}
function closeConfirmPopup() { confirmPopup.classList.remove('show'); updateBodyLock(); _cfmCallback = null; }
cfmYes.onclick = () => { const cb = _cfmCallback; closeConfirmPopup(); if (cb) cb(); };
cfmNo.onclick = closeConfirmPopup; cfmClose.onclick = closeConfirmPopup;
confirmPopup.addEventListener('click', e => { if (e.target === confirmPopup) closeConfirmPopup(); });

// ── FILTER POPUP ──────────────────────────────────────────
const filterPopup = $('filterPopup');
const filterBtn = $('filterBtn');
filterBtn.onclick = e => { e.stopPropagation(); filterPopup.classList.toggle('show'); };
document.addEventListener('click', e => {
  if (!e.target.closest('#filterPopup') && !e.target.closest('#filterBtn'))
    filterPopup.classList.remove('show');
});

// ── ANIMATE NEW CELL ──────────────────────────────────────
function animateNewCell(id) {
  const cell = gridEl.querySelector(`.cell[data-id="${id}"]`);
  if (cell && typeof gsap !== 'undefined')
    gsap.fromTo(cell, { opacity: 0, scale: 0.85 }, { opacity: 1, scale: 1, duration: 0.4, ease: 'back.out(1.4)' });
}

// ── SORT NEWEST ───────────────────────────────────────────
const sortNewestBtn = $('sortNewestBtn');
function updateSortNewestUI() { sortNewestBtn.classList.toggle('active', sortNewest); }
sortNewestBtn.onclick = () => {
  sortNewest = !sortNewest;
  localStorage.setItem('sort_newest', sortNewest);
  updateSortNewestUI(); renderGrid();
  toast(sortNewest ? 'Sortiert: Zuletzt hinzugefügt' : 'Zufällige Anordnung');
};
updateSortNewestUI();

window.addEventListener('resize', () => {
  const r = getColRange();
  applyGridCols(Math.max(r.min, Math.min(r.max, gridCols)));
});

// ── AUTH BUTTON ───────────────────────────────────────────
$('loginBtn').onclick = handleLoginBtn;
$('loginSubmit').onclick = submitLogin;
$('loginClose').onclick = closeLoginModal;
$('loginEmail').addEventListener('keydown', e => { if (e.key === 'Enter') submitLogin(); else if (e.key === 'Escape') closeLoginModal(); });
$('loginModal').addEventListener('click', e => { if (e.target === $('loginModal')) closeLoginModal(); });

// ── WELCOME TOUR BINDINGS ─────────────────────────────────
$('welcomeNext').onclick = advanceWelcome;
$('welcomeSkip').onclick = dismissWelcome;

// ── INIT ──────────────────────────────────────────────────
async function init() {
  await initAuth();
  await loadMoodsFromDB();
  renderMoodChips();
  applyGridCols(gridCols);
  await loadItems();
  subscribeRealtime();
  // show welcome for first-time guests (not owners)
  if (!owner) showWelcomeIfNew();
}

init();
