-- sql/002_chunks.sql
CREATE TABLE IF NOT EXISTS chunks (
                                      chunk_id        TEXT PRIMARY KEY, -- e.g. WEBU:GEN.1.1-1.3
                                      translation     TEXT NOT NULL,
                                      book_id         TEXT NOT NULL,
                                      chapter         INT  NOT NULL,

                                      verse_start     INT  NOT NULL,
                                      verse_end       INT  NOT NULL,
                                      verse_raw_start TEXT NOT NULL,
                                      verse_raw_end   TEXT NOT NULL,

                                      ref_start       TEXT NOT NULL, -- WEBU:GEN.1.1
                                      ref_end         TEXT NOT NULL, -- WEBU:GEN.1.3

                                      text_clean      TEXT NOT NULL, -- concatenated verse text
                                      verse_refs      JSONB NOT NULL  -- array of verse refs included (for provenance)
);

CREATE INDEX IF NOT EXISTS ix_chunks_book_chapter
    ON chunks (book_id, chapter);

CREATE INDEX IF NOT EXISTS ix_chunks_text_clean_trgm
    ON chunks USING GIN (text_clean gin_trgm_ops);
