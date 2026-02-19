-- Chapter-level generated explanations (offline LLM pipeline output).

CREATE TABLE IF NOT EXISTS chapter_explanations (
    id                  BIGSERIAL PRIMARY KEY,
    translation         TEXT NOT NULL,
    book_id             TEXT NOT NULL,
    chapter             INT  NOT NULL CHECK (chapter > 0),
    model               TEXT NOT NULL,
    prompt_version      TEXT NOT NULL,
    schema_version      TEXT NOT NULL DEFAULT 'v1',
    status              TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'error')),
    chapter_explanation TEXT,
    input_payload       JSONB NOT NULL DEFAULT '{}',
    output_json         JSONB NOT NULL DEFAULT '{}',
    error_text          TEXT,
    duration_ms         INT,
    generated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (translation, book_id, chapter, model, prompt_version)
);

CREATE INDEX IF NOT EXISTS ix_chapter_explanations_lookup
    ON chapter_explanations (translation, book_id, chapter);

CREATE INDEX IF NOT EXISTS ix_chapter_explanations_generated_at
    ON chapter_explanations (generated_at DESC);

CREATE INDEX IF NOT EXISTS ix_chapter_explanations_status
    ON chapter_explanations (status);
