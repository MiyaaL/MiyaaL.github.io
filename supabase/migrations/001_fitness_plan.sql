begin;

create table if not exists public.fitness_plan_public (
  plan_key text primary key check (plan_key = 'fitness'),
  version bigint not null default 0 check (version >= 0),
  snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(snapshot) = 'object'),
  updated_at timestamptz not null default now()
);

create table if not exists public.fitness_plan_private (
  plan_key text primary key check (plan_key = 'fitness'),
  version bigint not null default 0 check (version >= 0),
  state jsonb not null default '{}'::jsonb check (jsonb_typeof(state) = 'object'),
  updated_at timestamptz not null default now()
);

alter table public.fitness_plan_public enable row level security;
alter table public.fitness_plan_private enable row level security;

revoke all on table public.fitness_plan_public from anon, authenticated;
revoke all on table public.fitness_plan_private from anon, authenticated;
grant select on table public.fitness_plan_public to anon, authenticated;

create or replace function public.is_fitness_plan_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.identities as identity
    where identity.user_id = (select auth.uid())
      and identity.provider = 'github'
      and identity.provider_id = '73994563'
  );
$$;

revoke all on function public.is_fitness_plan_owner() from public;
grant execute on function public.is_fitness_plan_owner() to authenticated;

drop policy if exists "Public fitness plan is readable" on public.fitness_plan_public;
create policy "Public fitness plan is readable"
on public.fitness_plan_public
for select
to anon, authenticated
using (true);

create or replace function public.load_private_fitness_plan()
returns table (
  version bigint,
  state jsonb,
  updated_at timestamptz
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
  select plan.version, plan.state, plan.updated_at
  from public.fitness_plan_private as plan
  where plan.plan_key = 'fitness';
end;
$$;

revoke all on function public.load_private_fitness_plan() from public;
grant execute on function public.load_private_fitness_plan() to authenticated;

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

  return next_version;
end;
$$;

revoke all on function public.save_fitness_plan(bigint, jsonb, jsonb) from public;
grant execute on function public.save_fitness_plan(bigint, jsonb, jsonb) to authenticated;

commit;
