-- Keeps the last 50 saved versions of the plan so a wrong overwrite or a bad
-- client release can be undone, and tightens the save function.
--
-- Run once in the Supabase SQL editor after 001_fitness_plan.sql. It is safe
-- to run again.
begin;

create table if not exists public.fitness_plan_history (
  id bigint generated always as identity primary key,
  plan_key text not null check (plan_key = 'fitness'),
  version bigint not null check (version >= 1),
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  saved_at timestamptz not null default now(),
  unique (plan_key, version)
);

-- Row level security with no policies: the table is reachable only through
-- the security-definer functions below, which check ownership themselves.
alter table public.fitness_plan_history enable row level security;
revoke all on table public.fitness_plan_history from public, anon, authenticated;

create or replace function public.save_fitness_plan(
  p_expected_version bigint,
  p_state jsonb,
  p_snapshot jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_version bigint;
  next_version bigint;
  saved_at timestamptz := now();
  stored_state jsonb;
  stored_snapshot jsonb;
begin
  if not public.is_fitness_plan_owner() then
    raise exception 'not_plan_owner' using errcode = 'P0001';
  end if;

  if jsonb_typeof(p_state) <> 'object' or jsonb_typeof(p_snapshot) <> 'object' then
    raise exception 'invalid_plan_payload' using errcode = '22023';
  end if;

  -- A fully logged cycle is about 100 kB of state and 60 kB of snapshot; these
  -- caps leave room for years of archived cycles and stop runaway payloads.
  if pg_catalog.octet_length(p_state::text) > 4194304
     or pg_catalog.octet_length(p_snapshot::text) > 1048576 then
    raise exception 'plan_payload_too_large' using errcode = '22023';
  end if;

  -- Serialise both updates and the first insert so version 0 cannot be saved twice.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('fitness_plan'));

  select plan.version
  into current_version
  from public.fitness_plan_private as plan
  where plan.plan_key = 'fitness'
  for update;

  if not found then
    if coalesce(p_expected_version, 0) <> 0 then
      raise exception 'version_conflict' using errcode = 'P0001';
    end if;
    next_version := 1;
  else
    if current_version <> coalesce(p_expected_version, 0) then
      raise exception 'version_conflict' using errcode = 'P0001';
    end if;
    next_version := current_version + 1;
  end if;

  stored_state := jsonb_set(p_state, '{version}', to_jsonb(next_version), true);
  stored_state := jsonb_set(stored_state, '{updatedAt}', to_jsonb(saved_at::text), true);
  stored_snapshot := jsonb_set(p_snapshot, '{version}', to_jsonb(next_version), true);
  stored_snapshot := jsonb_set(stored_snapshot, '{updatedAt}', to_jsonb(saved_at::text), true);

  insert into public.fitness_plan_private (plan_key, version, state, updated_at)
  values ('fitness', next_version, stored_state, saved_at)
  on conflict (plan_key) do update
  set version = excluded.version,
      state = excluded.state,
      updated_at = excluded.updated_at;

  insert into public.fitness_plan_public (plan_key, version, snapshot, updated_at)
  values ('fitness', next_version, stored_snapshot, saved_at)
  on conflict (plan_key) do update
  set version = excluded.version,
      snapshot = excluded.snapshot,
      updated_at = excluded.updated_at;

  -- Append-only history of what was just stored; older versions are trimmed.
  insert into public.fitness_plan_history (plan_key, version, state, snapshot, saved_at)
  values ('fitness', next_version, stored_state, stored_snapshot, saved_at)
  on conflict (plan_key, version) do nothing;

  delete from public.fitness_plan_history as history
  where history.plan_key = 'fitness'
    and history.version <= next_version - 50;

  return next_version;
end;
$$;

-- The version that is live when this migration runs becomes the first history
-- entry, so the save that follows it can already be undone.
insert into public.fitness_plan_history (plan_key, version, state, snapshot, saved_at)
select private.plan_key, private.version, private.state, public_row.snapshot, private.updated_at
from public.fitness_plan_private as private
join public.fitness_plan_public as public_row on public_row.plan_key = private.plan_key
where private.plan_key = 'fitness' and private.version >= 1
on conflict (plan_key, version) do nothing;

create or replace function public.list_fitness_plan_history()
returns table (
  version bigint,
  saved_at timestamptz,
  state_bytes integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_fitness_plan_owner() then
    raise exception 'not_plan_owner' using errcode = 'P0001';
  end if;

  return query
  select history.version, history.saved_at, pg_catalog.octet_length(history.state::text)
  from public.fitness_plan_history as history
  where history.plan_key = 'fitness'
  order by history.version desc;
end;
$$;

create or replace function public.load_fitness_plan_history(p_version bigint)
returns table (
  version bigint,
  state jsonb,
  snapshot jsonb,
  saved_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_fitness_plan_owner() then
    raise exception 'not_plan_owner' using errcode = 'P0001';
  end if;

  return query
  select history.version, history.state, history.snapshot, history.saved_at
  from public.fitness_plan_history as history
  where history.plan_key = 'fitness' and history.version = p_version;
end;
$$;

-- Supabase grants execute on new functions to anon and authenticated by
-- default, so revoking from public alone leaves anon able to call them. The
-- functions refuse non-owners either way; this removes the entry point too.
revoke all on function public.save_fitness_plan(bigint, jsonb, jsonb) from public, anon;
revoke all on function public.load_private_fitness_plan() from public, anon;
revoke all on function public.is_fitness_plan_owner() from public, anon;
revoke all on function public.list_fitness_plan_history() from public, anon;
revoke all on function public.load_fitness_plan_history(bigint) from public, anon;
grant execute on function public.save_fitness_plan(bigint, jsonb, jsonb) to authenticated;
grant execute on function public.load_private_fitness_plan() to authenticated;
grant execute on function public.is_fitness_plan_owner() to authenticated;
grant execute on function public.list_fitness_plan_history() to authenticated;
grant execute on function public.load_fitness_plan_history(bigint) to authenticated;

commit;
