-- Optimize entity and geo lookups used by API endpoints.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Geo map queries with optional bounding box filters.
CREATE INDEX IF NOT EXISTS ix_entities_geo_lon_lat
    ON entities (lon, lat)
    WHERE lon IS NOT NULL AND lat IS NOT NULL;

-- Optional geo type filter (e.g. place.settlement).
CREATE INDEX IF NOT EXISTS ix_entities_geo_type
    ON entities (type)
    WHERE lon IS NOT NULL AND lat IS NOT NULL;

-- Case-insensitive/prefix style filters on entity type.
CREATE INDEX IF NOT EXISTS ix_entities_type_trgm
    ON entities USING GIN (type gin_trgm_ops);

-- Entity search now includes canonical_name and aliases.
CREATE INDEX IF NOT EXISTS ix_entities_canonical_name_trgm
    ON entities USING GIN (canonical_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS ix_entity_aliases_name_form_trgm
    ON entity_aliases USING GIN (name_form gin_trgm_ops);
