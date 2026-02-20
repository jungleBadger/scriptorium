import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    parseAndValidate,
    buildRosterContext,
    buildUserPrompt,
    callOllama,
    checkNameRelevance,
} from "../../ingest/scripts/009_enrich_entities_metadata_llm.mjs";

// ── parseAndValidate ────────────────────────────────────────────

describe("parseAndValidate", () => {
    const validIds = new Set([1, 2, 3, 42, 87, 100]);
    const knownRefs = new Set(["2SA 5:6-9", "1KI 8:1", "GEN 1:1", "GEN 2:1", "GEN 3:1", "GEN 4:1", "GEN 5:1", "GEN 6:1"]);

    it("parses valid JSON and returns structured result", () => {
        const raw = JSON.stringify({
            key_refs: ["2SA 5:6-9", "1KI 8:1"],
            related_entities: [42, 87],
        });

        const result = parseAndValidate(raw, validIds, knownRefs);

        expect(result.cross_references).toHaveLength(2);
        expect(result.cross_references).toEqual(["2SA 5:6-9", "1KI 8:1"]);
        expect(result.related_entities).toEqual([42, 87]);
    });

    it("filters out invalid entity IDs", () => {
        const raw = JSON.stringify({
            key_refs: [],
            related_entities: [42, 999, 87, 5000],
        });

        const result = parseAndValidate(raw, validIds, knownRefs);
        expect(result.related_entities).toEqual([42, 87]);
    });

    it("filters out non-numeric entity IDs", () => {
        const raw = JSON.stringify({
            key_refs: [],
            related_entities: [42, "not-a-number", null, 87],
        });

        const result = parseAndValidate(raw, validIds, knownRefs);
        expect(result.related_entities).toEqual([42, 87]);
    });

    it("throws on invalid JSON", () => {
        expect(() => parseAndValidate("not json at all", validIds, knownRefs)).toThrow();
    });

    it("caps key_refs at 5", () => {
        const raw = JSON.stringify({
            key_refs: ["GEN 1:1", "GEN 2:1", "GEN 3:1", "GEN 4:1", "GEN 5:1", "GEN 6:1"],
            related_entities: [],
        });

        const result = parseAndValidate(raw, validIds, knownRefs);
        expect(result.cross_references).toHaveLength(5);
    });

    it("filters out invented refs not in knownRefs", () => {
        const raw = JSON.stringify({
            key_refs: ["2SA 5:6-9", "FAKE 99:99", "1KI 8:1"],
            related_entities: [],
        });

        const result = parseAndValidate(raw, validIds, knownRefs);
        expect(result.cross_references).toEqual(["2SA 5:6-9", "1KI 8:1"]);
    });

    it("filters out non-string key_refs", () => {
        const raw = JSON.stringify({
            key_refs: ["GEN 1:1", 123, null, "1KI 8:1"],
            related_entities: [],
        });

        const result = parseAndValidate(raw, validIds, knownRefs);
        expect(result.cross_references).toEqual(["GEN 1:1", "1KI 8:1"]);
    });

    it("handles missing optional arrays gracefully", () => {
        const raw = JSON.stringify({});

        const result = parseAndValidate(raw, validIds, knownRefs);
        expect(result.cross_references).toEqual([]);
        expect(result.related_entities).toEqual([]);
    });
});

// ── buildRosterContext ──────────────────────────────────────────

describe("buildRosterContext", () => {
    const roster = [
        { id: 1, canonical_name: "Jerusalem", type: "place.settlement" },
        { id: 2, canonical_name: "Bethlehem", type: "place.settlement" },
        { id: 3, canonical_name: "David", type: "person" },
        { id: 4, canonical_name: "Moses", type: "person" },
        { id: 5, canonical_name: "Jordan", type: "place.river" },
    ];

    it("includes all same-type entities (excluding current)", () => {
        const current = { id: 1, type: "place.settlement" };
        const { context } = buildRosterContext(roster, current);

        expect(context).toContain("2:Bethlehem(place.settlement)");
        expect(context).not.toContain("1:Jerusalem");
    });

    it("includes other-type entities in context", () => {
        const current = { id: 1, type: "place.settlement" };
        const { context } = buildRosterContext(roster, current);

        // With only 3 other-type entities (< 200 sample), all should be included
        expect(context).toContain("3:David(person)");
        expect(context).toContain("4:Moses(person)");
        expect(context).toContain("5:Jordan(place.river)");
    });

    it("uses compact format id:name(type)", () => {
        const current = { id: 1, type: "place.settlement" };
        const { context } = buildRosterContext(roster, current);
        const lines = context.split("\n");

        for (const line of lines) {
            expect(line).toMatch(/^\d+:\w+\([\w.]+\)$/);
        }
    });

    it("excludes the current entity from roster", () => {
        const current = { id: 3, type: "person" };
        const { context } = buildRosterContext(roster, current);

        expect(context).not.toContain("3:David");
        expect(context).toContain("4:Moses(person)");
    });

    it("returns ids array matching the context entries", () => {
        const current = { id: 1, type: "place.settlement" };
        const { ids } = buildRosterContext(roster, current);

        expect(ids).toContain(2);
        expect(ids).toContain(3);
        expect(ids).toContain(4);
        expect(ids).toContain(5);
        expect(ids).not.toContain(1);
    });
});

// ── buildUserPrompt ─────────────────────────────────────────────

describe("buildUserPrompt", () => {
    const entity = {
        canonical_name: "Jerusalem",
        type: "place.settlement",
        description: "vision of peace",
        aliases: ["Jebus", "Zion"],
    };

    it("includes entity name and type", () => {
        const prompt = buildUserPrompt(entity, [], "", []);
        expect(prompt).toContain("You must write about: Jerusalem (place.settlement)");
    });

    it("includes description and aliases", () => {
        const prompt = buildUserPrompt(entity, [], "", []);
        expect(prompt).toContain("vision of peace");
        expect(prompt).toContain("Jebus, Zion");
    });

    it("truncates verse refs at 20", () => {
        const refs = Array.from({ length: 30 }, (_, i) => `GEN ${i + 1}:1`);
        const prompt = buildUserPrompt(entity, refs, "", []);

        expect(prompt).toContain("GEN 20:1");
        expect(prompt).not.toContain("GEN 21:1");
        expect(prompt).toContain("First 20 verse references");
    });

    it("includes roster context", () => {
        const roster = "42:Bethlehem(place.settlement)\n87:David(person)";
        const prompt = buildUserPrompt(entity, [], roster, [42, 87]);

        expect(prompt).toContain("42:Bethlehem(place.settlement)");
        expect(prompt).toContain("87:David(person)");
    });

    it("uses real roster IDs in example instead of placeholders", () => {
        const prompt = buildUserPrompt(entity, [], "", [100, 200, 300]);
        expect(prompt).toContain("[100, 200]");
        expect(prompt).not.toContain("[42, 87]");
    });

    it("does not include description_rich in prompt", () => {
        const prompt = buildUserPrompt(entity, [], "", []);
        expect(prompt).not.toContain("description_rich");
    });

    it("handles entity with no description", () => {
        const noDesc = { ...entity, description: "" };
        const prompt = buildUserPrompt(noDesc, [], "", []);
        expect(prompt).toContain("No existing description");
    });

    it("handles entity with no aliases", () => {
        const noAlias = { ...entity, aliases: [] };
        const prompt = buildUserPrompt(noAlias, [], "", []);
        expect(prompt).not.toContain("Also known as");
    });
});

// ── checkNameRelevance ───────────────────────────────────────────

describe("checkNameRelevance", () => {
    it("returns true when canonical name appears in description", () => {
        const entity = { canonical_name: "Jerusalem", aliases: [] };
        expect(checkNameRelevance(entity, "Jerusalem was the capital of ancient Israel.")).toBe(true);
    });

    it("returns true when alias appears in description", () => {
        const entity = { canonical_name: "Jerusalem", aliases: ["Jebus", "Zion"] };
        expect(checkNameRelevance(entity, "The city of Zion held great significance.")).toBe(true);
    });

    it("returns false when description is about a different entity", () => {
        const entity = { canonical_name: "Abdon", aliases: [] };
        expect(checkNameRelevance(entity, "The Valley of Rephaim is mentioned in several places.")).toBe(false);
    });

    it("is case-insensitive", () => {
        const entity = { canonical_name: "JERUSALEM", aliases: [] };
        expect(checkNameRelevance(entity, "jerusalem was important.")).toBe(true);
    });

    it("matches first word of hyphenated names", () => {
        const entity = { canonical_name: "Abel-beth-maacah", aliases: [] };
        expect(checkNameRelevance(entity, "Abel was a settlement in northern Israel.")).toBe(true);
    });

    it("does not match short first-word fragments (< 3 chars)", () => {
        const entity = { canonical_name: "Ur", aliases: [] };
        // "Ur" is only 2 chars, so first-word split shouldn't add it again
        // but the full name "Ur" should still match
        expect(checkNameRelevance(entity, "Ur of the Chaldees was Abraham's homeland.")).toBe(true);
    });

    it("returns false when no name or alias matches", () => {
        const entity = { canonical_name: "Abel-keramim", aliases: ["Abel of the Vineyards"] };
        expect(checkNameRelevance(entity, "Bethlehem is the birthplace of King David and Jesus Christ.")).toBe(false);
    });

    it("handles entity with no aliases", () => {
        const entity = { canonical_name: "Damascus" };
        expect(checkNameRelevance(entity, "Damascus is one of the oldest continuously inhabited cities.")).toBe(true);
    });
});

// ── callOllama ──────────────────────────────────────────────────

describe("callOllama", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it("sends correct request and returns content", async () => {
        const mockResponse = {
            message: { content: '{"key_refs": ["GEN 1:1"]}' },
        };
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(mockResponse),
        }));

        const result = await callOllama("system", "user");
        expect(result).toBe('{"key_refs": ["GEN 1:1"]}');

        const call = fetch.mock.calls[0];
        expect(call[0]).toContain("/api/chat");
        const body = JSON.parse(call[1].body);
        expect(body.messages).toHaveLength(2);
        expect(body.format).toBe("json");
        expect(body.stream).toBe(false);
        expect(body.options.temperature).toBe(0.3);
    });

    it("throws on non-200 response", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
            ok: false,
            status: 500,
            text: () => Promise.resolve("Internal Server Error"),
        }));

        await expect(callOllama("system", "user")).rejects.toThrow("Ollama returned 500");
    });

    it("returns empty string when message content is missing", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ message: {} }),
        }));

        const result = await callOllama("system", "user");
        expect(result).toBe("");
    });
});
