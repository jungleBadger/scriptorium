#!/usr/bin/env bash
# migrate_to_supabase.sh — Dumps data from local bible DB and restores to Supabase.
# Tables/indexes must already exist in the target (run SQL migrations first).
#
# WARNING: Full-load mode (default) assumes target tables are EMPTY.
# If the target already contains seed data or prior migrations, conflicts are
# silently skipped (DO NOTHING) or will crash (COPY). Verify target state first.
#
# Usage:
#   SUPABASE_PASSWORD=xxx bash ingest/scripts/migrate_to_supabase.sh
#
# Optional overrides:
#   LOCAL_PASSWORD=xxx      (default: "bible")
#   DUMP_FILE=/tmp/dump.sql (default: /tmp/scriptorium_data.sql)
#   SKIP_DUMP=1             (reuse an existing dump file)
#
# Delta mode — push only new/changed rows for specific tables:
#   DELTA=1 TABLES=chapter_explanations SUPABASE_PASSWORD=xxx bash ingest/scripts/migrate_to_supabase.sh
#
#   DELTA=1   switches from COPY to INSERT … ON CONFLICT DO NOTHING.
#             Rows already in the target are left untouched (target wins).
#             Rows added post-migration are NOT overwritten — intentional.
#   TABLES=   comma-separated list of tables to dump. REQUIRED when DELTA=1.
#             Omitting TABLES in delta mode is an error: tables with no natural
#             unique constraint (beyond a serial id) would silently insert
#             duplicates if local and remote ids have drifted.

set -euo pipefail

# ── Connection config ─────────────────────────────────────────────────────────

LOCAL_HOST="${LOCAL_HOST:-localhost}"
LOCAL_PORT="${LOCAL_PORT:-5432}"
LOCAL_USER="${LOCAL_USER:-bible}"
LOCAL_DB="${LOCAL_DB:-bible}"
LOCAL_PASSWORD="${LOCAL_PASSWORD:-bible}"

# Supabase direct connection (port 5432, bypasses pooler — better for bulk ops)
SUPABASE_HOST="${SUPABASE_HOST:-db.saziylgexsqotjpqrqkb.supabase.co}"
SUPABASE_PORT="${SUPABASE_PORT:-5432}"
SUPABASE_USER="${SUPABASE_USER:-postgres}"
SUPABASE_DB="${SUPABASE_DB:-postgres}"
SUPABASE_PASSWORD="${SUPABASE_PASSWORD:?Must set SUPABASE_PASSWORD}"

DUMP_FILE="${DUMP_FILE:-/tmp/scriptorium_data.sql}"
DELTA="${DELTA:-0}"
TABLES="${TABLES:-}"

if [[ "$DELTA" == "1" && -z "$TABLES" ]]; then
    echo "ERROR: TABLES= is required when DELTA=1. Specify a comma-separated list of tables to avoid silently inserting duplicates into tables with no natural unique key."
    exit 1
fi

# ── Helpers ───────────────────────────────────────────────────────────────────

local_psql()  { PGPASSWORD="$LOCAL_PASSWORD"    psql    -h "$LOCAL_HOST"    -p "$LOCAL_PORT"    -U "$LOCAL_USER"    -d "$LOCAL_DB"    "$@"; }
local_dump()  { PGPASSWORD="$LOCAL_PASSWORD"    pg_dump -h "$LOCAL_HOST"    -p "$LOCAL_PORT"    -U "$LOCAL_USER"    -d "$LOCAL_DB"    "$@"; }
remote_psql() { PGPASSWORD="$SUPABASE_PASSWORD" psql    -h "$SUPABASE_HOST" -p "$SUPABASE_PORT" -U "$SUPABASE_USER" -d "$SUPABASE_DB" "$@"; }

# ── Step 1: Row counts on local ───────────────────────────────────────────────

echo "=== Local row counts ==="
local_psql -t -c "
SELECT tablename, (xpath('/row/c/text()',
    query_to_xml(format('SELECT COUNT(*) AS c FROM %I', tablename), false, true, '')))[1]::text::int AS rows
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
"

# ── Step 2: Dump data-only from local ────────────────────────────────────────

if [[ "${SKIP_DUMP:-0}" == "1" && -f "$DUMP_FILE" ]]; then
    echo "=== Skipping dump — reusing $DUMP_FILE ==="
else
    echo "=== Dumping local data to $DUMP_FILE ==="

    TABLE_ARGS=""
    if [[ -n "$TABLES" ]]; then
        for t in ${TABLES//,/ }; do TABLE_ARGS="$TABLE_ARGS --table=$t"; done
    fi

    # DELTA=1: use INSERT … ON CONFLICT DO NOTHING so existing rows in the
    # target are left untouched. COPY (default) has no conflict handling and
    # will crash if the target already contains any of the same rows.
    CONFLICT_ARGS=""
    if [[ "$DELTA" == "1" ]]; then
        CONFLICT_ARGS="--inserts --on-conflict-do-nothing"
    fi

    local_dump \
        --data-only \
        --no-owner \
        --disable-triggers \
        --schema=public \
        $TABLE_ARGS \
        $CONFLICT_ARGS \
        > "$DUMP_FILE"
    echo "    Dump size: $(du -sh "$DUMP_FILE" | cut -f1)"
fi

# ── Step 3: Restore to Supabase ───────────────────────────────────────────────

echo "=== Restoring to Supabase ==="
# Pipe SET + dump + RESET through a single psql session so FK triggers stay
# disabled for the entire import (session_replication_role is session-scoped).
# pg_dump --disable-triggers also adds DISABLE/ENABLE TRIGGER ALL per-table as
# a second layer of protection; both require the postgres superuser role.
(
    echo "SET session_replication_role = 'replica';"
    cat "$DUMP_FILE"
    echo "SET session_replication_role = 'origin';"
) | remote_psql -v ON_ERROR_STOP=1

# ── Step 4: Reset sequences ───────────────────────────────────────────────────
# Required for SERIAL/BIGSERIAL columns: entities.id, entity_aliases.id,
# chapter_explanations.id

echo "=== Resetting sequences ==="
remote_psql -v ON_ERROR_STOP=1 <<'SQL'
SELECT setval(
    pg_get_serial_sequence('entities', 'id'),
    COALESCE((SELECT MAX(id) FROM entities), 1)
);
SELECT setval(
    pg_get_serial_sequence('entity_aliases', 'id'),
    COALESCE((SELECT MAX(id) FROM entity_aliases), 1)
);
SELECT setval(
    pg_get_serial_sequence('chapter_explanations', 'id'),
    COALESCE((SELECT MAX(id) FROM chapter_explanations), 1)
);
SQL

# ── Step 5: Verify on Supabase ────────────────────────────────────────────────

echo "=== Supabase row counts ==="
remote_psql -t -c "
SELECT tablename, (xpath('/row/c/text()',
    query_to_xml(format('SELECT COUNT(*) AS c FROM %I', tablename), false, true, '')))[1]::text::int AS rows
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
"

echo "=== Migration complete ==="
