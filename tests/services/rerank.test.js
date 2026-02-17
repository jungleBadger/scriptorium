// Unit tests for rerank — pure functions, no mocking needed.

import { describe, it, expect } from "vitest";
import { rerank, DEUTERO_BOOKS } from "../../server/services/rerank.js";

// Helper to build a minimal candidate
function makeCandidate(overrides = {}) {
  return {
    chunk_id: "c1",
    translation: "WEBU",
    ref_start: "GEN 1:1",
    ref_end: "GEN 1:5",
    book_id: "GEN",
    chapter: 1,
    verse_start: 1,
    verse_end: 5,
    score: 0.9,
    text_clean: "In the beginning God created the heavens and the earth.",
    ...overrides,
  };
}

// ── DEUTERO_BOOKS ───────────────────────────────────────────────

describe("DEUTERO_BOOKS", () => {
  it("contains known deuterocanonical books", () => {
    expect(DEUTERO_BOOKS.has("TOB")).toBe(true);
    expect(DEUTERO_BOOKS.has("1MA")).toBe(true);
    expect(DEUTERO_BOOKS.has("SIR")).toBe(true);
  });

  it("does not contain canonical books", () => {
    expect(DEUTERO_BOOKS.has("GEN")).toBe(false);
    expect(DEUTERO_BOOKS.has("REV")).toBe(false);
    expect(DEUTERO_BOOKS.has("PSA")).toBe(false);
  });
});

// ── rerank ──────────────────────────────────────────────────────

describe("rerank", () => {
  it("returns results sorted by final_score descending", () => {
    const candidates = [
      makeCandidate({ chunk_id: "low", score: 0.3, text_clean: "unrelated text" }),
      makeCandidate({ chunk_id: "high", score: 0.95, text_clean: "In the beginning God created" }),
    ];

    const results = rerank(candidates, "creation", "explorer");

    expect(results[0].chunk_id).toBe("high");
    expect(results[1].chunk_id).toBe("low");
    expect(results[0].final_score).toBeGreaterThan(results[1].final_score);
  });

  it("includes expected fields in output", () => {
    const results = rerank([makeCandidate()], "beginning", "explorer");
    const r = results[0];

    expect(r).toHaveProperty("chunk_id");
    expect(r).toHaveProperty("semantic_score");
    expect(r).toHaveProperty("evidence_score");
    expect(r).toHaveProperty("final_score");
    expect(r).toHaveProperty("evidence");
    expect(r.evidence).toHaveProperty("keyword_hits");
    expect(r.evidence).toHaveProperty("notes");
    expect(r).toHaveProperty("text_clean");
  });

  it("boosts evidence score for matching keyword rules", () => {
    const candidate = makeCandidate({
      text_clean: "In the beginning God created the heavens and the earth.",
    });

    const withKeyword = rerank([candidate], "creation", "explorer");
    const withoutKeyword = rerank([candidate], "xyzzy", "explorer");

    expect(withKeyword[0].evidence_score).toBeGreaterThan(withoutKeyword[0].evidence_score);
  });

  it("populates keyword_hits when rules match", () => {
    const candidate = makeCandidate({
      text_clean: "God so loved the world that he gave his only son",
    });

    const results = rerank([candidate], "love", "explorer");

    expect(results[0].evidence.keyword_hits.length).toBeGreaterThan(0);
    expect(results[0].evidence.keyword_hits).toContain("loved");
  });

  it("returns zero evidence for unrelated queries", () => {
    const candidate = makeCandidate({
      text_clean: "The genealogy of Jesus Christ",
    });

    const results = rerank([candidate], "xyzzy", "explorer");
    expect(results[0].evidence_score).toBe(0);
    expect(results[0].evidence.keyword_hits).toEqual([]);
  });

  it("uses different weights for explorer vs exact mode", () => {
    const candidate = makeCandidate({
      text_clean: "In the beginning God created the heavens and the earth.",
    });

    const explorer = rerank([candidate], "creation", "explorer");
    const exact = rerank([candidate], "creation", "exact");

    // Same input, different weights → different final scores
    expect(explorer[0].final_score).not.toBe(exact[0].final_score);
  });

  it("incorporates trigram scores in exact mode", () => {
    const candidate = makeCandidate({ chunk_id: "c1", text_clean: "love one another" });
    const trigramScores = new Map([["c1", 0.9]]);

    const withTrigram = rerank([candidate], "love", "exact", trigramScores);
    const withoutTrigram = rerank([candidate], "love", "exact");

    expect(withTrigram[0].evidence_score).not.toBe(withoutTrigram[0].evidence_score);
    expect(withTrigram[0].evidence.notes.some((n) => n.includes("trigram_sim"))).toBe(true);
  });

  it("handles empty candidates array", () => {
    const results = rerank([], "anything", "explorer");
    expect(results).toEqual([]);
  });
});
