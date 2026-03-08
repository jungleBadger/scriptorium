-- Anonymous feedback / reporting intake.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS feedback_reports (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind                TEXT NOT NULL CHECK (kind IN ('content_report', 'bug_report', 'product_feedback')),
    status              TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'triaged', 'in_progress', 'resolved', 'dismissed')),
    target_type         TEXT,
    translation         TEXT,
    book_id             TEXT,
    chapter             INT CHECK (chapter IS NULL OR chapter > 0),
    verse_start         INT CHECK (verse_start IS NULL OR verse_start > 0),
    verse_end           INT CHECK (verse_end IS NULL OR verse_end > 0),
    entity_id           TEXT,
    user_message        TEXT NOT NULL,
    suggested_fix       TEXT,
    content_snapshot    TEXT,
    generation_metadata JSONB,
    page_context        JSONB,
    contact_email       TEXT,
    ip_hash             TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at         TIMESTAMPTZ,
    resolved_at         TIMESTAMPTZ,
    CHECK (char_length(btrim(user_message)) > 0),
    CHECK (verse_end IS NULL OR verse_start IS NOT NULL),
    CHECK (verse_end IS NULL OR verse_end >= verse_start),
    CHECK (ip_hash IS NULL OR ip_hash ~ '^[0-9a-f]{64}$'),
    CHECK (reviewed_at IS NULL OR reviewed_at >= created_at),
    CHECK (resolved_at IS NULL OR resolved_at >= created_at),
    CHECK (resolved_at IS NULL OR reviewed_at IS NULL OR resolved_at >= reviewed_at)
);

CREATE INDEX IF NOT EXISTS ix_feedback_reports_status
    ON feedback_reports (status);

CREATE INDEX IF NOT EXISTS ix_feedback_reports_kind
    ON feedback_reports (kind);

CREATE INDEX IF NOT EXISTS ix_feedback_reports_created_at
    ON feedback_reports (created_at DESC);

CREATE INDEX IF NOT EXISTS ix_feedback_reports_book_chapter
    ON feedback_reports (book_id, chapter);

CREATE INDEX IF NOT EXISTS ix_feedback_reports_target_type
    ON feedback_reports (target_type);

CREATE INDEX IF NOT EXISTS ix_feedback_reports_ip_hash
    ON feedback_reports (ip_hash);

CREATE INDEX IF NOT EXISTS ix_feedback_reports_new_created_at
    ON feedback_reports (created_at DESC)
    WHERE status = 'new';

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bff_reader') THEN
        GRANT SELECT, INSERT ON feedback_reports TO bff_reader;
    END IF;
END $$;
