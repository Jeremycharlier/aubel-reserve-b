-- Banc de test local SANS Docker : reproduit les rôles et privilèges
-- par défaut d'un projet Supabase hébergé. Ne PAS exécuter sur Supabase.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit password 'authenticator';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin login createrole password 'auth_admin';
  end if;
end $$;

grant anon, authenticated, service_role to authenticator;
grant anon, authenticated, service_role to postgres;

create schema if not exists auth authorization supabase_auth_admin;
grant create on database postgres to supabase_auth_admin;
alter role supabase_auth_admin set search_path = auth;
grant usage on schema auth to anon, authenticated, service_role;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;

-- Privilèges par défaut identiques à Supabase : tout est accordé à
-- anon/authenticated/service_role ; nos migrations doivent donc révoquer
-- explicitement ce qui ne doit pas être accessible.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
