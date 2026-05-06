create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create table if not exists public.generations (
  id uuid primary key default gen_random_uuid(),
  prompt text not null,
  shape_type text,
  confidence text,
  dims jsonb not null default '{}'::jsonb,
  featurescript text not null default '',
  thinking text not null default '',
  char_count integer,
  user_rating smallint,
  user_feedback text,
  created_at timestamptz not null default now()
);

alter table public.generations add column if not exists char_count integer;
alter table public.generations add column if not exists user_rating smallint;
alter table public.generations add column if not exists user_feedback text;

create table if not exists public.debug_sessions (
  id uuid primary key default gen_random_uuid(),
  original_code text not null default '',
  error_messages text not null default '',
  fixed_code text not null default '',
  explanation text not null default '',
  was_helpful boolean,
  created_at timestamptz not null default now()
);

create table if not exists public.image_analyses (
  id uuid primary key default gen_random_uuid(),
  image_count smallint not null default 1,
  image_contexts text[] not null default '{}',
  global_prompt text not null default '',
  ai_description text not null default '',
  generation_id uuid references public.generations(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.shape_knowledge (
  id uuid primary key default gen_random_uuid(),
  shape_type text not null unique,
  aliases text[] not null default '{}',
  description text not null default '',
  default_dims jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.cad_knowledge (
  id uuid primary key default gen_random_uuid(),
  title text not null unique,
  summary text not null default '',
  tags text[] not null default '{}',
  keywords text[] not null default '{}',
  parameter_hints text[] not null default '{}',
  modeling_notes text[] not null default '{}',
  example_prompt text,
  created_at timestamptz not null default now()
);

create table if not exists public.cad_memory (
  id uuid primary key default gen_random_uuid(),
  memory_type text not null default 'skill',
  title text not null unique,
  summary text not null default '',
  shape_type text,
  tags text[] not null default '{}',
  keywords text[] not null default '{}',
  parameter_hints text[] not null default '{}',
  modeling_notes text[] not null default '{}',
  feature_pattern text,
  failure_modes text[] not null default '{}',
  validation_rules text[] not null default '{}',
  source_table text,
  source_id uuid,
  quality_score numeric(6, 3) not null default 0.500,
  usage_count integer not null default 0,
  success_count integer not null default 0,
  failure_count integer not null default 0,
  is_active boolean not null default true,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists cad_memory_title_shape_unique
  on public.cad_memory (lower(title), coalesce(shape_type, ''));

create unique index if not exists cad_memory_title_unique
  on public.cad_memory (title);

create index if not exists cad_memory_active_quality_idx
  on public.cad_memory (is_active, quality_score desc);

create index if not exists cad_memory_shape_idx
  on public.cad_memory (shape_type);

create index if not exists cad_memory_keywords_gin_idx
  on public.cad_memory using gin (keywords);

create index if not exists cad_memory_tags_gin_idx
  on public.cad_memory using gin (tags);

create index if not exists cad_knowledge_keywords_gin_idx
  on public.cad_knowledge using gin (keywords);

create index if not exists cad_knowledge_tags_gin_idx
  on public.cad_knowledge using gin (tags);

create table if not exists public.cad_generation_memory_matches (
  id uuid primary key default gen_random_uuid(),
  generation_id uuid not null references public.generations(id) on delete cascade,
  memory_id uuid not null references public.cad_memory(id) on delete cascade,
  score_rank integer,
  score_snapshot numeric(8, 3),
  created_at timestamptz not null default now()
);

create index if not exists cad_generation_memory_generation_idx
  on public.cad_generation_memory_matches (generation_id);

create index if not exists cad_generation_memory_memory_idx
  on public.cad_generation_memory_matches (memory_id);

create table if not exists public.cad_feedback_events (
  id uuid primary key default gen_random_uuid(),
  generation_id uuid references public.generations(id) on delete cascade,
  signal text not null,
  rating smallint,
  weight numeric(6, 3) not null default 0,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists cad_feedback_generation_idx
  on public.cad_feedback_events (generation_id);

create table if not exists public.cad_memory_pruning_events (
  id uuid primary key default gen_random_uuid(),
  memory_id uuid references public.cad_memory(id) on delete set null,
  action text not null,
  reason text not null,
  score_before numeric(6, 3),
  created_at timestamptz not null default now()
);

create or replace function public.search_cad_memory(
  query_text text default '',
  query_keywords text[] default '{}',
  query_shape text default null,
  match_limit integer default 8
)
returns table (
  id uuid,
  memory_type text,
  title text,
  summary text,
  shape_type text,
  tags text[],
  keywords text[],
  parameter_hints text[],
  modeling_notes text[],
  feature_pattern text,
  failure_modes text[],
  validation_rules text[],
  quality_score numeric,
  usage_count integer,
  success_count integer,
  failure_count integer,
  match_score numeric
)
language sql
stable
as $$
  with q as (
    select
      lower(coalesce(query_text, '')) as text,
      coalesce(query_keywords, '{}')::text[] as keywords,
      nullif(query_shape, '') as shape
  )
  select
    m.id,
    m.memory_type,
    m.title,
    m.summary,
    m.shape_type,
    m.tags,
    m.keywords,
    m.parameter_hints,
    m.modeling_notes,
    m.feature_pattern,
    m.failure_modes,
    m.validation_rules,
    m.quality_score,
    m.usage_count,
    m.success_count,
    m.failure_count,
    (
      m.quality_score
      + case when q.shape is not null and m.shape_type = q.shape then 0.35 else 0 end
      + (
        select count(*)::numeric * 0.12
        from unnest(q.keywords) as k(keyword)
        where k.keyword = any(m.keywords)
           or k.keyword = any(m.tags)
           or lower(m.title) like '%' || k.keyword || '%'
           or lower(m.summary) like '%' || k.keyword || '%'
      )
      + similarity(lower(m.title || ' ' || m.summary), q.text) * 0.25
    ) as match_score
  from public.cad_memory m
  cross join q
  where m.is_active = true
  order by match_score desc, m.quality_score desc, m.updated_at desc
  limit greatest(1, least(coalesce(match_limit, 8), 20));
$$;

create or replace function public.mark_cad_memory_used(memory_ids uuid[])
returns void
language sql
as $$
  update public.cad_memory
  set
    usage_count = usage_count + 1,
    last_used_at = now(),
    updated_at = now()
  where id = any(coalesce(memory_ids, '{}')::uuid[]);
$$;

create or replace function public.record_cad_feedback(
  p_generation_id uuid,
  p_signal text,
  p_weight numeric default null,
  p_notes text default null,
  p_rating smallint default null
)
returns void
language plpgsql
as $$
declare
  v_weight numeric := coalesce(
    p_weight,
    case
      when p_rating is not null then (p_rating - 3) * 0.04
      when p_signal = 'copied' then 0.04
      when p_signal = 'helpful' then 0.08
      when p_signal = 'debug_requested' then -0.03
      when p_signal = 'compile_error' then -0.08
      when p_signal = 'needs_fix' then -0.08
      when p_signal = 'bad' then -0.12
      else 0
    end
  );
begin
  insert into public.cad_feedback_events (generation_id, signal, rating, weight, notes)
  values (p_generation_id, coalesce(p_signal, 'feedback'), p_rating, v_weight, p_notes);

  update public.generations
  set
    user_rating = coalesce(p_rating, user_rating),
    user_feedback = coalesce(p_notes, user_feedback)
  where id = p_generation_id;

  update public.cad_memory m
  set
    quality_score = least(1, greatest(0, m.quality_score + v_weight)),
    success_count = success_count + case when v_weight > 0 then 1 else 0 end,
    failure_count = failure_count + case when v_weight < 0 then 1 else 0 end,
    updated_at = now()
  from public.cad_generation_memory_matches gm
  where gm.memory_id = m.id
    and gm.generation_id = p_generation_id;
end;
$$;

create or replace function public.prune_cad_memory()
returns integer
language plpgsql
as $$
declare
  v_count integer;
begin
  with candidates as (
    select id, quality_score
    from public.cad_memory
    where is_active = true
      and usage_count >= 8
      and quality_score < 0.25
      and failure_count > success_count
  ),
  deactivated as (
    update public.cad_memory m
    set is_active = false, updated_at = now()
    from candidates c
    where m.id = c.id
    returning m.id, c.quality_score
  )
  insert into public.cad_memory_pruning_events (memory_id, action, reason, score_before)
  select id, 'deactivate', 'low score after repeated failed feedback', quality_score
  from deactivated;

  get diagnostics v_count = row_count;
  return coalesce(v_count, 0);
end;
$$;

insert into public.cad_memory (
  memory_type,
  title,
  summary,
  tags,
  keywords,
  parameter_hints,
  modeling_notes,
  source_table
)
select
  'seed',
  title,
  summary,
  tags,
  keywords,
  parameter_hints,
  modeling_notes,
  'cad_knowledge'
from public.cad_knowledge
on conflict do nothing;
