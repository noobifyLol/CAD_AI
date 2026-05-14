-- Auth RPCs for server-side username/password login without exposing cad_users
-- through broad anon SELECT policies.

create or replace function auth_get_user_by_username(p_username text)
returns table (
  id uuid,
  username text,
  password_hash text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    cad_users.id,
    cad_users.username,
    cad_users.password_hash,
    cad_users.created_at
  from cad_users
  where cad_users.username = lower(trim(p_username))
  limit 1;
$$;

grant execute on function auth_get_user_by_username(text) to anon, authenticated, service_role;

create or replace function auth_create_user(p_username text, p_password_hash text)
returns table (
  id uuid,
  username text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  created_row cad_users%rowtype;
begin
  insert into cad_users (username, password_hash)
  values (lower(trim(p_username)), p_password_hash)
  returning * into created_row;

  return query
  select created_row.id, created_row.username, created_row.created_at;
end;
$$;

grant execute on function auth_create_user(text, text) to anon, authenticated, service_role;
