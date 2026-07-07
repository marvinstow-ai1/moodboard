/* ============================================================================
   Tamagotchi — Marvin's Place
   ----------------------------------------------------------------------------
   Vollflächige Seite (gleiche Glas-Mechanik wie Info/Gästebuch/3D-Inventar).
   Darauf leben die Überschrift und ein spielbarer Pure-CSS-Tamagotchi aus
   Marvins Gist (ursprünglich ein Pen von Manz.dev): die CSS-Hülle liefert das
   Aussehen, dieses Script macht die Icons funktionsfähig.

   Die 8 LCD-Icons = echte Funktionen (klickbar ODER per Hardware-Buttons):
     Futter (Mahlzeit/Snack) · Licht/Schlafen · Spielen · Medizin ·
     Putzen (Kacki weg) · Status/Gewicht · Loben · Ruf-Anzeige.
   Vier Werte (Futter, Laune, Energie, Sauber) fallen mit der Zeit – auch
   offline (beim Öffnen wird bis 24 h nachsimuliert). Alles animiert in CSS,
   Zustand in localStorage. Das Tier stirbt nie, es wird höchstens krank.

   Hardware-Buttons unten:  A = Auswahl weiter · B = Bestätigen · C = Abbrechen.
   Frühere Canvas-Version: archive/tamagotchi-classic/.
   ============================================================================ */
(function () {
'use strict';

const $ = (id) => document.getElementById(id);

const page = $('tamaPage');
if (!page) return;

const gadget = page.querySelector('.tama-gadget');
if (!gadget) return;

const screenEl = gadget.querySelector('.screen');
const petEl    = gadget.querySelector('.pet');
const floor    = gadget.querySelector('.tg-floor');
const fx       = gadget.querySelector('.tg-fx');
const statusEl = gadget.querySelector('.tg-status');
const msgEl    = gadget.querySelector('.tg-msg');
const items    = Array.from(gadget.querySelectorAll('.item'));
const hwBtns   = gadget.querySelectorAll('.buttons-container .button');

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand  = (a, b) => a + Math.random() * (b - a);

/* ── Farbwechsel-Buttons (aus dem Gist) ─────────────────────────────────────*/
const COLORS_BUTTON = [
  { text: 'Rojo',     color: '#890000', buttonsColor: 'gold' },
  { text: 'Turquesa', color: '#19B1AC', buttonsColor: '#ccc' },
  { text: 'Negro',    color: '#111',    buttonsColor: '#bbb' },
  { text: 'Azul',     color: '#001F91', buttonsColor: '#ddd' },
  { text: 'Amarillo', color: '#d68111', buttonsColor: '#1836a3' },
];
const changeColor = gadget.querySelector('.change-color');
const tamagotchi  = gadget.querySelector('.tamagotchi');
if (changeColor && tamagotchi) {
  changeColor.innerHTML = COLORS_BUTTON.map((c) =>
    `<button type="button" style="--color: ${c.color}; --text-color: ${c.buttonsColor}"><span>${c.text}</span></button>`
  ).join('');
  changeColor.querySelectorAll('button').forEach((button, index) => {
    button.addEventListener('click', () => {
      tamagotchi.style.setProperty('--body-color', COLORS_BUTTON[index].color);
      tamagotchi.style.setProperty('--buttons-color', COLORS_BUTTON[index].buttonsColor);
    });
  });
}

/* ── Persistenter Zustand ──────────────────────────────────────────────────*/
const KEY = 'mb-tama-v2';
function defaults() {
  const now = Date.now();
  return {
    born: now, lastTick: now,
    hunger: 80, happy: 80, energy: 80, clean: 100,
    sleeping: false, sick: false, snacks: 0,
    poops: [],        // [{x}]  x in Prozent (12..85)
    nextPoop: 0,      // Timestamp: nach dem Essen kommt irgendwann ein Häufchen
  };
}
let S = (() => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (raw && typeof raw === 'object') return Object.assign(defaults(), raw);
  } catch (e) {}
  return defaults();
})();
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }

function ageDays() { return Math.floor((Date.now() - S.born) / 86400000); }
function weightG() { return Math.round(5 + (S.hunger / 100) * 3 + S.snacks * 0.6); }

/* ── Simulation (läuft auch die Offline-Zeit nach) ──────────────────────────*/
function simulate(from, to) {
  let t = Math.max(from, to - 24 * 3600000);          // offline max. 24 h
  while (t < to) {
    const chunk = Math.min(15 * 60000, to - t);       // 15-Minuten-Schritte
    const h = chunk / 3600000;
    if (S.sleeping) {
      S.energy = clamp(S.energy + 22 * h, 0, 100);
      S.hunger = clamp(S.hunger - 4 * h, 0, 100);
      if (S.energy >= 100) S.sleeping = false;         // ausgeschlafen → wacht auf
    } else {
      S.hunger = clamp(S.hunger - 8 * h, 0, 100);
      S.energy = clamp(S.energy - 5 * h, 0, 100);
      S.happy  = clamp(S.happy - (5 + S.poops.length * 2 + (S.sick ? 5 : 0)) * h, 0, 100);
    }
    S.clean  = clamp(S.clean - (2 + S.poops.length * 6) * h, 0, 100);
    S.snacks = Math.max(0, S.snacks - 0.15 * h);
    if (S.nextPoop && t + chunk >= S.nextPoop && !S.sleeping && S.poops.length < 4) {
      S.poops.push({ x: Math.round(rand(12, 85)) });
      S.clean = clamp(S.clean - 12, 0, 100);
      S.nextPoop = 0;
    }
    if (!S.sick) {
      const risk = (S.hunger <= 5 ? .12 : 0) + (S.clean <= 8 ? .12 : 0) + (S.snacks >= 6 ? .06 : 0);
      if (risk && Math.random() < risk * h * 4) S.sick = true;
    }
    t += chunk;
  }
  S.lastTick = to;
}

/* ── Bedürfnis-Check (steuert Ruf-Anzeige + Hinweise) ───────────────────────*/
function need() {
  if (S.sick)                               return 'KRANK!';
  if (S.clean < 25 || S.poops.length >= 2)  return 'PUTZEN!';
  if (S.hunger < 25)                        return 'HUNGER!';
  if (!S.sleeping && S.energy < 15)         return 'MUEDE!';
  if (S.happy < 20)                         return 'SPIELEN!';
  return null;
}

/* ── FX: Partikel + Meldung ────────────────────────────────────────────────*/
function spawn(type, n) {
  for (let i = 0; i < n; i++) {
    const el = document.createElement(type === 'zzz' ? 'span' : 'div');
    el.className = 'tg-p ' + type;
    if (type === 'zzz') el.textContent = 'Z';
    el.style.left   = (28 + Math.random() * 48) + '%';
    el.style.bottom = (18 + Math.random() * 16) + 'px';
    el.style.animationDelay = (Math.random() * 0.22).toFixed(2) + 's';
    fx.appendChild(el);
    const kill = () => el.remove();
    el.addEventListener('animationend', kill);
    setTimeout(kill, 3000);
  }
}
let msgTimer = null;
function showMsg(text, ms = 1800) {
  msgEl.textContent = text;
  msgEl.classList.add('show');
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => msgEl.classList.remove('show'), ms);
}

/* ── Busy-Pose (Fressen/Spielen/Heilen …) ──────────────────────────────────*/
let busy = false, busyTimer = null;
function setBusy(dur, pose) {
  busy = true;
  screenEl.classList.add('busy');
  if (pose) petEl.classList.add(pose);
  clearTimeout(busyTimer);
  busyTimer = setTimeout(() => {
    busy = false;
    screenEl.classList.remove('busy');
    petEl.classList.remove('eat', 'play', 'cheer');
    render();
  }, dur);
}

/* ── Rendering (spiegelt den Zustand ins LCD) ──────────────────────────────*/
let sweeping = false;
function renderFloor() {
  if (sweeping) return;
  if (floor.childElementCount === S.poops.length) return;   // nur bei Änderung neu bauen
  floor.textContent = '';
  S.poops.forEach((p) => {
    const el = document.createElement('div');
    el.className = 'tg-poop';
    el.style.left = p.x + '%';
    floor.appendChild(el);
  });
}
function render() {
  screenEl.classList.toggle('sleeping', S.sleeping);
  screenEl.classList.toggle('sick', S.sick && !S.sleeping);
  renderFloor();
  const n = need();
  const att = items.find((el) => el.dataset.fn === 'attention');
  if (att) att.classList.toggle('calling', !!n && !S.sleeping);
  if (!statusEl.hidden) buildStatus();
}

/* ── Aktionen ──────────────────────────────────────────────────────────────*/
function feed() {
  if (busy || mode !== 'idle') return;
  if (S.sleeping) return showMsg('SCHLAEFT...');
  if (S.hunger >= 96) return showMsg('SCHON SATT!');
  S.hunger = clamp(S.hunger + 30, 0, 100);
  S.clean  = clamp(S.clean - 3, 0, 100);
  S.nextPoop = Date.now() + rand(50, 140) * 60000;
  setBusy(2200, 'eat'); spawn('crumb', 5);
  showMsg('MJAM MJAM!'); render(); save();
}
function play() {
  if (busy || mode !== 'idle') return;
  if (S.sleeping) return showMsg('SCHLAEFT...');
  if (S.energy < 12) return showMsg('ZU MUEDE...');
  S.happy  = clamp(S.happy + 16, 0, 100);
  S.energy = clamp(S.energy - 12, 0, 100);
  S.hunger = clamp(S.hunger - 5, 0, 100);
  setBusy(2600, 'play'); spawn('heart', 5);
  showMsg('JUHUU!'); render(); save();
}
function toggleLight() {
  S.sleeping = !S.sleeping;
  if (S.sleeping) { fx.textContent = ''; showMsg('GUTE NACHT'); }
  else            { showMsg(S.energy >= 90 ? 'AUSGERUHT!' : 'GUTEN MORGEN'); }
  render(); save();
}
function medicine() {
  if (busy || mode !== 'idle') return;
  if (!S.sick) return showMsg('ALLES GUT!');
  S.sick = false;
  S.happy = clamp(S.happy - 4, 0, 100);
  S.snacks = 0;
  setBusy(1600, 'cheer'); spawn('spark', 7);
  showMsg('WIEDER FIT!'); render(); save();
}
function clean() {
  if (busy || mode !== 'idle') return;
  if (!S.poops.length && S.clean > 95) return showMsg('BLITZBLANK!');
  S.poops = []; S.clean = 100; S.nextPoop = 0;
  sweeping = true;
  const broom = document.createElement('div');
  broom.className = 'tg-broom';
  petEl.parentNode.appendChild(broom);
  broom.addEventListener('animationend', () => broom.remove());
  floor.querySelectorAll('.tg-poop').forEach((p) => {
    p.classList.add('clearing');
    p.addEventListener('animationend', () => p.remove());
  });
  spawn('spark', 5);
  setBusy(1300, null);
  showMsg('SAUBER!');
  setTimeout(() => { sweeping = false; render(); }, 550);
  save();
}
function toggleStatus() {
  if (statusEl.hidden) { buildStatus(); statusEl.hidden = false; mode = 'status'; }
  else closeStatus();
}
let lastPraise = 0;
function praise() {                                    // "Loben / Streicheln"
  if (busy || mode !== 'idle') return;
  if (S.sleeping) return showMsg('SCHLAEFT...');
  if (S.sick)     return showMsg('BRAUCHT MEDIZIN');
  if (Date.now() - lastPraise < 6000) return showMsg('SCHON GELOBT');
  lastPraise = Date.now();
  S.happy = clamp(S.happy + 6, 0, 100);
  setBusy(1400, 'cheer'); spawn('heart', 3);
  showMsg('BRAV!'); render(); save();
}
function showNeed() {
  const n = need();
  showMsg(n ? n : 'ALLES OK!');
}

const FN = {
  feed, light: toggleLight, play, med: medicine,
  clean, status: toggleStatus, scold: praise, attention: showNeed,
};
function runFn(fn) { (FN[fn] || (() => {}))(); }

function closeStatus() { statusEl.hidden = true; if (mode === 'status') mode = 'idle'; }

/* ── Status-/Gewicht-Panel ─────────────────────────────────────────────────*/
const BARS = [['hunger', 'FUT'], ['happy', 'LAU'], ['energy', 'ENE'], ['clean', 'SAU']];
function buildStatus() {
  const rows = BARS.map(([k, label]) => {
    const v = Math.round(S[k]);
    const on = Math.round(v / 12.5);                   // 8 Segmente
    let segs = '';
    for (let i = 0; i < 8; i++) segs += `<i class="${i < on ? 'on' : ''}"></i>`;
    return `<div class="tg-st-row${v < 25 ? ' low' : ''}"><b>${label}</b><span class="tg-st-bar">${segs}</span></div>`;
  }).join('');
  statusEl.innerHTML =
    `<div class="tg-st-head">STATUS</div>${rows}` +
    `<div class="tg-st-foot">GEW ${weightG()}g · TAG ${ageDays() + 1}${S.sick ? ' · KRANK' : ''}</div>`;
}

/* ── Auswahl per Hardware-Buttons ──────────────────────────────────────────*/
let mode = 'idle';         // 'idle' | 'status'
let selIndex = -1;         // ausgewähltes Icon
function updateSel() {
  items.forEach((el, i) => el.classList.toggle('sel', i === selIndex));
}
function flash(el) {
  el.classList.add('act');
  setTimeout(() => el.classList.remove('act'), 320);
}
function btnA() {                                       // Auswahl weiter (durchswipen)
  if (mode === 'status') return;
  selIndex = (selIndex + 1) % items.length;
  updateSel();
}
function btnB() {                                       // Bestätigen
  if (mode === 'status') { closeStatus(); return; }
  if (selIndex < 0) { selIndex = 0; updateSel(); return; }
  const el = items[selIndex]; flash(el); runFn(el.dataset.fn);
}
function btnC() {                                       // Abbrechen / zurück
  if (mode !== 'idle') { closeStatus(); return; }
  selIndex = -1; updateSel();
}
const BTN = { a: btnA, b: btnB, c: btnC };
hwBtns.forEach((b) => {
  const run = () => (BTN[b.dataset.btn] || (() => {}))();
  b.addEventListener('click', run);
  b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); run(); } });
});

// Die Icons selbst sind bewusst NICHT klickbar – gesteuert wird ausschliesslich
// über die drei Hardware-Buttons unten (A/B/C).

/* ── Lauf-Schleife (nur solange die Seite offen ist) ───────────────────────*/
let tickTimer = null;
function tick() {
  simulate(S.lastTick, Date.now());
  if (S.sleeping && Math.random() < 0.5) spawn('zzz', 1);
  render(); save();
}
function start() { if (tickTimer) return; tickTimer = setInterval(tick, 1500); }
function stop()  { clearInterval(tickTimer); tickTimer = null; }

/* ── Seite öffnen / schließen ──────────────────────────────────────────────*/
let animTimer = null;
function markAnimating() {
  page.classList.add('is-animating');
  clearTimeout(animTimer);
  animTimer = setTimeout(() => page.classList.remove('is-animating'), 320);
}
function openPage() {
  window.MB?.closeOtherPopups?.();
  window.MB?.closeInfoPage?.();
  window.MB?.closeGuestbook?.();
  window.MB?.closeModels?.();
  markAnimating();
  page.classList.add('show');
  page.setAttribute('aria-hidden', 'false');
  window.MB?.updateBodyLock?.();
  window.MB?.kickAutoplay?.();
  simulate(S.lastTick, Date.now());                    // Offline-Zeit nachziehen
  closeStatus(); selIndex = -1; updateSel();
  render(); save();
  start();
}
function closePage() {
  markAnimating();
  page.classList.remove('show');
  page.setAttribute('aria-hidden', 'true');
  stop(); save();
  window.MB?.updateBodyLock?.();
}

// header-menu.js schließt Seiten direkt über die CSS-Klasse – daran vorbei
// würde der Tick weiterlaufen. Deshalb absichern: verschwindet .show, stoppen.
new MutationObserver(() => {
  if (!page.classList.contains('show') && tickTimer) { stop(); save(); }
}).observe(page, { attributes: true, attributeFilter: ['class'] });

document.addEventListener('visibilitychange', () => {
  if (document.hidden) { save(); stop(); }
  else if (page.classList.contains('show')) { simulate(S.lastTick, Date.now()); render(); start(); }
});
window.addEventListener('pagehide', save);

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !page.classList.contains('show')) return;
  if (mode !== 'idle') { closeStatus(); return; }
  closePage();
});

render();

window.MB = Object.assign(window.MB || {}, {
  openTama: openPage,
  closeTama: closePage,
});
})();
