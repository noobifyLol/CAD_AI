-- ─────────────────────────────────────────────────────────────────────────────
-- Adaptive CAD Memory — migration
-- Run once in your Supabase SQL editor or via the CLI:
--   supabase db push
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add missing columns to existing generations table
alter table if exists generations
  add column if not exists char_count    int4,
  add column if not exists user_rating   int2,
  add column if not exists user_feedback text;

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
  created_at      timestamptz not null default now()
);

create index if not exists cgmm_generation_idx on cad_generation_memory_matches (generation_id);
create index if not exists cgmm_memory_idx     on cad_generation_memory_matches (memory_id);

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

-- 5. cad_memory_pruning_events — audit trail for deactivated memories
create table if not exists cad_memory_pruning_events (
  id                   uuid primary key default gen_random_uuid(),
  memory_id            uuid references cad_memory (id) on delete cascade,
  reason               text,
  quality_score_before float8,
  created_at           timestamptz not null default now()
);

-- ─── RPCs ────────────────────────────────────────────────────────────────────

-- 6. search_cad_memory — scored keyword + shape search
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

-- 7. mark_cad_memory_used — increment usage_count for retrieved memories
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

-- 8. record_cad_feedback — apply a feedback signal to linked memory quality scores
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

-- 9. prune_cad_memory — deactivate repeatedly failing memories
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
alter table cad_memory                      enable row level security;
alter table cad_generation_memory_matches   enable row level security;
alter table cad_feedback_events             enable row level security;
alter table cad_memory_pruning_events       enable row level security;

-- Public read + anon insert (same pattern as generations table)
create policy if not exists "anon read cad_memory"
  on cad_memory for select using (true);
create policy if not exists "anon insert cad_memory"
  on cad_memory for insert with check (true);
create policy if not exists "anon update cad_memory"
  on cad_memory for update using (true);

create policy if not exists "anon insert memory_matches"
  on cad_generation_memory_matches for insert with check (true);
create policy if not exists "anon read memory_matches"
  on cad_generation_memory_matches for select using (true);

create policy if not exists "anon insert feedback_events"
  on cad_feedback_events for insert with check (true);
create policy if not exists "anon read feedback_events"
  on cad_feedback_events for select using (true);

create policy if not exists "anon read pruning_events"
  on cad_memory_pruning_events for select using (true);
create policy if not exists "anon insert pruning_events"
  on cad_memory_pruning_events for insert with check (true);