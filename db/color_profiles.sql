-- ============================================================================
-- Farbprofile für die Mood-Chat-Farbsuche
-- ----------------------------------------------------------------------------
-- Die Farbsuche im Chat („blau" -> nur Bilder, die wirklich blau sind) lief
-- früher rein im Browser: bei der ersten Farbsuche wurden ALLE Bilder geladen
-- und pixelweise analysiert. Das war sehr langsam (hunderte Bild-Downloads pro
-- Session) und passierte in jedem Browser aufs Neue.
--
-- Stattdessen wird das Farbprofil jetzt EINMAL berechnet und hier gespeichert:
--   • beim Upload direkt aus dem ohnehin dekodierten Canvas (kostenlos), und
--   • für Bestandsbilder per einmaligem Owner-Backfill („Medien optimieren").
-- Die Suche ist danach ein reiner In-Memory-Filter über die ohnehin geladenen
-- Items — kein Bild-Download pro Suche, keine API-Calls.
--
-- Format: 12 Ganzzahlen in Promille (0..1000), feste Bucket-Reihenfolge:
--   [rot, orange, gelb, gruen, tuerkis, blau, lila, pink, braun, schwarz, grau, weiss]
-- NULL = noch nicht analysiert. Die Reihenfolge entspricht COLOR_KEYS in
-- js/color-profile.js und darf NICHT umsortiert werden.
-- ============================================================================

alter table public.moodboard_items
  add column if not exists colors smallint[];

comment on column public.moodboard_items.colors is
  'Dominant-colour profile: 12 per-mille buckets [rot,orange,gelb,gruen,tuerkis,blau,lila,pink,braun,schwarz,grau,weiss]. NULL = not analysed.';
