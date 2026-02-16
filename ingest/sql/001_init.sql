CREATE TABLE verses (
                        ref           TEXT PRIMARY KEY,
                        translation   TEXT NOT NULL,
                        book_id       TEXT NOT NULL,
                        chapter       INT  NOT NULL,
                        verse         INT  NOT NULL,
                        verse_raw     TEXT NOT NULL,
                        text_raw      TEXT NOT NULL,
                        text_clean    TEXT NOT NULL,
                        source_file   TEXT,
                        ordinal       INT
);

CREATE UNIQUE INDEX ux_verses_natural
    ON verses (translation, book_id, chapter, verse_raw);

CREATE INDEX ix_verses_book_chapter_verse
    ON verses (book_id, chapter, verse);

CREATE INDEX ix_verses_text_clean_trgm
    ON verses USING GIN (text_clean gin_trgm_ops);
