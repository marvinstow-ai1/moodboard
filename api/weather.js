export const config = { runtime: 'edge' };

// Fixed location — Bottrop, Germany (matches the frontend).
const LAT = 51.5236;
const LON = 6.9286;

/* Server-side weather proxy.
   - Runs from Vercel, so it is never blocked by client-side adblockers /
     privacy filters and has no CORS issues (the page calls same-origin).
   - Uses OpenWeather when OPENWEATHER_API_KEY is set, otherwise Open-Meteo.
   - Falls back to Open-Meteo if OpenWeather fails for any reason.
   Returns a normalised shape: { code, isDay, cloud, sr, ss, src }
   where sr/ss are minutes-of-day in local time. */
export default async function handler() {
  const headers = {
    'Content-Type': 'application/json',
    // let Vercel's CDN serve a cached copy for 20 min (and stale for a bit
    // longer while it refreshes) so we barely hit the upstream APIs.
    'Cache-Control': 's-maxage=1200, stale-while-revalidate=1800',
  };
  try {
    // 1) OpenWeather (station-blended) wins when a key is configured.
    let data = await fromOpenWeather();

    // 2) Otherwise baseline from Open-Meteo (reliable sunrise/sunset), but
    //    take the cloud cover / condition from met.no when available — it's
    //    a different model and often closer to the actual sky than
    //    Open-Meteo's cloud_cover (which can read 0% on overcast days).
    if (!data) {
      const om = await fromOpenMeteo();
      const met = await fromMetNo().catch(() => null);
      data = (met && typeof met.cloud === 'number')
        ? { ...om, cloud: met.cloud, code: met.code ?? om.code, src: 'met.no' }
        : om;
    }
    return new Response(JSON.stringify(data), { headers });
  } catch (e) {
    try {
      return new Response(JSON.stringify(await fromOpenMeteo()), { headers });
    } catch {
      return new Response(JSON.stringify({ error: 'weather unavailable' }), { status: 502, headers });
    }
  }
}

// met.no / Yr.no — free, no key. Requires a descriptive User-Agent.
async function fromMetNo() {
  const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${LAT}&lon=${LON}`;
  const r = await fetch(url, {
    headers: { 'User-Agent': 'MarvinsPlace-Moodboard/1.0 moodboard-nine-bay.vercel.app' },
  });
  if (!r.ok) return null;
  const j = await r.json();
  const d = j.properties?.timeseries?.[0]?.data;
  const cloud = d?.instant?.details?.cloud_area_fraction;
  const sym = d?.next_1_hours?.summary?.symbol_code || d?.next_6_hours?.summary?.symbol_code || '';
  let code = 0;                                   // clear/cloud → decided by cloud%
  if (/thunder/.test(sym))            code = 95;
  else if (/snow|sleet/.test(sym))    code = 73;
  else if (/rain|drizzle/.test(sym))  code = 63;
  else if (/fog/.test(sym))           code = 45;
  return { cloud: typeof cloud === 'number' ? cloud : null, code, src: 'met.no' };
}

async function fromOpenWeather() {
  const key = process.env.OPENWEATHER_API_KEY;
  if (!key) return null;                       // not configured → skip
  const url = `https://api.openweathermap.org/data/2.5/weather?lat=${LAT}&lon=${LON}&appid=${key}`;
  const r = await fetch(url);
  if (!r.ok) return null;                       // let caller fall back
  const j = await r.json();

  const owmId = j.weather?.[0]?.id ?? 800;
  const cloud = typeof j.clouds?.all === 'number' ? j.clouds.all : null;
  const tz = j.timezone ?? 0;                   // seconds offset from UTC
  const dt = j.dt, srU = j.sys?.sunrise, ssU = j.sys?.sunset;
  const toMin = (u) => (u == null ? null : Math.floor(((((u + tz) % 86400) + 86400) % 86400) / 60));

  // Map OpenWeather condition id → WMO-ish code (precip/fog/thunder only;
  // clear/clouds are left to cloud% on the frontend).
  let code = 0;
  if (owmId >= 200 && owmId < 300) code = 95;        // thunderstorm
  else if (owmId >= 600 && owmId < 700) code = 73;   // snow
  else if (owmId >= 300 && owmId < 600) code = 63;   // drizzle / rain
  else if (owmId >= 700 && owmId < 800) code = 45;   // mist / fog / haze

  const isDay = (dt != null && srU != null && ssU != null) ? (dt >= srU && dt < ssU) : true;
  return { code, isDay, cloud, sr: toMin(srU), ss: toMin(ssU), src: 'openweather' };
}

async function fromOpenMeteo() {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
              `&current=weather_code,is_day,cloud_cover&daily=sunrise,sunset&timezone=auto&forecast_days=1`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('open-meteo ' + r.status);
  const j = await r.json();
  const hm = (iso) => {
    const t = (iso || '').split('T')[1];
    if (!t) return null;
    const [H, M] = t.split(':').map(Number);
    return H * 60 + M;
  };
  const cc = j.current?.cloud_cover;
  return {
    code: j.current?.weather_code ?? 0,
    isDay: (j.current?.is_day ?? 1) === 1,
    cloud: typeof cc === 'number' ? cc : null,
    sr: hm(j.daily?.sunrise?.[0]) ?? 390,
    ss: hm(j.daily?.sunset?.[0]) ?? 1170,
    src: 'open-meteo',
  };
}
