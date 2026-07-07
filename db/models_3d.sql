-- ============================================================
-- 3D-Modell-Inventar für Marvin's Place
-- ------------------------------------------------------------
-- Der Owner lädt 3D-Modelle (GLB/GLTF) hoch, die auf der neuen
-- Seite "3D Modelle" wie ein Inventar in einem 3er-Grid auf
-- kleinen Podesten angezeigt und live gedreht werden.
-- Die Modelldatei liegt im Storage-Bucket `moodboard` unter
-- models/; hier steht nur die fertige URL + ein bisschen
-- Metadaten (Titel, Podest-Stil). Diese Datei ist die Repo-
-- Kopie der Migration, die auf dem Supabase-Projekt angewendet
-- wurde (apply_migration: "models_3d_inventory").
--
--  * models_3d – ein Eintrag pro Modell. Lesen dürfen alle
--                Mitglieder (Owner + Freigegebene, gleiche Regel
--                wie die Galerie), schreiben/löschen nur der Owner.
--  * Storage   – der Bucket ist bereits owner-only beschreibbar
--                (db/access_control.sql). Der Owner darf ohnehin in
--                jeden Ordner hochladen, deshalb ist hier KEINE
--                extra Storage-Policy nötig – Uploads landen unter
--                models/. Lesen bleibt öffentlich, damit die
--                direkten .glb-URLs im Viewer funktionieren.
-- ============================================================

create table if not exists public.models_3d (
  id         uuid primary key default gen_random_uuid(),
  title      text not null check (char_length(title) between 1 and 80),
  model_url  text not null,
  -- Podest/"Plattform", auf dem das Modell steht (rein visuell, css/models3d.css):
  -- obsidian | marble | neon | gold | glass | wood. Default: obsidian.
  pedestal   text not null default 'obsidian'
             check (pedestal in ('obsidian','marble','neon','gold','glass','wood')),
  -- Inventar-Kategorie (Slug, Anzeigename im UI, siehe js/models3d.js):
  --   chars   → "Chars"
  --   devices → "Devices & Games"
  --   sports  → "Sports"
  --   random  → "Random Items"  (Default/Fallback für Altbestand)
  category   text not null default 'random'
             check (category in ('chars','devices','sports','random')),
  created_at timestamptz not null default now()
);

create index if not exists models_3d_created_idx
  on public.models_3d (created_at desc);

create index if not exists models_3d_category_idx
  on public.models_3d (category);

-- Nachträgliche Migration für bestehende Tabellen (apply_migration:
-- "models_3d_add_category"). Additiv & idempotent: neue Spalte mit Default
-- 'random', d. h. alle vorhandenen Modelle landen zunächst unter "Random Items"
-- und lassen sich danach im Verwalten-Popup umsortieren.
alter table public.models_3d
  add column if not exists category text not null default 'random';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'models_3d_category_check') then
    alter table public.models_3d
      add constraint models_3d_category_check
      check (category in ('chars','devices','sports','random'));
  end if;
end $$;

alter table public.models_3d enable row level security;

-- Lesen: Owner + freigegebene Freunde (wie die Galerie).
drop policy if exists member_read on public.models_3d;
create policy member_read on public.models_3d
  for select to authenticated
  using (
    ((auth.jwt() -> 'app_metadata') ->> 'role') = 'owner'
    or public.gate_ok()
  );

-- Schreiben: nur der Owner lädt Modelle hoch.
drop policy if exists owner_insert on public.models_3d;
create policy owner_insert on public.models_3d
  for insert to authenticated
  with check (((auth.jwt() -> 'app_metadata') ->> 'role') = 'owner');

-- Löschen: nur der Owner.
drop policy if exists owner_delete on public.models_3d;
create policy owner_delete on public.models_3d
  for delete to authenticated
  using (((auth.jwt() -> 'app_metadata') ->> 'role') = 'owner');
