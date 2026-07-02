-- ============================================================
-- Zugriffskontrolle ("Gate") für Marvin's Place
-- ------------------------------------------------------------
-- Wer die App sehen will, muss vorher per E-Mail + Name Zugriff
-- anfragen. Der Owner nimmt Anfragen an oder lehnt sie ab.
-- Diese Datei ist die Repo-Kopie der Migration, die auf dem
-- Supabase-Projekt angewendet wurde (apply_migration:
-- "access_control_gate").
--
--  * access_requests  – Anfragen mit Status pending/approved/blocked.
--                       Nur der Owner darf sie lesen; alle Änderungen
--                       laufen über die Edge Function `gate`
--                       (Service Role), damit im Client nichts von
--                       E-Mails/Namen sichtbar ist.
--  * gate_ok()        – prüft serverseitig, ob der eingeloggte User
--                       eine freigegebene Anfrage hat. SECURITY
--                       DEFINER, damit die RLS-Policies der Galerie
--                       die Tabelle lesen dürfen, ohne sie für
--                       Clients zu öffnen.
--  * Lesesperre       – moodboard_items/moods/pages sind nicht mehr
--                       öffentlich lesbar, sondern nur für Owner und
--                       freigegebene Freunde.
--  * Storage-Fix      – Upload/Update/Delete im Bucket `moodboard`
--                       nur noch für den Owner (vorher: jeder!).
--                       Lesen bleibt öffentlich, damit die direkten
--                       Bild-URLs im Grid weiter funktionieren.
-- ============================================================

-- ── Zugriffs-Anfragen ────────────────────────────────────────
create table if not exists public.access_requests (
  id         uuid primary key default gen_random_uuid(),
  email      text not null,
  name       text not null,
  status     text not null default 'pending'
             check (status in ('pending','approved','blocked')),
  user_id    uuid,                       -- auth.users-Id, sobald freigegeben
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create unique index if not exists access_requests_email_key
  on public.access_requests (lower(email));
create index if not exists access_requests_user_id_idx
  on public.access_requests (user_id);

alter table public.access_requests enable row level security;

-- Nur der Owner sieht die Anfragen (für den "Zugriffe"-Tab).
-- INSERT/UPDATE/DELETE gibt es bewusst für keine Client-Rolle:
-- das erledigt ausschließlich die Edge Function mit Service Role.
drop policy if exists owner_read on public.access_requests;
create policy owner_read on public.access_requests
  for select to authenticated
  using (((auth.jwt() -> 'app_metadata') ->> 'role') = 'owner');

-- ── Freigabe-Check für Policies & Client ─────────────────────
create or replace function public.gate_ok()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.access_requests
    where user_id = auth.uid() and status = 'approved'
  );
$$;
revoke all on function public.gate_ok() from public;
grant execute on function public.gate_ok() to authenticated, service_role;

-- ── Galerie-Lesezugriff: öffentlich → nur Mitglieder ─────────
drop policy if exists public_read on public.moodboard_items;
drop policy if exists member_read on public.moodboard_items;
create policy member_read on public.moodboard_items
  for select to authenticated
  using (
    ((auth.jwt() -> 'app_metadata') ->> 'role') = 'owner'
    or public.gate_ok()
  );

drop policy if exists public_read on public.moods;
drop policy if exists member_read on public.moods;
create policy member_read on public.moods
  for select to authenticated
  using (
    ((auth.jwt() -> 'app_metadata') ->> 'role') = 'owner'
    or public.gate_ok()
  );

drop policy if exists public_read on public.pages;
drop policy if exists member_read on public.pages;
create policy member_read on public.pages
  for select to authenticated
  using (
    ((auth.jwt() -> 'app_metadata') ->> 'role') = 'owner'
    or public.gate_ok()
  );

-- ── Storage: Schreiben nur noch für den Owner ────────────────
-- (public_read bleibt: die Bild-Dateien werden weiter über ihre
-- direkten, nicht erratbaren URLs geladen.)
drop policy if exists public_upload on storage.objects;
drop policy if exists public_delete on storage.objects;
drop policy if exists owner_upload on storage.objects;
drop policy if exists owner_update on storage.objects;   -- Uploads nutzen teils upsert
drop policy if exists owner_delete_storage on storage.objects;
create policy owner_upload on storage.objects
  for insert to authenticated
  with check (bucket_id = 'moodboard'
    and ((auth.jwt() -> 'app_metadata') ->> 'role') = 'owner');
create policy owner_update on storage.objects
  for update to authenticated
  using (bucket_id = 'moodboard'
    and ((auth.jwt() -> 'app_metadata') ->> 'role') = 'owner');
create policy owner_delete_storage on storage.objects
  for delete to authenticated
  using (bucket_id = 'moodboard'
    and ((auth.jwt() -> 'app_metadata') ->> 'role') = 'owner');

-- ── KI-Chat-Funktion nicht mehr anonym aufrufbar ─────────────
-- (verhindert, dass Fremde ohne Login das Gemini-Kontingent verbrauchen)
revoke execute on function public.mood_text_to_tags(text) from anon;
