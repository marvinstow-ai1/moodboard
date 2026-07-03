-- ============================================================
-- Gästebuch für Marvin's Place
-- ------------------------------------------------------------
-- Freigegebene Freunde (und der Owner) hinterlassen Name,
-- Instagram-Handle und eine gemalte Unterschrift. Die Unter-
-- schrift wird clientseitig als PNG in den Storage-Bucket
-- `moodboard` unter guestbook/ hochgeladen; hier steht nur die
-- fertige URL. Diese Datei ist die Repo-Kopie der Migration,
-- die auf dem Supabase-Projekt angewendet wurde
-- (apply_migration: "guestbook").
--
--  * guestbook_entries – ein Eintrag pro Signatur. Lesen dürfen
--                        alle Mitglieder (Owner + Freigegebene,
--                        gleiche Regel wie die Galerie), schreiben
--                        nur für sich selbst (user_id = auth.uid()),
--                        löschen nur der Owner.
--  * Storage-Ausnahme  – der Bucket ist sonst owner-only
--                        beschreibbar (db/access_control.sql);
--                        Mitglieder dürfen zusätzlich NUR in den
--                        Ordner guestbook/ hochladen.
-- ============================================================

create table if not exists public.guestbook_entries (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid(),
  name          text not null check (char_length(name) between 1 and 60),
  instagram     text check (instagram is null or char_length(instagram) <= 60),
  signature_url text not null,
  created_at    timestamptz not null default now()
);

create index if not exists guestbook_entries_created_idx
  on public.guestbook_entries (created_at desc);

alter table public.guestbook_entries enable row level security;

-- Lesen: Owner + freigegebene Freunde (wie die Galerie).
drop policy if exists member_read on public.guestbook_entries;
create policy member_read on public.guestbook_entries
  for select to authenticated
  using (
    ((auth.jwt() -> 'app_metadata') ->> 'role') = 'owner'
    or public.gate_ok()
  );

-- Schreiben: jedes Mitglied, aber nur unter der eigenen user_id.
drop policy if exists member_insert on public.guestbook_entries;
create policy member_insert on public.guestbook_entries
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and (
      ((auth.jwt() -> 'app_metadata') ->> 'role') = 'owner'
      or public.gate_ok()
    )
  );

-- Aufräumen: nur der Owner darf Einträge löschen.
drop policy if exists owner_delete on public.guestbook_entries;
create policy owner_delete on public.guestbook_entries
  for delete to authenticated
  using (((auth.jwt() -> 'app_metadata') ->> 'role') = 'owner');

-- ── Storage: Mitglieder dürfen Signaturen hochladen ──────────
-- Nur INSERT und nur in den Ordner guestbook/ – der Rest des
-- Buckets bleibt owner-only (siehe db/access_control.sql).
drop policy if exists guestbook_upload on storage.objects;
create policy guestbook_upload on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'moodboard'
    and (storage.foldername(name))[1] = 'guestbook'
    and (
      ((auth.jwt() -> 'app_metadata') ->> 'role') = 'owner'
      or public.gate_ok()
    )
  );
