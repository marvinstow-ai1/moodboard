-- ============================================================
-- Registrierungs-Sperre für auth.users
-- ------------------------------------------------------------
-- Repo-Kopie: finaler Stand nach den Migrationen
-- "block_new_signups" (2026-06-25), "allow_gate_managed_users",
-- "fix_signup_block_allow_gate_users" und
-- "fix_signup_block_deferred_check" (2026-07-03).
--
-- Historie: Die ursprüngliche Migration blockte JEDEN Insert in
-- auth.users, um Selbst-Registrierungen über /auth/v1/signup zu
-- verhindern. Seit dem Gate-System (access_control.sql) legt die
-- Edge Function "gate" beim Freigeben einer Anfrage aber selbst
-- User per Admin-API an – die liefen in dieselbe Sperre
-- ("Registrierung ist deaktiviert." → im Client
-- "Aktion fehlgeschlagen" beim Annehmen).
--
-- Warum ein DEFERRED CONSTRAINT TRIGGER: GoTrue legt neue User in
-- einer Transaktion an – erst der nackte INSERT, danach UPDATEs
-- für email_confirmed_at und app_metadata. Ein BEFORE-INSERT-
-- Trigger kann einen Admin-User deshalb nicht von einer Selbst-
-- Registrierung unterscheiden. Der Constraint-Trigger feuert erst
-- beim Commit, liest den finalen Zeilenstand nach und lässt nur
-- User mit app_metadata-Rolle 'friend' oder 'owner' durch (die
-- setzt ausschließlich die Gate-Funktion bzw. der Owner). Eine
-- Selbst-Registrierung kann app_metadata nicht setzen und schlägt
-- damit weiterhin fehl – auch für E-Mails, die in access_requests
-- stehen.
-- ============================================================

create or replace function public.block_new_signups()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  final_role text;
  still_exists boolean;
begin
  select true, u.raw_app_meta_data->>'role'
    into still_exists, final_role
  from auth.users u
  where u.id = new.id;
  -- Zeile in derselben Transaktion wieder gelöscht: nichts zu blocken.
  if still_exists is not true then
    return new;
  end if;
  if final_role in ('friend', 'owner') then
    return new;
  end if;
  raise exception 'Registrierung ist deaktiviert.' using errcode = 'check_violation';
end;
$$;

drop trigger if exists prevent_new_signups on auth.users;
create constraint trigger prevent_new_signups
  after insert on auth.users
  deferrable initially deferred
  for each row
  execute function public.block_new_signups();
