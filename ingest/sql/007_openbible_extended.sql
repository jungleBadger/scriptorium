-- Normalized OpenBible support tables for modern locations, geometry, images,
-- sources, plus mapping tables back to canonical entities.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS openbible_sources (
    id              TEXT PRIMARY KEY,
    friendly_id     TEXT,
    display_name    TEXT,
    abbreviation    TEXT,
    source_type     TEXT,
    publisher       TEXT,
    year            INT,
    url             TEXT,
    vote_count      INT,
    contributors    JSONB NOT NULL DEFAULT '[]',
    raw             JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS openbible_images (
    id              TEXT PRIMARY KEY,
    description     TEXT,
    credit          TEXT,
    credit_url      TEXT,
    license         TEXT,
    color           TEXT,
    role            TEXT,
    person          TEXT,
    meters_per_pixel DOUBLE PRECISION,
    image_url       TEXT,
    thumbnail_url_pattern TEXT,
    width           INT,
    height          INT,
    descriptions    JSONB NOT NULL DEFAULT '{}',
    thumbnails      JSONB NOT NULL DEFAULT '{}',
    raw             JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS openbible_geometries (
    id                      TEXT PRIMARY KEY,
    format                  TEXT,
    name                    TEXT,
    source                  TEXT,
    source_url              TEXT,
    source_urls             JSONB NOT NULL DEFAULT '[]',
    geometry_type           TEXT,
    modifier                TEXT,
    land_or_water           TEXT,
    geojson_file            TEXT,
    simplified_geojson_file TEXT,
    kml_file                TEXT,
    isobands_geojson_file   TEXT,
    min_confidence          INT,
    max_confidence          INT,
    raw                     JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS openbible_modern (
    id                  TEXT PRIMARY KEY,
    friendly_id         TEXT NOT NULL,
    url_slug            TEXT,
    class               TEXT,
    modern_type         TEXT,
    geometry            TEXT,
    geometry_credit     TEXT,
    land_or_water       TEXT,
    lon                 DOUBLE PRECISION,
    lat                 DOUBLE PRECISION,
    preceding_article   TEXT,
    geojson_file        TEXT,
    kml_file            TEXT,
    root                TEXT,
    custom_lonlat       TEXT,
    coordinates_source  JSONB NOT NULL DEFAULT '{}',
    precision           JSONB NOT NULL DEFAULT '{}',
    names               JSONB NOT NULL DEFAULT '[]',
    media               JSONB NOT NULL DEFAULT '{}',
    ancient_associations JSONB NOT NULL DEFAULT '{}',
    accuracy_claims     JSONB NOT NULL DEFAULT '[]',
    precision_claims    JSONB NOT NULL DEFAULT '[]',
    raw                 JSONB NOT NULL DEFAULT '{}'
);

-- Modern location secondary linkage.
CREATE TABLE IF NOT EXISTS openbible_modern_geometry_links (
    modern_id    TEXT NOT NULL REFERENCES openbible_modern(id) ON DELETE CASCADE,
    geometry_id  TEXT NOT NULL REFERENCES openbible_geometries(id) ON DELETE CASCADE,
    role         TEXT NOT NULL DEFAULT 'unspecified',
    context      JSONB NOT NULL DEFAULT '{}',
    PRIMARY KEY (modern_id, geometry_id, role)
);

CREATE TABLE IF NOT EXISTS openbible_modern_source_links (
    modern_id    TEXT NOT NULL REFERENCES openbible_modern(id) ON DELETE CASCADE,
    source_id    TEXT NOT NULL REFERENCES openbible_sources(id) ON DELETE CASCADE,
    role         TEXT NOT NULL DEFAULT 'unspecified',
    context      JSONB NOT NULL DEFAULT '{}',
    PRIMARY KEY (modern_id, source_id, role)
);

CREATE TABLE IF NOT EXISTS openbible_modern_image_links (
    modern_id    TEXT NOT NULL REFERENCES openbible_modern(id) ON DELETE CASCADE,
    image_id     TEXT NOT NULL REFERENCES openbible_images(id) ON DELETE CASCADE,
    role         TEXT NOT NULL DEFAULT 'unspecified',
    context      JSONB NOT NULL DEFAULT '{}',
    PRIMARY KEY (modern_id, image_id, role)
);

-- Canonical entity linkage back to normalized OpenBible resources.
CREATE TABLE IF NOT EXISTS entity_modern_links (
    entity_id            INT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    modern_id            TEXT NOT NULL REFERENCES openbible_modern(id) ON DELETE CASCADE,
    score                INT,
    name                 TEXT,
    url_slug             TEXT,
    identification_ids   JSONB NOT NULL DEFAULT '[]',
    metadata             JSONB NOT NULL DEFAULT '{}',
    PRIMARY KEY (entity_id, modern_id)
);

CREATE TABLE IF NOT EXISTS entity_source_links (
    entity_id    INT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    source_id    TEXT NOT NULL REFERENCES openbible_sources(id) ON DELETE CASCADE,
    role         TEXT NOT NULL DEFAULT 'unspecified',
    context      JSONB NOT NULL DEFAULT '{}',
    PRIMARY KEY (entity_id, source_id, role)
);

CREATE TABLE IF NOT EXISTS entity_image_links (
    entity_id    INT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    image_id     TEXT NOT NULL REFERENCES openbible_images(id) ON DELETE CASCADE,
    role         TEXT NOT NULL DEFAULT 'unspecified',
    context      JSONB NOT NULL DEFAULT '{}',
    PRIMARY KEY (entity_id, image_id, role)
);

CREATE TABLE IF NOT EXISTS entity_geometry_links (
    entity_id    INT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    geometry_id  TEXT NOT NULL REFERENCES openbible_geometries(id) ON DELETE CASCADE,
    role         TEXT NOT NULL DEFAULT 'unspecified',
    context      JSONB NOT NULL DEFAULT '{}',
    PRIMARY KEY (entity_id, geometry_id, role)
);

CREATE INDEX IF NOT EXISTS ix_openbible_modern_lon_lat
    ON openbible_modern (lon, lat)
    WHERE lon IS NOT NULL AND lat IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_openbible_modern_friendly_id_trgm
    ON openbible_modern USING GIN (friendly_id gin_trgm_ops);

CREATE INDEX IF NOT EXISTS ix_openbible_sources_friendly_id
    ON openbible_sources (friendly_id);

CREATE INDEX IF NOT EXISTS ix_openbible_sources_title_trgm
    ON openbible_sources USING GIN (display_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS ix_ob_modern_geometry_links_geometry
    ON openbible_modern_geometry_links (geometry_id);
CREATE INDEX IF NOT EXISTS ix_ob_modern_source_links_source
    ON openbible_modern_source_links (source_id);
CREATE INDEX IF NOT EXISTS ix_ob_modern_image_links_image
    ON openbible_modern_image_links (image_id);

CREATE INDEX IF NOT EXISTS ix_entity_modern_links_modern
    ON entity_modern_links (modern_id);
CREATE INDEX IF NOT EXISTS ix_entity_source_links_source
    ON entity_source_links (source_id);
CREATE INDEX IF NOT EXISTS ix_entity_image_links_image
    ON entity_image_links (image_id);
CREATE INDEX IF NOT EXISTS ix_entity_geometry_links_geometry
    ON entity_geometry_links (geometry_id);
