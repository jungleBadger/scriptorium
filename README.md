# Scriptorium

Personal Bible Explorer with semantic search. Ingest Bible translations (USFM/USFX), store structured verses in Postgres, and run multilingual vector search via pgvector.

## Translations

| Code | Language | Format | Source |
|---|---|---|---|
| `WEBU` | English | USFM | [World English Bible](https://ebible.org/) |
| `PT1911` | Portuguese | USFX | Almeida Revista e Corrigida (1911) |

## Prerequisites

- Node.js 22+
- Docker and Docker Compose

## Quick Start

```bash
# 1. Start infrastructure (Postgres with pgvector)
docker compose -f infra/docker-compose.yml up -d

# 2. Install dependencies
npm install

# 3. Run the full ingestion pipeline
npm run ingest:rebuild

# 4. Start the server
npm start
```

## npm Scripts

| Command | Description |
|---|---|
| `npm start` | Start the Fastify server |
| `npm test` | Run all tests (Vitest) |
| `npm run search "<query>"` | Semantic search from the CLI (supports `--translations=PT1911`) |
| `npm run ingest:rebuild` | Run the full ingestion pipeline (USFM -> Postgres -> pgvector) |
| `npm run ingest:destroy` | Wipe all ingested data (keeps containers running) |
| `npm run ingest:entities:openbible` | Load OpenBible ancient places into entity tables |
| `npm run ingest:entities:openbible:full` | Load normalized OpenBible full bundle (`openbible_*`) |
| `npm run ingest:entities:hitchcock` | Load Hitchcock names and merge/create entities |
| `npm run ingest:entities:enrich:meta` | LLM metadata enrichment for entities |
| `npm run ingest:entities:enrich:desc` | LLM description enrichment for entities |
| `npm run ingest:chapters:explain` | Generate chapter explanations with Ollama |

## Project Structure

```text
scriptorium/
  infra/
    docker-compose.yml    # Postgres with pgvector
  ingest/
    data/                 # USFM/USFX source files (not committed)
    out/                  # Generated NDJSON (not committed)
    scripts/              # Ingestion pipeline scripts
    README.md             # Pipeline details and env vars
  server/
    index.js              # Fastify entry point
    data/                 # Static data (book names, canonical order)
    routes/               # API route handlers
    services/             # Repos, embedder, vector search, reranker
  scripts/
    search_cli.mjs        # CLI semantic search tool
  tests/
    routes/               # Route integration tests (Fastify inject)
    services/             # Service unit tests (mocked DB)
  package.json
```

## Pipeline Overview

1. **Parse** USFM zip or USFX XML -> verse NDJSON
2. **Load** verses into Postgres
3. **Chunk** verses into overlapping 3-verse windows (per translation, per chapter)
4. **Embed** chunks with `paraphrase-multilingual-MiniLM-L12-v2` -> pgvector
5. **Optional enrichments**: entities and chapter-level explanations

## API

### Semantic Search

```bash
# All translations
curl -X POST http://localhost:3000/api/search \
  -H 'Content-Type: application/json' \
  -d '{"q": "In the beginning God created", "topk": 5}'

# Filter to specific translations
curl -X POST http://localhost:3000/api/search \
  -H 'Content-Type: application/json' \
  -d '{"q": "No principio criou Deus", "topk": 5, "translations": ["PT1911"]}'
```

**Parameters:** `q` (required), `topk`, `mode` (`explorer`|`exact`), `includeDeutero`, `translations` (array of translation codes).

### Bible Reader

```bash
# Books / Table of Contents
curl localhost:3000/api/books?translation=WEBU

# Full chapter
curl localhost:3000/api/chapters/GEN/1?translation=WEBU

# Verse range
curl localhost:3000/api/verses/GEN/1/1/3?translation=WEBU
```

### Entities

```bash
# Search entities by name
curl "localhost:3000/api/entities?q=Jeru"
curl "localhost:3000/api/entities?q=Jeru&type=place&limit=20&offset=0"

# Entity detail (includes related entities)
curl localhost:3000/api/entities/1

# Entities for a verse
curl localhost:3000/api/entities/by-verse/GEN/2/8

# Geo entities for map layer
curl localhost:3000/api/entities/geo
curl "localhost:3000/api/entities/geo?type=place.settlement&limit=1000&offset=0"
curl "localhost:3000/api/entities/geo?minLon=35&maxLon=36&minLat=31&maxLat=32"
```

`/api/entities` and `/api/entities/geo` return pagination metadata: `total`, `limit`, `offset`, `has_more`, and `results`.

See `ingest/README.md` for detailed pipeline docs and environment variables.
