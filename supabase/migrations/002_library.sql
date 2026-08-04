begin;

create or replace function public.is_site_owner()
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

revoke all on function public.is_site_owner() from public;
grant execute on function public.is_site_owner() to authenticated;

create table if not exists public.library_reading_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  document_id text not null check (
    char_length(document_id) between 1 and 96
    and document_id ~ '^[a-zA-Z0-9._-]+$'
  ),
  page_number integer not null check (page_number >= 1),
  total_pages integer not null check (total_pages >= 0),
  zoom numeric(4, 2) not null check (zoom between 0.50 and 2.50),
  updated_at timestamptz not null default now(),
  primary key (user_id, document_id)
);

alter table public.library_reading_progress enable row level security;
revoke all on table public.library_reading_progress from anon, authenticated;

create or replace function public.load_library_progress()
returns table (
  document_id text,
  page_number integer,
  total_pages integer,
  zoom numeric,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_site_owner() then
    raise exception 'not_site_owner' using errcode = 'P0001';
  end if;

  return query
  select progress.document_id,
         progress.page_number,
         progress.total_pages,
         progress.zoom,
         progress.updated_at
  from public.library_reading_progress as progress
  where progress.user_id = (select auth.uid());
end;
$$;

revoke all on function public.load_library_progress() from public;
grant execute on function public.load_library_progress() to authenticated;

create or replace function public.save_library_progress(
  p_document_id text,
  p_page_number integer,
  p_total_pages integer,
  p_zoom numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_site_owner() then
    raise exception 'not_site_owner' using errcode = 'P0001';
  end if;

  if p_document_id is null
     or char_length(p_document_id) not between 1 and 96
     or p_document_id !~ '^[a-zA-Z0-9._-]+$'
     or p_page_number < 1
     or p_total_pages < 0
     or p_zoom not between 0.50 and 2.50 then
    raise exception 'invalid_library_progress' using errcode = '22023';
  end if;

  insert into public.library_reading_progress (
    user_id,
    document_id,
    page_number,
    total_pages,
    zoom,
    updated_at
  )
  values (
    (select auth.uid()),
    p_document_id,
    p_page_number,
    p_total_pages,
    p_zoom,
    now()
  )
  on conflict (user_id, document_id) do update
  set page_number = excluded.page_number,
      total_pages = excluded.total_pages,
      zoom = excluded.zoom,
      updated_at = excluded.updated_at;
end;
$$;

revoke all on function public.save_library_progress(text, integer, integer, numeric) from public;
grant execute on function public.save_library_progress(text, integer, integer, numeric) to authenticated;

commit;
