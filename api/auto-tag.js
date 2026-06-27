export const config = { runtime: 'edge' };

// ── Background image auto-tagging for the chatbot ────────────────────────────
// Returns a rich, detailed set of German keywords/mood words for an image.
// These tags are stored in `moodboard_items.ai_tags` and are NEVER shown in the
// UI — they only exist so a chatbot can later find images by mood/topic.
//
// V1 uses Gemini 2.0 Flash (cheap/free tier, same key as /api/suggest-moods).
// The provider call is isolated in classify() so it can be swapped later.

const MAX_TAGS = 30;       // hard cap stored per image
const TAG_MAX_LEN = 40;    // max length of a single tag
const TIMEOUT_MS = 20000;  // abort slow model calls so the request never hangs

export default async function handler(req) {
  if (req.method !== 'POST') {
    return json({ tags: [], error: 'method_not_allowed' }, 405);
  }

  let imageUrl;
  try {
    ({ imageUrl } = await req.json());
  } catch {
    return json({ tags: [], error: 'bad_request' }, 400);
  }
  if (!imageUrl || typeof imageUrl !== 'string') {
    return json({ tags: [], error: 'missing_image_url' }, 400);
  }

  const key = process.env.GEMINI_API_KEY;
  // No key configured → behave gracefully (no tags), never error the upload.
  // `no_provider` lets the client skip pointless retries until a key exists.
  if (!key) return json({ tags: [], error: 'no_provider' });

  try {
    const raw = await classify(imageUrl, key);
    const tags = sanitizeTags(raw);
    return json({ tags });
  } catch (e) {
    // Surface a soft failure; the client marks the row ai_status='failed'
    // so a later retry can pick it up again.
    return json({ tags: [], error: 'classify_failed' }, 200);
  }
}

// ── Provider: Gemini Vision ──────────────────────────────────────────────────
async function classify(imageUrl, key) {
  const prompt = [
    'Du bist ein Bild-Tagging-System für eine Moodboard-App.',
    'Analysiere das Bild und gib viele detaillierte deutsche Schlagwörter zurück,',
    'damit ein Chatbot das Bild später nach Stimmung und Inhalt finden kann.',
    '',
    'Gib eine Mischung aus:',
    '- 1–3 Stimmungs-/Mood-Wörtern (z. B. "urlaub", "gute laune", "sonnig", "entspannt", "cozy", "natur", "melancholisch", "energiegeladen")',
    '- vielen beschreibenden Tags zu Motiv, Objekten, Ort, Farben, Jahreszeit, Tageszeit und Aktivität',
    '  (z. B. "strand", "meer", "palmen", "himmel", "sonnenuntergang", "berge", "kaffee", "stadt", "nacht", "blau").',
    '',
    'Regeln:',
    '- Nur deutsche Wörter, alles klein geschrieben, einzelne Begriffe (max. 2 Wörter).',
    '- 10 bis 25 Tags insgesamt.',
    '- Keine Doppelungen, keine Sätze, keine Emojis, keine Erklärungen.',
    'Antworte AUSSCHLIESSLICH mit einem JSON-Array von Strings, z. B.: ["strand","meer","urlaub","sonnig","gute laune","sommer","palmen","blau"].',
  ].join('\n');

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // Download the image bytes and send them inline. This is far more reliable
    // than fileData.fileUri, which only accepts Files-API/GCS URIs.
    const { dataB64, mimeType } = await fetchImageBase64(imageUrl, controller.signal);

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inlineData: { mimeType, data: dataB64 } },
            ],
          }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 256 },
        }),
      }
    );
    if (!res.ok) throw new Error('gemini_http_' + res.status);
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
    const match = text.match(/\[[\s\S]*\]/);
    return match ? JSON.parse(match[0]) : [];
  } finally {
    clearTimeout(t);
  }
}

// Fetch an image and return base64 + mime type for Gemini inlineData.
async function fetchImageBase64(url, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error('image_fetch_' + res.status);
  let mimeType = (res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
  if (!/^image\//.test(mimeType)) mimeType = 'image/jpeg';
  const buf = new Uint8Array(await res.arrayBuffer());
  // Chunked conversion avoids call-stack limits on larger images.
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, buf.subarray(i, i + CHUNK));
  }
  return { dataB64: btoa(binary), mimeType };
}

// ── Normalisation ────────────────────────────────────────────────────────────
function sanitizeTags(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const tag = item.toLowerCase().trim().replace(/\s+/g, ' ');
    if (!tag || tag.length > TAG_MAX_LEN) continue;
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
