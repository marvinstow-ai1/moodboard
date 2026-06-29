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

const CACHE_KEY   = 'mb_weather_v1';
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
    <svg width="44" height="44" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" style="position:relative">
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
    <svg width="40" height="40" viewBox="0 0 22 22" shape-rendering="crispEdges" style="position:relative">
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
    const scale = (opts.scaleMin ?? 0.7) + depth * 0.6;
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

  const sky = (html) => { const d = el('div'); d.innerHTML = html; layer.appendChild(d.firstElementChild); };

  switch (scene){
    case 'clear':
      if (isDay){ sky(sunSVG()); }
      else { addStars(layer, 14); sky(moonSVG()); }
      break;
    case 'partly':
      if (isDay){ sky(sunSVG()); addClouds(layer, 2, { topMin:6, topMax:30, opacity:.92 }); }
      else { addStars(layer, 8); sky(moonSVG()); addClouds(layer, 2, { color:'#5a6473', topMin:6, topMax:30, opacity:.8 }); }
      break;
    case 'cloudy':
      addClouds(layer, 4, { color: isDay ? '#aab4c0' : '#5a6473', opacity: isDay ? .95 : .85, speed:.9 });
      break;
    case 'fog':
      addClouds(layer, 2, { color: isDay ? '#b8bdc4' : '#565b63', opacity:.6, topMin:2, topMax:14 });
      addFog(layer);
      break;
    case 'rain':
      addClouds(layer, 3, { color: isDay ? '#8c97a4' : '#49525f', opacity:.95, topMin:2, topMax:16, speed:.7 });
      addRain(layer, 16);
      break;
    case 'snow':
      addClouds(layer, 3, { color: isDay ? '#9fa9b6' : '#525c6a', opacity:.92, topMin:2, topMax:16, speed:.6 });
      addSnow(layer, 16);
      break;
    case 'thunder':
      addClouds(layer, 3, { color:'#454a5a', opacity:.97, topMin:2, topMax:16, speed:.7 });
      addRain(layer, 14);
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
              `&current=weather_code,is_day&timezone=auto`;
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error('weather ' + r.status);
  const j = await r.json();
  const data = {
    code: j.current?.weather_code ?? 0,
    isDay: (j.current?.is_day ?? 1) === 1,
    t: Date.now()
  };
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch {}
  return data;
}

/* ---- boot ---------------------------------------------------- */
function init(){
  const topbar = document.querySelector('.topbar');
  if (!topbar || topbar.querySelector('.weather-layer')) return;

  const layer = el('div', 'weather-layer');
  const scrim = el('div', 'weather-scrim');
  topbar.prepend(scrim);
  topbar.prepend(layer);

  let lastKey = '';
  const apply = async () => {
    try {
      const w = await fetchWeather();
      const scene = sceneForCode(w.code, w.isDay);
      const key = scene + (w.isDay ? '-d' : '-n');
      if (key === lastKey) return;        // nothing changed → don't rebuild
      lastKey = key;
      render(layer, scene, w.isDay);
    } catch (e) {
      if (!lastKey){ render(layer, 'partly', true); lastKey = 'fallback'; }
    }
  };

  apply();
  // the "hourly cron": re-check every hour for long-lived tabs.
  setInterval(apply, ONE_HOUR);

  // pause the animation loop while the tab is in the background
  const sync = () => layer.classList.toggle('paused', document.hidden);
  document.addEventListener('visibilitychange', sync);
  sync();
}

if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', init);
else
  init();
