#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ $# -ne 1 ]]; then
  printf 'Usage: PASSPHRASE_FILE=/path/to/key RESTORE_CONFIRM=restore-agentproofarch %s DUMP_FILE\n' "$0" >&2
  exit 2
fi

dump_file="$1"
: "${PASSPHRASE_FILE:?PASSPHRASE_FILE is required}"
: "${RESTORE_CONFIRM:?RESTORE_CONFIRM is required}"

if [[ "$RESTORE_CONFIRM" != "restore-agentproofarch" ]]; then
  printf 'RESTORE_CONFIRM must equal restore-agentproofarch\n' >&2
  exit 2
fi

if [[ ! -r "$dump_file" || ! -r "$PASSPHRASE_FILE" ]]; then
  printf 'The dump and passphrase files must both be readable\n' >&2
  exit 2
fi

for command_name in docker gpg sha256sum; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'Required command is missing: %s\n' "$command_name" >&2
    exit 2
  fi
done

compose_dir="${COMPOSE_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
compose_file="${COMPOSE_FILE:-docker-compose.prod.yml}"
compose_dir="$(cd "$compose_dir" && pwd)"
if [[ "$compose_file" != /* ]]; then
  compose_file="${compose_dir}/${compose_file}"
fi
if [[ ! -f "$compose_file" ]]; then
  printf 'Compose file does not exist: %s\n' "$compose_file" >&2
  exit 2
fi

compose=(docker compose --project-directory "$compose_dir" -f "$compose_file" --profile edge)
checksum_file="${dump_file}.sha256"

if [[ ! -r "$checksum_file" ]]; then
  printf 'Checksum sidecar is required: %s\n' "$checksum_file" >&2
  exit 2
fi

(
  cd "$(dirname "$dump_file")"
  sha256sum --check "$(basename "$checksum_file")"
)

restore_tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/agentproofarch-restore.XXXXXX")"
plain_dump="${restore_tmp_dir}/restore.dump"
cleanup() {
  rm -rf -- "$restore_tmp_dir"
}
trap cleanup EXIT

gpg \
  --decrypt \
  --batch \
  --quiet \
  --pinentry-mode loopback \
  --passphrase-file "$PASSPHRASE_FILE" \
  --output "$plain_dump" \
  "$dump_file"
chmod 600 "$plain_dump"

"${compose[@]}" config --services >/dev/null
"${compose[@]}" up -d postgres >/dev/null

for _ in {1..60}; do
  if "${compose[@]}" exec -T postgres pg_isready >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

if ! "${compose[@]}" exec -T postgres pg_isready >/dev/null 2>&1; then
  printf 'Postgres did not become ready\n' >&2
  exit 1
fi

postgres_major="$("${compose[@]}" exec -T postgres pg_restore --version | sed -E 's/.* ([0-9]+)\..*/\1/' | tr -d '\r')"
if [[ "$postgres_major" != "16" ]]; then
  printf 'Restore requires PostgreSQL client major 16; found %s\n' "$postgres_major" >&2
  exit 1
fi

"${compose[@]}" exec -T postgres pg_restore --list <"$plain_dump" >/dev/null

database="$("${compose[@]}" exec -T postgres sh -eu -c 'printf "%s" "$POSTGRES_DB"' | tr -d '\r')"
database_user="$("${compose[@]}" exec -T postgres sh -eu -c 'printf "%s" "$POSTGRES_USER"' | tr -d '\r')"

if [[ ! "$database" =~ ^[A-Za-z_][A-Za-z0-9_-]*$ || "$database" == "postgres" || "$database" == "template0" || "$database" == "template1" ]]; then
  printf 'Refusing unsafe target database name\n' >&2
  exit 1
fi

"${compose[@]}" stop app caddy >/dev/null
"${compose[@]}" exec -T postgres dropdb \
  --username "$database_user" \
  --maintenance-db postgres \
  --force \
  --if-exists \
  "$database"
"${compose[@]}" exec -T postgres createdb \
  --username "$database_user" \
  --owner "$database_user" \
  "$database"

"${compose[@]}" exec -T postgres pg_restore \
    --username "$database_user" \
    --dbname "$database" \
    --exit-on-error \
    --no-owner \
    --no-privileges \
    <"$plain_dump"

"${compose[@]}" exec -T postgres vacuumdb \
  --username "$database_user" \
  --dbname "$database" \
  --analyze-in-stages >/dev/null

printf 'Restore completed. The app and Caddy remain stopped for verification.\n'
