# Marvin's Place — Moodboard

Personal visual moodboard app. Upload images, GIFs and videos, organize them by mood.

**Live:** [marvinsplace.live](https://marvinsplace.live)

---

## Stack

- **Frontend:** Vanilla JS (ES Modules), CSS custom properties
- **Backend:** Supabase (PostgreSQL + Storage + Realtime)
- **Hosting:** Vercel
- **Animations:** GSAP 3

## Structure

```
moodboard/
├── index.html        # HTML structure
├── css/
│   └── style.css     # All styles
├── js/
│   └── app.js        # Application logic
└── README.md
```

## Features

- Upload images (JPEG/PNG → WebP compressed), GIFs and videos
- Parallel uploads (3 concurrent), max 1920px
- Organize by mood tags
- Favorites with double-click/tap
- Lightbox with swipe navigation
- Slideshow with fullscreen
- Realtime sync across devices
- Share links (deep links)
- Shuffle or sort by date
- **Autoplay-Killswitch** — toggle in the tile-size popup to freeze GIFs/videos in the grid (per-browser, saved in `localStorage`, doesn't affect other visitors)
- **Mood-Chat search** — type a mood/wish, get matching images (see below)
- **3D-Modell-Inventar** — a separate "3D Modelle" page (opened from the navigation pop-up) that shows uploaded 3D models as an inventory, 3 per row, each rotating on its own pedestal (see below)

## Database

**Table:** `moodboard_items`

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| title | text | File name |
| moods | text[] | Mood tags |
| tags | text[] | Custom tags |
| media_url | text | Supabase Storage URL |
| media_type | text | `image`, `gif`, `video` |
| favorite | boolean | Favorited |
| created_at | timestamptz | Upload timestamp |
| ai_tags | text[] | Auto-generated detailed tags for the chatbot (hidden, never shown in UI) |
| ai_status | text | `pending` / `processed` / `failed` (background tagging state) |
| ai_tagged_at | timestamptz | When auto-tagging last ran |
| colors | smallint[] | Precomputed dominant-colour profile (12 per-mille buckets) for the chat colour search. `NULL` = not analysed. See [`db/color_profiles.sql`](db/color_profiles.sql). |

**Storage bucket:** `moodboard` (public)

### Background auto-tagging (chatbot)

Images **and GIFs** get a rich set of detailed tags (25–40 each) in the hidden
`ai_tags` column. These exist only so a chatbot can find media by mood, topic
**and concrete names** — they are **not** shown in the grid, lightbox or editor,
and the frontend never reads them. Everything runs **server-side in Supabase**,
so no app/frontend code is involved:

- **What gets tagged:** named entities when clearly recognisable (people, clubs,
  brands, places, movies/characters/memes — e.g. `victor osimhen`, `ssc napoli`,
  `rush hour`), descriptive content (objects, colours, season, activity), mood
  words, and colloquial Gen-Z slang (`goat`, `drip`, `vibes`, `legende`). The
  model is told **not to guess names** when unsure, to avoid false IDs.
- **Vision model:** OpenRouter (`google/gemini-2.5-flash`), called directly from
  Postgres via the `http` extension. The API key lives encrypted in **Supabase
  Vault** (`openrouter_api_key`) — never in the repo or frontend. The model is
  overridable via a Vault secret `openrouter_model`.
- **Tagging function:** `public.ai_tag_image(uuid)` reads the key from Vault,
  calls the model, normalises the result and writes `ai_tags` / `ai_status` /
  `ai_tagged_at`. It is owner/service-role only.
- **Automation (`pg_cron`):** `auto-tag-pending` tags new `pending` media every
  minute (self-parallelising via `for update skip locked`); `auto-tag-retry`
  retries `failed` media every 15 minutes. New uploads are inserted with
  `ai_status='pending'` (the column default) and get tagged within ~1 minute —
  no change to the upload flow, no added latency.

The full, reproducible SQL setup lives in [`db/ai_tagging.sql`](db/ai_tagging.sql).

### Mood-Chat search

A round chat button in the bottom bar opens a small chat panel. Type a short
mood or wish — e.g. *"Bock auf Urlaub"*, *"hab schlechte Laune"*,
*"ich bin gestresst"* — and the best-matching images appear **directly in the
main grid** (no separate page). A "Alle anzeigen" button resets the grid.
**No image is re-analysed per request**; it matches against the pre-computed
`ai_tags`.

The text → search-tags translation has three layers
([`js/mood-chat.js`](js/mood-chat.js)):

- **Layer A** — keyword & synonym mappings (`TRIGGERS`): maps intents/moods to
  search tags (e.g. `urlaub` → `urlaub, reise, sonne, strand, meer`).
- **Layer B** — rule-based normalisation: lowercasing, umlaut/accent folding
  (so `gemütlich`/`grün` still match), tokenisation and stop-word removal.
- **Layer C** — *optional* cheap LLM via the Supabase function
  `mood_text_to_tags` (OpenRouter, key read from **Vault** — no Vercel env
  needed; globally rate-limited). It only kicks in when the rules yield little,
  and returns `[]` on any error — **the app works fully without any paid AI**
  (Layers A + B alone).

Matching ([`rankImages`](js/mood-chat.js)) **auto-detects search intent** from
how rare each tag is across the whole library (a tag's document frequency):

- **Specific search** — when one of the words you typed yourself is rare in the
  library (e.g. a named entity like `drogba`, present in only a few images),
  only images that actually contain that target are shown. Generic shared tags
  (`fussball`, `sport`) no longer drag in unrelated subjects. Multiple specific
  targets are unioned (`messi und ronaldo` → both).
- **Broad search** — when there's no rare target (e.g. `cozy vibes`,
  `bock auf urlaub`), many matching images are shown, as before.

Either way, scoring is IDF-weighted (rare tags count more than ubiquitous ones)
so the most relevant image ranks first, and tag hits are matched word-by-word
rather than as blind substrings. The tagged-image list is fetched once per
session and cached. For true semantic search later, `rankImages` can be swapped
for a pgvector similarity query — the `textToTags` → match interface stays the
same (see the note in the source).

#### Colour search

Type a plain colour word — *"blau"*, *"rot grün"*, *"grünes"* — and only images
that are **actually dominated by that colour** are shown (typing `blau` never
returns greenish images). There are **no colour tiles in the UI** anymore; the
colour search lives entirely in the chat input (`detectColorQuery` recognises
pure colour words and routes to `runColorSearch`).

It is **fast and runs without any per-search image downloads or API calls**:
every image's dominant-colour profile (12 per-mille buckets: red, orange,
yellow, green, teal, blue, purple, pink, brown, black, grey, white) is
**precomputed once and stored in the `colors` column**. New uploads compute it
for free from the canvas they're already decoded on; existing media is filled in
by a one-time owner backfill (*"Farbprofile berechnen"*). The owner media tools
are **split into independent buttons** — *Bilder optimieren*, *GIFs optimieren*,
*Farbprofile berechnen* — so each runs on its own instead of one long action.
The search
is then a pure in-memory filter over the already-loaded list. A colour "counts"
only if it truly dominates the image (dominance + coverage thresholds in
`colorMetrics`). Shared logic lives in [`js/color-profile.js`](js/color-profile.js);
the column is documented in [`db/color_profiles.sql`](db/color_profiles.sql).
Images still lacking a profile fall back to an instant `ai_tags` colour-word
match (no download) until the backfill runs.

### 3D-Modell-Inventar

A dedicated **"3D Modelle"** page — reachable as a fourth card in the navigation
pop-up (the compass button) — shows all uploaded 3D models as an **inventory in a
fixed 3-per-row grid**. Each model rotates live on its own **pedestal
("Plattform")** and can be tapped to open large in a fullscreen viewer with full
drag-to-rotate / pinch-to-zoom controls.

- **Rendering:** Google [`<model-viewer>`](https://modelviewer.dev/) (loaded from
  CDN in `index.html`). Because model-viewer **auto-frames** every model, all
  models appear at the **same size in the grid regardless of the source model's
  scale** — i.e. they're "size-adjusted on upload" automatically. Files are
  `.glb` (preferred, single self-contained file) or `.gltf`.
- **Pedestals:** each model stands on a stylized podium. Six styles are available
  from a dropdown in the upload sheet — `obsidian`, `marble`, `neon`, `gold`,
  `glass`, `wood` — rendered purely in CSS (`css/models3d.css`).
- **Upload (owner only):** a floating *"Modell hochladen"* button opens a sheet
  with a title field, a `.glb`/`.gltf` drop-zone and the pedestal dropdown. The
  file is uploaded to the `moodboard` storage bucket under `models/`; the record
  (title, URL, pedestal) lands in `public.models_3d`.
- Logic lives in [`js/models3d.js`](js/models3d.js); the table and RLS are
  documented in [`db/models_3d.sql`](db/models_3d.sql).

**Table:** `models_3d`

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| title | text | Model name |
| model_url | text | Supabase Storage URL (`.glb`/`.gltf`) |
| pedestal | text | Podium style: `obsidian` / `marble` / `neon` / `gold` / `glass` / `wood` |
| created_at | timestamptz | Upload timestamp |

RLS mirrors the guestbook: **members read** (owner + approved friends), **owner
only** inserts and deletes. Storage stays owner-only writable
(`db/access_control.sql`), so no extra storage policy is needed — uploads go to
`models/`.

## Environment

Supabase credentials are set directly in `js/app.js`. For local dev, replace with your own project URL and anon key.
