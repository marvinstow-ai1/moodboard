// ============================================================================
// Farbprofil — geteiltes Modul für Upload (app.js) und Farbsuche (mood-chat.js)
// ----------------------------------------------------------------------------
// Ein Bild wird EINMAL pixelweise in 12 Farb-Buckets eingeteilt. Das Ergebnis
// (Promille-Anteile pro Bucket) wird in der DB-Spalte `moodboard_items.colors`
// gespeichert — beim Upload direkt aus dem ohnehin dekodierten Canvas, und für
// Bestandsbilder per einmaligem Owner-Backfill. Die Farbsuche im Chat ist danach
// ein reiner In-Memory-Filter: kein Bild-Download pro Suche, keine API-Calls.
//
// Eine Farbe „zählt" nur, wenn sie das Bild wirklich prägt (dominant + genug
// Fläche, s. colorMetrics). Suche nach „blau" → nur Bilder, die klar blau sind.
// ============================================================================

// Reihenfolge der Farb-Buckets = Speicherreihenfolge in der DB. NICHT umsortieren!
export const COLOR_KEYS = ['rot', 'orange', 'gelb', 'gruen', 'tuerkis', 'blau', 'lila', 'pink', 'braun', 'schwarz', 'grau', 'weiss'];
// Bunte (chromatische) Farben — nur diese zählen für die Dominanz-Rechnung.
const CHROMA_KEYS = ['rot', 'orange', 'gelb', 'gruen', 'tuerkis', 'blau', 'lila', 'pink'];
const NEUTRAL_KEYS = new Set(['schwarz', 'grau', 'weiss', 'braun']);

// Definition der gängigsten Farben: Anzeigename, Swatch, Wort-Stämme (gefaltet)
// zum Erkennen getippter Eingaben und für den ai_tags-Fallback.
export const COLOR_DEFS = [
  { key: 'rot',     label: 'Rot',     swatch: '#e5484d', stems: ['rot', 'red'] },
  { key: 'orange',  label: 'Orange',  swatch: '#f2811d', stems: ['orange'] },
  { key: 'gelb',    label: 'Gelb',    swatch: '#f5d90a', stems: ['gelb', 'yellow'] },
  { key: 'gruen',   label: 'Grün',    swatch: '#30a46c', stems: ['grun', 'green'] },
  { key: 'tuerkis', label: 'Türkis',  swatch: '#0fb5ba', stems: ['turkis', 'tuerkis', 'teal', 'cyan', 'aqua'] },
  { key: 'blau',    label: 'Blau',    swatch: '#3b82f6', stems: ['blau', 'blue'] },
  { key: 'lila',    label: 'Lila',    swatch: '#8e4ec6', stems: ['lila', 'violett', 'violet', 'purple', 'purpur'] },
  { key: 'pink',    label: 'Pink',    swatch: '#e93d82', stems: ['pink', 'rosa', 'magenta'] },
  { key: 'braun',   label: 'Braun',   swatch: '#8a5a2b', stems: ['braun', 'brown'] },
  { key: 'schwarz', label: 'Schwarz', swatch: '#111318', stems: ['schwarz', 'black'] },
  { key: 'grau',    label: 'Grau',    swatch: '#9aa0a6', stems: ['grau', 'gray', 'grey'] },
  { key: 'weiss',   label: 'Weiß',    swatch: '#f4f4f5', stems: ['weiss', 'white'] },
];
export const COLOR_BY_KEY = new Map(COLOR_DEFS.map(c => [c.key, c]));

// ── Schwellen (Thresholds) — bewusst zentral & tunbar ──────────────────────
// minShare    : Anteil der Farbe an ALLEN bunten Pixeln. Die eigentliche
//               Dominanz-/Qualitätskontrolle. 0.6 ≈ „das Bunt im Bild ist zu
//               ~60–80 % diese Farbe" → fühlt sich als „das Foto ist blau" an.
// minCoverage : Mindestanteil der Farbe am GESAMTEN Bild, damit ein kleiner,
//               knallbunter Fleck nicht reicht.
const COLOR_THRESHOLDS = {
  minShare: 0.6,
  minCoverage: 0.18,
  // Neutrale Farben haben keine „Bunt-Dominanz"; sie brauchen schlicht genug Fläche.
  neutralCoverage: { schwarz: 0.5, weiss: 0.5, grau: 0.45, braun: 0.28 },
};

// ── HSL-Klassifikation eines Pixels → Farb-Bucket ──────────────────────────
function classifyPixel(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 510;               // Helligkeit 0..1
  const s = d === 0 ? 0 : d / (255 - Math.abs(max + min - 255)); // Sättigung 0..1

  // Neutral: kaum Sättigung → nach Helligkeit in schwarz/grau/weiß einordnen.
  if (s < 0.15 || d < 24) {
    if (l < 0.16) return 'schwarz';
    if (l > 0.82) return 'weiss';
    return 'grau';
  }

  // Farbton (Hue) 0..360
  let h;
  if (max === r)      h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else                h = (r - g) / d + 4;
  h = (h * 60 + 360) % 360;

  // Braun = dunkler/gedämpfter Orangeton — vor den Bunt-Buckets abfangen.
  if (h >= 8 && h <= 46 && l < 0.42 && !(s > 0.8 && l > 0.34)) return 'braun';

  if (h < 14 || h >= 346) return 'rot';
  if (h < 44)  return 'orange';
  if (h < 68)  return 'gelb';
  if (h < 162) return 'gruen';
  if (h < 192) return 'tuerkis';
  if (h < 258) return 'blau';
  if (h < 292) return 'lila';
  return 'pink';
}

// Kleines, wiederverwendetes Analyse-Canvas.
const SAMPLE = 36;
let _cv = null, _ctx = null;

// Zeichnet die Bildquelle (HTMLImageElement / Canvas / ImageBitmap) verkleinert
// auf ein 36×36-Canvas und zählt die Farb-Buckets. Rückgabe: 12 Promille-Werte
// (0..1000) in COLOR_KEYS-Reihenfolge — genau so, wie es in der DB liegt.
// Wirft bei getaintetem Canvas (fehlendes CORS) oder ungültiger Quelle.
export function analyzeColorProfile(src) {
  if (!_cv) {
    _cv = document.createElement('canvas');
    _cv.width = _cv.height = SAMPLE;
    _ctx = _cv.getContext('2d', { willReadFrequently: true });
  }
  _ctx.clearRect(0, 0, SAMPLE, SAMPLE);
  _ctx.drawImage(src, 0, 0, SAMPLE, SAMPLE);
  const data = _ctx.getImageData(0, 0, SAMPLE, SAMPLE).data; // wirft bei getaintetem Canvas
  const counts = Object.create(null);
  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;         // transparente Pixel ignorieren
    const cat = classifyPixel(data[i], data[i + 1], data[i + 2]);
    counts[cat] = (counts[cat] || 0) + 1;
    total++;
  }
  return COLOR_KEYS.map(k => (total ? Math.round((counts[k] || 0) / total * 1000) : 0));
}

// Promille-Array (aus DB) → { bucket: fraction 0..1 } für colorMetrics.
export function profileToFractions(arr) {
  const f = Object.create(null);
  for (let i = 0; i < COLOR_KEYS.length; i++) f[COLOR_KEYS[i]] = (arr && arr[i] || 0) / 1000;
  return f;
}

// ── Bewertung: passt ein Bild-Farbprofil zur gesuchten Farbe? ──────────────
// Liefert { pass, score }. `score` sortiert die Treffer (dominanteste zuerst).
export function colorMetrics(key, f) {
  const coverage = f[key] || 0;
  if (NEUTRAL_KEYS.has(key)) {
    const min = COLOR_THRESHOLDS.neutralCoverage[key] ?? 0.5;
    return { pass: coverage >= min, score: coverage };
  }
  let coloredMass = 0, top = 0;
  for (const k of CHROMA_KEYS) {
    const v = f[k] || 0;
    coloredMass += v;
    if (v > top) top = v;
  }
  const share = coloredMass > 0 ? coverage / coloredMass : 0;
  const isTop = coverage > 0 && coverage >= top - 1e-9;   // dominante Buntfarbe
  const pass = isTop && share >= COLOR_THRESHOLDS.minShare && coverage >= COLOR_THRESHOLDS.minCoverage;
  const score = share * 0.75 + Math.min(coverage, 0.6) * 0.25;
  return { pass, score };
}

// Lädt eine (CORS-fähige) Bild-URL und liefert deren Farbprofil (Promille-Array).
// Wird beim Owner-Backfill für Bestandsbilder genutzt. Wirft bei Lade-/CORS-Fehler.
export function analyzeUrlColors(url) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';           // nötig, damit das Canvas lesbar bleibt
    img.decoding = 'async';
    img.onload = () => {
      try { res(analyzeColorProfile(img)); }
      catch (e) { rej(e); }
    };
    img.onerror = () => rej(new Error('load'));
    img.src = url;
  });
}
