# Ingestion Pipeline

Converts Bible sources (USFM or USFX format) into structured data in Postgres and vector embeddings via pgvector. Supports multiple translations; chunks are scoped per translation so languages are never mixed.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Local Setup](#local-setup)
- [Quick Start](#quick-start)
- [Pipeline Steps](#pipeline-steps)
- [Entity Enrichment](#entity-enrichment)
- [Chapter Explanation Enrichment](#chapter-explanation-enrichment)
- [Environment Variables](#environment-variables)
- [Verification](#verification)
- [Data Sources & Licensing](#data-sources--licensing)

---

## Prerequisites

- **Node.js** v18+ (ESM support required)
- **Docker** + **Docker Compose** (for Postgres with pgvector)
- **Ollama** (for chapter explanation enrichment — optional)
- Source data files placed in `ingest/data/` (see [Data Sources & Licensing](#data-sources--licensing) for where to obtain them)

---

## Local Setup

### 1. Start the database

```bash
docker compose up -d
```

This spins up Postgres with the pgvector extension. Connection defaults are `localhost:5432`, database `bible`, user `bible`, password `bible`.

### 2. Run migrations

```bash
psql -h localhost -U bible -d bible -f ingest/sql/001_schema.sql
psql -h localhost -U bible -d bible -f ingest/sql/002_verses.sql
psql -h localhost -U bible -d bible -f ingest/sql/003_embeddings.sql
psql -h localhost -U bible -d bible -f ingest/sql/004_entities.sql
psql -h localhost -U bible -d bible -f ingest/sql/005_entities_geo_indexes.sql
psql -h localhost -U bible -d bible -f ingest/sql/007_openbible_extended.sql
psql -h localhost -U bible -d bible -f ingest/sql/008_chapter_explanations.sql
```

### 3. Place source data files

Download the required files (see [Data Sources & Licensing](#data-sources--licensing)) and place them at:

```
ingest/data/
├── engwebu_usfm.zip                  # World English Bible Updated (USFM)
├── por-almeida.usfx.xml              # Almeida 1911 Portuguese Bible (USFX)
├── HitchcocksBibleNamesDictionary.csv
├── ancient.jsonl
├── modern.jsonl
├── geometry.jsonl
├── source.jsonl
└── image.jsonl
```

### 4. Install dependencies

```bash
npm install
```

### 5. (Optional) Install Ollama for chapter explanations

Download from [ollama.ai](https://ollama.ai) and pull a model:

```bash
ollama pull qwen3:8b
```

---

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

---

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

Inserts verse records into the `verses` table. Uses `ON CONFLICT (ref) DO UPDATE` so reruns are safe and also refresh corrected parsing output (for example, cleaner `text_clean` updates).

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

---

## Entity Enrichment

A separate, independently-runnable pipeline that populates an entity knowledge layer (places, people) with translation-independent data. Entity ingestors are idempotent and can be re-run at any time without affecting verse data.

### Schema

- **`entities`** — People, places, and other named biblical items with coordinates, types, and extensible JSONB metadata
- **`entity_aliases`** — Translation-independent name variants (e.g., "Abana" / "Abanah")
- **`entity_verses`** — Verse anchoring by `(book_id, chapter, verse)`, not tied to any specific translation
- **`openbible_*`** — Normalized OpenBible records for modern locations, geometry, sources, and images (plus link tables)

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

Parses `ingest/data/ancient.jsonl` (~1,342 places) from the [OpenBible Geocoding Data](https://github.com/openbibleinfo/Bible-Geocoding-Data) project. Extracts coordinates, place types, translation name variants (as aliases), verse references, and linked data / media into JSONB metadata.

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

---

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

Prompt templates (user prompts):
- `ingest/prompts/chapter_explainer_prompt.txt` — full prompt (EN)
- `ingest/prompts/chapter_explainer_prompt_8b.txt` — compact prompt for 8b models (EN)
- `ingest/prompts/chapter_explainer_prompt_pt-br.txt` — full prompt (PT-BR)
- `ingest/prompts/chapter_explainer_prompt_8b_pt-br.txt` — compact prompt for 8b models (PT-BR)

System prompts:
- `ingest/prompts/system_prompt_en.txt`
- `ingest/prompts/system_prompt_pt-br.txt`

The script auto-selects pt-br user and system prompts when `--translation` starts with `PT` (e.g. `PT1911`). No env vars needed. Manual overrides via `--prompt`, `--prompt-simple`, `--prompt-complex` take precedence.

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

---

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
| `CHAPTER_PROMPT` | language-aware (see below) | Default prompt path |
| `CHAPTER_PROMPT_SIMPLE` | language-aware (see below) | Simple prompt path for `--auto-model` |
| `CHAPTER_PROMPT_COMPLEX` | language-aware (see below) | Complex prompt path for `--auto-model` |

`CHAPTER_PROMPT*` defaults are resolved at runtime based on `--translation`: translations starting with `PT` use the `*_pt-br.txt` variants automatically. Explicit env var values always take precedence.

---

## Supabase Migration

`ingest/scripts/migrate_to_supabase.sh` dumps data from the local Postgres DB and restores it to Supabase. Tables and indexes must already exist in the target (run SQL migrations first).

### Full load (first-time)

```bash
SUPABASE_PASSWORD=xxx bash ingest/scripts/migrate_to_supabase.sh
```

> **Warning:** Full-load mode assumes target tables are **empty**. Restoring over existing rows will crash (`COPY` has no conflict handling). Verify target state before running.

### Delta mode (incremental push)

Use `DELTA=1` to push only new rows for specific tables without touching existing data:

```bash
DELTA=1 TABLES=chapter_explanations SUPABASE_PASSWORD=xxx bash ingest/scripts/migrate_to_supabase.sh
```

- `DELTA=1` switches from `COPY` to `INSERT … ON CONFLICT DO NOTHING` — existing rows in the target are left untouched (target wins).
- `TABLES=` is **required** with `DELTA=1`. Omitting it is a hard error: tables with no natural unique constraint (beyond a serial id) could silently accumulate duplicate rows if local and remote ids have drifted.
- Use `TABLES=` as a comma-separated list to scope multiple tables in one run: `TABLES=chapter_explanations,entity_verses`.

### Other options

| Variable | Default | Description |
|---|---|---|
| `DUMP_FILE` | `/tmp/scriptorium_data.sql` | Path for the intermediate dump file |
| `SKIP_DUMP` | `0` | Set to `1` to reuse an existing dump file and skip the pg_dump step |
| `LOCAL_PASSWORD` | `bible` | Local Postgres password |

---

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

---

## Data Sources & Licensing

This pipeline depends on several open and public domain datasets. You must download these yourself and place them in `ingest/data/` before running. None of these files are bundled with this repository.

---

### Bible Translations

#### World English Bible Updated (WEBU) — `engwebu_usfm.zip`

| | |
|---|---|
| **Translation** | World English Bible Updated (WEBU) |
| **Language** | English |
| **Format** | USFM (Paratext format, one file per book) |
| **License** | **Public Domain** — no copyright restrictions |
| **Download** | https://ebible.org/Scriptures/engwebu_usfm.zip |
| **Project page** | https://ebible.org/engwebu/ |
| **Publisher** | [eBible.org](https://ebible.org) — Michael Paul Johnson |

The World English Bible is a modern English translation in the public domain. You may copy, distribute, publish, or use it freely without restriction. The name "World English Bible" is a trademark of eBible.org; if you modify the text, you may not call the result the World English Bible. The USFM source files for all eBible translations are listed at https://ebible.org/Scriptures/.

---

#### Almeida Revista e Corrigida 1911 (PT1911) — `por-almeida.usfx.xml`

| | |
|---|---|
| **Translation** | Bíblia de João Ferreira de Almeida — Revista e Corrigida (1911) |
| **Language** | Portuguese |
| **Format** | USFX (XML derivative of USFM) |
| **License** | **Public Domain** |
| **Download** | https://github.com/seven1m/open-bibles/raw/master/por-almeida.usfx.xml |
| **Project page** | https://github.com/seven1m/open-bibles |
| **Original translator** | João Ferreira de Almeida (1628–1691) |

The Almeida translation is one of the oldest and most widely used Portuguese Bible translations. The 1911 revision is in the public domain. The USFX file is hosted in the [seven1m/open-bibles](https://github.com/seven1m/open-bibles) repository, which collects public domain and freely licensed Bible translations in standard XML formats.

---

### Entity & Geographic Data

#### OpenBible Bible Geocoding Data — `ancient.jsonl`, `modern.jsonl`, `geometry.jsonl`, `source.jsonl`, `image.jsonl`

| | |
|---|---|
| **Dataset** | Bible Geocoding Data |
| **Publisher** | [OpenBible.info](https://www.openbible.info/geo/) — Aaron Meurer |
| **License** | **Creative Commons Attribution 4.0 (CC BY 4.0)**; OpenStreetMap geometry data is **ODbL 1.0** |
| **Download** | https://github.com/openbibleinfo/Bible-Geocoding-Data |
| **Project page** | https://www.openbible.info/geo/ |
| **Thumbnail images** | https://a.openbible.info/geo/thumbnails.zip (~180 MB) |

A comprehensive geographic dataset identifying the possible modern locations of every place mentioned in the Protestant Bible, with data-backed confidence levels and links to open data. Contains:

| File | Contents |
|---|---|
| `ancient.jsonl` | ~1,342 ancient biblical places with coordinates, verse references, name variants, and media |
| `modern.jsonl` | ~1,596 modern locations with coordinate provenance and associations to ancient places |
| `geometry.jsonl` | ~588 geometry metadata records for rivers, regions, and other non-point data |
| `source.jsonl` | ~442 bibliographic source records cited for identifications |
| `image.jsonl` | ~2,424 image attribution and asset records |

Each file is in **JSON Lines format** (one complete JSON object per line). Attribution is required when using or redistributing this data under CC BY 4.0 — please credit **OpenBible.info**.

---

#### Hitchcock's Bible Names Dictionary — `HitchcocksBibleNamesDictionary.csv`

| | |
|---|---|
| **Work** | Hitchcock's Bible Names Dictionary |
| **Author** | Roswell D. Hitchcock (1817–1887), Washburn Professor of Church History, Union Theological Seminary, New York |
| **Originally published** | c. 1869, as part of *Hitchcock's New and Complete Analysis of the Holy Bible* |
| **License** | **Public Domain** |
| **Primary source** | [Christian Classics Ethereal Library (CCEL)](https://www.ccel.org/ccel/hitchcock/bible_names.html) |
| **CCEL PDF** | https://www.ccel.org/ccel/h/hitchcock/bible_names/cache/bible_names.pdf |
| **CrossWire / SWORD** | http://www.crosswire.org/sword/ |

Contains over 2,500 Hebrew proper names from the Bible with their etymological meanings. The CSV used by this pipeline is derived from the CCEL/CrossWire public domain text. No attribution is legally required, but crediting Roswell D. Hitchcock and CCEL is appreciated.

---

### Attribution Summary

If you publish a project or application built on this pipeline, the following credits are recommended:

```
Bible translations:
  - World English Bible Updated (WEBU) — Public Domain — ebible.org
  - Almeida Revista e Corrigida 1911 — Public Domain — github.com/seven1m/open-bibles

Geographic data:
  - Bible Geocoding Data by OpenBible.info — CC BY 4.0 — openbible.info/geo

Name data:
  - Hitchcock's Bible Names Dictionary by Roswell D. Hitchcock (c. 1869) — Public Domain
    via Christian Classics Ethereal Library — ccel.org
```

CC BY 4.0 attribution for OpenBible geodata is a **legal requirement**, not optional. The other sources are public domain but crediting them is good practice.