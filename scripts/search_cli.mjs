#!/usr/bin/env node
// scripts/search_cli.mjs
// CLI tool for testing the search+rerank pipeline locally.
//
// Usage:
//   node scripts/search_cli.mjs "No princípio Deus criou o céu e a terra"
//   node scripts/search_cli.mjs "amor de Deus" --topk=10 --mode=exact --no-deutero
//   node scripts/search_cli.mjs "No princípio" --translations=PT1911
//   node scripts/search_cli.mjs "In the beginning" --translations=WEBU,PT1911

import { embedQuery } from "../server/services/embedder.js";
import { searchChunks } from "../server/services/vectorSearch.js";
import { fetchChunksByIds, trigramSimilarity, closePool } from "../server/services/chunksRepo.js";
import { rerank, DEUTERO_BOOKS } from "../server/services/rerank.js";

function parseArgs(argv) {
  const args = { topk: 5, mode: "explorer", includeDeutero: true, translations: null, query: "" };
  const positional = [];

  for (const arg of argv) {
    if (arg.startsWith("--topk=")) {
      args.topk = parseInt(arg.split("=")[1], 10);
    } else if (arg.startsWith("--mode=")) {
      args.mode = arg.split("=")[1];
    } else if (arg === "--no-deutero") {
      args.includeDeutero = false;
    } else if (arg.startsWith("--translations=")) {
      args.translations = arg.split("=")[1].split(",").map((t) => t.trim());
    } else {
      positional.push(arg);
    }
  }

  args.query = positional.join(" ");
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.query) {
    console.error("Usage: node scripts/search_cli.mjs <query> [--topk=N] [--mode=explorer|exact] [--no-deutero] [--translations=WEBU,PT1911]");
    process.exit(1);
  }

  console.log(`Query:  "${args.query}"`);
  console.log(`Mode:   ${args.mode} | Top-K: ${args.topk} | Deutero: ${args.includeDeutero} | Translations: ${args.translations ? args.translations.join(", ") : "all"}\n`);

  // Embed
  console.log("Embedding query...");
  const vector = await embedQuery(args.query);

  // pgvector search
  const candidateLimit = Math.max(args.topk * 3, 30);
  console.log(`Searching Postgres/pgvector (top ${candidateLimit} candidates)...`);
  let candidates = await searchChunks(vector, candidateLimit, args.translations);

  if (!args.includeDeutero) {
    candidates = candidates.filter((c) => !DEUTERO_BOOKS.has(c.book_id));
  }

  // Hydrate
  const ids = candidates.map((c) => c.chunk_id);
  console.log(`Hydrating ${ids.length} chunks from Postgres...`);
  const chunks = await fetchChunksByIds(ids);
  const chunkMap = new Map(chunks.map((c) => [c.chunk_id, c]));

  const hydrated = candidates
    .filter((c) => chunkMap.has(c.chunk_id))
    .map((c) => ({ ...c, text_clean: chunkMap.get(c.chunk_id).text_clean }));

  // Trigram (exact mode)
  let trigramScores = null;
  if (args.mode === "exact") {
    trigramScores = await trigramSimilarity(ids, args.query);
  }

  // Rerank
  const ranked = rerank(hydrated, args.query, args.mode, trigramScores);
  const top = ranked.slice(0, args.topk);

  // Display
  console.log(`\n${"=".repeat(72)}`);
  console.log(`Results (${top.length}/${ranked.length} shown):`);
  console.log("=".repeat(72));

  for (let i = 0; i < top.length; i++) {
    const r = top[i];
    const snippet = r.text_clean.length > 160
      ? r.text_clean.slice(0, 160) + "…"
      : r.text_clean;

    console.log(`\n#${i + 1}  [${r.translation}] ${r.ref_start} → ${r.ref_end}  [${r.book_id} ${r.chapter}:${r.verse_start}-${r.verse_end}]`);
    console.log(`    final=${r.final_score}  semantic=${r.semantic_score}  evidence=${r.evidence_score}`);
    if (r.evidence.keyword_hits.length) {
      console.log(`    keywords: ${r.evidence.keyword_hits.join(", ")}`);
    }
    if (r.evidence.notes.length) {
      console.log(`    notes: ${r.evidence.notes.join(" | ")}`);
    }
    console.log(`    ${snippet}`);
  }

  console.log();
  await closePool();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
