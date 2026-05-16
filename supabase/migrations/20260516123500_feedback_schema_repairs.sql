-- Repair schema drift that breaks runtime feedback writes.
-- 1. cad_knowledge is upserted by title throughout the app and scripts.
-- 2. cad_memory_pruning_events is written with memory_id during manual prune fallback.

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'cad_knowledge'
  ) then
    -- Keep the newest row for each duplicated title before enforcing uniqueness.
    with ranked as (
      select
        ctid,
        row_number() over (
          partition by title
          order by created_at desc nulls last, ctid desc
        ) as rn
      from public.cad_knowledge
      where title is not null
    )
    delete from public.cad_knowledge ck
    using ranked r
    where ck.ctid = r.ctid
      and r.rn > 1;

    if not exists (
      select 1
      from pg_constraint
      where conname = 'cad_knowledge_title_unique'
    ) then
      alter table public.cad_knowledge
        add constraint cad_knowledge_title_unique unique (title);
    end if;
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'cad_memory_pruning_events'
  ) then
    alter table public.cad_memory_pruning_events
      add column if not exists memory_id uuid;

    if exists (
      select 1
      from information_schema.tables
      where table_schema = 'public'
        and table_name = 'cad_memory'
    ) then
      begin
        alter table public.cad_memory_pruning_events
          add constraint cad_memory_pruning_events_memory_id_fkey
          foreign key (memory_id) references public.cad_memory(id) on delete cascade;
      exception
        when duplicate_object then
          null;
      end;
    end if;

    create index if not exists cad_memory_pruning_events_memory_id_idx
      on public.cad_memory_pruning_events(memory_id);
  end if;
end $$;
