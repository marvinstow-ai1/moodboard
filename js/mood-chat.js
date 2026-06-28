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
  'weihnacht': ['winter', 'schnee', 'gemutlich', 'cozy', 'warm', 'kalt'],
  'xmas': ['winter', 'schnee', 'gemutlich', 'cozy', 'warm'],
  'herbst': ['herbst', 'natur', 'wald', 'gemutlich', 'warm'],
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

// Gesamter Stimmungs-Wortschatz (alle Auslöser + alle gemappten Tags). Wörter
// hieraus sind generische Mood-/Themen-Begriffe – also NIE ein „spezifisches"
// Suchziel wie ein Eigenname. Wird unten zur Intent-Erkennung gebraucht.
const MOOD_VOCAB = new Set();
for (const [k, v] of Object.entries(TRIGGERS)) {
  MOOD_VOCAB.add(fold(k));
  v.forEach(x => MOOD_VOCAB.add(fold(x)));
}

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
// Liefert ein strukturiertes Objekt zurück statt nur einer flachen Tag-Liste:
//   all     — alle Such-Tags (Stimmung + konkrete Wörter), fürs Scoring
//   literal — die vom Nutzer SELBST getippten konkreten Wörter (keine bekannten
//             Mood-Begriffe). Das sind die Kandidaten für ein „spezifisches"
//             Suchziel (z. B. ein Eigenname / ein konkretes Motiv).
// Diese Trennung erlaubt rankImages, automatisch zu erkennen, ob jemand breit
// nach einer Stimmung oder gezielt nach einer bestimmten Sache sucht.
async function textToTags(text) {
  const norm = fold(text);
  const all = new Set();
  const literal = new Set();

  // Ebene A: Synonym-/Keyword-Auslöser → breite Stimmungs-/Themen-Tags
  for (const [trigger, mapped] of TRIGGER_ENTRIES) {
    if (norm.includes(trigger)) mapped.forEach(t => all.add(t));
  }

  // Ebene B: aussagekräftige Eigenwörter als rohe Tags übernehmen
  // (z. B. „palmen", „messi") — Stoppwörter und zu kurze Tokens raus.
  // Wörter, die NICHT zum Stimmungs-Wortschatz gehören, sind potenzielle
  // konkrete Suchziele und kommen zusätzlich nach `literal`.
  for (const w of norm.split(/[^a-z0-9]+/)) {
    if (w.length < 4 || STOPWORDS.has(w)) continue;
    all.add(w);
    if (!MOOD_VOCAB.has(w)) literal.add(w);
  }

  // Ebene C: nur ergänzen, wenn die Regeln wenig hergeben (spart Kosten/Latenz).
  // KI-Tags landen NUR in `all` (fürs Ranking), nie in `literal` – sie sollen
  // eine gezielte Suche nicht heimlich verbreitern.
  if (all.size < 2) {
    const ai = await aiTags(text);
    ai.forEach(t => all.add(fold(t)));
  }

  return { all: [...all], literal: [...literal] };
}

// ── Korpus-Statistik (Tag-Häufigkeiten) ────────────────────────────────────
// Zählt, in wie vielen Bildern jeder Tag vorkommt (document frequency). Daraus
// leiten wir ab, wie „spezifisch" ein Tag ist: Ein Eigenname wie „drogba" steckt
// in sehr wenigen Bildern, ein generischer Tag wie „fussball" oder „cozy" in
// vielen. Wird einmal pro Bild-Bestand berechnet und gecacht.
let _stats = null;
function corpusStats(items) {
  if (_stats && _stats.n === items.length) return _stats;
  const df = new Map();
  for (const it of items) {
    const seen = new Set((it.ai_tags || []).map(fold).filter(Boolean));
    for (const t of seen) df.set(t, (df.get(t) || 0) + 1);
  }
  _stats = { n: items.length, df };
  return _stats;
}

// Treffer eines Such-Tags gegen einen Bild-Tag — wortgenau, nicht als blinder
// Substring. So matcht „drogba" auch den Bild-Tag „didier drogba" (ganzes Wort),
// aber NICHT zufällige Teilstrings, die sonst fremde Bilder reinziehen würden.
function tagHit(imageTag, s) {
  if (imageTag === s) return true;
  const iw = imageTag.split(/[^a-z0-9]+/);
  if (iw.includes(s)) return true;                 // s ist ein ganzes Wort im Bild-Tag
  const sw = s.split(/[^a-z0-9]+/);
  if (sw.length > 1 && sw.every(x => iw.includes(x))) return true;
  return false;
}

// ── Bild-Matching / Ranking ────────────────────────────────────────────────
// Erkennt automatisch, OB der Nutzer breit (Stimmung/Kategorie) oder gezielt
// (konkretes Motiv/Eigenname) sucht, und filtert entsprechend:
//
//   • SPEZIFISCH — Mindestens eines der vom Nutzer getippten konkreten Wörter
//     (`literal`) ist im Bestand selten (kommt in wenigen Bildern vor). Dann
//     will der Nutzer genau diese Sache → es werden NUR Bilder gezeigt, die
//     dieses seltene Ziel wirklich enthalten. Generische Tags (fussball, sport)
//     ziehen keine fremden Motive mehr rein. Mehrere konkrete Ziele werden
//     vereinigt („messi und ronaldo" → beide).
//
//   • BREIT — Es gibt kein seltenes konkretes Ziel (z. B. „cozy vibes",
//     „bock auf urlaub"). Dann werden wie gewohnt viele passende Bilder gezeigt.
//
// In beiden Fällen wird per IDF gewichtet: seltene Tags zählen stärker als
// allgegenwärtige, damit das relevanteste Bild oben steht.
//
// Hinweis für später: Für echte semantische Suche ließe sich hier pgvector
// einsetzen — Bild-Tags + Eingabe als Embeddings ablegen und per Cosine-Distanz
// ranken. Die Schnittstelle (textToTags + rankImages) bliebe gleich.
function rankImages(query, items) {
  const all = [...new Set((query.all || []).map(fold))].filter(Boolean);
  if (!all.length) return [];

  const stats = corpusStats(items);
  const N = stats.n || 1;
  const idf = s => Math.log((N + 1) / ((stats.df.get(s) || 0) + 1)) + 1;

  // Schwelle: Ein konkretes Wort gilt als „spezifisches Ziel", wenn es in
  // höchstens ~12 % der Bilder vorkommt (mit kleinem absoluten Mindestwert für
  // kleine Bestände). Was häufiger ist, ist faktisch eine breite Kategorie.
  const specificThreshold = Math.max(4, Math.ceil(N * 0.12));
  const literal = new Set((query.literal || []).map(fold));
  // Nur eigene Tipp-Wörter, die im Bestand SELTEN, aber ÜBERHAUPT vorhanden
  // sind, gelten als „spezifisches Ziel". Wichtig: df muss ≥ 1 sein. Ein Wort,
  // das in KEINEM Bild als Tag steckt (z. B. das Kompositum „weihnachtsbilder"
  // oder „sommerbilder"), kann nicht hart filtern – sonst würde der harte
  // Filter unten ausnahmslos ALLE Bilder verwerfen und das Grid bliebe leer.
  // Solche Wörter fallen daher in die breite Suche zurück, sodass eine erneute
  // Suche immer aus dem GESAMTEN Bestand passende (Stimmungs-)Bilder findet.
  const specificTags = all.filter(s => {
    if (!literal.has(s)) return false;           // nur eigene Tipp-Wörter zählen
    const dfc = stats.df.get(s) || 0;
    return dfc >= 1 && dfc <= specificThreshold; // selten, aber tatsächlich da
  });
  const isSpecific = specificTags.length > 0;

  const scored = [];
  for (const it of items) {
    const tags = (it.ai_tags || []).map(fold);
    if (!tags.length) continue;

    // Spezifische Suche: Bild MUSS mindestens ein konkretes Ziel enthalten.
    if (isSpecific && !specificTags.some(s => tags.some(t => tagHit(t, s)))) continue;

    let score = 0;
    for (const s of all) {
      const w = idf(s);
      if (tags.includes(s)) score += 3 * w;                       // exakter Treffer
      else if (tags.some(t => tagHit(t, s))) score += 2 * w;      // wortgenauer Treffer
      else if (s.length >= 5 && tags.some(t => t.includes(s) || s.includes(t)))
        score += 0.5 * w;                                         // schwache Ähnlichkeit
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
// Vorschläge als Emoji-Chips: nur ein passendes Apple-Emoji ist sichtbar,
// die eigentliche Such-Anfrage (`q`) und ein Label fürs Vorlesen/Tooltip
// stecken in den Datenattributen. Alle Chips passen in eine Reihe.
// Chips sind zweierlei Art:
//   • Stimmung  (`q`)   — Freitext, der durch die normale Fuzzy-Suche läuft.
//   • Kategorie (`cat`) — feste Liste von Tag-Bausteinen; es werden NUR Bilder
//                         gezeigt, deren ai_tags einen dieser Bausteine als
//                         Teilstring enthalten. So ist die Kategorie exklusiv
//                         (z. B. „Fußball" zeigt wirklich nur Fußball, nicht
//                         allgemeinen Sport).
const SUGGESTIONS = [
  { emoji: '🏖️', q: 'Bock auf Urlaub',           label: 'Bock auf Urlaub' },
  { emoji: '🌧️', q: 'hab schlechte Laune',        label: 'Schlechte Laune' },
  { emoji: '🎬', cat: ['anime', 'manga', 'film', 'kino', 'cartoon', 'comic', 'movie', 'serie'],
    label: 'Movies / Anime / Manga' },
  { emoji: '🏆', q: 'zeig mir was Motivierendes', label: 'Motivierendes' },
  { emoji: '🧘', q: 'was Beruhigendes',           label: 'Beruhigendes' },
  { emoji: '⚽️', cat: ['fussball', 'trikot', 'stadion', 'torjubel', 'torjäger', 'messi', 'ronaldo', 'champions league'],
    label: 'Fußball' },
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

  // Vorschlags-Chips rendern (Emoji sichtbar, Label im aria-label/title)
  suggestEl.innerHTML = SUGGESTIONS
    .map((s, i) => `<button class="mc-chip" type="button" data-i="${i}" ` +
      `aria-label="${s.label.replace(/"/g, '&quot;')}" title="${s.label.replace(/"/g, '&quot;')}">` +
      `<span aria-hidden="true">${s.emoji}</span></button>`)
    .join('');
  suggestEl.querySelectorAll('.mc-chip').forEach(btn => {
    btn.onclick = () => {
      const s = SUGGESTIONS[+btn.dataset.i];
      if (s.cat) { runCategory(s.cat, s.label); }
      else { input.value = s.q; runSearch(s.q); }
    };
  });

  // Quick-Chip „Zuletzt hinzugefügt": wechselt direkt zur Recent-Ansicht
  // (ersetzt den früheren Eintrag aus dem Header-Dropdown) und schließt das Panel.
  const recentChip = $('mcRecentChip');
  if (recentChip) {
    recentChip.onclick = () => {
      clearStatus();
      window.MB?.showRecentView?.();
      closePanel();
    };
  }

  // ── Dynamische Placeholder-Vorschau ──
  // Tippt im leeren Eingabefeld nacheinander Vorschläge als Placeholder ein
  // (Buchstabe für Buchstabe), löscht sie wieder und loopt über die Liste.
  // Sobald der Nutzer selbst etwas tippt, ruht die Animation und der
  // Placeholder bleibt leer.
  const PLACEHOLDER_PHRASES = ['Bock auf Urlaub', 'Gute Laune', 'Fußball', 'Nostalgie'];
  let _phTimer = null;
  function stopPlaceholder() {
    if (_phTimer) { clearTimeout(_phTimer); _phTimer = null; }
  }
  function startPlaceholder() {
    stopPlaceholder();
    let phrase = 0, char = 0, deleting = false;
    const tick = () => {
      // Pausieren, solange der Nutzer eigenen Text im Feld hat.
      if (input.value) { input.placeholder = ''; _phTimer = setTimeout(tick, 400); return; }
      const full = PLACEHOLDER_PHRASES[phrase];
      if (!deleting) {
        char++;
        input.placeholder = full.slice(0, char);
        if (char >= full.length) { deleting = true; _phTimer = setTimeout(tick, 1500); return; }
        _phTimer = setTimeout(tick, 90);
      } else {
        char--;
        input.placeholder = full.slice(0, char);
        if (char <= 0) {
          deleting = false;
          phrase = (phrase + 1) % PLACEHOLDER_PHRASES.length;
          _phTimer = setTimeout(tick, 350);
          return;
        }
        _phTimer = setTimeout(tick, 45);
      }
    };
    tick();
  }

  // ── Tastatur-Handling (iOS) ──
  // Statt die Seite beim Fokus reinzuzoomen (verhindert über font-size:16px am
  // Input) lassen wir das Panel sanft über die eingeblendete Apple-Tastatur
  // gleiten. Die Tastaturhöhe ergibt sich aus dem VisualViewport: Differenz
  // zwischen Layout-Viewport und sichtbarem Bereich. Wird als CSS-Variable
  // `--mc-kb` ans Panel gegeben; die Position animiert per CSS-Transition.
  const vv = window.visualViewport;
  function syncKeyboard() {
    if (!vv || !panel.classList.contains('show')) return;
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    panel.style.setProperty('--mc-kb', kb + 'px');
  }
  if (vv) {
    vv.addEventListener('resize', syncKeyboard);
    vv.addEventListener('scroll', syncKeyboard);
  }

  // ── Panel öffnen / schließen ──
  function openPanel() {
    // Immer frisch starten: alte Eingabe und Status verwerfen, damit beim
    // erneuten Öffnen nicht der letzte Suchbegriff stehen bleibt.
    input.value = '';
    clearStatus();
    panel.classList.add('show');
    panel.setAttribute('aria-hidden', 'false');
    chatBtn.classList.add('active');
    loadTaggedImages().catch(() => {}); // schon mal vorladen
    startPlaceholder();                 // Tipp-Vorschau im Eingabefeld starten
    setTimeout(() => input.focus(), 220);
  }
  function closePanel() {
    panel.classList.remove('show');
    panel.setAttribute('aria-hidden', 'true');
    chatBtn.classList.remove('active');
    stopPlaceholder();
    panel.style.setProperty('--mc-kb', '0px'); // Tastatur-Offset zurücksetzen
  }
  function togglePanel() {
    panel.classList.contains('show') ? closePanel() : openPanel();
  }

  // Schließen von außen erreichbar machen (z. B. damit ein Klick auf ein Bild
  // bei offenem Panel zuerst nur das Panel schließt, statt das Bild zu öffnen).
  window.MB = window.MB || {};
  window.MB.closeChat = closePanel;

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

    let imgs, query;
    try {
      [imgs, query] = await Promise.all([loadTaggedImages(), textToTags(q)]);
    } catch (e) {
      if (token !== _runToken) return;
      sendBtn.classList.remove('is-busy');
      setStatus('error', 'Konnte gerade nicht laden. Versuch es nochmal.');
      return;
    }
    if (token !== _runToken) return; // veraltete Antwort verwerfen
    sendBtn.classList.remove('is-busy');

    const matched = rankImages(query, imgs);
    const ids = matched.map(it => it.id);

    if (!imgs.length) {
      setStatus('empty', 'Noch keine getaggten Bilder vorhanden.');
      return;
    }
    if (!ids.length) {
      setStatus('empty', `Nichts zu „${escapeHtmlLite(q)}" gefunden. Probier eine andere Stimmung 👀`);
      return;
    }

    // Es gibt Treffer → ans Haupt-Grid übergeben und den Chat komplett
    // schließen, damit man voll auf die Ergebnisse fokussiert ist. Beim
    // „nichts gefunden"-Fall (oben mit return) bleibt der Chat samt Tastatur
    // offen, sodass man direkt etwas anderes eintippen kann.
    window.MB?.showChatResults?.(ids);
    input.blur();
    closePanel();
  }

  // ── Kategorie-Suche ────────────────────────────────────────────────────────
  // Zeigt ausschließlich Bilder, deren ai_tags einen der Kategorie-Bausteine als
  // Teilstring enthalten (z. B. „fussball" matcht auch „fussballspieler"). Keine
  // Fuzzy-/Stimmungslogik, damit die Kategorie wirklich exklusiv bleibt.
  async function runCategory(tags, label) {
    const token = ++_runToken;
    sendBtn.classList.add('is-busy');
    setStatus('loading', '<span class="mc-spin"></span><span>Suche passende Bilder …</span>');

    let imgs;
    try {
      imgs = await loadTaggedImages();
    } catch (e) {
      if (token !== _runToken) return;
      sendBtn.classList.remove('is-busy');
      setStatus('error', 'Konnte gerade nicht laden. Versuch es nochmal.');
      return;
    }
    if (token !== _runToken) return; // veraltete Antwort verwerfen
    sendBtn.classList.remove('is-busy');

    const needles = tags.map(fold);
    const ids = imgs
      .filter(it => (it.ai_tags || []).some(t => {
        const ft = fold(t);
        return needles.some(n => ft.includes(n));
      }))
      .map(it => it.id);

    if (!imgs.length) {
      setStatus('empty', 'Noch keine getaggten Bilder vorhanden.');
      return;
    }
    if (!ids.length) {
      setStatus('empty', `Keine Bilder in „${escapeHtmlLite(label)}" gefunden 👀`);
      return;
    }

    window.MB?.showChatResults?.(ids);
    input.blur();
    closePanel();
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
