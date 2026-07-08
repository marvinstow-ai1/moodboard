-- ============================================================
-- Gate-Swiper: öffentliche Mini-Auswahl für die Login-Startpage
-- ------------------------------------------------------------
-- Repo-Kopie der Migration "gate_teaser_fixed_selection" (per
-- apply_migration auf dem Supabase-Projekt angewendet; löst die
-- ältere Migration "gate_teaser_swiper" ab).
--
-- Das Gate (Startpage vor dem Login) zeigt zwei fließende Bild-Reihen
-- aus der Galerie. Die Items-Tabelle bleibt für Anonyme per RLS
-- gesperrt (siehe access_control.sql); diese SECURITY-DEFINER-Funktion
-- gibt stattdessen nur eine gedeckelte Auswahl an Medien-URLs heraus –
-- keine Titel, Moods oder Tags.
--
-- Die Auswahl ist FEST statt zufällig: pro Kategorie (KI-Tag) werden
-- deterministisch dieselben Bilder gezogen (Favoriten zuerst, dann die
-- ältesten). So zeigt das Gate bei jedem Besuch dieselben Kacheln und
-- der Browser kann sie aus dem HTTP-Cache laden – das Gate baut sich
-- dadurch auch deutlich schneller auf.
--
-- Echte Videos sind ausgenommen: das Gate zeigt nur Bilder und
-- GIF-Clips (konvertierte GIFs haben media_type 'image', ihre
-- media_url zeigt auf eine .mp4-Datei).
-- ============================================================

create or replace function public.gate_teaser(n int default 20)
returns table (media_url text, media_type text, thumb_url text)
language sql stable security definer
set search_path = public
as $$
  with cats(ord, tag) as (
    values (1,'anime'),(2,'fussball'),(3,'natur'),(4,'urban'),(5,'sommer'),
           (6,'nacht'),(7,'sport'),(8,'wasser'),(9,'himmel'),(10,'episch')
  ),
  picks as (
    select c.ord, x.id, x.media_url, x.media_type, x.thumb_url, x.rn
    from cats c
    cross join lateral (
      select i.id, i.media_url, i.media_type, i.thumb_url,
             row_number() over (order by i.favorite desc, i.created_at, i.id) as rn
      from public.moodboard_items i
      where coalesce(i.media_type, 'image') <> 'video'
        and i.ai_tags @> array[c.tag]
      order by i.favorite desc, i.created_at, i.id
      limit 4
    ) x
  ),
  -- Ein Bild kann mehrere Kategorie-Tags tragen – jede Kachel nur einmal.
  dedup as (
    select distinct on (id) id, media_url, media_type, thumb_url, ord, rn
    from picks
    order by id, rn, ord
  ),
  -- Auffüllen, falls die Kategorien nicht genug hergeben (z. B. Bilder
  -- ohne KI-Tags): ebenfalls deterministisch, nie zufällig.
  fill as (
    select i.id, i.media_url, i.media_type, i.thumb_url, 99 as ord,
           100 + row_number() over (order by i.favorite desc, i.created_at, i.id) as rn
    from public.moodboard_items i
    where coalesce(i.media_type, 'image') <> 'video'
      and not exists (select 1 from dedup d where d.id = i.id)
    order by i.favorite desc, i.created_at, i.id
    limit 40
  )
  -- rn zuerst: Reihe 1 bekommt aus jeder Kategorie das erste Bild,
  -- Reihe 2 das zweite – bunte Mischung statt Kategorie-Blöcke.
  select media_url, media_type, thumb_url
  from (select * from dedup union all select * from fill) u
  order by rn, ord
  limit least(greatest(coalesce(n, 20), 1), 40);
$$;
revoke all on function public.gate_teaser(int) from public;
grant execute on function public.gate_teaser(int) to anon, authenticated;
