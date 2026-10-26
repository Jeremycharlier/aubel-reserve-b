#!/usr/bin/env bash
# Banc de test local SANS Docker : PostgreSQL 16 + Supabase Auth + PostgREST.
# Réinitialise ENTIÈREMENT la base locale de test à chaque lancement.
#
# Prérequis : un PostgreSQL 16 local accessible en superutilisateur `postgres`
# sans mot de passe sur le port $PGPORT (par défaut 54322), et les binaires
# `auth` (supabase/auth) et `postgrest` dans $STACK_BIN (voir download.sh).
#
# Pour un développement courant, préférez la CLI Supabase (`supabase start`),
# qui fournit la même pile via Docker.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STACK_BIN="${STACK_BIN:-$ROOT/.stack/bin}"
STACK_RUN="${STACK_RUN:-$ROOT/.stack/run}"
PGPORT="${PGPORT:-54322}"
JWT_SECRET="${JWT_SECRET:-local-test-secret-with-at-least-32-characters}"
export PGOPTIONS="-c client_min_messages=warning"
PSQL=(psql -h 127.0.0.1 -p "$PGPORT" -U postgres -v ON_ERROR_STOP=1 -q)
mkdir -p "$STACK_RUN"

stop() { pkill -f "$STACK_BIN/auth/auth" 2>/dev/null || true
         pkill -f "$STACK_BIN/postgrest" 2>/dev/null || true
         pkill -f "scripts/stack/gateway.mjs" 2>/dev/null || true; }
stop
for _ in $(seq 1 20); do
  curl -s -o /dev/null http://127.0.0.1:9999/health || curl -s -o /dev/null http://127.0.0.1:3001/ || break
  sleep 0.5
done
if curl -s -o /dev/null http://127.0.0.1:9999/health; then
  echo "Le port 9999 est encore occupé par un ancien processus : arrêtez-le puis relancez."; exit 1
fi

echo "› Réinitialisation de la base de test"
"${PSQL[@]}" -d postgres <<'SQL'
select pg_terminate_backend(pid) from pg_stat_activity
 where datname = 'postgres' and pid <> pg_backend_pid();
drop schema if exists public cascade;
drop schema if exists auth cascade;
drop schema if exists extensions cascade;
create schema public;
grant usage, create on schema public to postgres;
SQL
"${PSQL[@]}" -f "$ROOT/scripts/stack/bootstrap.sql"

echo "› Démarrage de Supabase Auth"
(
  cd "$STACK_BIN/auth"
  export GOTRUE_API_HOST=127.0.0.1 PORT=9999 \
    API_EXTERNAL_URL=http://127.0.0.1:54321/auth/v1 \
    GOTRUE_DB_DRIVER=postgres \
    GOTRUE_DB_DATABASE_URL="postgres://supabase_auth_admin:auth_admin@127.0.0.1:$PGPORT/postgres?sslmode=disable" \
    GOTRUE_DB_MIGRATIONS_PATH="$STACK_BIN/auth/migrations" \
    GOTRUE_SITE_URL=http://localhost:3000 GOTRUE_JWT_SECRET="$JWT_SECRET" \
    GOTRUE_JWT_EXP=3600 GOTRUE_JWT_AUD=authenticated GOTRUE_JWT_ADMIN_ROLES=service_role GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated \
    GOTRUE_DISABLE_SIGNUP=true GOTRUE_EXTERNAL_EMAIL_ENABLED=true GOTRUE_MAILER_AUTOCONFIRM=true \
    GOTRUE_LOG_LEVEL=warn GOTRUE_RATE_LIMIT_TOKEN_REFRESH=10000 GOTRUE_RATE_LIMIT_VERIFY=10000
  nohup "$STACK_BIN/auth/auth" > "$STACK_RUN/auth.log" 2>&1 &
)
for _ in $(seq 1 40); do
  curl -sf http://127.0.0.1:9999/health >/dev/null && break; sleep 0.5
done
curl -sf http://127.0.0.1:9999/health >/dev/null || { echo "Auth ne démarre pas"; cat "$STACK_RUN/auth.log"; exit 1; }
# Attendre la fin des migrations internes de Supabase Auth
EXPECTED=$(ls "$STACK_BIN/auth/migrations" | grep -c '\.up\.sql$')
for _ in $(seq 1 60); do
  DONE=$(psql -h 127.0.0.1 -p "$PGPORT" -U postgres -Atqc \
    "select case when to_regclass('auth.schema_migrations') is null then 0 else (select count(*) from auth.schema_migrations) end" 2>/dev/null || echo 0)
  [ "$DONE" -ge "$EXPECTED" ] && break; sleep 0.5
done

echo "› Application des migrations"
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -f "$f" >/dev/null 2>"$STACK_RUN/migrate.err" || { cat "$STACK_RUN/migrate.err"; exit 1; }
done
if [ "${WITH_SEED:-0}" = "1" ]; then "${PSQL[@]}" -f "$ROOT/supabase/seed.sql" >/dev/null; fi

echo "› Démarrage de PostgREST"
cat > "$STACK_RUN/postgrest.conf" <<CONF
db-uri = "postgres://authenticator:authenticator@127.0.0.1:$PGPORT/postgres"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$JWT_SECRET"
server-host = "127.0.0.1"
server-port = 3001
CONF
nohup "$STACK_BIN/postgrest" "$STACK_RUN/postgrest.conf" > "$STACK_RUN/postgrest.log" 2>&1 &
nohup node "$ROOT/scripts/stack/gateway.mjs" > "$STACK_RUN/gateway.log" 2>&1 &
for _ in $(seq 1 40); do
  curl -sf http://127.0.0.1:3001/ >/dev/null 2>&1 && break; sleep 0.5
done
node "$ROOT/scripts/stack/keys.mjs" > "$STACK_RUN/keys.env"
echo "✓ Pile locale prête sur http://127.0.0.1:54321 (clés dans $STACK_RUN/keys.env)"
