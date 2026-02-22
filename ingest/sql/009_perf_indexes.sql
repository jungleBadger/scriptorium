-- Performance indexes identified during query audit.

-- Supports lower(coalesce(e.source_id, '')) = ANY($2::text[]) in fetchActiveEntityRows.
-- Without this, the expression is non-SARGable and forces a sequential scan.
CREATE INDEX IF NOT EXISTS ix_entities_source_id_lower
    ON entities (lower(source_id))
    WHERE source_id IS NOT NULL;
