#!/usr/bin/env bash
# Télécharge les binaires officiels Supabase Auth et PostgREST (Linux x86-64)
# utilisés par le banc de test local sans Docker.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STACK_BIN="${STACK_BIN:-$ROOT/.stack/bin}"
AUTH_VERSION="${AUTH_VERSION:-v2.197.0}"
PGRST_VERSION="${PGRST_VERSION:-v14.18}"
mkdir -p "$STACK_BIN/auth"
curl -sSL "https://github.com/supabase/auth/releases/download/$AUTH_VERSION/auth-$AUTH_VERSION-x86.tar.gz" \
  | tar xz -C "$STACK_BIN/auth"
curl -sSL "https://github.com/PostgREST/postgrest/releases/download/$PGRST_VERSION/postgrest-$PGRST_VERSION-linux-static-x86-64.tar.xz" \
  | tar xJ -C "$STACK_BIN"
echo "Binaires installés dans $STACK_BIN"
