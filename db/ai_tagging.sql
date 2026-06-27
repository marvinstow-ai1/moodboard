-- ============================================================================
-- Background image auto-tagging for the chatbot
-- ----------------------------------------------------------------------------
-- Tags are stored in moodboard_items.ai_tags and are NEVER shown in the UI;
-- they only let a chatbot find images by mood/topic. Everything runs
-- server-side in Supabase (no frontend code involved).
--
-- This file documents the full setup so it can be reproduced. It is applied to
-- the live project already. The OpenRouter API key itself is NOT in this file —
-- it lives encrypted in Supabase Vault (see step 2).
-- ============================================================================

-- 1) Hidden columns on moodboard_items ---------------------------------------
alter table public.moodboard_items
  add column if not exists ai_tags text[] not null default '{}'::text[],
  add column if not exists ai_status text not null default 'pending',
  add column if not exists ai_tagged_at timestamptz;

create index if not exists moodboard_items_ai_tags_gin
  on public.moodboard_items using gin (ai_tags);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'moodboard_items_ai_status_chk') then
    alter table public.moodboard_items
      add constraint moodboard_items_ai_status_chk
      check (ai_status in ('pending','processed','failed'));
  end if;
end $$;

-- 2) Secrets in Vault --------------------------------------------------------
-- Run ONCE with your real key (kept out of git):
--   select vault.create_secret('sk-or-v1-...', 'openrouter_api_key', 'OpenRouter API key');
-- Optional model override (defaults to google/gemini-2.5-flash-lite):
--   select vault.create_secret('google/gemini-2.5-flash-lite', 'openrouter_model');

-- 3) Extensions --------------------------------------------------------------
create extension if not exists supabase_vault;          -- encrypted secrets
create extension if not exists http with schema extensions;  -- outbound calls
create extension if not exists pg_cron;                 -- scheduling

-- 4) Service-role-only reader for Vault secrets ------------------------------
create or replace function public.get_secret(secret_name text)
returns text
language sql
security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = secret_name;
$$;
revoke all on function public.get_secret(text) from public, anon, authenticated;
grant execute on function public.get_secret(text) to service_role;

-- 5) The tagging function ----------------------------------------------------
-- Reads the key from Vault, calls the vision model and writes the tags.
-- Owner-only when invoked through PostgREST; open to direct/cron/service calls.
create or replace function public.ai_tag_image(p_id uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_url     text;
  v_key     text;
  v_model   text;
  v_claims  text;
  v_status  int;
  v_content text;
  v_text    text;
  v_arr     text;
  v_tags    text[];
  v_prompt  text := $p$Du bist ein Bild-Tagging-System fuer eine Moodboard-App. Analysiere das Bild und gib viele detaillierte deutsche Schlagwoerter zurueck, damit ein Chatbot das Bild spaeter nach Stimmung und Inhalt finden kann. Gib eine Mischung aus 1-3 Stimmungs-/Mood-Woertern (z. B. urlaub, gute laune, sonnig, entspannt, cozy, natur, melancholisch, energiegeladen) und vielen beschreibenden Tags zu Motiv, Objekten, Ort, Farben, Jahreszeit, Tageszeit und Aktivitaet (z. B. strand, meer, palmen, himmel, sonnenuntergang, berge, kaffee, stadt, nacht, blau). Regeln: nur deutsche Woerter, alles klein, einzelne Begriffe (max. 2 Woerter), 12 bis 22 Tags, keine Doppelungen, keine Saetze, keine Emojis. Antworte AUSSCHLIESSLICH mit einem JSON-Array von Strings.$p$;
begin
  v_claims := current_setting('request.jwt.claims', true);
  if v_claims is not null and v_claims <> '' then
    if coalesce((v_claims::jsonb -> 'app_metadata' ->> 'role'), '') <> 'owner' then
      raise exception 'forbidden';
    end if;
  end if;

  select media_url into v_url from public.moodboard_items where id = p_id;
  if v_url is null then return null; end if;

  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'openrouter_api_key';
  if v_key is null then return null; end if;

  v_model := coalesce(
    (select decrypted_secret from vault.decrypted_secrets where name = 'openrouter_model'),
    'google/gemini-2.5-flash-lite'
  );

  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '20000');

  select r.status, r.content
    into v_status, v_content
  from extensions.http((
    'POST',
    'https://openrouter.ai/api/v1/chat/completions',
    array[
      extensions.http_header('Authorization', 'Bearer ' || v_key),
      extensions.http_header('HTTP-Referer', 'https://moodboard-nine-bay.vercel.app'),
      extensions.http_header('X-Title', 'Marvins Place Moodboard')
    ],
    'application/json',
    json_build_object(
      'model', v_model,
      'temperature', 0.2,
      'max_tokens', 300,
      'messages', json_build_array(json_build_object(
        'role', 'user',
        'content', json_build_array(
          json_build_object('type','text','text', v_prompt),
          json_build_object('type','image_url','image_url', json_build_object('url', v_url))
        )
      ))
    )::text
  )::extensions.http_request) as r;

  if v_status is distinct from 200 then
    update public.moodboard_items set ai_status = 'failed' where id = p_id;
    return null;
  end if;

  v_text := v_content::jsonb -> 'choices' -> 0 -> 'message' ->> 'content';
  v_arr  := (regexp_match(coalesce(v_text,''), '\[.*\]', 's'))[1];
  if v_arr is null then
    update public.moodboard_items set ai_status = 'failed' where id = p_id;
    return null;
  end if;

  select array_agg(t) into v_tags from (
    select distinct lower(btrim(value)) as t
    from jsonb_array_elements_text(v_arr::jsonb) as e(value)
    where btrim(value) <> '' and length(btrim(value)) <= 40
    limit 30
  ) s;

  v_tags := coalesce(v_tags, '{}');

  update public.moodboard_items
     set ai_tags = v_tags, ai_status = 'processed', ai_tagged_at = now()
   where id = p_id;

  return v_tags;
exception
  when others then
    update public.moodboard_items set ai_status = 'failed' where id = p_id;
    return null;
end
$fn$;
revoke all on function public.ai_tag_image(uuid) from public, anon;
grant execute on function public.ai_tag_image(uuid) to authenticated, service_role;

-- 6) Scheduling --------------------------------------------------------------
select cron.unschedule(jobid) from cron.job where jobname in ('auto-tag-pending','auto-tag-retry');

-- New uploads (ai_status defaults to 'pending') get tagged within ~1 minute.
select cron.schedule('auto-tag-pending', '* * * * *', $$
  select public.ai_tag_image(id) from (
    select id from public.moodboard_items
    where media_type = 'image' and ai_status = 'pending'
    order by created_at desc limit 15
  ) s
$$);

-- Transient failures are retried every 15 minutes.
select cron.schedule('auto-tag-retry', '*/15 * * * *', $$
  select public.ai_tag_image(id) from (
    select id from public.moodboard_items
    where media_type = 'image' and ai_status = 'failed'
    order by created_at desc limit 10
  ) s
$$);

-- One-off backfill of existing images (run manually in batches):
--   select public.ai_tag_image(id) from (
--     select id from public.moodboard_items
--     where media_type='image' and ai_status <> 'processed'
--     order by created_at desc limit 20
--   ) s;
