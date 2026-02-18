# Ingestion Pipeline

Converts Bible sources (USFM or USFX format) into structured data in Postgres and vector embeddings via pgvector. Supports multiple translations — chunks are scoped per translation so languages are never mixed.

## Quick Start

```bash
# Full pipeline (parse, load, chunk, embed)
npm run ingest:rebuild

# Entity enrichment (run after verses are loaded)
npm run ingest:entities:openbible
npm run ingest:entities:hitchcock

# Wipe all data including entities (keeps containers running)
npm run ingest:destroy
```

## Pipeline Steps

### 1. Parse Source to NDJSON

**USFM format (e.g., WEBU):**

```bash
node ingest/scripts/usfm_to_verses.mjs ingest/data/engwebu_usfm.zip ingest/out WEBU
```

**USFX format (e.g., PT1911):**

```bash
node ingest/scripts/usfx_to_verses.mjs ingest/data/por-almeida.usfx.xml ingest/out PT1911
```

Writes `ingest/out/verses.ndjson` with one JSON record per verse containing `ref`, `translation`, `book_id`, `chapter`, `verse`, `verse_raw`, `text_raw`, `text_clean`, `source_file`, and `ordinal`.

### 2. Load Verses into Postgres

```bash
node ingest/scripts/load_verses_to_postgres.mjs ingest/out/verses.ndjson
```

Inserts verse records into the `verses` table. Uses `ON CONFLICT (ref) DO NOTHING` so reruns are safe.

### 3. Generate Chunks

```bash
node ingest/scripts/generate_chunks.mjs 3 1
```

Creates overlapping 3-verse windows (stride 1) within each chapter, scoped per translation. Writes to the `chunks` table. Truncates existing chunks before inserting so reruns are idempotent.

### 4. Embed Chunks to Postgres (pgvector)

```bash
node ingest/scripts/embed_chunks.mjs
```

Reads chunks from Postgres, generates embeddings using `paraphrase-multilingual-MiniLM-L12-v2`, and writes them back to the `chunks.embedding` column (pgvector `vector(384)` with HNSW cosine index). Migration: `ingest/sql/003_embeddings.sql`.

## Entity Enrichment

A separate, independently-runnable pipeline that populates an entity knowledge layer (places, people) with translation-independent data. Entity ingestors are idempotent and can be re-run at any time without affecting verse data.

### Schema

- **`entities`** — People, places, and other named biblical items with coordinates, types, and extensible JSONB metadata
- **`entity_aliases`** — Translation-independent name variants (e.g., "Abana" / "Abanah")
- **`entity_verses`** — Verse anchoring by `(book_id, chapter, verse)`, not tied to any specific translation

Migration: `ingest/sql/004_entities.sql`

### 5. Load OpenBible Geodata

```bash
npm run ingest:entities:openbible
```

Parses `ingest/data/ancient.jsonl` (~1,342 places) from the [OpenBible Geodata](https://github.com/openbibleinfo/Bible-Geocoding-Data) project. Extracts coordinates, place types, translation name variants (as aliases), verse references, and linked data / media into JSONB metadata.

### 6. Load Hitchcock's Bible Names

```bash
npm run ingest:entities:hitchcock
```

Parses `ingest/data/HitchcocksBibleNamesDictionary.csv` (~2,623 names). Merges with existing OpenBible entities by case-insensitive name match (adding etymological meanings), and creates new `person`-type entities for unmatched names.

**Run order:** OpenBible first (provides base place entities), then Hitchcock (enriches and extends).

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
node scripts/search_cli.mjs "No princípio criou Deus" --translations=PT1911
```

## Data Sources

| Code | Language | Format | Source | File |
|---|---|---|---|---|
| `WEBU` | English | USFM | [ebible.org](https://ebible.org/) | `ingest/data/engwebu_usfm.zip` |
| `PT1911` | Portuguese | USFX | Almeida Revista e Corrigida (1911) | `ingest/data/por-almeida.usfx.xml` |

### Entity Data

| Source | Description | File |
|---|---|---|
| OpenBible Geodata | ~1,342 ancient places with coordinates, verse refs, and media | `ingest/data/ancient.jsonl` |
| Hitchcock's Names | ~2,623 biblical names with etymological meanings | `ingest/data/HitchcocksBibleNamesDictionary.csv` |
