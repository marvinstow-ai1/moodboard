-- ============================================================
-- Globaler Tamagotchi-Zustand für Marvin's Place
-- ------------------------------------------------------------
-- Der Tamagotchi war früher rein lokal (localStorage): jede/r
-- hatte ein eigenes Tier im eigenen Browser. Gewünscht ist aber
-- EIN gemeinsames Tier für alle – wenn jemand füttert, ist es
-- für alle satt. Deshalb lebt der Zustand jetzt serverseitig in
-- genau EINER Zeile (Singleton, id = 1) und wird per Supabase
-- Realtime zwischen allen offenen Browsern synchron gehalten.
-- Diese Datei ist die Repo-Kopie der Migration, die auf dem
-- Supabase-Projekt angewendet wurde (apply_migration:
-- "tamagotchi_global_state").
--
--  * tamagotchi_state – eine einzige Zeile mit dem kompletten
--                       Spielzustand als JSON (Futter, Laune,
--                       Energie, Sauber, Häufchen, Zeitstempel …).
--                       Lesen + Schreiben dürfen alle Mitglieder
--                       (Owner + freigegebene Freunde, gleiche
--                       Regel wie Galerie/Freundebuch). Es gibt
--                       kein DELETE – die Zeile bleibt bestehen.
--  * Realtime          – die Tabelle hängt in der Publication
--                       `supabase_realtime`, damit UPDATEs live
--                       an alle Clients gepusht werden.
-- ============================================================

create table if not exists public.tamagotchi_state (
  id         smallint primary key default 1 check (id = 1),
  state      jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.tamagotchi_state enable row level security;

-- Lesen: Owner + freigegebene Freunde (wie die Galerie).
drop policy if exists member_read on public.tamagotchi_state;
create policy member_read on public.tamagotchi_state
  for select to authenticated
  using (
    ((auth.jwt() -> 'app_metadata') ->> 'role') = 'owner'
    or public.gate_ok()
  );

-- Schreiben (UPDATE): jedes Mitglied darf das gemeinsame Tier
-- versorgen. Es gibt nur die eine Zeile (id = 1).
drop policy if exists member_update on public.tamagotchi_state;
create policy member_update on public.tamagotchi_state
  for update to authenticated
  using (
    ((auth.jwt() -> 'app_metadata') ->> 'role') = 'owner'
    or public.gate_ok()
  )
  with check (
    ((auth.jwt() -> 'app_metadata') ->> 'role') = 'owner'
    or public.gate_ok()
  );

-- INSERT (nur zum Anlegen der Singleton-Zeile, falls sie mal
-- fehlt): ebenfalls für Mitglieder, hart auf id = 1 begrenzt.
drop policy if exists member_insert on public.tamagotchi_state;
create policy member_insert on public.tamagotchi_state
  for insert to authenticated
  with check (
    id = 1
    and (
      ((auth.jwt() -> 'app_metadata') ->> 'role') = 'owner'
      or public.gate_ok()
    )
  );

-- Die Singleton-Zeile mit Startwerten anlegen (Zeitstempel als
-- Millisekunden-Epoch, passend zu Date.now() im Client).
insert into public.tamagotchi_state (id, state)
values (1, jsonb_build_object(
  'born',     (extract(epoch from now()) * 1000)::bigint,
  'lastTick', (extract(epoch from now()) * 1000)::bigint,
  'hunger',   80,
  'happy',    80,
  'energy',   80,
  'clean',    100,
  'sleeping', false,
  'sick',     false,
  'snacks',   0,
  'poops',    '[]'::jsonb,
  'nextPoop', 0
))
on conflict (id) do nothing;

-- Realtime: UPDATEs an alle offenen Browser pushen.
alter publication supabase_realtime add table public.tamagotchi_state;
