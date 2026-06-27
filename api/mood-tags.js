export const config = { runtime: 'edge' };

// ============================================================================
// Ebene C (optional): Freitext → Such-Tags per günstigem LLM.
// ----------------------------------------------------------------------------
// Wird von js/mood-chat.js nur als Ergänzung aufgerufen. Ist kein API-Key
// gesetzt, liefert der Endpoint einfach [] und die App nutzt weiter die
// regelbasierten Ebenen A + B. So entstehen keine zwingenden laufenden Kosten.
//
// Konfiguration (Vercel Env): OPENROUTER_API_KEY und optional OPENROUTER_MODEL
// (Default: google/gemini-2.5-flash-lite — sehr günstig).
// ============================================================================

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const { text } = await req.json().catch(() => ({}));
  const key = process.env.OPENROUTER_API_KEY;

  const empty = () =>
    new Response(JSON.stringify({ tags: [] }), {
      headers: { 'Content-Type': 'application/json' },
    });

  if (!key || !text || typeof text !== 'string') return empty();

  const model = process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash-lite';
  const prompt = `Wandle die folgende Nutzereingabe in 4-8 deutsche Such-Tags fuer eine Bild-Moodboard-Suche um. Gib eine Mischung aus Stimmung/Mood (z. B. urlaub, ruhe, gute laune, motivierend, cozy, melancholisch) und Motiv/Thema (z. B. strand, meer, natur, stadt, kaffee). Regeln: nur deutsche Woerter, alles klein, einzelne Begriffe, keine Saetze, keine Emojis. Antworte AUSSCHLIESSLICH mit einem JSON-Array von Strings.\n\nEingabe: "${text}"`;

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://moodboard-nine-bay.vercel.app',
        'X-Title': 'Marvins Place Moodboard',
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        max_tokens: 120,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) return empty();
    const data = await res.json();
    const out = data?.choices?.[0]?.message?.content || '[]';
    const match = out.match(/\[.*?\]/s);
    const tags = match ? JSON.parse(match[0]) : [];
    const valid = (Array.isArray(tags) ? tags : [])
      .filter(t => typeof t === 'string')
      .map(t => t.toLowerCase().trim())
      .filter(t => t && t.length <= 40)
      .slice(0, 8);

    return new Response(JSON.stringify({ tags: valid }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return empty();
  }
}
