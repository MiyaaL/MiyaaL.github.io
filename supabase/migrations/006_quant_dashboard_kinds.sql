-- Private quant dashboard: separate snapshot kinds (paper trading / data health).
--
-- 005 stored one stream of paper-trading snapshots. This adds a `kind` column so the
-- data-health view can be uploaded alongside it. Existing rows become `paper`; the
-- existing three-argument calls keep working and keep meaning `paper`.
--
-- Re-runnable: every statement is idempotent.

begin;

alter table public.quant_dashboard_snapshot
  add column if not exists kind text not null default 'paper';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'quant_dashboard_snapshot_kind_check'
  ) then
    alter table public.quant_dashboard_snapshot
      add constraint quant_dashboard_snapshot_kind_check check (kind in ('paper', 'data'));
  end if;
end;
$$;

create index if not exists quant_dashboard_snapshot_kind_uploaded_at_idx
  on public.quant_dashboard_snapshot (kind, uploaded_at desc);

-- Owner read of the latest snapshot of one kind.
create or replace function public.load_quant_dashboard(p_kind text)
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
  where snapshot.kind = p_kind
  order by snapshot.uploaded_at desc, snapshot.id desc
  limit 1;
end;
$$;

-- The 005 signature keeps returning paper-trading snapshots.
create or replace function public.load_quant_dashboard()
returns table (
  generated_at timestamptz,
  uploaded_at timestamptz,
  payload jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.load_quant_dashboard('paper');
$$;

-- Publisher write of one kind, authorised by the publish key; keeps 30 per kind.
create or replace function public.publish_quant_dashboard(
  p_key text,
  p_generated_at timestamptz,
  p_payload jsonb,
  p_kind text
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
  if p_kind is null or p_kind not in ('paper', 'data') then
    raise exception 'invalid_dashboard_kind' using errcode = '22023';
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

  insert into public.quant_dashboard_snapshot (generated_at, payload, kind)
  values (p_generated_at, p_payload, p_kind)
  returning id into new_id;

  delete from public.quant_dashboard_snapshot as old
  where old.kind = p_kind
    and old.id not in (
      select recent.id
      from public.quant_dashboard_snapshot as recent
      where recent.kind = p_kind
      order by recent.uploaded_at desc, recent.id desc
      limit 30
    );

  return new_id;
end;
$$;

-- The 005 signature keeps writing paper-trading snapshots.
create or replace function public.publish_quant_dashboard(
  p_key text,
  p_generated_at timestamptz,
  p_payload jsonb
)
returns bigint
language sql
volatile
security definer
set search_path = ''
as $$
  select public.publish_quant_dashboard(p_key, p_generated_at, p_payload, 'paper');
$$;

-- Supabase grants execute on new functions to anon and authenticated by default.
revoke all on function public.load_quant_dashboard(text) from public, anon, authenticated;
revoke all on function public.load_quant_dashboard() from public, anon, authenticated;
revoke all on function public.publish_quant_dashboard(text, timestamptz, jsonb, text) from public, anon, authenticated;
revoke all on function public.publish_quant_dashboard(text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.load_quant_dashboard(text) to authenticated;
grant execute on function public.load_quant_dashboard() to authenticated;
grant execute on function public.publish_quant_dashboard(text, timestamptz, jsonb, text) to anon;
grant execute on function public.publish_quant_dashboard(text, timestamptz, jsonb) to anon;

commit;
