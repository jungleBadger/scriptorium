# Scriptorium

Personal Bible Explorer with semantic search. Ingest Bible translations (USFM/USFX), store structured verses in Postgres, and perform multilingual vector search via Milvus.

## Translations

| Code | Language | Format | Source |
|---|---|---|---|
| `WEBU` | English | USFM | [World English Bible](https://ebible.org/) |
| `PT1911` | Portuguese | USFX | Almeida Revista e Corrigida (1911) |

## Prerequisites

- Node.js 22+
- Docker & Docker Compose

## Quick Start

```bash
# 1. Start infrastructure (Postgres, Milvus, etcd, MinIO)
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
| `npm run search "<query>"` | Semantic search from the CLI (supports `--translations=PT1911`) |
| `npm run ingest:rebuild` | Run the full ingestion pipeline (USFM → Postgres → Milvus) |
| `npm run ingest:destroy` | Wipe all ingested data (keeps containers running) |

## Project Structure

```
scriptorium/
  infra/
    docker-compose.yml    # Postgres, Milvus, etcd, MinIO
  ingest/
    data/                 # USFM/USFX source files (not committed)
    out/                  # Generated NDJSON (not committed)
    scripts/              # Ingestion pipeline scripts
    README.md             # Pipeline details and env vars
  server/
    index.js              # Fastify entry point
    services/             # Embedder, Milvus client, reranker, chunks repo
  scripts/
    search_cli.mjs        # CLI semantic search tool
  package.json
```

## Pipeline Overview

1. **Parse** USFM zip or USFX XML → verse NDJSON
2. **Load** verses into Postgres
3. **Chunk** verses into overlapping 3-verse windows (per translation, per chapter)
4. **Embed** chunks with `paraphrase-multilingual-MiniLM-L12-v2` → Milvus

## Search API

```bash
# All translations
curl -X POST http://localhost:3000/api/search \
  -H 'Content-Type: application/json' \
  -d '{"q": "In the beginning God created", "topk": 5}'

# Filter to specific translations
curl -X POST http://localhost:3000/api/search \
  -H 'Content-Type: application/json' \
  -d '{"q": "No princípio criou Deus", "topk": 5, "translations": ["PT1911"]}'
```

**Parameters:** `q` (required), `topk`, `mode` (`explorer`|`exact`), `includeDeutero`, `translations` (array of translation codes).

See [`ingest/README.md`](ingest/README.md) for detailed pipeline docs and environment variables.
