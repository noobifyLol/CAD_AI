create table if not exists public.generations (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    prompt text not null,
    shape_type text,
    confidence text,
    dims jsonb not null default '{}'::jsonb,
    featurescript text not null,
    thinking text
);

create index if not exists generations_created_at_idx
    on public.generations (created_at desc);

create index if not exists generations_shape_type_idx
    on public.generations (shape_type);

create table if not exists public.cad_knowledge (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    title text not null unique,
    summary text not null,
    tags text[] not null default '{}',
    keywords text[] not null default '{}',
    parameter_hints text[] not null default '{}',
    modeling_notes text[] not null default '{}',
    example_prompt text
);

create index if not exists cad_knowledge_keywords_idx
    on public.cad_knowledge using gin (keywords);

create index if not exists cad_knowledge_tags_idx
    on public.cad_knowledge using gin (tags);
