-- Entities: people, places, and other named biblical items
CREATE TABLE IF NOT EXISTS entities (
    id              SERIAL PRIMARY KEY,
    canonical_name  TEXT NOT NULL,
    type            TEXT NOT NULL,         -- "place.river", "place.settlement", "person", etc.
    disambiguator   TEXT,                  -- "judge of Israel" vs "city in Asher"
    description     TEXT,                  -- etymological meaning or short description
    lon             DOUBLE PRECISION,
    lat             DOUBLE PRECISION,
    source          TEXT NOT NULL,         -- "openbible", "hitchcock", etc.
    source_id       TEXT,                  -- original ID from source dataset
    metadata        JSONB DEFAULT '{}'     -- wikidata, thumbnails, linked_data, etc.
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_entities_source
    ON entities (source, source_id);

-- Aliases: translation-independent name forms
CREATE TABLE IF NOT EXISTS entity_aliases (
    id              SERIAL PRIMARY KEY,
    entity_id       INT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    name_form       TEXT NOT NULL,
    lang            TEXT NOT NULL DEFAULT 'en'
);

CREATE INDEX IF NOT EXISTS ix_entity_aliases_entity
    ON entity_aliases (entity_id);
CREATE INDEX IF NOT EXISTS ix_entity_aliases_name_form
    ON entity_aliases (name_form);

-- Verse anchoring: translation-independent
CREATE TABLE IF NOT EXISTS entity_verses (
    entity_id       INT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    book_id         TEXT NOT NULL,
    chapter         INT NOT NULL,
    verse           INT NOT NULL,
    PRIMARY KEY (entity_id, book_id, chapter, verse)
);

CREATE INDEX IF NOT EXISTS ix_entity_verses_location
    ON entity_verses (book_id, chapter, verse);
