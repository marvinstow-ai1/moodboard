/* ============================================================================
   Tamagotchi — Marvin's Place
   ----------------------------------------------------------------------------
   Vollflächige Seite (gleiche Glas-Mechanik wie Info/Gästebuch/3D-Inventar)
   mit einem klassischen Tamagotchi: ein pixeliger Charakter lebt in einem
   16-Bit-Wohnzimmer (Canvas, 160×144 wie ein Game Boy, hochskaliert mit
   image-rendering:pixelated). Kein Sprite-Sheet, keine Assets – Zimmer und
   Figur werden komplett prozedural Pixel für Pixel gezeichnet.

   Funktionen wie damals: Füttern, Snack, Spielen, Licht (Schlafen), Putzen
   (Häufchen!), Medizin bei Krankheit. Vier Werte (Futter, Laune, Energie,
   Sauberkeit) fallen mit der Zeit – auch offline: beim Öffnen wird die
   verstrichene Zeit nachsimuliert (max. 24 h, damit nichts hoffnungslos ist).
   Zustand liegt in localStorage; das Tier stirbt nie, es wird höchstens krank.

   Performance: die Render-Schleife läuft NUR solange die Seite offen ist
   (openPage startet sie, closePage stoppt sie), der Canvas ist winzig.
   Styles in css/tamagotchi.css, Markup in index.html.
   ============================================================================ */
(function () {
'use strict';

const $ = (id) => document.getElementById(id);

const page   = $('tamaPage');
const canvas = $('tamaCanvas');
if (!page || !canvas) return;
let ctx = canvas.getContext('2d');

const W = 160, H = 144;
const GROUND = 124;                 // Boden-Linie, auf der die Figur steht
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand  = (a, b) => a + Math.random() * (b - a);

/* ── Persistenter Zustand ────────────────────────────────────────────────── */
const KEY = 'mb-tama-v1';
function defaults() {
  const now = Date.now();
  return {
    name: '', born: now, lastTick: now,
    hunger: 80, happy: 80, energy: 80, clean: 100,
    sleeping: false, sick: false, snacks: 0,
    poops: [],            // [{x}] auf dem Boden
    nextPoop: 0,          // Timestamp: nach dem Essen kommt irgendwann eins
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

/* ── Alter & Entwicklungsstufe ───────────────────────────────────────────── */
const STAGE_NAME = ['Baby', 'Kind', 'Erwachsen'];
const STAGE_SIZE = [[7, 6], [9, 8], [11, 9]];      // Körper-Radius rx/ry
function ageDays() { return Math.floor((Date.now() - S.born) / 86400000); }
function stage()   { const d = ageDays(); return d < 2 ? 0 : d < 6 ? 1 : 2; }
function mood() {
  if (S.sick) return 'sick';
  const avg = (S.hunger + S.happy + S.energy + S.clean) / 4;
  return avg < 30 ? 'sad' : avg > 70 ? 'great' : 'ok';
}

/* ── Simulation (läuft auch die Offline-Zeit nach) ───────────────────────── */
function simulate(from, to) {
  let t = Math.max(from, to - 24 * 3600000);      // offline max. 24 h nachziehen
  while (t < to) {
    const chunk = Math.min(15 * 60000, to - t);   // 15-Minuten-Schritte
    const h = chunk / 3600000;
    if (S.sleeping) {
      S.energy = clamp(S.energy + 22 * h, 0, 100);
      S.hunger = clamp(S.hunger - 4 * h, 0, 100);
      if (S.energy >= 100) S.sleeping = false;    // ausgeschlafen → wacht auf
    } else {
      S.hunger = clamp(S.hunger - 8 * h, 0, 100);
      S.energy = clamp(S.energy - 5 * h, 0, 100);
      S.happy  = clamp(S.happy - (5 + S.poops.length * 2 + (S.sick ? 5 : 0)) * h, 0, 100);
    }
    S.clean  = clamp(S.clean - (2 + S.poops.length * 6) * h, 0, 100);
    S.snacks = Math.max(0, S.snacks - 0.15 * h);
    // Nach dem Essen kommt irgendwann ein Häufchen (nicht im Schlaf).
    if (S.nextPoop && t + chunk >= S.nextPoop && !S.sleeping && S.poops.length < 4) {
      S.poops.push({ x: Math.round(rand(22, 138)) });
      S.clean = clamp(S.clean - 12, 0, 100);
      S.nextPoop = 0;
    }
    // Vernachlässigung macht krank (nie tot).
    if (!S.sick) {
      const risk = (S.hunger <= 5 ? .12 : 0) + (S.clean <= 8 ? .12 : 0) + (S.snacks >= 6 ? .06 : 0);
      if (risk && Math.random() < risk * h * 4) S.sick = true;
    }
    t += chunk;
  }
  S.lastTick = to;
}

/* ── Laufzeit-Zustand (nicht persistiert) ────────────────────────────────── */
const pet = {
  x: 80, dir: 1, target: 80, moving: false,
  anim: null,                         // {type,t,dur}
  nextWander: 0, nextBlink: 0, blinkUntil: 0,
};
let parts = [];                       // Partikel: {type,x,y,vx,vy,life}
let nextZ = 0, nextNeedMsg = 0;

/* ── Pixel-Zeichen-Helfer ────────────────────────────────────────────────── */
function px(x, y, w, h, col) { ctx.fillStyle = col; ctx.fillRect(x | 0, y | 0, w, h); }
function pxEllipse(cx, cy, rx, ry, col) {
  ctx.fillStyle = col;
  for (let y = -ry; y <= ry; y++) {
    const k = 1 - (y * y) / ((ry + .5) * (ry + .5));
    if (k <= 0) continue;
    const w = Math.round(rx * Math.sqrt(k));
    ctx.fillRect((cx - w) | 0, (cy + y) | 0, w * 2 + 1, 1);
  }
}

/* ── Zimmer (16-Bit-Zuhause) ─────────────────────────────────────────────── */
function skyPhase() {
  const h = new Date().getHours() + new Date().getMinutes() / 60;
  if (h >= 21 || h < 6) return { top: '#0b1030', bot: '#262450', night: true,  warm: false };
  if (h < 8)            return { top: '#7a5f9e', bot: '#f0a883', night: false, warm: true  };
  if (h < 17)           return { top: '#69b7e8', bot: '#bfe6f5', night: false, warm: false };
  return                       { top: '#4f5aa8', bot: '#e8875f', night: false, warm: true  };
}

function drawRoom(t) {
  // Wand mit Tapeten-Punkten + Sockelleiste
  px(0, 0, W, 96, '#ad93c4');
  ctx.fillStyle = '#a189b8';
  for (let y = 8; y < 84; y += 12)
    for (let x = ((y / 12) % 2) ? 6 : 12; x < W; x += 12) ctx.fillRect(x, y, 2, 2);
  px(0, 84, W, 8, '#8a6ca8');
  px(0, 84, W, 1, '#6d5488');
  px(0, 91, W, 1, '#6d5488');

  // Fenster rechts mit Tag/Nacht-Himmel
  const sky = skyPhase();
  px(98, 16, 46, 42, '#5c4030');                       // Rahmen
  px(101, 19, 40, 36, sky.top);
  const g = ctx.createLinearGradient(0, 19, 0, 55);
  g.addColorStop(0, sky.top); g.addColorStop(1, sky.bot);
  ctx.fillStyle = g; ctx.fillRect(101, 19, 40, 36);
  if (sky.night) {                                     // Sterne + Mond
    ctx.fillStyle = '#e8ecff';
    [[106,24],[115,30],[124,22],[133,34],[110,42],[130,45],[121,38]]
      .forEach(([x, y]) => ctx.fillRect(x, y, 1, 1));
    pxEllipse(130, 27, 4, 4, '#f4f2d8');
    pxEllipse(128, 26, 3, 3, sky.top);
  } else {                                             // Sonne + Wölkchen
    pxEllipse(131, 27, 4, 4, '#ffd95c');
    ctx.save();                                        // Wolke bleibt im Fenster
    ctx.beginPath(); ctx.rect(101, 19, 40, 36); ctx.clip();
    const cx2 = 101 + ((t / 260) % 64) - 12;
    pxEllipse(cx2, 40, 6, 2, 'rgba(255,255,255,.85)');
    pxEllipse(cx2 + 5, 42, 5, 2, 'rgba(255,255,255,.7)');
    ctx.restore();
  }
  px(98, 35, 46, 2, '#5c4030');                        // Sprossen
  px(120, 16, 2, 42, '#5c4030');
  px(96, 56, 50, 3, '#6d4a36');                        // Fensterbank

  // Bilderrahmen links (Mini-Berglandschaft)
  px(24, 24, 22, 17, '#c8a05f');
  px(26, 26, 18, 13, '#8fd0e8');
  ctx.fillStyle = '#5b8a68';
  for (let i = 0; i < 8; i++) ctx.fillRect(29 + i, 38 - i, 1, i + 1);
  for (let i = 0; i < 6; i++) ctx.fillRect(37 + i, 38 - (5 - i), 1, 6 - i);
  px(40, 28, 3, 3, '#fff6c8');

  // Boden: Dielen mit Fugen
  px(0, 96, W, H - 96, '#c89a5f');
  ctx.fillStyle = '#a87b4b';
  for (let y = 104; y < H; y += 10) ctx.fillRect(0, y, W, 1);
  ctx.fillStyle = '#b3854c';
  for (let y = 96; y < H; y += 10)
    for (let x = ((y / 10) % 2) ? 20 : 50; x < W; x += 60) ctx.fillRect(x, y + 1, 1, 9);

  // Teppich in der Mitte
  pxEllipse(80, 122, 36, 10, '#e8d9a8');
  pxEllipse(80, 122, 33, 8, '#4fa4a0');
  pxEllipse(80, 122, 24, 5, '#3f8a86');

  // Topfpflanze links auf dem Boden
  pxEllipse(18, 92, 7, 3, '#3d7f46');
  pxEllipse(14, 88, 5, 4, '#4e9e58');
  pxEllipse(23, 87, 5, 4, '#4e9e58');
  pxEllipse(18, 84, 5, 4, '#5cb468');
  px(13, 95, 11, 3, '#b3603f');
  px(12, 94, 13, 2, '#8a4a30');
  px(14, 98, 9, 4, '#9a4f34');
}

/* ── Requisiten ──────────────────────────────────────────────────────────── */
function drawPoop(x, y) {
  px(x - 3, y - 2, 7, 2, '#8a5a34');
  px(x - 2, y - 4, 5, 2, '#9a6a40');
  px(x - 1, y - 6, 2, 2, '#8a5a34');
  px(x - 3, y, 7, 1, '#6d4426');
}
function drawBowl(x, bites) {
  pxEllipse(x, GROUND - 2, 8, 3, '#d8d8e2');
  pxEllipse(x, GROUND - 3, 7, 2, '#4a4a58');
  if (bites < 3) {                                    // Futter schrumpft in 3 Bissen
    const r = 5 - bites * 1.5;
    pxEllipse(x, GROUND - 5, Math.max(1, Math.round(r)), 2, '#e8a04f');
    px(x - 1, GROUND - 7, 2, 1, '#c8763a');
  }
}
function drawBall(x, y) {
  pxEllipse(x, y, 3, 3, '#20203a');
  pxEllipse(x, y, 2, 2, '#e85d5d');
  px(x - 1, y - 1, 1, 1, '#ffffff');
}
function drawBroom(x) {
  px(x, GROUND - 26, 2, 20, '#8a6136');
  px(x - 3, GROUND - 6, 8, 3, '#c8a05f');
  px(x - 3, GROUND - 3, 8, 4, '#e8c878');
  px(x - 3, GROUND + 1, 8, 1, '#b39448');
}
function drawHeart(x, y, col) {
  px(x, y, 2, 1, col); px(x + 3, y, 2, 1, col);
  px(x, y + 1, 5, 1, col); px(x + 1, y + 2, 3, 1, col); px(x + 2, y + 3, 1, 1, col);
}
function drawZ(x, y, col) { px(x, y, 3, 1, col); px(x + 1, y + 1, 1, 1, col); px(x, y + 2, 3, 1, col); }
function drawSpark(x, y, col) { px(x, y - 1, 1, 3, col); px(x - 1, y, 3, 1, col); }

/* ── Die Figur (prozedurale Pixel-Art) ───────────────────────────────────── */
function drawPet(t) {
  const [rx0, ry0] = STAGE_SIZE[stage()];
  let rx = rx0, ry = ry0;
  const a = pet.anim;
  let lift = 0, leanX = 0;
  let eyes = 'open', mouth = 'idle';

  if (S.sleeping) {
    ry = Math.max(4, Math.round(ry * 0.7)); rx += 2; eyes = 'closed';
  } else if (a) {
    const p = a.t / a.dur;
    if (a.type === 'eat')   { leanX = -2; mouth = (Math.floor(a.t / 240) % 2) ? 'open' : 'idle'; }
    if (a.type === 'play')  { lift = Math.abs(Math.sin(p * Math.PI * 5)) * 10; eyes = 'happy'; mouth = 'smile'; }
    if (a.type === 'pet')   { eyes = 'happy'; mouth = 'smile'; }
    if (a.type === 'heal')  { eyes = 'closed'; }
  } else {
    const m = mood();
    if (S.sick)            { eyes = 'sick'; mouth = 'sad'; }
    else if (m === 'sad')  { mouth = 'sad'; }
    else if (m === 'great'){ mouth = 'smile'; }
    if (pet.moving) lift = Math.abs(Math.sin(t / 130)) * 3;
  }
  if (eyes === 'open' && t < pet.blinkUntil) eyes = 'closed';

  const breathe = S.sleeping ? Math.sin(t / 700) * 0.8 : Math.sin(t / 460) * 0.5;
  const sy = Math.round(ry + breathe);
  const cx = Math.round(pet.x + leanX);
  const cy = GROUND - sy - Math.round(lift);

  const OUT   = '#20203a';
  const BODY  = S.sick ? '#a9c9b4' : '#8be8c0';
  const SHADE = S.sick ? '#84ab92' : '#5ecfa0';

  // Bodenschatten
  pxEllipse(Math.round(pet.x), GROUND + 1, rx - 1, 2, 'rgba(0,0,0,.22)');

  // Ohren (kleine Dreiecke)
  const earY = cy - sy - 4;
  for (const ex of [cx - rx + 3, cx + rx - 3]) {
    for (let i = 0; i < 5; i++) px(ex - Math.min(i, 2), earY + i, Math.min(i, 2) * 2 + 1, 1, OUT);
    for (let i = 1; i < 4; i++) px(ex - Math.min(i - 1, 1), earY + i + 1, Math.min(i - 1, 1) * 2 + 1, 1, BODY);
  }

  // Körper: Outline → Fläche → Bauch-Schattierung
  pxEllipse(cx, cy, rx + 1, sy + 1, OUT);
  pxEllipse(cx, cy, rx, sy, BODY);
  pxEllipse(cx, cy + sy - 2, rx - 3, 2, SHADE);

  // Gesicht (schaut leicht in Laufrichtung)
  const fx = cx + (pet.dir < 0 ? -1 : 1);
  const eyeY = cy - 2;
  for (const ex of [fx - 5, fx + 3]) {
    if (eyes === 'open')        { px(ex, eyeY, 2, 3, OUT); px(ex, eyeY, 1, 1, '#ffffff'); }
    else if (eyes === 'closed')   px(ex - 1, eyeY + 1, 3, 1, OUT);
    else if (eyes === 'happy')  { px(ex - 1, eyeY + 1, 1, 1, OUT); px(ex, eyeY, 1, 1, OUT); px(ex + 1, eyeY + 1, 1, 1, OUT); }
    else if (eyes === 'sick')   { px(ex - 1, eyeY, 1, 1, OUT); px(ex, eyeY + 1, 1, 1, OUT); px(ex + 1, eyeY, 1, 1, OUT); }
  }
  // Wangen
  if (!S.sick && (eyes === 'happy' || mood() === 'great') && !S.sleeping) {
    px(fx - 7, cy + 1, 2, 1, '#f7a8c4'); px(fx + 5, cy + 1, 2, 1, '#f7a8c4');
  }
  // Mund
  const my = cy + 2;
  if (mouth === 'idle')       px(fx - 1, my + 1, 2, 1, OUT);
  else if (mouth === 'open') { px(fx - 2, my, 4, 3, OUT); px(fx - 1, my + 1, 2, 1, '#e85d5d'); }
  else if (mouth === 'smile'){ px(fx - 2, my, 1, 1, OUT); px(fx - 1, my + 1, 2, 1, OUT); px(fx + 1, my, 1, 1, OUT); }
  else if (mouth === 'sad')  { px(fx - 2, my + 1, 1, 1, OUT); px(fx - 1, my, 2, 1, OUT); px(fx + 1, my + 1, 1, 1, OUT); }

  // Schweißtropfen, wenn krank
  if (S.sick && !S.sleeping && Math.floor(t / 600) % 2) {
    px(cx + rx, cy - sy + 1, 2, 3, '#7ec8f0'); px(cx + rx, cy - sy, 1, 1, '#7ec8f0');
  }
  // "!" wenn etwas dringend ist
  if (!S.sleeping && !a && (S.hunger < 15 || S.clean < 15) && Math.floor(t / 500) % 2) {
    px(cx - 1, cy - sy - 14, 2, 5, '#e85d5d'); px(cx - 1, cy - sy - 7, 2, 2, '#e85d5d');
  }
}

/* ── Szene rendern ───────────────────────────────────────────────────────── */
function renderScene(t, preview) {
  drawRoom(t);

  const a = pet.anim;
  const cleanX = a && a.type === 'clean' ? 8 + (a.t / a.dur) * (W - 16) : -1;
  for (const p of S.poops) {
    if (cleanX >= 0 && p.x < cleanX) continue;        // Besen hat es schon weggefegt
    drawPoop(p.x, GROUND + 2);
  }
  if (a && a.type === 'eat') drawBowl(clamp(Math.round(pet.x) - 18, 10, W - 12), Math.floor((a.t / a.dur) * 3));
  if (a && a.type === 'play') {
    const p = a.t / a.dur;
    drawBall(clamp(Math.round(pet.x) + 16, 8, W - 8), GROUND - 3 - Math.abs(Math.sin(p * Math.PI * 5 + 1.2)) * 14);
  }

  drawPet(t);
  if (a && a.type === 'clean') drawBroom(Math.round(cleanX));

  if (!preview) {
    for (const p of parts) {
      if (p.type === 'heart') drawHeart(p.x | 0, p.y | 0, '#f06292');
      else if (p.type === 'z') drawZ(p.x | 0, p.y | 0, '#dfe6ff');
      else drawSpark(p.x | 0, p.y | 0, '#fff6c8');
    }
  }

  // Licht aus: Zimmer abdunkeln (Zzz bleiben sichtbar)
  if (S.sleeping) {
    px(0, 0, W, H, 'rgba(8,10,40,.55)');
    for (const p of parts) if (p.type === 'z') drawZ(p.x | 0, p.y | 0, '#dfe6ff');
  } else if (skyPhase().night) {
    px(0, 0, W, H, 'rgba(255,190,110,.08)');          // warmes Lampenlicht am Abend
  }
}

/* ── Laufzeit-Schritt (Bewegung, Partikel, Animationen) ──────────────────── */
function step(dt, t) {
  if (t > pet.nextBlink) { pet.blinkUntil = t + 140; pet.nextBlink = t + rand(2400, 5200); }

  if (pet.anim) {
    pet.anim.t += dt;
    if (pet.anim.t >= pet.anim.dur) { onAnimEnd(pet.anim); pet.anim = null; }
  } else if (!S.sleeping) {
    if (t > pet.nextWander) { pet.target = rand(30, 130); pet.nextWander = t + rand(2800, 7000); }
    const dx = pet.target - pet.x;
    if (Math.abs(dx) > 2) { pet.x += Math.sign(dx) * dt * 0.018; pet.dir = Math.sign(dx); pet.moving = true; }
    else pet.moving = false;
  } else {
    pet.moving = false;
    if (t > nextZ) { parts.push({ type: 'z', x: pet.x + 10, y: GROUND - 26, vx: 0.004, vy: -0.012, life: 1900 }); nextZ = t + 950; }
  }

  for (const p of parts) { p.x += (p.vx || 0) * dt; p.y += p.vy * dt; p.life -= dt; }
  parts = parts.filter((p) => p.life > 0);
}

function spawnHearts(n) {
  for (let i = 0; i < n; i++)
    parts.push({ type: 'heart', x: pet.x + rand(-14, 12), y: GROUND - 24 - rand(0, 10), vx: rand(-0.004, 0.004), vy: -0.016, life: rand(900, 1500) });
}
function spawnSparks(n) {
  for (let i = 0; i < n; i++)
    parts.push({ type: 'spark', x: rand(16, 144), y: rand(100, 132), vx: 0, vy: -0.006, life: rand(500, 1100) });
}
function onAnimEnd(a) {
  if (a.type === 'eat' || a.type === 'pet') spawnHearts(a.type === 'eat' ? 3 : 4);
  if (a.type === 'play') spawnHearts(5);
  if (a.type === 'clean') { S.poops = []; S.clean = 100; spawnSparks(10); renderStats(); save(); }
  if (a.type === 'heal') { spawnHearts(4); }
  updateUI();
}

/* ── UI: Meldung, Werte-Balken, Buttons ──────────────────────────────────── */
let _msgTimer = 0;
function showMsg(text, ms = 2400) {
  const el = $('tamaMsg');
  if (!el) return;
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(_msgTimer);
  _msgTimer = setTimeout(() => el.classList.remove('show'), ms);
}

const BARS = [['hunger', 'Futter'], ['happy', 'Laune'], ['energy', 'Energie'], ['clean', 'Sauber']];
function buildBars() {
  const host = $('tamaBars');
  if (!host || host.children.length) return;
  for (const [key, label] of BARS) {
    const row = document.createElement('div');
    row.className = 'tama-bar';
    row.dataset.stat = key;
    row.innerHTML = '<span class="tb-label">' + label + '</span><span class="tb-segs">' + '<i></i>'.repeat(10) + '</span>';
    host.appendChild(row);
  }
}
function renderStats() {
  document.querySelectorAll('#tamaBars .tama-bar').forEach((row) => {
    const v = S[row.dataset.stat];
    const n = Math.round(v / 10);
    Array.from(row.querySelectorAll('.tb-segs i')).forEach((seg, i) => seg.classList.toggle('on', i < n));
    row.classList.toggle('low', v < 25);
  });
  const st = $('tamaStatusline');
  if (st) st.textContent =
    (S.name || '???') + ' · ' + STAGE_NAME[stage()] + ' · Tag ' + (ageDays() + 1) + (S.sick ? ' · KRANK' : '');
}
function icon(act) { return document.querySelector('.tama-ic[data-act="' + act + '"]'); }
function updateUI() {
  icon('med')?.classList.toggle('is-needed', S.sick);
  icon('clean')?.classList.toggle('is-needed', S.poops.length > 0);
  icon('feed')?.classList.toggle('is-needed', S.hunger < 25);
  icon('light')?.classList.toggle('is-off', S.sleeping);   // Glühbirne wirkt „aus"
}

/* ── Aktionen ────────────────────────────────────────────────────────────── */
function busy() { return !!pet.anim; }
function act(type) {
  if (!S.name) { openNameDlg(); return; }
  if (busy() && type !== 'light') return;

  const asleep = S.sleeping;
  switch (type) {
    case 'feed':
      if (asleep) return showMsg('PSST… ER SCHLÄFT');
      if (S.hunger >= 96) return showMsg('SCHON PAPPSATT!');
      S.hunger = clamp(S.hunger + 30, 0, 100);
      S.clean  = clamp(S.clean - 3, 0, 100);
      S.nextPoop = Date.now() + rand(50, 140) * 60000;
      pet.anim = { type: 'eat', t: 0, dur: 2600 };
      showMsg('MJAM MJAM…');
      break;
    case 'snack':
      if (asleep) return showMsg('PSST… ER SCHLÄFT');
      if (S.hunger >= 98) return showMsg('SCHON PAPPSATT!');
      S.hunger = clamp(S.hunger + 8, 0, 100);
      S.happy  = clamp(S.happy + 10, 0, 100);
      S.snacks += 1;
      pet.anim = { type: 'eat', t: 0, dur: 1500 };
      showMsg(S.snacks >= 5 ? 'LECKER! ABER NICHT ZU VIEL…' : 'LECKER!');
      break;
    case 'play':
      if (asleep) return showMsg('PSST… ER SCHLÄFT');
      if (S.energy < 12) return showMsg('ZU MÜDE ZUM SPIELEN…');
      S.happy  = clamp(S.happy + 16, 0, 100);
      S.energy = clamp(S.energy - 12, 0, 100);
      S.hunger = clamp(S.hunger - 5, 0, 100);
      pet.anim = { type: 'play', t: 0, dur: 3000 };
      showMsg('JUHUU!');
      break;
    case 'light':
      S.sleeping = !S.sleeping;
      pet.anim = null;
      if (S.sleeping) { parts = []; showMsg('GUTE NACHT ✦'); }
      else showMsg(S.energy >= 90 ? 'AUSGESCHLAFEN!' : 'GUTEN MORGEN!');
      break;
    case 'clean':
      if (!S.poops.length && S.clean > 95) return showMsg('ALLES BLITZBLANK!');
      pet.anim = { type: 'clean', t: 0, dur: 1500 };
      showMsg('SAUBER MACHEN…');
      break;
    case 'med':
      if (!S.sick) return showMsg('ALLES GESUND!');
      S.sick = false;
      S.happy = clamp(S.happy - 4, 0, 100);
      S.snacks = 0;
      pet.anim = { type: 'heal', t: 0, dur: 1600 };
      showMsg('WIEDER FIT!');
      break;
  }
  renderStats(); updateUI(); save();
}
/* ── Menü-Cursor + die drei physischen Knöpfe ────────────────────────────── */
const icons = Array.from(document.querySelectorAll('.tama-ic'));
let cursor = 0;
function renderCursor() { icons.forEach((el, i) => el.classList.toggle('sel', i === cursor)); }
function moveCursor(d) {
  if (!icons.length) return;
  cursor = (cursor + d + icons.length) % icons.length;
  renderCursor();
}
renderCursor();

// Symbol direkt antippen: Cursor dorthin setzen und ausführen.
document.querySelectorAll('.tama-icons').forEach((strip) => {
  strip.addEventListener('click', (e) => {
    const b = e.target.closest('.tama-ic');
    if (!b) return;
    const i = icons.indexOf(b);
    if (i >= 0) { cursor = i; renderCursor(); }
    act(b.dataset.act);
  });
});

// Knöpfe: ◀ blättern · ● bestätigen · ▶ blättern.
$('tamaButtons')?.addEventListener('click', (e) => {
  const b = e.target.closest('.tama-hw');
  if (!b) return;
  const dlg = $('tamaNameDlg');
  if (dlg && !dlg.hidden) { if (b.dataset.nav === 'ok') submitName(); return; }
  if (b.dataset.nav === 'prev')      moveCursor(-1);
  else if (b.dataset.nav === 'next') moveCursor(1);
  else if (b.dataset.nav === 'ok')   act(icons[cursor]?.dataset.act);
});

// Streicheln: Tipp auf die Figur im Canvas.
let _lastPet = 0;
canvas.addEventListener('click', (e) => {
  if (S.sleeping || busy() || !S.name) return;
  const r = canvas.getBoundingClientRect();
  const mx = (e.clientX - r.left) / r.width * W;
  const my = (e.clientY - r.top) / r.height * H;
  if (Math.abs(mx - pet.x) < 20 && my > GROUND - 40 && my < GROUND + 8) {
    const now = Date.now();
    if (now - _lastPet < 6000) return;
    _lastPet = now;
    S.happy = clamp(S.happy + 4, 0, 100);
    pet.anim = { type: 'pet', t: 0, dur: 1200 };
    showMsg('♥');
    renderStats(); save();
  }
});

/* ── Namens-Dialog (erster Besuch) ───────────────────────────────────────── */
function openNameDlg() {
  const dlg = $('tamaNameDlg');
  if (!dlg) return;
  dlg.hidden = false;
  setTimeout(() => $('tamaNameInput')?.focus(), 60);
}
function submitName() {
  const val = ($('tamaNameInput')?.value || '').trim().toUpperCase().slice(0, 10);
  S.name = val || 'MOCHI';
  $('tamaNameDlg').hidden = true;
  showMsg('HALLO, ' + S.name + '!');
  renderStats(); save();
}
$('tamaNameOk')?.addEventListener('click', submitName);
$('tamaNameInput')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitName(); });

/* ── Bedürfnis-Hinweise (dezent, max. alle 45 s) ─────────────────────────── */
function needCheck() {
  const t = performance.now();
  if (t < nextNeedMsg || S.sleeping || busy() || !S.name) return;
  let msg = null;
  if (S.sick) msg = 'MIR GEHT ES NICHT GUT…';
  else if (S.hunger < 20) msg = 'ICH HAB HUNGER!';
  else if (S.clean < 20 || S.poops.length >= 2) msg = 'IIH… MACH MAL SAUBER!';
  else if (S.energy < 15) msg = 'ICH BIN SOO MÜDE…';
  else if (S.happy < 20) msg = 'MIR IST LANGWEILIG…';
  if (msg) { showMsg(msg); nextNeedMsg = t + 45000; }
}

/* ── Render-Schleife (läuft nur bei offener Seite) ───────────────────────── */
let running = false, raf = 0, lastFrame = 0, lastSim = 0;
function loop(ts) {
  if (!running) return;
  raf = requestAnimationFrame(loop);
  if (ts - lastFrame < 1000 / 30) return;             // ~30 fps reichen für Pixel
  const dt = Math.min(120, ts - lastFrame || 33);
  lastFrame = ts;
  step(dt, ts);
  renderScene(ts, false);
  if (ts - lastSim > 5000) {
    lastSim = ts;
    const wasSick = S.sick, wasSleeping = S.sleeping;
    simulate(S.lastTick, Date.now());
    if (S.sick && !wasSick) { showMsg('OH NEIN… KRANK!'); }
    if (wasSleeping && !S.sleeping) showMsg('AUSGESCHLAFEN!');
    renderStats(); updateUI(); needCheck(); save();
  }
}
function start() { if (running) return; running = true; lastFrame = 0; lastSim = 0; raf = requestAnimationFrame(loop); }
function stop()  { running = false; cancelAnimationFrame(raf); }

/* ── Seite öffnen/schließen (gleiche Mechanik wie 3D-Inventar) ───────────── */
let _animTimer = null;
function markAnimating() {
  page.classList.add('is-animating');
  clearTimeout(_animTimer);
  _animTimer = setTimeout(() => page.classList.remove('is-animating'), 320);
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
  buildBars();
  simulate(S.lastTick, Date.now());                   // Offline-Zeit nachziehen
  renderStats(); updateUI();
  if (!S.name) openNameDlg();
  start();
}
function closePage() {
  markAnimating();
  page.classList.remove('show');
  page.setAttribute('aria-hidden', 'true');
  stop(); save();
  window.MB?.updateBodyLock?.();
}
$('tamaClose')?.addEventListener('click', closePage);

// Der In-Page-Header (js/header-menu.js) schließt Seiten direkt über die
// CSS-Klasse – daran vorbei würde die Render-Schleife weiterlaufen. Deshalb
// hier absichern: verschwindet .show, wird gestoppt und gespeichert.
new MutationObserver(() => {
  if (!page.classList.contains('show') && running) { stop(); save(); }
}).observe(page, { attributes: true, attributeFilter: ['class'] });

// Bei Tab-Wechsel Zustand sichern; Loop pausieren, wenn nichts sichtbar ist.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { save(); stop(); }
  else if (page.classList.contains('show')) { simulate(S.lastTick, Date.now()); renderStats(); start(); }
});
window.addEventListener('pagehide', save);

document.addEventListener('keydown', (e) => {
  if (!page.classList.contains('show')) return;
  const dlg = $('tamaNameDlg');
  if (e.key === 'Escape') {
    if (dlg && !dlg.hidden) { if (S.name) dlg.hidden = true; return; }
    closePage(); return;
  }
  if (dlg && !dlg.hidden) return;                     // Dialog fängt Eingaben selbst ab
  if (e.key === 'ArrowLeft')       { moveCursor(-1); e.preventDefault(); }
  else if (e.key === 'ArrowRight') { moveCursor(1);  e.preventDefault(); }
  else if (e.key === 'Enter' || e.key === ' ') { act(icons[cursor]?.dataset.act); e.preventDefault(); }
});

/* ── Mini-Vorschau für die Navigations-Pill (js/nav.js) ──────────────────── */
function drawTamaPreview(cv) {
  try {
    const old = ctx;
    ctx = cv.getContext('2d');
    renderScene(performance.now(), true);
    ctx = old;
    return true;
  } catch (e) { return false; }
}

window.MB = Object.assign(window.MB || {}, {
  openTama: openPage,
  closeTama: closePage,
  drawTamaPreview,
});
})();
