// ============================================================================
// Mood-Chat — Texteingabe → Such-Tags → passende Bilder
// ----------------------------------------------------------------------------
// Die Bilder werden NICHT bei jeder Anfrage neu per KI analysiert. Stattdessen
// besitzt jedes Bild bereits gespeicherte `ai_tags` (server-seitig erzeugt,
// siehe db/ai_tagging.sql). Hier wird nur die kurze Nutzereingabe in Such-Tags
// übersetzt und gegen diese vorhandenen Tags gematcht.
//
// Die Textverarbeitung hat drei Ebenen:
//   Ebene A — Keyword- & Synonym-Mappings (TRIGGERS)
//   Ebene B — regelbasierte Normalisierung (fold + Tokenisierung + Stoppwörter)
//   Ebene C — optionale, austauschbare KI-Funktion (api/mood-tags) als Bonus
//
// Wichtig: Die App funktioniert komplett ohne bezahlte KI. Ebene C ist nur ein
// optionaler Zusatz und liefert leer zurück, wenn kein API-Key konfiguriert ist.
// ============================================================================

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://uvfuxnwinuakbqanaxtp.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2ZnV4bndpbnVha2JxYW5heHRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxNzg3MDIsImV4cCI6MjA5NTc1NDcwMn0.quSvaycB3Yk2JXCnQz7AQmHpyATtx6u0U8aGQXD73fo';
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = id => document.getElementById(id);

// ── Ebene B: Normalisierung ────────────────────────────────────────────────
// Faltet Umlaute/Akzente weg (ä→a, ö→o, ü→u, ß→ss) und macht alles klein.
// So matchen Eingabe-Tags robust gegen die (evtl. mit/ohne Umlaut erzeugten)
// gespeicherten Bild-Tags.
function fold(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .trim();
}

// Häufige deutsche Füllwörter, die keine Such-Tags ergeben.
const STOPWORDS = new Set([
  'ich','du','er','sie','es','wir','ihr','der','die','das','den','dem','ein','eine','einen','einem',
  'und','oder','aber','auf','bei','mit','von','vom','zum','zur','fuer','fur','nach','aus','ins','im','am',
  'will','willst','moechte','mochte','will','hab','habe','hast','bin','bist','ist','sind','war','mir','mich','dir','dich',
  'mal','was','wie','wo','wer','warum','etwas','bisschen','grad','gerade','heute','jetzt','total','richtig','voll','echt','so','sehr',
  'zeig','zeige','mir','sehen','sehn','schauen','gucken','finde','finden','such','suche','suchen','bock','lust','laune','stimmung',
  'mehr','noch','schon','immer','nicht','kein','keine','nichts','irgendwas','irgendwie','wieder'
]);

// ── Ebene A: Keyword- & Synonym-Mappings ───────────────────────────────────
// Schlüssel = (gefalteter) Auslöser, der als Teilstring in der Eingabe gesucht
// wird. Wert = Liste passender Such-Tags. Mehrere Auslöser dürfen sich
// überschneiden; alle Treffer werden vereinigt.
const TRIGGERS = {
  // Reise / Urlaub
  'urlaub': ['urlaub', 'reise', 'sonne', 'strand', 'meer', 'entspannung'],
  'reise': ['reise', 'urlaub', 'abenteuer', 'fernweh', 'weite'],
  'fernweh': ['fernweh', 'reise', 'weite', 'meer', 'berge'],
  'abenteuer': ['abenteuer', 'reise', 'natur', 'berge'],
  // Wetter / Natur / Orte
  'sonne': ['sonne', 'sonnig', 'sommer', 'warm'],
  'sonnig': ['sonnig', 'sonne', 'sommer', 'warm'],
  'sommer': ['sommer', 'sonne', 'strand', 'warm', 'gute laune'],
  'winter': ['winter', 'schnee', 'kalt', 'gemutlich'],
  'schnee': ['schnee', 'winter', 'weiss', 'kalt'],
  'regen': ['regen', 'grau', 'melancholisch', 'gemutlich'],
  'strand': ['strand', 'meer', 'sand', 'sonne'],
  'meer': ['meer', 'wasser', 'strand', 'blau', 'weite'],
  'see': ['see', 'wasser', 'natur', 'ruhe'],
  'berg': ['berge', 'natur', 'wandern', 'weite'],
  'natur': ['natur', 'grun', 'wald', 'ruhe'],
  'wald': ['wald', 'natur', 'baume', 'grun'],
  'blumen': ['blumen', 'fruhling', 'natur', 'bunt'],
  'fruhling': ['fruhling', 'blumen', 'natur', 'frisch'],
  'stadt': ['stadt', 'urban', 'architektur', 'nacht'],
  'sonnenuntergang': ['sonnenuntergang', 'abend', 'warm', 'himmel'],
  'sunset': ['sonnenuntergang', 'abend', 'warm', 'himmel'],
  'morgen': ['morgen', 'licht', 'frisch'],
  // Stimmungen — beruhigend / Stress
  'gestresst': ['ruhe', 'entspannung', 'natur', 'slow', 'beruhigend'],
  'stress': ['ruhe', 'entspannung', 'natur', 'slow', 'beruhigend'],
  'beruhig': ['beruhigend', 'ruhe', 'entspannung', 'natur', 'slow'],
  'ruhig': ['ruhe', 'beruhigend', 'entspannung', 'natur'],
  'ruhe': ['ruhe', 'beruhigend', 'entspannung', 'natur'],
  'entspann': ['entspannung', 'ruhe', 'beruhigend', 'slow'],
  'chill': ['entspannung', 'ruhe', 'cozy', 'slow'],
  'relax': ['entspannung', 'ruhe', 'beruhigend', 'slow'],
  // Stimmungen — Aufmunterung / schlechte Laune
  'schlechte laune': ['aufmunternd', 'positiv', 'gute laune', 'comfort', 'cozy', 'warm'],
  'scheiss': ['aufmunternd', 'positiv', 'gute laune', 'comfort', 'cozy'],
  'mies': ['aufmunternd', 'positiv', 'gute laune', 'comfort'],
  'traurig': ['aufmunternd', 'positiv', 'comfort', 'warm', 'cozy'],
  'down': ['aufmunternd', 'positiv', 'comfort', 'warm'],
  'deprimiert': ['aufmunternd', 'positiv', 'comfort', 'warm'],
  // Stimmungen — gute Laune / Energie
  'gute laune': ['gute laune', 'positiv', 'sonnig', 'bunt', 'energiegeladen'],
  'gluck': ['gute laune', 'positiv', 'warm', 'sonnig'],
  'happy': ['gute laune', 'positiv', 'bunt', 'sonnig'],
  'frohlich': ['gute laune', 'positiv', 'bunt'],
  'motivier': ['motivierend', 'energie', 'energiegeladen', 'ziel', 'kraft'],
  'motivation': ['motivierend', 'energie', 'energiegeladen', 'ziel'],
  'antrieb': ['motivierend', 'energie', 'kraft'],
  'power': ['energie', 'energiegeladen', 'motivierend', 'kraft'],
  'energie': ['energie', 'energiegeladen', 'aktiv', 'bewegung'],
  'aktiv': ['aktiv', 'energie', 'bewegung'],
  'party': ['party', 'nacht', 'energie', 'bunt'],
  'feiern': ['party', 'nacht', 'energie', 'bunt'],
  // Stimmungen — cozy / melancholisch / dunkel
  'cozy': ['cozy', 'gemutlich', 'warm', 'comfort', 'ruhe'],
  'gemutlich': ['gemutlich', 'cozy', 'warm', 'comfort'],
  'kuschel': ['cozy', 'gemutlich', 'warm', 'comfort'],
  'comfort': ['comfort', 'cozy', 'gemutlich', 'warm'],
  'melancho': ['melancholisch', 'ruhig', 'neblig', 'grau'],
  'nachdenklich': ['melancholisch', 'ruhig', 'grau'],
  'dunkel': ['dunkel', 'nacht', 'dark', 'mysterios'],
  'dark': ['dunkel', 'nacht', 'dark', 'mysterios'],
  'nacht': ['nacht', 'dunkel', 'stadt', 'mysterios'],
  // Diverses
  'liebe': ['romantisch', 'liebe', 'warm', 'sonnenuntergang'],
  'romantisch': ['romantisch', 'liebe', 'warm'],
  'kaffee': ['kaffee', 'cozy', 'morgen', 'warm'],
  'coffee': ['kaffee', 'cozy', 'morgen', 'warm'],
  'fokus': ['fokus', 'minimal', 'clean', 'ruhe'],
  'konzentr': ['fokus', 'minimal', 'clean', 'ruhe'],
  'produktiv': ['fokus', 'minimal', 'clean'],
  'minimal': ['minimal', 'clean', 'schlicht'],
  'clean': ['minimal', 'clean', 'schlicht'],
  'bunt': ['bunt', 'farbenfroh', 'lebendig'],
  'farben': ['bunt', 'farbenfroh', 'lebendig'],
  'tiere': ['tiere', 'niedlich', 'natur'],
  'hund': ['tiere', 'niedlich'],
  'katze': ['tiere', 'niedlich'],
  'essen': ['essen', 'food', 'lecker'],
  'food': ['essen', 'food', 'lecker'],
  'musik': ['musik', 'konzert', 'vibe'],
};

// Vorberechnete Liste für schnellen Durchlauf.
const TRIGGER_ENTRIES = Object.entries(TRIGGERS).map(([k, v]) => [fold(k), v.map(fold)]);

// ── Ebene C: optionale KI-Anbindung ────────────────────────────────────────
// Ruft die Supabase-Funktion `mood_text_to_tags` auf, die Such-Tags aus dem
// Freitext erzeugt. Der API-Key liegt server-seitig im Supabase Vault (kein
// Vercel-Env nötig); die Funktion ist global rate-limitiert. Ohne Key oder bei
// jedem Fehler kommt [] zurück und die App bleibt voll funktionsfähig (A + B).
async function aiTags(text) {
  try {
    const { data, error } = await sb.rpc('mood_text_to_tags', { p_text: text });
    if (error) return [];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

// ── Texteingabe → Such-Tags ────────────────────────────────────────────────
async function textToTags(text) {
  const norm = fold(text);
  const tags = new Set();

  // Ebene A: Synonym-/Keyword-Auslöser
  for (const [trigger, mapped] of TRIGGER_ENTRIES) {
    if (norm.includes(trigger)) mapped.forEach(t => tags.add(t));
  }

  // Ebene B: zusätzlich aussagekräftige Eigenwörter als rohe Tags übernehmen
  // (z. B. „palmen", „kaffee") — Stoppwörter und zu kurze Tokens raus.
  for (const w of norm.split(/[^a-z0-9]+/)) {
    if (w.length >= 4 && !STOPWORDS.has(w)) tags.add(w);
  }

  // Ebene C: nur ergänzen, wenn die Regeln wenig hergeben (spart Kosten/Latenz)
  if (tags.size < 2) {
    const ai = await aiTags(text);
    ai.forEach(t => tags.add(fold(t)));
  }

  return [...tags];
}

// ── Bild-Matching / Ranking ────────────────────────────────────────────────
// Score je Bild: exakter Tag-Treffer zählt stark, Teil-/Ähnlichkeitstreffer
// (Substring in beide Richtungen) zählt schwach — so greifen bei wenigen
// exakten Treffern auch ähnliche Tags.
//
// Hinweis für später: Für semantische Suche (statt reinem String-Match) ließe
// sich hier pgvector einsetzen — Bild-Tags + Eingabe als Embeddings ablegen und
// per Cosine-Distanz ranken. Die Schnittstelle (textToTags + rankImages) bliebe
// gleich; nur rankImages würde gegen eine RPC `match_images(embedding)` tauschen.
function rankImages(searchTags, items) {
  const st = [...new Set(searchTags.map(fold))].filter(Boolean);
  if (!st.length) return [];
  const scored = [];
  for (const it of items) {
    const tags = (it.ai_tags || []).map(fold);
    if (!tags.length) continue;
    let score = 0;
    for (const s of st) {
      if (tags.includes(s)) score += 3;
      else if (tags.some(t => t.includes(s) || s.includes(t))) score += 1;
    }
    if (score > 0) scored.push({ it, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map(x => x.it);
}

// ── Bild-Cache ─────────────────────────────────────────────────────────────
// Nur einmal pro Session laden (Performance): ausschließlich fertig getaggte
// Bilder und nur die wirklich benötigten Spalten.
let _cache = null;
let _cachePromise = null;
async function loadTaggedImages() {
  if (_cache) return _cache;
  if (_cachePromise) return _cachePromise;
  _cachePromise = (async () => {
    const { data, error } = await sb
      .from('moodboard_items')
      .select('id,media_url,media_type,ai_tags')
      .in('media_type', ['image', 'gif'])
      .eq('ai_status', 'processed')
      .order('created_at', { ascending: false });
    if (error) throw error;
    _cache = (data || []).filter(it => Array.isArray(it.ai_tags) && it.ai_tags.length);
    return _cache;
  })();
  try {
    return await _cachePromise;
  } finally {
    _cachePromise = null;
  }
}

// ── UI-Controller ──────────────────────────────────────────────────────────
const SUGGESTIONS = [
  'Bock auf Urlaub',
  'hab schlechte Laune',
  'ich bin gestresst',
  'zeig mir was Motivierendes',
  'was Beruhigendes',
  'cozy Vibes',
];

function initMoodChat() {
  const panel = $('moodChatPanel');
  const chatBtn = $('chatBtn');
  if (!panel || !chatBtn) return;

  const form = $('mcForm');
  const input = $('mcInput');
  const sendBtn = $('mcSend');
  const suggestEl = $('mcSuggest');
  const statusEl = $('mcStatus');

  // Vorschlags-Chips rendern
  suggestEl.innerHTML = SUGGESTIONS
    .map(s => `<button class="mc-chip" type="button" data-q="${s.replace(/"/g, '&quot;')}">${s}</button>`)
    .join('');
  suggestEl.querySelectorAll('.mc-chip').forEach(btn => {
    btn.onclick = () => { input.value = btn.dataset.q; runSearch(btn.dataset.q); };
  });

  // ── Panel öffnen / schließen ──
  function openPanel() {
    panel.classList.add('show');
    panel.setAttribute('aria-hidden', 'false');
    chatBtn.classList.add('active');
    loadTaggedImages().catch(() => {}); // schon mal vorladen
    setTimeout(() => input.focus(), 220);
  }
  function closePanel() {
    panel.classList.remove('show');
    panel.setAttribute('aria-hidden', 'true');
    chatBtn.classList.remove('active');
  }
  function togglePanel() {
    panel.classList.contains('show') ? closePanel() : openPanel();
  }

  chatBtn.addEventListener('click', e => { e.stopPropagation(); togglePanel(); });
  $('mcClose').addEventListener('click', closePanel);
  // Klick außerhalb schließt das Panel (aber nicht beim Tippen darin / Button)
  document.addEventListener('click', e => {
    if (!panel.classList.contains('show')) return;
    if (e.target.closest('#moodChatPanel') || e.target.closest('#chatBtn')) return;
    closePanel();
  });
  input.addEventListener('keydown', e => { if (e.key === 'Escape') closePanel(); });

  // ── Status-Zeile ──
  function setStatus(kind, html) {
    statusEl.className = 'mc-status show' + (kind ? ' is-' + kind : '');
    statusEl.innerHTML = html || '';
    const reset = statusEl.querySelector('.mc-reset');
    if (reset) reset.onclick = resetGrid;
  }
  function clearStatus() {
    statusEl.className = 'mc-status';
    statusEl.innerHTML = '';
  }
  function resetGrid() {
    clearStatus();
    input.value = '';
    window.MB?.clearChatResults?.();
  }

  let _runToken = 0;
  async function runSearch(text) {
    const q = (text ?? input.value ?? '').trim();
    if (!q) { input.focus(); return; }
    const token = ++_runToken;

    sendBtn.classList.add('is-busy');
    setStatus('loading', '<span class="mc-spin"></span><span>Suche passende Bilder …</span>');

    let imgs, searchTags;
    try {
      [imgs, searchTags] = await Promise.all([loadTaggedImages(), textToTags(q)]);
    } catch (e) {
      if (token !== _runToken) return;
      sendBtn.classList.remove('is-busy');
      setStatus('error', 'Konnte gerade nicht laden. Versuch es nochmal.');
      return;
    }
    if (token !== _runToken) return; // veraltete Antwort verwerfen
    sendBtn.classList.remove('is-busy');

    const matched = rankImages(searchTags, imgs);
    const ids = matched.map(it => it.id);

    if (!imgs.length) {
      setStatus('empty', 'Noch keine getaggten Bilder vorhanden.');
      return;
    }
    if (!ids.length) {
      setStatus('empty', `Nichts zu „${q}" gefunden. Probier eine andere Stimmung 👀`);
      return;
    }

    // Treffer ans Haupt-Grid übergeben (keine Extraseite).
    const shown = window.MB?.showChatResults?.(ids) ?? ids.length;
    setStatus('', `<span>${shown} ${shown === 1 ? 'Bild' : 'Bilder'} zu „${escapeHtmlLite(q)}"</span>` +
      `<button class="mc-reset" type="button">Alle anzeigen</button>`);
  }

  form.addEventListener('submit', e => { e.preventDefault(); runSearch(); });
}

// Minimaler HTML-Escape für die Statuszeile.
function escapeHtmlLite(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initMoodChat);
} else {
  initMoodChat();
}
