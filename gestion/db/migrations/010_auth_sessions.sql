-- 010: server-side session invalidation + a narrow, function-only door for authentication.
--
-- Login has to read users.password_hash before anybody is signed in, so it cannot run
-- as seller/superadmin. The `app_runtime_auth` role has NO table privileges at all; it
-- can only EXECUTE the three auth_* functions below (owned by app_definer).

alter table users add column token_version integer not null default 0;

-- Any change that should end existing sessions bumps the version (unless the caller
-- bumped it explicitly): password change, (de)activation, branch or role change.
create or replace function users_bump_token_version() returns trigger
language plpgsql
as $$
begin
  if new.token_version = old.token_version
     and (new.password_hash is distinct from old.password_hash
          or new.active is distinct from old.active
          or new.branch_id is distinct from old.branch_id
          or new.role is distinct from old.role) then
    new.token_version := old.token_version + 1;
  end if;
  return new;
end
$$;

create trigger users_bump_token_version before update on users
  for each row execute function users_bump_token_version();

-- Sellers of an inactive branch cannot sign in (nor keep a session).
create or replace function auth_login_lookup(p_username text)
returns table (id uuid, password_hash text, role text, branch_id uuid, token_version integer)
language sql stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select u.id, u.password_hash, u.role, u.branch_id, u.token_version
    from users u
    left join branches b on b.id = u.branch_id
   where lower(u.username) = lower(p_username)
     and u.active
     and (u.role = 'superadmin' or coalesce(b.active, false))
$$;

create or replace function auth_record_login(p_user_id uuid) returns void
language sql volatile
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  update users set last_login_at = now() where id = p_user_id and active
$$;

create or replace function auth_load_user(p_user_id uuid)
returns table (id uuid, username text, full_name text, role text, branch_id uuid,
               branch_name text, token_version integer)
language sql stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select u.id, u.username, u.full_name, u.role, u.branch_id, b.name, u.token_version
    from users u
    left join branches b on b.id = u.branch_id
   where u.id = p_user_id
     and u.active
     and (u.role = 'superadmin' or coalesce(b.active, false))
$$;

-- Logout-all: superadmin invalidates the sessions of one user, or of everybody when null.
create or replace function revoke_user_sessions(p_user_id uuid default null) returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_count integer;
begin
  perform assert_role(array['superadmin']);
  update users set token_version = token_version + 1
   where p_user_id is null or id = p_user_id;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

alter function users_bump_token_version() owner to app_definer;
alter function auth_login_lookup(text) owner to app_definer;
alter function auth_record_login(uuid) owner to app_definer;
alter function auth_load_user(uuid) owner to app_definer;
alter function revoke_user_sessions(uuid) owner to app_definer;

grant update (token_version) on users to app_definer;
revoke all on function auth_login_lookup(text), auth_record_login(uuid), auth_load_user(uuid),
  revoke_user_sessions(uuid), users_bump_token_version() from public;
grant execute on function auth_login_lookup(text), auth_record_login(uuid), auth_load_user(uuid)
  to app_runtime_auth;
grant execute on function revoke_user_sessions(uuid) to app_superadmin;
