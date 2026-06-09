# Marvin's Place — Moodboard

Personal visual moodboard app. Upload images, GIFs and videos, organize them by mood.

**Live:** [moodboard-nine-bay.vercel.app](https://moodboard-nine-bay.vercel.app)

---

## Stack

- **Frontend:** Vanilla JS (ES Modules), single CSS file, minimal monochrome design
- **Backend:** Supabase (PostgreSQL + Storage + Realtime)
- **Hosting:** Vercel
- **Animations:** GSAP 3

## Structure

```
moodboard/
├── index.html        # HTML structure
├── css/
│   └── style.css     # All styles (design tokens + components)
├── js/
│   └── app.js        # Application logic
├── api/
│   └── suggest-moods.js  # AI mood suggestion endpoint (Gemini Vision)
└── README.md
```

## Features

- Upload images (JPEG/PNG compressed to WebP, max 1920px), GIFs and videos
- Parallel uploads (3 concurrent), drag and drop, paste from clipboard
- Quick add via URL
- AI mood suggestions on upload
- Organize by mood tags, multi-select OR filter
- Adjustable grid columns (slider, persisted)
- Lightbox with swipe/keyboard navigation, ambient background, download and share deep links
- Slideshow with fullscreen and sleep mode
- Moods overview with cover tiles, mood management
- Custom pages (create/delete, own navigation)
- Selection mode with bulk delete
- Realtime sync across devices
- Shuffle or sort by date
- Spotify playlist player

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

**Table:** `pages` — custom sub pages (`id`, `name`, `slug`, `sort_order`, `created_at`)

**Storage bucket:** `moodboard` (public)

## Environment

Supabase credentials are set directly in `js/app.js`. For local dev, replace with your own project URL and anon key.
