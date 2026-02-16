# Ingestion Pipeline

Converts Bible sources (USFM or USFX format) into structured data in Postgres and vector embeddings in Milvus. Supports multiple translations — chunks are scoped per translation so languages are never mixed.

## Quick Start

```bash
# Full pipeline (parse, load, chunk, embed)
npm run ingest:rebuild

# Wipe all data (keeps containers running)
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

### 4a. Init Milvus Collection

```bash
RESET_MILVUS=true node ingest/scripts/milvus_init.mjs
```

Creates the `bible_chunks` collection with an HNSW index on the embedding field. When `RESET_MILVUS=true`, drops the existing collection first.

### 4b. Embed Chunks to Milvus

```bash
node ingest/scripts/embed_chunks_to_milvus.mjs
```

Reads chunks from Postgres, generates embeddings using `paraphrase-multilingual-MiniLM-L12-v2`, and inserts them into Milvus.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PGHOST` | `localhost` | Postgres host |
| `PGPORT` | `5432` | Postgres port |
| `PGUSER` | `bible` | Postgres user |
| `PGPASSWORD` | `bible` | Postgres password |
| `PGDATABASE` | `bible` | Postgres database |
| `MILVUS_ADDRESS` | `localhost:19530` | Milvus gRPC address |
| `MILVUS_COLLECTION` | `bible_chunks` | Milvus collection name |
| `EMBED_MODEL` | `Xenova/paraphrase-multilingual-MiniLM-L12-v2` | Sentence-transformer model |
| `EMBED_DIM` | `384` | Embedding dimension |
| `BATCH` | `32` | Embedding batch size |
| `RESET_MILVUS` | `false` | Drop collection before init |

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
