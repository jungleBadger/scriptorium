# Database Reference

This document describes the current PostgreSQL schema used by Scriptorium.

## Engine and Extensions

- Engine: PostgreSQL 16 (via `pgvector/pgvector:pg16` image)
- Schema: `public` (default)
- Extensions used:
- `vector` for `chunks.embedding` and vector search
- `pg_trgm` for trigram indexes and similarity search

## Migration Files

The SQL files live in `ingest/sql` and are applied in this logical order:

1. `001_init.sql` - base `verses` table + indexes
2. `002_chunks.sql` - `chunks` table + indexes
3. `003_embeddings.sql` - pgvector extension + `chunks.embedding` + HNSW index
4. `004_entities.sql` - entity core tables
5. `005_entities_geo_indexes.sql` - geo/search indexes for entity APIs
6. `006_chapter_payload_example_gen_1.sql` - example query only (no schema changes)
7. `007_openbible_extended.sql` - normalized OpenBible tables + link tables + indexes
8. `008_chapter_explanations.sql` - chapter explanation storage

## Table Schemas

### Core Text

### `verses`
- Primary key: `ref` (`TEXT`)
- Columns:
- `ref`, `translation`, `book_id`, `chapter`, `verse`, `verse_raw`
- `text_raw`, `text_clean`, `source_file`, `ordinal`

### `chunks`
- Primary key: `chunk_id` (`TEXT`)
- Columns:
- `chunk_id`, `translation`, `book_id`, `chapter`
- `verse_start`, `verse_end`, `verse_raw_start`, `verse_raw_end`
- `ref_start`, `ref_end`, `text_clean`, `verse_refs` (`JSONB`)
- `embedding` (`vector(384)`, added by `003_embeddings.sql`)

### Entities Core

### `entities`
- Primary key: `id` (`SERIAL`)
- Unique: `(source, source_id)`
- Columns:
- `id`, `canonical_name`, `type`, `disambiguator`, `description`
- `lon`, `lat`
- `source`, `source_id`
- `metadata` (`JSONB`, default `{}`)

### `entity_aliases`
- Primary key: `id` (`SERIAL`)
- Foreign key: `entity_id -> entities(id) ON DELETE CASCADE`
- Columns: `id`, `entity_id`, `name_form`, `lang` (default `en`)

### `entity_verses`
- Composite primary key: `(entity_id, book_id, chapter, verse)`
- Foreign key: `entity_id -> entities(id) ON DELETE CASCADE`
- Columns: `entity_id`, `book_id`, `chapter`, `verse`

### OpenBible Normalized Tables

### `openbible_sources`
- Primary key: `id` (`TEXT`)
- Columns include: `friendly_id`, `display_name`, `abbreviation`, `source_type`,
  `publisher`, `year`, `url`, `vote_count`, `contributors` (`JSONB`), `raw` (`JSONB`)

### `openbible_images`
- Primary key: `id` (`TEXT`)
- Columns include: `description`, `credit`, `credit_url`, `license`,
  `color`, `role`, `person`, `meters_per_pixel`, `image_url`,
  `thumbnail_url_pattern`, `width`, `height`, `descriptions` (`JSONB`),
  `thumbnails` (`JSONB`), `raw` (`JSONB`)

### `openbible_geometries`
- Primary key: `id` (`TEXT`)
- Columns include: `format`, `name`, `source`, `source_url`, `source_urls` (`JSONB`),
  `geometry_type`, `modifier`, `land_or_water`, `geojson_file`,
  `simplified_geojson_file`, `kml_file`, `isobands_geojson_file`,
  `min_confidence`, `max_confidence`, `raw` (`JSONB`)

### `openbible_modern`
- Primary key: `id` (`TEXT`)
- Columns include: `friendly_id`, `url_slug`, `class`, `modern_type`, `geometry`,
  `geometry_credit`, `land_or_water`, `lon`, `lat`, `preceding_article`,
  `geojson_file`, `kml_file`, `root`, `custom_lonlat`, `coordinates_source` (`JSONB`),
  `precision` (`JSONB`), `names` (`JSONB`), `media` (`JSONB`),
  `ancient_associations` (`JSONB`), `accuracy_claims` (`JSONB`),
  `precision_claims` (`JSONB`), `raw` (`JSONB`)

### `openbible_modern_geometry_links`
- Composite primary key: `(modern_id, geometry_id, role)`
- Foreign keys:
- `modern_id -> openbible_modern(id) ON DELETE CASCADE`
- `geometry_id -> openbible_geometries(id) ON DELETE CASCADE`
- Columns: `modern_id`, `geometry_id`, `role`, `context` (`JSONB`)

### `openbible_modern_source_links`
- Composite primary key: `(modern_id, source_id, role)`
- Foreign keys:
- `modern_id -> openbible_modern(id) ON DELETE CASCADE`
- `source_id -> openbible_sources(id) ON DELETE CASCADE`
- Columns: `modern_id`, `source_id`, `role`, `context` (`JSONB`)

### `openbible_modern_image_links`
- Composite primary key: `(modern_id, image_id, role)`
- Foreign keys:
- `modern_id -> openbible_modern(id) ON DELETE CASCADE`
- `image_id -> openbible_images(id) ON DELETE CASCADE`
- Columns: `modern_id`, `image_id`, `role`, `context` (`JSONB`)

### `entity_modern_links`
- Composite primary key: `(entity_id, modern_id)`
- Foreign keys:
- `entity_id -> entities(id) ON DELETE CASCADE`
- `modern_id -> openbible_modern(id) ON DELETE CASCADE`
- Columns: `entity_id`, `modern_id`, `score`, `name`, `url_slug`,
  `identification_ids` (`JSONB`), `metadata` (`JSONB`)

### `entity_source_links`
- Composite primary key: `(entity_id, source_id, role)`
- Foreign keys:
- `entity_id -> entities(id) ON DELETE CASCADE`
- `source_id -> openbible_sources(id) ON DELETE CASCADE`
- Columns: `entity_id`, `source_id`, `role`, `context` (`JSONB`)

### `entity_image_links`
- Composite primary key: `(entity_id, image_id, role)`
- Foreign keys:
- `entity_id -> entities(id) ON DELETE CASCADE`
- `image_id -> openbible_images(id) ON DELETE CASCADE`
- Columns: `entity_id`, `image_id`, `role`, `context` (`JSONB`)

### `entity_geometry_links`
- Composite primary key: `(entity_id, geometry_id, role)`
- Foreign keys:
- `entity_id -> entities(id) ON DELETE CASCADE`
- `geometry_id -> openbible_geometries(id) ON DELETE CASCADE`
- Columns: `entity_id`, `geometry_id`, `role`, `context` (`JSONB`)

### Chapter Explanations

### `chapter_explanations`
- Primary key: `id` (`BIGSERIAL`)
- Unique key: `(translation, book_id, chapter, model, prompt_version)`
- Columns:
- `translation`, `book_id`, `chapter`
- `model`, `prompt_version`, `schema_version`
- `status` (`ready|error`)
- `chapter_explanation`
- `input_payload` (`JSONB`), `output_json` (`JSONB`)
- `error_text`, `duration_ms`, `generated_at`

## Index Inventory

### `verses`
- `ux_verses_natural` (UNIQUE): `(translation, book_id, chapter, verse_raw)`
- `ix_verses_book_chapter_verse`: `(book_id, chapter, verse)`
- `ix_verses_text_clean_trgm` (GIN trigram): `text_clean`

### `chunks`
- `ix_chunks_book_chapter`: `(book_id, chapter)`
- `ix_chunks_text_clean_trgm` (GIN trigram): `text_clean`
- `ix_chunks_embedding_hnsw` (HNSW vector cosine): `embedding`

### `entities` and related
- `ux_entities_source` (UNIQUE): `(source, source_id)`
- `ix_entities_geo_lon_lat`: `(lon, lat)` where coords exist
- `ix_entities_geo_type`: `(type)` where coords exist
- `ix_entities_type_trgm` (GIN trigram): `type`
- `ix_entities_canonical_name_trgm` (GIN trigram): `canonical_name`
- `ix_entity_aliases_entity`: `(entity_id)`
- `ix_entity_aliases_name_form`: `(name_form)`
- `ix_entity_aliases_name_form_trgm` (GIN trigram): `name_form`
- `ix_entity_verses_location`: `(book_id, chapter, verse)`

### OpenBible normalized
- `ix_openbible_modern_lon_lat`: `(lon, lat)` where coords exist
- `ix_openbible_modern_friendly_id_trgm` (GIN trigram): `friendly_id`
- `ix_openbible_sources_friendly_id`: `(friendly_id)`
- `ix_openbible_sources_title_trgm` (GIN trigram): `display_name`
- `ix_ob_modern_geometry_links_geometry`: `(geometry_id)`
- `ix_ob_modern_source_links_source`: `(source_id)`
- `ix_ob_modern_image_links_image`: `(image_id)`
- `ix_entity_modern_links_modern`: `(modern_id)`
- `ix_entity_source_links_source`: `(source_id)`
- `ix_entity_image_links_image`: `(image_id)`
- `ix_entity_geometry_links_geometry`: `(geometry_id)`

### Chapter explanations
- `ix_chapter_explanations_lookup`: `(translation, book_id, chapter)`
- `ix_chapter_explanations_generated_at`: `(generated_at DESC)`
- `ix_chapter_explanations_status`: `(status)`

## Relationship Overview

- `entities` has many `entity_aliases`, `entity_verses`, and `entity_*_links`.
- `entity_verses` links entities to canonical verse locations (`book_id/chapter/verse`).
- `openbible_modern` links to sources, images, and geometries via `openbible_modern_*_links`.
- `entity_modern_links` ties canonical entities to normalized OpenBible modern records.
- `entity_source_links`, `entity_image_links`, `entity_geometry_links` attach provenance/media/geometry to canonical entities.
- `chapter_explanations` stores generated chapter summaries keyed by translation/book/chapter/model/prompt version.

## Are `openbible_*` Tables Still Used?

Yes. They are currently in active use and should not be removed unless you also remove/refactor dependent features.

Direct runtime dependencies include:
- `server/services/entitiesRepo.js` joins `entity_image_links -> openbible_images` for entity thumbnails.
- `server/services/chaptersRepo.js` joins `entity_image_links -> openbible_images` for chapter context thumbnails.
- `server/services/askService.js` joins `entity_image_links -> openbible_images` for Ask results.

Pipeline/developer tooling also depends on them:
- `ingest/scripts/007_load_openbible_full.mjs` populates all normalized OpenBible tables and link tables.
- `ingest/scripts/012_enrich_chapters_explanation_ollama.mjs` joins `entity_modern_links -> openbible_modern` and `entity_image_links -> openbible_images`.
- `ingest/scripts/016_escalate_chapters_14b.mjs` and `ingest/scripts/017_escalate_chapters_openai.mjs` use the same joins.

If you want a leaner schema, a safe path is:
1. Stop full OpenBible ingest (`ingest:entities:openbible:full`).
2. Remove thumbnail/modern joins from runtime services.
3. Drop link tables and `openbible_*` tables only after code and tests are updated.
