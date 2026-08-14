begin;

create table if not exists public.library_annotation_documents (
  user_id uuid not null references auth.users(id) on delete cascade,
  document_id text not null check (
    char_length(document_id) between 1 and 96
    and document_id ~ '^[a-zA-Z0-9._-]+$'
  ),
  document_revision text not null check (
    char_length(document_revision) between 1 and 160
    and document_revision ~ '^[a-zA-Z0-9._:-]+$'
  ),
  annotations jsonb not null default '[]'::jsonb check (jsonb_typeof(annotations) = 'array'),
  version bigint not null default 1 check (version >= 1),
  updated_at timestamptz not null default now(),
  primary key (user_id, document_id, document_revision)
);

alter table public.library_annotation_documents enable row level security;
revoke all on table public.library_annotation_documents from anon, authenticated;

create or replace function public.load_library_annotations(
  p_document_id text,
  p_document_revision text
)
returns table (
  document_id text,
  document_revision text,
  annotations jsonb,
  version bigint,
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

  if p_document_id is null
     or char_length(p_document_id) not between 1 and 96
     or p_document_id !~ '^[a-zA-Z0-9._-]+$'
     or p_document_revision is null
     or char_length(p_document_revision) not between 1 and 160
     or p_document_revision !~ '^[a-zA-Z0-9._:-]+$' then
    raise exception 'invalid_library_annotation_document' using errcode = '22023';
  end if;

  return query
  select record.document_id,
         record.document_revision,
         record.annotations,
         record.version,
         record.updated_at
  from public.library_annotation_documents as record
  where record.user_id = (select auth.uid())
    and record.document_id = p_document_id
    and record.document_revision = p_document_revision;
end;
$$;

revoke all on function public.load_library_annotations(text, text) from public;
grant execute on function public.load_library_annotations(text, text) to authenticated;

create or replace function public.save_library_annotations(
  p_document_id text,
  p_document_revision text,
  p_annotations jsonb,
  p_expected_version bigint
)
returns table (
  version bigint,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_version bigint;
  saved_updated_at timestamptz;
begin
  if not public.is_site_owner() then
    raise exception 'not_site_owner' using errcode = 'P0001';
  end if;

  if p_document_id is null
     or char_length(p_document_id) not between 1 and 96
     or p_document_id !~ '^[a-zA-Z0-9._-]+$'
     or p_document_revision is null
     or char_length(p_document_revision) not between 1 and 160
     or p_document_revision !~ '^[a-zA-Z0-9._:-]+$'
     or p_expected_version is null
     or p_expected_version < 0 then
    raise exception 'invalid_library_annotation_document' using errcode = '22023';
  end if;

  if p_annotations is null or jsonb_typeof(p_annotations) <> 'array' then
    raise exception 'invalid_library_annotations' using errcode = '22023';
  end if;

  if jsonb_array_length(p_annotations) > 5000
     or octet_length(p_annotations::text) > 4194304 then
    raise exception 'library_annotations_too_large' using errcode = '22023';
  end if;

  if p_expected_version = 0 then
    insert into public.library_annotation_documents (
      user_id,
      document_id,
      document_revision,
      annotations,
      version,
      updated_at
    )
    values (
      (select auth.uid()),
      p_document_id,
      p_document_revision,
      p_annotations,
      1,
      now()
    )
    on conflict do nothing
    returning library_annotation_documents.version,
              library_annotation_documents.updated_at
    into saved_version, saved_updated_at;
  else
    update public.library_annotation_documents as record
    set annotations = p_annotations,
        version = record.version + 1,
        updated_at = now()
    where record.user_id = (select auth.uid())
      and record.document_id = p_document_id
      and record.document_revision = p_document_revision
      and record.version = p_expected_version
    returning record.version, record.updated_at
    into saved_version, saved_updated_at;
  end if;

  if saved_version is null then
    raise exception 'library_annotation_conflict' using errcode = 'P0001';
  end if;

  return query select saved_version, saved_updated_at;
end;
$$;

revoke all on function public.save_library_annotations(text, text, jsonb, bigint) from public;
grant execute on function public.save_library_annotations(text, text, jsonb, bigint) to authenticated;

commit;
