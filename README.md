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

### Background auto-tagging (chatbot)

Images get a rich set of detailed German tags (mood + content, e.g. `urlaub`,
`sonnig`, `gute laune`, `strand`, `meer`) in the hidden `ai_tags` column. These
exist only so a chatbot can find images by mood/topic — they are **not** shown
in the grid, lightbox or editor, and the frontend never reads them. Everything
runs **server-side in Supabase**, so no app/frontend code is involved:

- **Vision model:** OpenRouter (`google/gemini-2.5-flash-lite`), called directly
  from Postgres via the `http` extension. The API key lives encrypted in
  **Supabase Vault** (`openrouter_api_key`) — never in the repo or frontend.
  The model is overridable via a Vault secret `openrouter_model`.
- **Tagging function:** `public.ai_tag_image(uuid)` reads the key from Vault,
  calls the model, normalises the result and writes `ai_tags` /
  `ai_status` / `ai_tagged_at`. It is owner/service-role only.
- **Automation (`pg_cron`):** `auto-tag-pending` tags new `pending` images every
  minute; `auto-tag-retry` retries `failed` images every 15 minutes. New uploads
  are inserted with `ai_status='pending'` (the column default) and get tagged
  within ~1 minute — no change to the upload flow, no added latency.

The full, reproducible SQL setup lives in [`db/ai_tagging.sql`](db/ai_tagging.sql).

## Environment

Supabase credentials are set directly in `js/app.js`. For local dev, replace with your own project URL and anon key.
