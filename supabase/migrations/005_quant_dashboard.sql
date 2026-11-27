-- Private quant-lab dashboard (/quant/).
--
-- quant-lab uploads one de-identified snapshot per run; only the site owner can
-- read it. Nothing about the dashboard is public: the page is a static shell
-- and every number comes from load_quant_dashboard() after GitHub sign-in.
--
-- quant-lab never holds an owner session or a service key. It uploads with a
-- dedicated publish key that can do exactly one thing: append a snapshot.
-- The owner creates or rotates that key with rotate_quant_publish_key(); only
-- its SHA-256 digest is stored, so the database never holds the key itself.
--
-- Re-runnable: every statement is idempotent.

begin;

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.quant_dashboard_snapshot (
  id bigint generated always as identity primary key,
  generated_at timestamptz not null,
  uploaded_at timestamptz not null default now(),
  payload jsonb not null check (jsonb_typeof(payload) = 'object')
);

create index if not exists quant_dashboard_snapshot_uploaded_at_idx
  on public.quant_dashboard_snapshot (uploaded_at desc);

-- One row per publisher: the digest of the current publish key.
create table if not exists public.quant_dashboard_publisher (
  publisher text primary key check (publisher = 'quant-lab'),
  key_sha256 text not null check (key_sha256 ~ '^[0-9a-f]{64}$'),
  rotated_at timestamptz not null default now()
);

-- Row Level Security with no policies: the tables are reachable only through
-- the security-definer functions below, never with a direct select.
alter table public.quant_dashboard_snapshot enable row level security;
alter table public.quant_dashboard_publisher enable row level security;
revoke all on table public.quant_dashboard_snapshot from public, anon, authenticated;
revoke all on table public.quant_dashboard_publisher from public, anon, authenticated;

-- Owner read: the latest snapshot, or no row when nothing was uploaded yet.
create or replace function public.load_quant_dashboard()
returns table (
  generated_at timestamptz,
  uploaded_at timestamptz,
  payload jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_fitness_plan_owner() then
    raise exception 'not_dashboard_owner' using errcode = 'P0001';
  end if;
  return query
  select snapshot.generated_at, snapshot.uploaded_at, snapshot.payload
  from public.quant_dashboard_snapshot as snapshot
  order by snapshot.uploaded_at desc, snapshot.id desc
  limit 1;
end;
$$;

-- Publisher write: callable without a session, authorised by the publish key.
create or replace function public.publish_quant_dashboard(
  p_key text,
  p_generated_at timestamptz,
  p_payload jsonb
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  stored_digest text;
  new_id bigint;
begin
  select publisher.key_sha256
  into stored_digest
  from public.quant_dashboard_publisher as publisher
  where publisher.publisher = 'quant-lab';

  if stored_digest is null
     or p_key is null
     or length(p_key) < 32
     or encode(extensions.digest(p_key, 'sha256'), 'hex') <> stored_digest then
    raise exception 'invalid_publish_key' using errcode = 'P0001';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'invalid_dashboard_payload' using errcode = '22023';
  end if;
  if octet_length(p_payload::text) > 1048576 then
    raise exception 'dashboard_payload_too_large' using errcode = '22023';
  end if;
  if p_generated_at is null or p_generated_at > now() + interval '1 day' then
    raise exception 'invalid_generated_at' using errcode = '22023';
  end if;

  insert into public.quant_dashboard_snapshot (generated_at, payload)
  values (p_generated_at, p_payload)
  returning id into new_id;

  -- Keep the last 30 uploads: enough to recover from a bad run, small enough to ignore.
  delete from public.quant_dashboard_snapshot as old
  where old.id not in (
    select recent.id
    from public.quant_dashboard_snapshot as recent
    order by recent.uploaded_at desc, recent.id desc
    limit 30
  );

  return new_id;
end;
$$;

-- Owner only: create or replace the publish key. The new key is returned once
-- and only its digest is stored; the previous key stops working immediately.
create or replace function public.rotate_quant_publish_key()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  new_key text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  if not public.is_fitness_plan_owner() then
    raise exception 'not_dashboard_owner' using errcode = 'P0001';
  end if;
  insert into public.quant_dashboard_publisher (publisher, key_sha256, rotated_at)
  values ('quant-lab', encode(extensions.digest(new_key, 'sha256'), 'hex'), now())
  on conflict (publisher) do update
  set key_sha256 = excluded.key_sha256,
      rotated_at = excluded.rotated_at;
  return new_key;
end;
$$;

-- Supabase grants execute on new functions to anon and authenticated by
-- default; revoking from public alone does not remove those grants.
revoke all on function public.load_quant_dashboard() from public, anon, authenticated;
revoke all on function public.publish_quant_dashboard(text, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.rotate_quant_publish_key() from public, anon, authenticated;
grant execute on function public.load_quant_dashboard() to authenticated;
grant execute on function public.rotate_quant_publish_key() to authenticated;
-- The publisher calls without a session (anon); the key is the authorisation.
grant execute on function public.publish_quant_dashboard(text, timestamptz, jsonb) to anon;

commit;
