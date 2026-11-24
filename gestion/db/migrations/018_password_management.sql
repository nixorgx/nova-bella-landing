-- 018: password management.
--
--  * change_own_password: any signed-in user changes THEIR OWN password (the app verified the current
--    one first). Only the caller's own row can change: the identity comes from the signed request
--    context (app_user_id()), never from an argument.
--  * admin_reset_password: a superadmin sets a new (temporary) password for ANOTHER user and may force a
--    change at the next sign-in (must_change_password).
--  * Both bump token_version (every old session dies) and leave who/when in password_changed_by/_at
--    (never the password, only its bcrypt hash is ever stored).
--
-- The runtime roles do NOT gain UPDATE on users: the writes happen inside SECURITY DEFINER functions owned
-- by app_definer. The superadmin's old column grant on users.password_hash is revoked (nothing used it).

alter table users add column must_change_password boolean not null default false;
alter table users add column password_changed_at timestamptz;
alter table users add column password_changed_by uuid references users (id);

-- who/when is visible to the superadmin (the Usuarios screen); the flag is needed by the request guard
-- through auth_load_user, not by the table grants.
grant select (must_change_password, password_changed_at, password_changed_by) on users to app_superadmin;
grant update (password_hash, must_change_password, password_changed_at, password_changed_by, token_version)
  on users to app_definer;
revoke update (password_hash) on users from app_superadmin;

-- ---- auth_load_user now also reports the must-change flag (return type changes: drop and recreate) ----
drop function auth_load_user(uuid);
create function auth_load_user(p_user_id uuid)
returns table (id uuid, username text, full_name text, role text, branch_id uuid,
               branch_name text, token_version integer, must_change_password boolean)
language sql stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select u.id, u.username, u.full_name, u.role, u.branch_id, b.name, u.token_version, u.must_change_password
    from users u
    left join branches b on b.id = u.branch_id
   where u.id = p_user_id
     and u.active
     and (u.role = 'superadmin' or coalesce(b.active, false))
$$;
alter function auth_load_user(uuid) owner to app_definer;
revoke all on function auth_load_user(uuid) from public;
grant execute on function auth_load_user(uuid) to app_runtime_auth;

-- ---- change_own_password ----
-- p_old_hash is the hash the app just verified the current password against: if the row changed in the
-- meantime (another tab, a reset) nothing is written and the caller is told to try again.
create or replace function change_own_password(p_old_hash text, p_new_hash text) returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_uid     uuid := app_user_id();
  v_version integer;
begin
  perform assert_role(array['seller', 'superadmin']);
  if p_new_hash is null or p_old_hash is null or p_new_hash !~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$' then
    raise exception 'La contraseña nueva no es valida' using errcode = 'IN003';
  end if;
  update users
     set password_hash = p_new_hash,
         must_change_password = false,
         password_changed_at = now(),
         password_changed_by = v_uid,
         token_version = token_version + 1
   where id = v_uid and active and password_hash = p_old_hash
   returning token_version into v_version;
  if v_version is null then
    raise exception 'No se pudo cambiar la contraseña. Vuelva a intentarlo' using errcode = 'IN005';
  end if;
  return v_version;
end
$$;

-- ---- admin_reset_password ----
create or replace function admin_reset_password(p_user_id uuid, p_new_hash text, p_must_change boolean default true)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor   uuid := app_user_id();
  v_version integer;
begin
  perform assert_role(array['superadmin']);
  if p_user_id is null or p_user_id = v_actor then
    raise exception 'Para su propia cuenta use "Cambiar mi contraseña"' using errcode = 'IN004';
  end if;
  if p_new_hash is null or p_new_hash !~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$' then
    raise exception 'La contraseña nueva no es valida' using errcode = 'IN003';
  end if;
  update users
     set password_hash = p_new_hash,
         must_change_password = coalesce(p_must_change, true),
         password_changed_at = now(),
         password_changed_by = v_actor,
         token_version = token_version + 1
   where id = p_user_id
   returning token_version into v_version;
  if v_version is null then
    raise exception 'El usuario no existe' using errcode = 'IN005';
  end if;
  return v_version;
end
$$;

alter function change_own_password(text, text) owner to app_definer;
alter function admin_reset_password(uuid, text, boolean) owner to app_definer;
revoke all on function change_own_password(text, text), admin_reset_password(uuid, text, boolean) from public;
grant execute on function change_own_password(text, text) to app_seller, app_superadmin;
grant execute on function admin_reset_password(uuid, text, boolean) to app_superadmin;
