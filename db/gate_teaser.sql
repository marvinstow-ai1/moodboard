-- ============================================================
-- Gate-Swiper: öffentliche Mini-Auswahl für die Login-Startpage
-- ------------------------------------------------------------
-- Repo-Kopie der Migration "gate_teaser_swiper" (per apply_migration
-- auf dem Supabase-Projekt angewendet).
--
-- Das Gate (Startpage vor dem Login) zeigt zwei fließende Bild-Reihen
-- aus der Galerie. Die Items-Tabelle bleibt für Anonyme per RLS
-- gesperrt (siehe access_control.sql); diese SECURITY-DEFINER-Funktion
-- gibt stattdessen nur eine zufällige, gedeckelte Auswahl an
-- Medien-URLs heraus – keine Titel, Moods oder Tags.
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
  select media_url, media_type, thumb_url
  from public.moodboard_items
  where coalesce(media_type, 'image') <> 'video'
  order by random()
  limit least(greatest(coalesce(n, 20), 1), 40);
$$;
revoke all on function public.gate_teaser(int) from public;
grant execute on function public.gate_teaser(int) to anon, authenticated;
