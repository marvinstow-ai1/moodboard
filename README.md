# Marvin's Place — Moodboard

Personal visual moodboard app. Upload images, GIFs and videos, organize them by mood.

**Live:** [moodboard-nine-bay.vercel.app](https://moodboard-nine-bay.vercel.app)

---

## Stack

- **Frontend:** Vanilla JS (ES Modules), CSS custom properties
- **Backend:** Supabase (PostgreSQL + Storage + Realtime)
- **Hosting:** Vercel
- **Animations:** GSAP 3 (ScrollTrigger included)

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

**Storage bucket:** `moodboard` (public)

### Background auto-tagging

On upload, images are analysed in the background (`/api/auto-tag`) and a rich
set of detailed German tags (mood + content, e.g. `urlaub`, `sonnig`,
`gute laune`, `strand`, `meer`) is written to `ai_tags`. These tags exist only
so a chatbot can find images by mood/topic — they are **not** shown in the grid,
lightbox or editor. A gentle owner-only backfill tags older images over time and
retries failures.

**Provider** (server-side env, pick one):

- `OPENROUTER_API_KEY` — preferred. OpenAI-compatible vision via OpenRouter.
  Model overridable with `OPENROUTER_MODEL` (default
  `google/gemini-2.0-flash-exp:free`).
- `GEMINI_API_KEY` — fallback, direct Google Gemini 2.0 Flash.

If neither is set, tagging stays idle (rows remain `pending`) and starts
automatically once a key is added.

## Environment

Supabase credentials are set directly in `js/app.js`. For local dev, replace with your own project URL and anon key.
