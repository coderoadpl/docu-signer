#!/bin/sh
set -e

# Migrations run on startup — deterministic and idempotent (drizzle records
# applied migrations, so re-running is a no-op). The app never serves against an
# un-migrated schema.
echo "entrypoint: applying migrations..."
node adapters/db/migrate.js

# Demo seed is opt-in (SEED_ON_START=true) — off in production, on for the CI
# smoke stack and local demos. The seed is idempotent.
if [ "${SEED_ON_START}" = "true" ]; then
  echo "entrypoint: seeding demo data (SEED_ON_START=true)..."
  node adapters/db/seed.js
fi

echo "entrypoint: starting server..."
exec node apps/server/src/entry.node.js
