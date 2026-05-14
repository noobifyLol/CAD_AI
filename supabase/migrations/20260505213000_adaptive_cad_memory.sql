-- ── Users table (Reddit-style: username + password, no email) ──────────────────
create table if not exists cad_users (
  id            uuid primary key default gen_random_uuid(),
  username      text not null,
  password_hash text not null,
  created_at    timestamptz not null default now(),
  constraint cad_users_username_unique unique (username)
);

alter table cad_users enable row level security;

-- Service-role can do everything; anon key can only insert (signup) and
-- read their own row via the RPC below (we don't expose the raw table to anon).
create policy if not exists "service insert cad_users"
  on cad_users for insert with check (true);

-- ── Add user_id to generations so history is per-user ───────────────────────
alter table if exists generations
  add column if not exists user_id uuid references cad_users (id) on delete set null;

create index if not exists generations_user_id_idx on generations (user_id);

-- ── History view — compact columns for the history panel ────────────────────
create or replace view generation_history as
  select
    id,
    user_id,
    prompt,
    shape_type,
    confidence,
    featurescript,
    char_count,
    user_rating,
    user_feedback,
    created_at
  from generations
  order by created_at desc;

-- Anyone can read their own history via this RPC (avoids wide table exposure)
create or replace function get_user_history(p_user_id uuid, p_limit int default 30)
returns table (
  id            uuid,
  prompt        text,
  shape_type    text,
  confidence    text,
  featurescript text,
  user_rating   int2,
  created_at    timestamptz
)
language sql stable security definer
as $$
  select id, prompt, shape_type, confidence, featurescript, user_rating, created_at
  from generations
  where user_id = p_user_id
  order by created_at desc
  limit p_limit;
$$;