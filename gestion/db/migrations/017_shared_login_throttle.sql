-- 017: login throttling shared by every app instance.
--
-- The in-memory limiter of the app is per process: on a serverless host (Vercel) every cold start
-- and every parallel instance has its own counters, so the real limit is a multiple of the intended
-- one. These attempts live in the database instead. Only app_runtime_auth (which can run nothing
-- but auth_* functions) reaches them, through two SECURITY DEFINER functions; the table itself has
-- no grant for any runtime login.

create table auth_login_attempts (
  key           text primary key check (length(key) between 1 and 200),
  attempts      integer not null check (attempts > 0),
  window_start  timestamptz not null default now()
);
create index auth_login_attempts_window_idx on auth_login_attempts (window_start);

alter table auth_login_attempts enable row level security;
revoke all on auth_login_attempts from public;
grant select, insert, update, delete on auth_login_attempts to app_definer;

-- Takes one attempt slot BEFORE the password is checked. Atomic per key (advisory lock), so parallel
-- guesses cannot all pass a "not blocked yet" test. Returns allowed + seconds to wait when blocked.
create or replace function auth_reserve_attempt(p_key text, p_max integer, p_window_seconds integer)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row  auth_login_attempts%rowtype;
  v_wait integer;
begin
  if p_key is null or length(p_key) not between 1 and 200
     or coalesce(p_max, 0) not between 1 and 1000
     or coalesce(p_window_seconds, 0) not between 1 and 86400 then
    raise exception 'Parametros de limite no validos' using errcode = 'IN003';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_key, 727));
  -- housekeeping: forget rows whose window ended long ago (a day), a few at a time
  delete from auth_login_attempts
   where ctid in (select ctid from auth_login_attempts where window_start < now() - interval '1 day' limit 20);

  select * into v_row from auth_login_attempts where key = p_key;
  if not found or v_row.window_start + make_interval(secs => p_window_seconds) <= now() then
    insert into auth_login_attempts (key, attempts, window_start) values (p_key, 1, now())
    on conflict (key) do update set attempts = 1, window_start = now();
    return query select true, 0;
    return;
  end if;
  if v_row.attempts >= p_max then
    v_wait := greatest(1, ceil(extract(epoch from (v_row.window_start + make_interval(secs => p_window_seconds) - now())))::integer);
    return query select false, v_wait;
    return;
  end if;
  update auth_login_attempts set attempts = attempts + 1 where key = p_key;
  return query select true, 0;
end
$$;

create or replace function auth_clear_attempts(p_key text) returns void
language sql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  delete from auth_login_attempts where key = p_key
$$;

alter function auth_reserve_attempt(text, integer, integer) owner to app_definer;
alter function auth_clear_attempts(text) owner to app_definer;
revoke all on function auth_reserve_attempt(text, integer, integer), auth_clear_attempts(text) from public;
grant execute on function auth_reserve_attempt(text, integer, integer), auth_clear_attempts(text) to app_runtime_auth;
