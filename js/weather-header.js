/* ============================================================
   Weather-reactive header
   ------------------------------------------------------------
   Fetches the current weather once an hour (cached in
   localStorage so we never re-hit the API on every visit) and
   renders a small 16-bit pixel-art scene BEHIND the header
   title + buttons. No API key, no backend — Open-Meteo is free
   and CORS-enabled. The location is fixed to Bottrop (Marvin's
   home), so the header always shows the local weather there.

   Performance: only transform/opacity animations (compositor),
   modest element counts, and everything pauses while the tab is
   hidden. Honors prefers-reduced-motion via CSS.
   ============================================================ */

const CACHE_KEY   = 'mb_weather_v2';
const ONE_HOUR    = 60 * 60 * 1000;
// Fixed location — Bottrop, Germany (Marvin's home).
const LOCATION    = { lat: 51.5236, lon: 6.9286, label: 'Bottrop' };

/* ---- WMO weather code → scene -------------------------------- */
function sceneForCode(code, isDay){
  // https://open-meteo.com/en/docs  (WMO weather interpretation codes)
  if (code === 0)                      return 'clear';
  if (code === 1 || code === 2)        return 'partly';
  if (code === 3)                      return 'cloudy';
  if (code === 45 || code === 48)      return 'fog';
  if (code >= 51 && code <= 57)        return 'rain';   // drizzle
  if (code >= 61 && code <= 67)        return 'rain';
  if (code >= 80 && code <= 82)        return 'rain';   // showers
  if (code >= 71 && code <= 77)        return 'snow';
  if (code === 85 || code === 86)      return 'snow';
  if (code >= 95)                      return 'thunder';
  return isDay ? 'partly' : 'cloudy';
}

/* ---- tiny DOM helper ----------------------------------------- */
function el(tag, cls, css){
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (css) n.style.cssText = css;
  return n;
}
const rnd = (a, b) => a + Math.random() * (b - a);

/* ---- pixel-art SVG sprites ----------------------------------- */
// A blocky filled disc rendered as <rect> rows so it stays crisp.
function pixelDisc(r, color){
  let rects = '';
  for (let y = -r; y <= r; y++){
    const w = Math.round(Math.sqrt(r*r - y*y));
    if (w <= 0) continue;
    rects += `<rect x="${r - w}" y="${r + y}" width="${2*w}" height="1"/>`;
  }
  return `<g fill="${color}">${rects}</g>`;
}

function sunSVG(){
  const size = 22;
  const disc = pixelDisc(5, '#ffd23f');
  const inner = pixelDisc(3, '#ffe98a');
  // 8 ray spikes around the disc (drawn on a rotating group)
  let rays = '';
  const cx = 11, R = 9;
  for (let i = 0; i < 8; i++){
    const a = i * Math.PI / 4;
    const x = Math.round(cx + Math.cos(a) * R) - 1;
    const y = Math.round(cx + Math.sin(a) * R) - 1;
    rays += `<rect x="${x}" y="${y}" width="2" height="2"/>`;
  }
  return `
  <div class="w-sun">
    <span class="glow"></span>
    <svg width="58" height="58" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" style="position:relative">
      <g class="rays" fill="#ffcf2e">${rays}</g>
      <g transform="translate(6,6)">${disc}</g>
      <g transform="translate(8,8)">${inner}</g>
    </svg>
  </div>`;
}

function moonSVG(){
  const disc = pixelDisc(5, '#eef2ff');
  return `
  <div class="w-moon">
    <span class="glow"></span>
    <svg width="52" height="52" viewBox="0 0 22 22" shape-rendering="crispEdges" style="position:relative">
      <g transform="translate(6,6)">${disc}</g>
      <rect x="10" y="9" width="2" height="2" fill="#b3bce0"/>
      <rect x="14" y="13" width="2" height="2" fill="#b3bce0"/>
      <rect x="9" y="14" width="1" height="1" fill="#b3bce0"/>
    </svg>
  </div>`;
}

// Lumpy pixel cloud built from rects on a ~26x12 grid.
function cloudSVG(color){
  const c = color || '#c9d2dd';
  const sh = '#9aa6b4';
  return `<svg width="52" height="24" viewBox="0 0 26 12" shape-rendering="crispEdges" fill="${c}">
    <rect x="6"  y="3" width="8"  height="3"/>
    <rect x="4"  y="5" width="18" height="3"/>
    <rect x="2"  y="7" width="22" height="3"/>
    <rect x="10" y="2" width="6"  height="2"/>
    <rect x="16" y="4" width="6"  height="2"/>
    <g fill="${sh}"><rect x="2" y="9" width="22" height="1"/></g>
  </svg>`;
}

/* ---- scene builders ------------------------------------------ */
function addClouds(layer, count, opts){
  for (let i = 0; i < count; i++){
    const depth = i / Math.max(1, count - 1);          // 0..1 (front→back)
    const wrap = el('div', 'w-cloud');
    const scale = (opts.scaleMin ?? 0.92) + depth * 0.7;
    const top = rnd(opts.topMin ?? 4, opts.topMax ?? 26);
    const startX = rnd(-40, 200);
    const drift = rnd(180, 320);
    const dur = rnd(34, 60) / (opts.speed ?? 1);
    wrap.style.cssText =
      `top:${top}px;left:${startX}px;transform-origin:left;` +
      `--drift:${drift}px;animation-duration:${dur}s;animation-delay:${-rnd(0,dur)}s;` +
      `opacity:${(opts.opacity ?? 0.9) - depth * 0.25};`;
    const inner = el('div', '', `transform:scale(${scale});transform-origin:left top`);
    inner.innerHTML = cloudSVG(opts.color);
    wrap.appendChild(inner);
    layer.appendChild(wrap);
  }
}

function addRain(layer, count){
  for (let i = 0; i < count; i++){
    const d = el('div', 'w-rain');
    const dur = rnd(0.5, 0.85);
    d.style.cssText =
      `left:${rnd(2, 98)}%;--rx:${rnd(-8,-4)}px;` +
      `animation-duration:${dur}s;animation-delay:${-rnd(0,dur)}s;` +
      `opacity:${rnd(0.5,0.95)};transform:scaleY(${rnd(0.8,1.3)})`;
    layer.appendChild(d);
  }
}

function addSnow(layer, count){
  for (let i = 0; i < count; i++){
    const d = el('div', 'w-snow');
    const dur = rnd(3.5, 6);
    d.style.cssText =
      `left:${rnd(2, 98)}%;--rx:${rnd(6,16)}px;` +
      `animation-duration:${dur}s;animation-delay:${-rnd(0,dur)}s;` +
      `opacity:${rnd(0.6,1)}`;
    layer.appendChild(d);
  }
}

function addStars(layer, count){
  for (let i = 0; i < count; i++){
    const s = el('div', 'w-star');
    const dur = rnd(2, 4.5);
    s.style.cssText =
      `top:${rnd(6, 40)}px;left:${rnd(4, 96)}%;` +
      `animation-duration:${dur}s;animation-delay:${-rnd(0,dur)}s;` +
      `opacity:${rnd(0.3,1)}`;
    layer.appendChild(s);
  }
}

function addFog(layer){
  for (let i = 0; i < 3; i++){
    const f = el('div', 'w-fog');
    f.style.cssText =
      `top:${10 + i*18}px;animation-duration:${rnd(12,20)}s;` +
      `animation-delay:${-rnd(0,8)}s;opacity:${0.6 - i*0.12};` +
      `transform:scaleY(${1 + i*0.6})`;
    layer.appendChild(f);
  }
}

/* ---- render a full scene ------------------------------------- */
function render(layer, scene, isDay){
  layer.innerHTML = '';
  const skyKey = (() => {
    if (scene === 'clear')   return isDay ? 'clear-day'  : 'clear-night';
    if (scene === 'partly')  return isDay ? 'partly-day' : 'partly-night';
    if (scene === 'cloudy')  return isDay ? 'cloudy'     : 'cloudy-night';
    if (scene === 'fog')     return isDay ? 'fog'        : 'fog-night';
    if (scene === 'rain')    return isDay ? 'rain'       : 'rain-night';
    if (scene === 'snow')    return isDay ? 'snow'       : 'snow-night';
    if (scene === 'thunder') return 'thunder';
    return 'clear-night';
  })();
  layer.dataset.sky = skyKey;

  // Sprites live in a stage that starts below the notch / safe-area, so
  // the sun, clouds etc. sit in the visible header band — never clipped
  // up behind the status bar. The sky gradient stays full-bleed on .layer.
  const stage = el('div', 'w-stage');
  layer.appendChild(stage);

  // Sun/moon go on the layer itself (not the stage) so they can sit in
  // the top-left corner above the title, not tucked down behind it.
  const sky = (html) => { const d = el('div'); d.innerHTML = html; layer.appendChild(d.firstElementChild); };

  switch (scene){
    case 'clear':
      if (isDay){ sky(sunSVG()); }
      else { addStars(stage, 14); sky(moonSVG()); }
      break;
    case 'partly':
      if (isDay){ sky(sunSVG()); addClouds(stage, 2, { topMin:4, topMax:24, opacity:.92 }); }
      else { addStars(stage, 8); sky(moonSVG()); addClouds(stage, 2, { color:'#5a6473', topMin:4, topMax:24, opacity:.8 }); }
      break;
    case 'cloudy':
      addClouds(stage, 4, { color: isDay ? '#aab4c0' : '#5a6473', opacity: isDay ? .95 : .85, speed:.9 });
      break;
    case 'fog':
      addClouds(stage, 2, { color: isDay ? '#b8bdc4' : '#565b63', opacity:.6, topMin:2, topMax:12 });
      addFog(stage);
      break;
    case 'rain':
      addClouds(stage, 3, { color: isDay ? '#8c97a4' : '#49525f', opacity:.95, topMin:2, topMax:14, speed:.7 });
      addRain(stage, 16);
      break;
    case 'snow':
      addClouds(stage, 3, { color: isDay ? '#9fa9b6' : '#525c6a', opacity:.92, topMin:2, topMax:14, speed:.6 });
      addSnow(stage, 16);
      break;
    case 'thunder':
      addClouds(stage, 3, { color:'#454a5a', opacity:.97, topMin:2, topMax:14, speed:.7 });
      addRain(stage, 14);
      layer.appendChild(el('div', 'w-flash'));
      break;
  }
}

/* ---- data fetching (cached hourly) --------------------------- */
async function fetchWeather(){
  // hourly cache — return it if it's still fresh
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (c && Date.now() - c.t < ONE_HOUR && typeof c.code === 'number') return c;
  } catch {}

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${LOCATION.lat}&longitude=${LOCATION.lon}` +
              `&current=weather_code,is_day&daily=sunrise,sunset&timezone=auto&forecast_days=1`;
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error('weather ' + r.status);
  const j = await r.json();
  // sunrise/sunset come as local-time ISO strings — keep just minutes-of-day
  const hm = (iso) => {
    const t = (iso || '').split('T')[1];
    if (!t) return null;
    const [H, M] = t.split(':').map(Number);
    return H * 60 + M;
  };
  const data = {
    code: j.current?.weather_code ?? 0,
    isDay: (j.current?.is_day ?? 1) === 1,
    sr: hm(j.daily?.sunrise?.[0]) ?? 390,    // fallbacks: 06:30 / 19:30
    ss: hm(j.daily?.sunset?.[0]) ?? 1170,
    t: Date.now()
  };
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch {}
  return data;
}

/* ---- time-of-day brightness ---------------------------------- */
// The weather is dimmed by the local clock so the header feels like real
// daylight: dawn is dim, midday is brightest, the afternoon eases off,
// evening/night are darkest. The base palettes are tuned for evening, so
// 1.0 ≈ "evening" brightness. (Colour of dawn/dusk is handled separately
// by the golden-hour gradient below.)
const BRIGHT = [           // [hour, brightness multiplier]
  [0,0.85],[5,0.85],[6.5,0.90],[8,0.97],[10,1.05],[12,1.14],[13.5,1.16],
  [15,1.08],[17,1.02],[18.5,1.0],[20,0.95],[21.5,0.90],[23,0.86],[24,0.85]
];

function curveAt(h, pts){
  if (h <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++){
    if (h <= pts[i][0]){
      const [x0,y0] = pts[i-1], [x1,y1] = pts[i];
      return y0 + (y1 - y0) * (h - x0) / (x1 - x0);
    }
  }
  return pts[pts.length-1][1];
}

function daylightFilter(){
  const d = new Date();
  const h = d.getHours() + d.getMinutes()/60;
  const b = curveAt(h, BRIGHT);
  return `brightness(${b.toFixed(3)}) saturate(1.05)`;
}

/* ---- golden hour (sunrise / sunset colours) ------------------ */
// Real sunrise/sunset times for Bottrop drive a warm gradient that
// blooms over the sky around each event — the classic colours of a
// beautiful sunrise/sunset. Sunrise leans softer pink/peach, sunset
// leans deeper orange/magenta/violet.
const GRAD_SUNRISE =
  'linear-gradient(180deg,#2b2a55 0%,#5a3d7a 22%,#b85f8e 45%,#ff9e6b 72%,#ffd49a 100%)';
const GRAD_SUNSET =
  'linear-gradient(180deg,#1e1b3c 0%,#4a2a60 24%,#9c3a6c 47%,#ea5a37 72%,#ffab4d 100%)';

// Smooth 1→0 bump centred on the event, reaching 0 at ±halfWidth minutes.
function bump(nowMin, eventMin, halfWidth){
  const d = Math.abs(nowMin - eventMin);
  if (d >= halfWidth) return 0;
  return 0.5 * (1 + Math.cos(Math.PI * d / halfWidth));
}

// Returns { opacity, gradient } for the current minute given sunrise/sunset.
function goldenHour(sr, ss, overcast){
  const now = new Date();
  const m = now.getHours() * 60 + now.getMinutes();
  const HALF = 85;                       // ~the golden hour window, each side
  const gSr = bump(m, sr, HALF);
  const gSs = bump(m, ss, HALF);
  const g = Math.max(gSr, gSs);
  const maxOp = overcast ? 0.45 : 0.82;  // overcast skies are muted
  return {
    opacity: g * maxOp,
    gradient: gSs >= gSr ? GRAD_SUNSET : GRAD_SUNRISE
  };
}

/* ---- boot ---------------------------------------------------- */
function init(){
  const topbar = document.querySelector('.topbar');
  if (!topbar || topbar.querySelector('.weather-layer')) return;

  const layer = el('div', 'weather-layer');
  const scrim = el('div', 'weather-scrim');
  topbar.prepend(scrim);
  topbar.prepend(layer);

  // Persistent golden-hour gradient — sits above the sky but below the
  // sprites, so the sun/clouds stay readable on a coloured sky.
  const golden = el('div', 'w-goldenhour');

  let lastKey = '';
  let sunMin  = { sr: 390, ss: 1170 };   // sunrise/sunset minutes (fallback)
  let curScene = 'partly';
  const overcastScenes = new Set(['cloudy','fog','rain','snow','thunder']);

  const apply = async () => {
    try {
      const w = await fetchWeather();
      sunMin = { sr: w.sr ?? 390, ss: w.ss ?? 1170 };
      const scene = sceneForCode(w.code, w.isDay);
      const key = scene + (w.isDay ? '-d' : '-n');
      if (key !== lastKey){               // only rebuild when the scene changes
        lastKey = key;
        curScene = scene;
        render(layer, scene, w.isDay);
      }
    } catch (e) {
      if (!lastKey){ render(layer, 'partly', true); lastKey = 'fallback'; }
    }
    tick();                               // refresh brightness + golden hour
  };

  // time-of-day brightness + sunrise/sunset colours — cheap, refreshed
  // often enough to glide through dawn/dusk.
  const tick = () => {
    layer.style.filter = daylightFilter();
    const g = goldenHour(sunMin.sr, sunMin.ss, overcastScenes.has(curScene));
    golden.style.background = g.gradient;
    golden.style.opacity = g.opacity.toFixed(3);
    // render() wipes the layer, so make sure the overlay is back, first in
    // line (above the sky background, below the sprites).
    if (layer.firstElementChild !== golden) layer.insertBefore(golden, layer.firstElementChild);
  };

  apply();
  // the "hourly cron": re-check the weather every hour for long-lived tabs.
  setInterval(apply, ONE_HOUR);
  // nudge brightness + golden hour every 10 min so transitions stay smooth.
  setInterval(tick, 10 * 60 * 1000);

  // pause the animation loop while the tab is in the background
  const sync = () => {
    layer.classList.toggle('paused', document.hidden);
    if (!document.hidden) tick();          // refresh after returning
  };
  document.addEventListener('visibilitychange', sync);
  sync();
}

if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', init);
else
  init();
