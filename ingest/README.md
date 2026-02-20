# Ingestion Pipeline

Converts Bible sources (USFM or USFX format) into structured data in Postgres and vector embeddings via pgvector. Supports multiple translations; chunks are scoped per translation so languages are never mixed.

## Quick Start

```bash
# Full pipeline (parse, load, chunk, embed)
npm run ingest:rebuild

# Entity enrichment (run after verses are loaded)
npm run ingest:entities:openbible
npm run ingest:entities:openbible:full
npm run ingest:entities:hitchcock
npm run ingest:entities:person-refs
npm run ingest:entities:export

# Chapter explanation enrichment (offline LLM pipeline)
npm run ingest:chapters:explain

# Wipe all data including entities (keeps containers running)
npm run ingest:destroy
```

`npm run ingest:rebuild` runs the default WEBU ingest path (`001 -> 003 -> 004 -> 005`).
Use `001_usfm_to_verses.mjs` / `002_usfx_to_verses.mjs` directly when loading other translations.

## Pipeline Steps

### 1. Parse Source to NDJSON

**USFM format (e.g., WEBU):**

```bash
node ingest/scripts/001_usfm_to_verses.mjs ingest/data/engwebu_usfm.zip ingest/out WEBU
```

**USFX format (e.g., PT1911):**

```bash
node ingest/scripts/002_usfx_to_verses.mjs ingest/data/por-almeida.usfx.xml ingest/out PT1911
```

Writes `ingest/out/verses.ndjson` with one JSON record per verse containing `ref`, `translation`, `book_id`, `chapter`, `verse`, `verse_raw`, `text_raw`, `text_clean`, `source_file`, and `ordinal`.

### 2. Load Verses into Postgres

```bash
node ingest/scripts/003_load_verses_to_postgres.mjs ingest/out/verses.ndjson
```

Inserts verse records into the `verses` table. Uses `ON CONFLICT (ref) DO NOTHING` so reruns are safe.

### 3. Generate Chunks

```bash
node ingest/scripts/004_generate_chunks.mjs 3 1
```

Creates overlapping 3-verse windows (stride 1) within each chapter, scoped per translation. Writes to the `chunks` table. Truncates existing chunks before inserting so reruns are idempotent.

### 4. Embed Chunks to Postgres (pgvector)

```bash
node ingest/scripts/005_embed_chunks.mjs
```

Reads chunks from Postgres, generates embeddings using `paraphrase-multilingual-MiniLM-L12-v2`, and writes them back to the `chunks.embedding` column (pgvector `vector(384)` with HNSW cosine index). Migration: `ingest/sql/003_embeddings.sql`.

## Entity Enrichment

A separate, independently-runnable pipeline that populates an entity knowledge layer (places, people) with translation-independent data. Entity ingestors are idempotent and can be re-run at any time without affecting verse data.

### Schema

- **`entities`** - People, places, and other named biblical items with coordinates, types, and extensible JSONB metadata
- **`entity_aliases`** - Translation-independent name variants (e.g., "Abana" / "Abanah")
- **`entity_verses`** - Verse anchoring by `(book_id, chapter, verse)`, not tied to any specific translation
- **`openbible_*`** - Normalized OpenBible records for modern locations, geometry, sources, and images (plus link tables)

Migrations:
- `ingest/sql/004_entities.sql` (entity tables)
- `ingest/sql/005_entities_geo_indexes.sql` (geo/search performance indexes)
- `ingest/sql/007_openbible_extended.sql` (normalized OpenBible modern/geometry/source/image tables and links)
- `ingest/sql/008_chapter_explanations.sql` (chapter-level explanation outputs)

Apply manually if needed:
```bash
psql -h localhost -U bible -d bible -f ingest/sql/005_entities_geo_indexes.sql
psql -h localhost -U bible -d bible -f ingest/sql/007_openbible_extended.sql
psql -h localhost -U bible -d bible -f ingest/sql/008_chapter_explanations.sql
```

### 5. Load OpenBible Geodata (Ancient-only)

```bash
npm run ingest:entities:openbible
```

Parses `ingest/data/ancient.jsonl` (~1,342 places) from the [OpenBible Geodata](https://github.com/openbibleinfo/Bible-Geocoding-Data) project. Extracts coordinates, place types, translation name variants (as aliases), verse references, and linked data / media into JSONB metadata.

### 6. Load OpenBible Geodata (Full normalized bundle)

```bash
npm run ingest:entities:openbible:full
```

Consumes all OpenBible JSONL datasets and writes deterministic, normalized records plus canonical entity links:
- `ingest/data/source.jsonl`
- `ingest/data/image.jsonl`
- `ingest/data/geometry.jsonl`
- `ingest/data/modern.jsonl`
- `ingest/data/ancient.jsonl`

The full loader repopulates `openbible_*` tables and refreshes OpenBible-derived links for `entities`.

### 7. Load Hitchcock's Bible Names

```bash
npm run ingest:entities:hitchcock
```

Parses `ingest/data/HitchcocksBibleNamesDictionary.csv` (~2,623 names). Merges with existing OpenBible entities by case-insensitive name match (adding etymological meanings), and creates new `person`-type entities for unmatched names.

**Run order:** OpenBible first (provides base place entities), then Hitchcock (enriches and extends).

### 7.25 Backfill Person Verse References (Additive)

```bash
npm run ingest:entities:person-refs
node ingest/scripts/018_backfill_person_verse_refs.mjs --translation WEBU --apply
```

Creates missing `entity_verses` links for `person` entities by matching name forms against verse text. Safety properties:
- Insert-only (`ON CONFLICT DO NOTHING`)
- No updates to `entities`, `entity_aliases`, or existing `entity_verses`
- Dry-run by default (add `--apply` to write)

### 7.5 Import Rich Entity Descriptions

If you generated `ingest/data/entities_enriched.jsonl` externally, import it with:

```bash
npm run ingest:entities:enrich:desc
```

Importer resolution order is:
1. `source + source_id` (stable, preferred)
2. `canonical_name + type`
3. unique `canonical_name`
4. legacy `id` (local DB only)

## Chapter Explanation Enrichment

Generates one chapter-level explanation per chapter using local Ollama and stores results in `chapter_explanations`.

### 8. Generate Chapter Explanations

```bash
npm run ingest:chapters:explain
```

Targeted examples:

```bash
# Single chapter
node ingest/scripts/012_enrich_chapters_explanation_ollama.mjs --translation WEBU --book GEN --chapter 1 --force

# First 20 chapters for PT1911
node ingest/scripts/012_enrich_chapters_explanation_ollama.mjs --translation PT1911 --limit 20
```

Prompt template:
- `ingest/prompts/chapter_explainer_prompt.txt`
- `ingest/prompts/chapter_explainer_prompt_8b.txt` (used as default simple prompt in `--auto-model` mode)

Useful options:

```bash
# Auto model routing (simple/complex) based on chapter complexity
node ingest/scripts/012_enrich_chapters_explanation_ollama.mjs --auto-model

# Fast-plus mode (lighter retry chain, defaults prompt/model to simple profile)
node ingest/scripts/012_enrich_chapters_explanation_ollama.mjs --fast-plus

# Override generation limits
node ingest/scripts/012_enrich_chapters_explanation_ollama.mjs --num-predict 850 --word-target 220
```

`--fast-plus` and `--auto-model` are mutually exclusive.

Validation and retry behavior:
- JSON parsing validates shape only: JSON object, exactly one top-level key `chapter_explanation`, non-empty string value.
- Meta/payload framing is evaluated separately and can trigger one targeted retry with stricter wording guidance.
- Existing retries remain in place for invalid JSON, truncation, word-count bounds, and grounding.
- `_meta` in `output_json` includes retry telemetry including `meta_talk_retry`, `meta_talk_ok`, and optional `meta_talk_hits`.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PGHOST` | `localhost` | Postgres host |
| `PGPORT` | `5432` | Postgres port |
| `PGUSER` | `bible` | Postgres user |
| `PGPASSWORD` | `bible` | Postgres password |
| `PGDATABASE` | `bible` | Postgres database |
| `EMBED_MODEL` | `Xenova/paraphrase-multilingual-MiniLM-L12-v2` | Sentence-transformer model |
| `EMBED_DIM` | `384` | Embedding dimension |
| `BATCH` | `32` | Embedding batch size |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama server URL |
| `CHAPTER_MODEL` | `qwen3:8b` | Model used by chapter explainer pipeline (single-model mode; falls back to `OLLAMA_MODEL` if set) |
| `CHAPTER_MODEL_SIMPLE` | `qwen3:8b` | Simple-model target for `--auto-model` |
| `CHAPTER_MODEL_COMPLEX` | `qwen3:14b` | Complex-model target for `--auto-model` |
| `CHAPTER_TEMP` | `0.15` | Temperature used by chapter explainer pipeline |
| `CHAPTER_TOP_P` | `0.75` | Top-p used by chapter explainer pipeline |
| `CHAPTER_NUM_PREDICT` | `900` | Default max generated tokens |
| `CHAPTER_WORD_TARGET` | `220` | Prompt target word count |
| `CHAPTER_PROMPT` | `ingest/prompts/chapter_explainer_prompt.txt` | Default prompt path |
| `CHAPTER_PROMPT_SIMPLE` | `ingest/prompts/chapter_explainer_prompt_8b.txt` | Simple prompt path for `--auto-model` |
| `CHAPTER_PROMPT_COMPLEX` | `CHAPTER_PROMPT` | Complex prompt path for `--auto-model` |

## Verification

```sql
-- Verse count (~31K per translation)
SELECT translation, COUNT(*) FROM verses GROUP BY translation;

-- Spot check
SELECT ref, text_clean FROM verses WHERE ref = 'WEBU:GEN.1.1';
SELECT ref, text_clean FROM verses WHERE ref = 'PT1911:GEN.1.1';

-- Chunk count per translation
SELECT translation, COUNT(*) FROM chunks GROUP BY translation;

-- Verify no cross-translation chunks
SELECT COUNT(*) FROM chunks
WHERE EXISTS (SELECT 1 FROM jsonb_array_elements_text(verse_refs) v WHERE v LIKE 'PT1911:%')
  AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(verse_refs) v WHERE v LIKE 'WEBU:%');
```

```sql
-- Entity counts
SELECT source, COUNT(*) FROM entities GROUP BY source;
SELECT COUNT(*) AS aliases FROM entity_aliases;
SELECT COUNT(*) AS verse_refs FROM entity_verses;

-- Extended OpenBible counts
SELECT COUNT(*) AS modern_rows FROM openbible_modern;
SELECT COUNT(*) AS geometry_rows FROM openbible_geometries;
SELECT COUNT(*) AS source_rows FROM openbible_sources;
SELECT COUNT(*) AS image_rows FROM openbible_images;

-- Chapter explanation counts
SELECT status, COUNT(*) FROM chapter_explanations GROUP BY status ORDER BY status;
SELECT COUNT(*) AS chapters_ready
FROM chapter_explanations
WHERE translation = 'WEBU' AND status = 'ready';

-- Spot check: entity with aliases and verse refs
SELECT e.canonical_name, e.type, e.description,
       array_agg(DISTINCT a.name_form) AS aliases
FROM entities e
JOIN entity_aliases a ON a.entity_id = e.id
WHERE e.canonical_name = 'Abana'
GROUP BY e.id;
```

```bash
# Semantic search (all translations)
npm run search "In the beginning God created the heavens and the earth"

# Search filtered to a specific translation
node scripts/search_cli.mjs "No principio criou Deus" --translations=PT1911
```

## Data Sources

| Code | Language | Format | Source | File |
|---|---|---|---|---|
| `WEBU` | English | USFM | [ebible.org](https://ebible.org/) | `ingest/data/engwebu_usfm.zip` |
| `PT1911` | Portuguese | USFX | Almeida Revista e Corrigida (1911) | `ingest/data/por-almeida.usfx.xml` |

### Entity Data

| Source | Description | File |
|---|---|---|
| OpenBible Geodata (ancient) | ~1,342 ancient places with coordinates, verse refs, and media | `ingest/data/ancient.jsonl` |
| OpenBible Geodata (modern) | ~1,596 modern places, coordinate provenance, and associations | `ingest/data/modern.jsonl` |
| OpenBible Geodata (geometry) | ~588 geometry records used by modern/ancient mappings | `ingest/data/geometry.jsonl` |
| OpenBible Geodata (sources) | ~442 bibliographic/source records | `ingest/data/source.jsonl` |
| OpenBible Geodata (images) | ~2,424 image attribution and asset records | `ingest/data/image.jsonl` |
| Hitchcock's Names | ~2,623 biblical names with etymological meanings | `ingest/data/HitchcocksBibleNamesDictionary.csv` |
