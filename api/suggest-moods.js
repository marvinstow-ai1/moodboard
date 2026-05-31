export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const { imageUrl, moods } = await req.json();
  const key = process.env.GEMINI_API_KEY;

  if (!key) {
    return new Response(JSON.stringify({ moods: [] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const moodList = moods.join(', ');
  const prompt = `Look at this image and select which of the following moods fit best: ${moodList}.
Return ONLY a JSON array with the matching mood names (max 3), exactly as spelled above. Example: ["Summer","Cozy"]. If none fit well, return [].`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inlineData: null },
              {
                fileData: {
                  mimeType: 'image/jpeg',
                  fileUri: imageUrl,
                },
              },
            ],
          }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 64 },
        }),
      }
    );

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
    const match = text.match(/\[.*?\]/s);
    const suggested = match ? JSON.parse(match[0]) : [];
    const valid = suggested.filter(m => moods.includes(m));

    return new Response(JSON.stringify({ moods: valid }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ moods: [] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
