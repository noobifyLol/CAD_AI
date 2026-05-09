-- ─────────────────────────────────────────────────────────────────────────────
-- Adaptive CAD Memory — migration
-- Run once in your Supabase SQL editor or via the CLI:
--   supabase db push
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists pgcrypto;

-- Repair helper for tables that may have been created by an older draft schema.
-- It is intentionally inline in the migration so the app can recover from
-- partial Supabase setup instead of requiring manual table deletion.
create or replace function public.ensure_uuid_id_primary_key(target_table text)
returns void
language plpgsql
as $$
begin
  if to_regclass('public.' || target_table) is null then
    return;
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = target_table
      and column_name = 'id'
  ) then
    execute format('alter table public.%I add column id uuid default gen_random_uuid()', target_table);
  end if;

  execute format('update public.%I set id = gen_random_uuid() where id is null', target_table);
  execute format('alter table public.%I alter column id set not null', target_table);

  if not exists (
    select 1
    from pg_constraint
    where conrelid = ('public.' || target_table)::regclass
      and contype = 'p'
  ) then
    execute format('alter table public.%I add primary key (id)', target_table);
  end if;
end;
$$;

-- 0. Base tables used by the app. These are included here so a fresh Supabase
-- project can be set up from one SQL file instead of needing docs/schema first.
create table if not exists generations (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  prompt        text not null,
  shape_type    text,
  confidence    text,
  dims          jsonb not null default '{}'::jsonb,
  featurescript text not null,
  thinking      text
);

create index if not exists generations_created_at_idx
  on generations (created_at desc);

create index if not exists generations_shape_type_idx
  on generations (shape_type);

select public.ensure_uuid_id_primary_key('generations');

create table if not exists cad_knowledge (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  title           text not null unique,
  summary         text not null,
  tags            text[] not null default '{}',
  keywords        text[] not null default '{}',
  parameter_hints text[] not null default '{}',
  modeling_notes  text[] not null default '{}',
  example_prompt  text
);

create index if not exists cad_knowledge_keywords_idx
  on cad_knowledge using gin (keywords);

create index if not exists cad_knowledge_tags_idx
  on cad_knowledge using gin (tags);

alter table if exists cad_knowledge
  add column if not exists created_at      timestamptz not null default now(),
  add column if not exists title           text,
  add column if not exists summary         text,
  add column if not exists tags            text[] not null default '{}',
  add column if not exists keywords        text[] not null default '{}',
  add column if not exists parameter_hints text[] not null default '{}',
  add column if not exists modeling_notes  text[] not null default '{}',
  add column if not exists example_prompt  text;

select public.ensure_uuid_id_primary_key('cad_knowledge');

create unique index if not exists cad_knowledge_title_unique_idx
  on cad_knowledge (title);

create table if not exists shape_knowledge (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  shape_type   text not null unique,
  aliases      text[] not null default '{}',
  description  text,
  default_dims jsonb not null default '{}'::jsonb,
  notes        text
);

select public.ensure_uuid_id_primary_key('shape_knowledge');

create table if not exists image_analyses (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  image_count    int4 not null default 1,
  image_contexts text[] not null default '{}',
  global_prompt  text,
  ai_description text,
  generation_id  uuid references generations (id) on delete set null
);

select public.ensure_uuid_id_primary_key('image_analyses');

create table if not exists debug_sessions (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  original_code  text not null default '',
  error_messages text not null default '',
  fixed_code     text not null default '',
  explanation    text not null default ''
);

select public.ensure_uuid_id_primary_key('debug_sessions');

-- 1. Add missing columns to existing generations table
alter table if exists generations
  add column if not exists char_count    int4 generated always as (char_length(featurescript)) stored,
  add column if not exists user_rating   int2,
  add column if not exists user_feedback text;

alter table if exists image_analyses
  add column if not exists image_count    int4 not null default 1,
  add column if not exists image_contexts text[] not null default '{}',
  add column if not exists global_prompt  text,
  add column if not exists ai_description text,
  add column if not exists generation_id  uuid references generations (id) on delete set null;

alter table if exists debug_sessions
  add column if not exists original_code  text not null default '',
  add column if not exists error_messages text not null default '',
  add column if not exists fixed_code     text not null default '',
  add column if not exists explanation    text not null default '';

-- 2. cad_memory — scored CAD skill records
create table if not exists cad_memory (
  id               uuid primary key default gen_random_uuid(),
  memory_type      text not null default 'skill',
  title            text not null,
  summary          text,
  shape_type       text,
  tags             text[]   not null default '{}',
  keywords         text[]   not null default '{}',
  parameter_hints  text[]   not null default '{}',
  modeling_notes   text[]   not null default '{}',
  feature_pattern  text,
  failure_modes    text[]   not null default '{}',
  validation_rules text[]   not null default '{}',
  quality_score    float8   not null default 0.5,
  usage_count      int4     not null default 0,
  success_count    int4     not null default 0,
  failure_count    int4     not null default 0,
  is_active        boolean  not null default true,
  source_table     text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint cad_memory_title_unique unique (title)
);

alter table if exists cad_memory
  add column if not exists memory_type      text not null default 'skill',
  add column if not exists title            text,
  add column if not exists summary          text,
  add column if not exists shape_type       text,
  add column if not exists tags             text[]   not null default '{}',
  add column if not exists keywords         text[]   not null default '{}',
  add column if not exists parameter_hints  text[]   not null default '{}',
  add column if not exists modeling_notes   text[]   not null default '{}',
  add column if not exists feature_pattern  text,
  add column if not exists failure_modes    text[]   not null default '{}',
  add column if not exists validation_rules text[]   not null default '{}',
  add column if not exists quality_score    float8   not null default 0.5,
  add column if not exists usage_count      int4     not null default 0,
  add column if not exists success_count    int4     not null default 0,
  add column if not exists failure_count    int4     not null default 0,
  add column if not exists is_active        boolean  not null default true,
  add column if not exists source_table     text,
  add column if not exists created_at       timestamptz not null default now(),
  add column if not exists updated_at       timestamptz not null default now();

select public.ensure_uuid_id_primary_key('cad_memory');

create unique index if not exists cad_memory_title_unique_idx
  on cad_memory (title);

create index if not exists cad_memory_shape_idx     on cad_memory (shape_type);
create index if not exists cad_memory_quality_idx   on cad_memory (quality_score desc);
create index if not exists cad_memory_is_active_idx on cad_memory (is_active);

-- 3. cad_generation_memory_matches — links generations to the memories that influenced them
create table if not exists cad_generation_memory_matches (
  id              uuid primary key default gen_random_uuid(),
  generation_id   uuid references generations (id) on delete cascade,
  memory_id       uuid references cad_memory (id)  on delete cascade,
  score_rank      int4    not null default 0,
  score_snapshot  float8  not null default 0,
  neural_score    float8,
  feature_vector  jsonb   not null default '[]'::jsonb,
  source_kind     text    not null default 'memory',
  created_at      timestamptz not null default now()
);

create index if not exists cgmm_generation_idx on cad_generation_memory_matches (generation_id);
create index if not exists cgmm_memory_idx     on cad_generation_memory_matches (memory_id);

alter table if exists cad_generation_memory_matches
  add column if not exists generation_id   uuid,
  add column if not exists memory_id       uuid,
  add column if not exists score_rank      int4    not null default 0,
  add column if not exists score_snapshot  float8  not null default 0,
  add column if not exists neural_score   float8,
  add column if not exists feature_vector jsonb not null default '[]'::jsonb,
  add column if not exists source_kind    text  not null default 'memory',
  add column if not exists created_at     timestamptz not null default now();

select public.ensure_uuid_id_primary_key('cad_generation_memory_matches');

-- 4. cad_feedback_events — raw feedback signals
create table if not exists cad_feedback_events (
  id            uuid primary key default gen_random_uuid(),
  generation_id uuid references generations (id) on delete cascade,
  signal        text    not null default 'feedback',
  rating        int2,
  weight        float8  not null default 0,
  notes         text,
  created_at    timestamptz not null default now()
);

create index if not exists cfe_generation_idx on cad_feedback_events (generation_id);

alter table if exists cad_feedback_events
  add column if not exists generation_id uuid,
  add column if not exists signal        text    not null default 'feedback',
  add column if not exists rating        int2,
  add column if not exists weight        float8  not null default 0,
  add column if not exists notes         text,
  add column if not exists created_at    timestamptz not null default now();

select public.ensure_uuid_id_primary_key('cad_feedback_events');

-- 5. cad_memory_pruning_events — audit trail for deactivated memories
create table if not exists cad_memory_pruning_events (
  id                   uuid primary key default gen_random_uuid(),
  memory_id            uuid references cad_memory (id) on delete cascade,
  reason               text,
  quality_score_before float8,
  created_at           timestamptz not null default now()
);

alter table if exists cad_memory_pruning_events
  add column if not exists memory_id            uuid,
  add column if not exists reason               text,
  add column if not exists quality_score_before float8,
  add column if not exists created_at           timestamptz not null default now();

select public.ensure_uuid_id_primary_key('cad_memory_pruning_events');

-- 6. cad_learning_state — trainable neural reranker weights/state
create table if not exists cad_learning_state (
  id          uuid primary key default gen_random_uuid(),
  state_key   text not null unique,
  state       jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table if exists cad_learning_state
  add column if not exists state_key   text,
  add column if not exists state       jsonb not null default '{}'::jsonb,
  add column if not exists created_at  timestamptz not null default now(),
  add column if not exists updated_at  timestamptz not null default now();

select public.ensure_uuid_id_primary_key('cad_learning_state');

create unique index if not exists cad_learning_state_key_unique_idx
  on cad_learning_state (state_key);

-- ─── RPCs ────────────────────────────────────────────────────────────────────

-- 7. search_cad_memory — scored keyword + shape search
create or replace function search_cad_memory(
  query_text     text    default '',
  query_keywords text[]  default '{}',
  query_shape    text    default null,
  match_limit    int     default 8
)
returns table (
  id               uuid,
  memory_type      text,
  title            text,
  summary          text,
  shape_type       text,
  tags             text[],
  keywords         text[],
  parameter_hints  text[],
  modeling_notes   text[],
  feature_pattern  text,
  failure_modes    text[],
  validation_rules text[],
  quality_score    float8,
  usage_count      int4,
  success_count    int4,
  failure_count    int4,
  match_score      float8
)
language sql stable
as $$
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
      m.quality_score * 2
      + case when m.shape_type = query_shape and query_shape is not null then 3 else 0 end
      + (
          select count(*)::float8
          from unnest(query_keywords) kw
          where
            m.title      ilike '%' || kw || '%'
            or m.summary ilike '%' || kw || '%'
            or kw = any(m.keywords)
            or kw = any(m.tags)
        )
    ) as match_score
  from cad_memory m
  where m.is_active = true
  order by match_score desc
  limit match_limit;
$$;

-- 8. mark_cad_memory_used — increment usage_count for retrieved memories
create or replace function mark_cad_memory_used(memory_ids uuid[])
returns void
language sql
as $$
  update cad_memory
  set
    usage_count = usage_count + 1,
    updated_at  = now()
  where id = any(memory_ids);
$$;

-- 9. record_cad_feedback — apply a feedback signal to linked memory quality scores
create or replace function record_cad_feedback(
  p_generation_id uuid,
  p_signal        text    default 'feedback',
  p_weight        float8  default 0,
  p_notes         text    default null,
  p_rating        int2    default null
)
returns void
language plpgsql
as $$
declare
  v_memory_id uuid;
begin
  -- Insert the raw feedback event
  insert into cad_feedback_events (generation_id, signal, rating, weight, notes)
  values (p_generation_id, p_signal, p_rating, p_weight, p_notes);

  -- Update generation rating / feedback if provided
  if p_rating is not null or p_notes is not null then
    update generations
    set
      user_rating   = coalesce(p_rating,   user_rating),
      user_feedback = coalesce(p_notes,    user_feedback)
    where id = p_generation_id;
  end if;

  -- Propagate weight to each linked memory's quality score
  for v_memory_id in
    select memory_id
    from cad_generation_memory_matches
    where generation_id = p_generation_id
  loop
    update cad_memory
    set
      quality_score  = greatest(0, least(1, quality_score + p_weight)),
      success_count  = case when p_weight > 0 then success_count + 1 else success_count end,
      failure_count  = case when p_weight < 0 then failure_count + 1 else failure_count end,
      updated_at     = now()
    where id = v_memory_id;
  end loop;
end;
$$;

-- 10. prune_cad_memory — deactivate repeatedly failing memories
create or replace function prune_cad_memory()
returns int
language plpgsql
as $$
declare
  v_count int := 0;
  v_row   record;
begin
  for v_row in
    select id, quality_score
    from cad_memory
    where
      is_active     = true
      and failure_count  > 3
      and quality_score  < 0.2
  loop
    update cad_memory
    set is_active = false, updated_at = now()
    where id = v_row.id;

    insert into cad_memory_pruning_events (memory_id, reason, quality_score_before)
    values (v_row.id, 'failure_count > 3 and quality_score < 0.2', v_row.quality_score);

    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ─── Row-level security (match existing tables) ───────────────────────────────
alter table generations                    enable row level security;
alter table cad_knowledge                  enable row level security;
alter table shape_knowledge                enable row level security;
alter table image_analyses                 enable row level security;
alter table debug_sessions                 enable row level security;
alter table cad_memory                      enable row level security;
alter table cad_generation_memory_matches   enable row level security;
alter table cad_feedback_events             enable row level security;
alter table cad_memory_pruning_events       enable row level security;
alter table cad_learning_state              enable row level security;

-- Public read + anon insert/update. This app currently uses the anon key from
-- the server only; tighten these policies before exposing direct browser DB writes.
drop policy if exists "anon read generations" on generations;
create policy "anon read generations"
  on generations for select using (true);
drop policy if exists "anon insert generations" on generations;
create policy "anon insert generations"
  on generations for insert with check (true);
drop policy if exists "anon update generations" on generations;
create policy "anon update generations"
  on generations for update using (true);

drop policy if exists "anon read cad_knowledge" on cad_knowledge;
create policy "anon read cad_knowledge"
  on cad_knowledge for select using (true);
drop policy if exists "anon insert cad_knowledge" on cad_knowledge;
create policy "anon insert cad_knowledge"
  on cad_knowledge for insert with check (true);
drop policy if exists "anon update cad_knowledge" on cad_knowledge;
create policy "anon update cad_knowledge"
  on cad_knowledge for update using (true);

drop policy if exists "anon read shape_knowledge" on shape_knowledge;
create policy "anon read shape_knowledge"
  on shape_knowledge for select using (true);
drop policy if exists "anon insert shape_knowledge" on shape_knowledge;
create policy "anon insert shape_knowledge"
  on shape_knowledge for insert with check (true);
drop policy if exists "anon update shape_knowledge" on shape_knowledge;
create policy "anon update shape_knowledge"
  on shape_knowledge for update using (true);

drop policy if exists "anon read image_analyses" on image_analyses;
create policy "anon read image_analyses"
  on image_analyses for select using (true);
drop policy if exists "anon insert image_analyses" on image_analyses;
create policy "anon insert image_analyses"
  on image_analyses for insert with check (true);

drop policy if exists "anon read debug_sessions" on debug_sessions;
create policy "anon read debug_sessions"
  on debug_sessions for select using (true);
drop policy if exists "anon insert debug_sessions" on debug_sessions;
create policy "anon insert debug_sessions"
  on debug_sessions for insert with check (true);

drop policy if exists "anon read cad_memory" on cad_memory;
create policy "anon read cad_memory"
  on cad_memory for select using (true);
drop policy if exists "anon insert cad_memory" on cad_memory;
create policy "anon insert cad_memory"
  on cad_memory for insert with check (true);
drop policy if exists "anon update cad_memory" on cad_memory;
create policy "anon update cad_memory"
  on cad_memory for update using (true);

drop policy if exists "anon insert memory_matches" on cad_generation_memory_matches;
create policy "anon insert memory_matches"
  on cad_generation_memory_matches for insert with check (true);
drop policy if exists "anon read memory_matches" on cad_generation_memory_matches;
create policy "anon read memory_matches"
  on cad_generation_memory_matches for select using (true);

drop policy if exists "anon insert feedback_events" on cad_feedback_events;
create policy "anon insert feedback_events"
  on cad_feedback_events for insert with check (true);
drop policy if exists "anon read feedback_events" on cad_feedback_events;
create policy "anon read feedback_events"
  on cad_feedback_events for select using (true);

drop policy if exists "anon read pruning_events" on cad_memory_pruning_events;
create policy "anon read pruning_events"
  on cad_memory_pruning_events for select using (true);
drop policy if exists "anon insert pruning_events" on cad_memory_pruning_events;
create policy "anon insert pruning_events"
  on cad_memory_pruning_events for insert with check (true);

drop policy if exists "anon read learning_state" on cad_learning_state;
create policy "anon read learning_state"
  on cad_learning_state for select using (true);
drop policy if exists "anon insert learning_state" on cad_learning_state;
create policy "anon insert learning_state"
  on cad_learning_state for insert with check (true);
drop policy if exists "anon update learning_state" on cad_learning_state;
create policy "anon update learning_state"
  on cad_learning_state for update using (true);

drop function if exists public.ensure_uuid_id_primary_key(text);
