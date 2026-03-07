// server/tests/askService.test.js
// Unit tests for the pure buildAskPrompt function.
// DB and Gemini dependencies are mocked so no network/DB calls are made.

import { describe, it, expect, vi } from "vitest";

vi.mock("../services/pool.js", () => ({ getPool: vi.fn(), closePool: vi.fn() }));
vi.mock("../services/entitiesRepo.js", () => ({ searchEntities: vi.fn() }));
vi.mock("../services/versesRepo.js", () => ({ getChapter: vi.fn() }));
vi.mock("../services/geminiClient.js", () => ({ generateGeminiText: vi.fn() }));

const { buildAskPrompt } = await import("../services/askService.js");

describe("buildAskPrompt", () => {
  const base = {
    question: "Who is Moses?",
    translation: "WEBU",
    book: "EXO",
    chapter: 3,
    verse: 1,
  };

  it("includes the bible version and passage reference", () => {
    const prompt = buildAskPrompt(base);
    expect(prompt).toContain("[BIBLE_VERSION]");
    expect(prompt).toContain("WEBU");
    expect(prompt).toContain("[PASSAGE]");
    expect(prompt).toContain("EXO 3:1");
  });

  it("includes the question", () => {
    const prompt = buildAskPrompt(base);
    expect(prompt).toContain("[QUESTION]");
    expect(prompt).toContain("Who is Moses?");
  });

  it("omits CHAPTER_TEXT section when no verses are given", () => {
    const prompt = buildAskPrompt({ ...base, chapterVerses: [] });
    expect(prompt).not.toContain("[CHAPTER_TEXT]");
  });

  it("includes CHAPTER_TEXT when verses are provided", () => {
    const prompt = buildAskPrompt({
      ...base,
      chapterVerses: [
        { verse: 1, text: "Now Moses was tending the flock." },
        { verse: 2, text: "There the angel of the LORD appeared to him." },
      ],
    });
    expect(prompt).toContain("[CHAPTER_TEXT]");
    expect(prompt).toContain("EXO 3 (WEBU)");
    expect(prompt).toContain("1 Now Moses was tending the flock.");
    expect(prompt).toContain("2 There the angel of the LORD appeared to him.");
  });

  it("omits CONTEXT_ENTITIES section when no entities are given", () => {
    const prompt = buildAskPrompt({ ...base, foundEntities: [] });
    expect(prompt).not.toContain("[CONTEXT_ENTITIES]");
  });

  it("includes CONTEXT_ENTITIES when entities are provided", () => {
    const prompt = buildAskPrompt({
      ...base,
      foundEntities: [
        { name: "Moses", type: "person" },
        { name: "Sinai", type: "place" },
      ],
    });
    expect(prompt).toContain("[CONTEXT_ENTITIES]");
    expect(prompt).toContain("Moses (person)");
    expect(prompt).toContain("Sinai (place)");
  });

  it("caps entity list at 5 entries", () => {
    const entities = Array.from({ length: 10 }, (_, i) => ({ name: `Entity${i}`, type: "person" }));
    const prompt = buildAskPrompt({ ...base, foundEntities: entities });
    expect(prompt).toContain("Entity0 (person)");
    expect(prompt).toContain("Entity4 (person)");
    expect(prompt).not.toContain("Entity5 (person)");
  });

  it("includes system instructions at the top", () => {
    const prompt = buildAskPrompt(base);
    expect(prompt).toContain("You are a Bible study assistant.");
    expect(prompt).toContain("Output plain text only.");
  });
});
