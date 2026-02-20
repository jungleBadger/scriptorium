import { describe, it, expect } from "vitest";
import {
    buildChapterPrompt,
    estimateExplanationWordPolicy,
    evaluateNoMetaTalk,
    evaluateGrounding,
    parseChapterOutput,
} from "../../ingest/scripts/012_enrich_chapters_explanation_ollama.mjs";

const LIST_HEAVY_PAYLOAD = {
    translation: "WEBU",
    book_id: "JOS",
    chapter: 15,
    verses: [
        { verse: 1, ref: "JOS 15:1", text: "The boundary of Judah went along the border of Edom at the southern edge of the Negev." },
        { verse: 13, ref: "JOS 15:13", text: "To Caleb son of Jephunneh he gave Kiriath Arba, that is Hebron." },
        { verse: 20, ref: "JOS 15:20", text: "This is the inheritance of the tribe of Judah according to their clans." },
        { verse: 21, ref: "JOS 15:21", text: "The cities of the tribe of Judah in the extreme south were Kabzeel, Eder, Jagur." },
    ],
    entities: [
        { canonical_name: "Judah" },
        { canonical_name: "Caleb" },
        { canonical_name: "Hebron" },
    ],
};

describe("chapter explanation grounding guardrails", () => {
    it("appends list-heavy instruction when chapter is list-heavy", () => {
        const template = "Aim for roughly {{WORD_TARGET}} words.\nChapter payload:\n{{CHAPTER_PAYLOAD_JSON}}";
        const prompt = buildChapterPrompt(template, LIST_HEAVY_PAYLOAD, 220, { list_heavy_ratio: 0.45, list_heavy_semantic: true });
        expect(prompt).toContain("chapter is list-heavy");
        expect(prompt).toContain("what is being listed");
    });

    it("flags ungrounded list-heavy explanation with invented narrative phrases", () => {
        const bad = "Joshua's leadership is central here, with Levitical priests maintaining order and preparing for conquest.";
        const result = evaluateGrounding(bad, LIST_HEAVY_PAYLOAD, { listHeavy: true });
        expect(result.isGrounded).toBe(false);
        expect(result.disallowed_phrase_hit).toBe(true);
    });

    it("accepts grounded list-heavy explanation and keeps JSON contract parseable", () => {
        const good = "Judah's inheritance is described through boundaries and city groups, moving from the southern border near Edom to listed settlements, while Caleb receives Hebron (v. 1, v. 13, v. 20-21).";
        const grounding = evaluateGrounding(good, LIST_HEAVY_PAYLOAD, { listHeavy: true });
        expect(grounding.isGrounded).toBe(true);

        const raw = JSON.stringify({ chapter_explanation: good });
        const parsed = parseChapterOutput(raw);
        expect(Object.keys(parsed.output_json)).toEqual(["chapter_explanation"]);
        expect(parsed.chapter_explanation).toContain("Judah");
        expect(parsed.chapter_explanation.toLowerCase()).toContain("boundar");
    });

    it("keeps parseChapterOutput focused on JSON shape and allows plain phrasing like each entry", () => {
        const raw = JSON.stringify({
            chapter_explanation: "The genealogy traces Adam to Noah, and each entry repeatedly notes ages, fathers, years, and death before moving to the next generation (v. 3-32).",
        });
        const parsed = parseChapterOutput(raw);
        expect(parsed.chapter_explanation.toLowerCase()).toContain("each entry");
    });

    it("fails meta-talk evaluator for payload-ish framing", () => {
        const badSamples = [
            "This JSON object contains the chapter explanation and supporting notes.",
            "The payload includes names and events from the passage.",
            "The verses array lists the content in sequence.",
        ];

        for (const sample of badSamples) {
            const result = evaluateNoMetaTalk(sample);
            expect(result.ok).toBe(false);
            expect(Array.isArray(result.hits)).toBe(true);
            expect(result.hits.length).toBeGreaterThan(0);
        }
    });

    it("passes meta-talk evaluator for normal genealogy explanation language", () => {
        const good = "Genesis 5 traces Adam, Seth, and Noah through ten generations, repeatedly noting ages, father-son succession, and lifespan totals before each death, highlighting continuity from creation to the flood era (v. 3-32).";
        const result = evaluateNoMetaTalk(good);
        expect(result.ok).toBe(true);
    });

    it("computes dynamic narrative word policy from chapter word estimate", () => {
        const payload = {
            verses: [{ text: "w ".repeat(800).trim() }],
        };
        const policy = estimateExplanationWordPolicy(payload, { listHeavy: false });
        expect(policy.chapter_words).toBe(800);
        expect(policy.target_words).toBe(124); // round(60 + 0.08*800)
        expect(policy.min_words).toBe(84);
        expect(policy.max_words).toBe(164);
        expect(policy.target_mode).toBe("dynamic");
    });

    it("computes dynamic list-heavy word policy and supports target override", () => {
        const payload = {
            verses: [{ text: "w ".repeat(500).trim() }],
        };
        const dynamicPolicy = estimateExplanationWordPolicy(payload, { listHeavy: true });
        // round(50 + 0.06*500) = 80, clamped to min 95 for list-heavy chapters
        expect(dynamicPolicy.target_words).toBe(95);
        expect(dynamicPolicy.min_words).toBe(70);
        expect(dynamicPolicy.max_words).toBe(135);

        const overridePolicy = estimateExplanationWordPolicy(payload, {
            listHeavy: true,
            overrideTarget: 170,
        });
        expect(overridePolicy.target_mode).toBe("override");
        expect(overridePolicy.target_words).toBe(170);
        expect(overridePolicy.min_words).toBe(130);
        expect(overridePolicy.max_words).toBe(210);
    });

    it("allows concise but grounded narrative outputs for medium chapters", () => {
        const payload = {
            verses: [{ text: "w ".repeat(780).trim() }],
        };
        const policy = estimateExplanationWordPolicy(payload, { listHeavy: false });
        expect(policy.target_words).toBe(122);
        expect(policy.min_words).toBe(82);
    });
});
