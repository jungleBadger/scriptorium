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
- [Gemini API key](https://aistudio.google.com/) (for the Explore / Ask feature)
- [voice.ai](https://voice.ai) account and API key (for text-to-speech, optional)
- [Cloudflare R2](https://developers.cloudflare.com/r2/) bucket (for TTS audio cache, optional)

## First-Time Setup (Data + Ingest)

1. Create the data directory:

```bash
mkdir -p ingest/data
```

2. Download and place required base translation files:
- `ingest/data/engwebu_usfm.zip` (WEBU, required by `npm run ingest:rebuild`)
- `ingest/data/por-almeida.usfx.xml` (PT1911, optional unless you ingest PT1911)

3. Optional entity datasets (for entity/maps/enrichment flows):
- `ingest/data/ancient.jsonl`
- `ingest/data/modern.jsonl`
- `ingest/data/geometry.jsonl`
- `ingest/data/source.jsonl`
- `ingest/data/image.jsonl`
- `ingest/data/HitchcocksBibleNamesDictionary.csv`

4. Start Postgres + pgvector:

```bash
docker compose -f infra/docker-compose.yml up -d
```

5. Install Node dependencies:

```bash
npm install
```

6. Run base ingest (WEBU parse -> load -> chunks -> embeddings):

```bash
npm run ingest:rebuild
```

7. Optional: ingest PT1911 and regenerate chunks/embeddings:

```bash
node ingest/scripts/002_usfx_to_verses.mjs ingest/data/por-almeida.usfx.xml ingest/out PT1911
node ingest/scripts/003_load_verses_to_postgres.mjs ingest/out/verses.ndjson
node ingest/scripts/004_generate_chunks.mjs 3 1
node ingest/scripts/005_embed_chunks.mjs
```

8. Optional: load/enrich entities:

```bash
npm run ingest:entities:openbible
npm run ingest:entities:openbible:full
npm run ingest:entities:hitchcock
npm run ingest:entities:person-refs
```

9. Optional: build client bundle and start app:

```bash
npm run build:client
npm start
```

10. Optional: enable the Explore / Ask feature (Gemini):

Set the following environment variable (e.g. in a `.env` file):

```
GEMINI_API_KEY=your-gemini-api-key
```

Obtain a free API key at [Google AI Studio](https://aistudio.google.com/). The model defaults to `gemini-2.5-flash`; override with `GEMINI_MODEL=<model-id>`.

11. Optional: configure text-to-speech (voice.ai + Cloudflare R2):

Set the following environment variables (e.g. in a `.env` file):

```
VOICE_AI_API_KEY=your-voice-ai-api-key
R2_URL=https://<account_id>.r2.cloudflarestorage.com
R2_BUCKET_NAME=scriptorium-tts-cache
R2_ACCESS_KEY=your-r2-access-key
R2_SECRET_ACCESS_KEY=your-r2-secret-key
```

Add your voice IDs from the voice.ai dashboard to `server/data/voices.js`.

12. Optional: install Ollama for chapter explanation enrichment (ingest pipeline only):

```bash
# Install Ollama (https://ollama.com/download), then:
ollama serve
ollama pull qwen3:8b
```

## Quick Start

```bash
# 1. Start infrastructure (Postgres with pgvector)
docker compose -f infra/docker-compose.yml up -d

# 2. Install dependencies
npm install

# 3. Run the base ingestion pipeline
npm run ingest:rebuild

# 4. (Optional) build the client bundle served by Fastify
npm run build:client

# 5. Start the server
npm start
```

Use this section when you already have the required files in `ingest/data`.

## Adding a New Translation

Adding a translation is a two-part process: ingest the text into Postgres, then register the translation code in the handful of places where the server and client have explicit maps.

### 1. Ingest the text

**USFM source (zip of one file per book):**

```bash
node ingest/scripts/001_usfm_to_verses.mjs ingest/data/<file>.zip ingest/out <CODE>
```

**USFX source (single XML file):**

```bash
node ingest/scripts/002_usfx_to_verses.mjs ingest/data/<file>.usfx.xml ingest/out <CODE>
```

Then load, chunk, and embed (these commands process all translations present in the DB, so existing data is not affected):

```bash
node ingest/scripts/003_load_verses_to_postgres.mjs ingest/out/verses.ndjson
node ingest/scripts/004_generate_chunks.mjs 3 1
node ingest/scripts/005_embed_chunks.mjs
```

### 2. Register the translation code

The following files each contain a small map that must be extended. All changes are additive — one new entry per file.

**`server/services/askService.js` — Gemini prompt language**

Defaults to `"English"` if absent. Add an entry for any non-English translation:

```js
const TRANSLATION_LANGUAGE_NAME = {
  PT1911: "Portuguese",
  ARC:    "Portuguese",
  YOUR_CODE: "Spanish", // ← add
};
```

**`server/services/ttsService.js` — TTS voice language / locale**

Controls which voice language is used for Read Aloud. Add an entry for any non-English translation:

```js
const TRANSLATION_TTS_PROFILE = {
  PT1911: { language: "pt", locale: "pt-BR" },
  ARC:    { language: "pt", locale: "pt-BR" },
  YOUR_CODE: { language: "es", locale: "es-ES" }, // ← add
};
```

**`client/src/App.vue` — UI translation picker**

The hardcoded array controls which codes appear in the translation selector:

```js
const AVAILABLE_TRANSLATIONS = ["WEBU", "PT1911", "YOUR_CODE"]; // ← add
```

**`client/src/composables/useVoices.js` — auto-switch voice on translation change**

Maps translation code → language code so the voice selector switches language automatically:

```js
const TRANSLATION_LANGUAGE = { PT1911: "pt", ARC: "pt", YOUR_CODE: "es" }; // ← add
```

**`client/src/components/ReaderSettingsPanel.vue` — UI locale label suffix**

Used as the `lang` attribute hint and display label. Add an entry to `TRANSLATION_LABEL_SUFFIX`:

```js
const TRANSLATION_LABEL_SUFFIX = {
  WEBU:      "en-us",
  PT1911:    "pt-br",
  ARC:       "pt-br",
  YOUR_CODE: "es-es", // ← add
};
```

### 3. Optional: localized book display names

If the translation uses non-English book names, create a data file modelled on `client/src/data/bookNamesPtBr.js` (a plain object keyed by book ID) and extend the `getDisplayBookName` function in `App.vue` with a matching condition.

---

## Explore & Ask (Gemini)

Scriptorium uses the Gemini API (`gemini-2.5-flash` by default) to power the Explore / Ask feature via `POST /api/ask`.

### 1. Configure Gemini API key

Add to your `.env` file:

```
GEMINI_API_KEY=your-gemini-api-key
```

Obtain a free key at [Google AI Studio](https://aistudio.google.com/).

### 2. Start Scriptorium backend

```bash
npm start
```

### 3. Verify health (Postgres + Gemini)

```bash
curl localhost:3000/api/health
```

Returns `"status": "ok"` when Postgres is up and `GEMINI_API_KEY` is set. Returns `"status": "degraded"` when a feature (Explore or Read Aloud) is unavailable — the app still starts and serves scripture normally.

### 4. Ask from UI or API

- UI: use the `Ask about this passage...` input and click `Explore`.
- API example:

```bash
curl -X POST http://localhost:3000/api/ask \
  -H 'Content-Type: application/json' \
  -d '{
    "question": "Who killed Abel?",
    "translation": "WEBU",
    "book": "GEN",
    "chapter": 4,
    "verse": 8
  }'
```

Response shape:

```json
{
  "raw_response_text": "plain text answer from Gemini",
  "found_entities": [],
  "relevant_passages": []
}
```

Notes:
- `raw_response_text` is plain text.
- Common errors include `GEMINI_NOT_CONFIGURED`, `GEMINI_RATE_LIMITED`, and `GEMINI_ERROR`.

## npm Scripts

| Command | Description |
|---|---|
| `npm start` | Start the Fastify server |
| `npm run dev:client` | Start the Vite client dev server |
| `npm run build:client` | Build client assets to `client/dist` |
| `npm test` | Run all tests (Vitest) |
| `npm run search "<query>"` | Semantic search from the CLI (supports `--translations=PT1911`) |
| `npm run ingest:rebuild` | Run the default rebuild pipeline (`001 -> 003 -> 004 -> 005`, WEBU) |
| `npm run ingest:destroy` | Wipe all ingested data (keeps containers running) |
| `npm run ingest:entities:openbible` | Load OpenBible ancient places into entity tables |
| `npm run ingest:entities:openbible:full` | Load normalized OpenBible full bundle (`openbible_*`) |
| `npm run ingest:entities:hitchcock` | Load Hitchcock names and merge/create entities |
| `npm run ingest:entities:person-refs` | Backfill person `entity_verses` links from verse text |
| `npm run ingest:entities:enrich:meta` | LLM metadata enrichment for entities |
| `npm run ingest:entities:enrich:desc` | LLM description enrichment for entities |
| `npm run ingest:entities:export` | Export entity JSONL batches to `ingest/out/entities` |
| `npm run ingest:chapters:explain` | Generate chapter explanations with Ollama |

## Project Structure

```text
scriptorium/
  client/
    src/                  # Vue frontend
    dist/                 # Built client bundle served by Fastify
    package.json
  infra/
    docker-compose.yml    # Postgres with pgvector
  ingest/
    data/                 # USFM/USFX source files (not committed)
    out/                  # Generated NDJSON (not committed)
    scripts/              # Ingestion pipeline scripts
    README.md             # Pipeline details and env vars
  server/
    index.js              # Fastify entry point
    data/                 # Static data (book names, canonical order, voices config)
    routes/               # API route handlers
    services/             # Repos, embedder, vector search, reranker, TTS, R2
  scripts/
    search_cli.mjs        # CLI semantic search tool
  tests/
    composables/          # Client composable pure function tests
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

### Health

```bash
curl localhost:3000/health
```

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

# Chapter context (LLM explanation + linked entities)
curl localhost:3000/api/chapters/GEN/1/context?translation=WEBU

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

### Text-to-Speech

Read Bible verses aloud with synchronized word highlighting.

```bash
# List available voices
curl localhost:3000/api/tts/voices
```

```bash
# Generate (or serve cached) audio for a verse
curl -X POST http://localhost:3000/api/tts \
  -H 'Content-Type: application/json' \
  -d '{
    "translation": "WEBU",
    "bookId": "GEN",
    "chapter": 1,
    "verse": 1,
    "voiceId": ""
  }'
```

Response shape:

```json
{
  "audioUrl": "https://<r2-bucket>/<key>?X-Amz-Signature=...",
  "words": [
    { "word": "In",        "startMs": 0,   "endMs": 150 },
    { "word": "the",       "startMs": 150, "endMs": 280 },
    { "word": "beginning", "startMs": 280, "endMs": 600 }
  ],
  "cached": false
}
```

Notes:
- `audioUrl` is a pre-signed Cloudflare R2 URL (24h expiry) served directly to the browser — supports Range requests for seeking.
- `words` timings are estimated from character distribution at ~130 WPM. Accuracy is sufficient for verse-length text.
- `cached: true` means audio was served from R2 without calling voice.ai.
- Audio is cached permanently in R2 (Bible text never changes). Cache key: `{bookId}/{chapter}/{verse}/{translation}/{voiceId}.mp3`.
- Voice selection in the UI auto-switches language when the translation changes (e.g. PT1911 → Portuguese voice), but respects manual overrides.
- Configure available voices in `server/data/voices.js`.

See [ingest/README.md](ingest/README.md) for detailed pipeline docs and environment variables.
