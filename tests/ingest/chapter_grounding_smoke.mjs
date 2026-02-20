import assert from "node:assert/strict";
import {
    buildChapterPrompt,
    evaluateGrounding,
    parseChapterOutput,
} from "../../ingest/scripts/012_enrich_chapters_explanation_ollama.mjs";

const listHeavyPayload = {
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

const template = "Aim for roughly {{WORD_TARGET}} words.\nChapter payload:\n{{CHAPTER_PAYLOAD_JSON}}";
const prompt = buildChapterPrompt(template, listHeavyPayload, 220, {
    list_heavy_ratio: 0.45,
    list_heavy_semantic: true,
});
assert.ok(prompt.includes("list-heavy"));

const bad = "Joshua's leadership is central here, with Levitical priests maintaining order and preparing for conquest.";
const badResult = evaluateGrounding(bad, listHeavyPayload, { listHeavy: true });
assert.equal(badResult.isGrounded, false);

const noRef = "Judah's inheritance is presented through borders and city lists, moving along southern boundaries and naming settlements, while Caleb receives Hebron.";
const noRefResult = evaluateGrounding(noRef, listHeavyPayload, { listHeavy: true });
assert.equal(noRefResult.isGrounded, false);

const cueHeavy = "The chapter emphasizes unity under Joshua with divine assurance and God's presence as they prepare for campaign.";
const cueHeavyResult = evaluateGrounding(cueHeavy, listHeavyPayload, { listHeavy: true });
assert.equal(cueHeavyResult.isGrounded, false);

const good = "Judah's inheritance is presented through boundaries and city lists, moving along southern borders and grouped settlements, while Caleb receives Hebron as an allotment (v. 1, v. 13, v. 20-21).";
const goodResult = evaluateGrounding(good, listHeavyPayload, { listHeavy: true });
assert.equal(goodResult.isGrounded, true);

const parsed = parseChapterOutput(JSON.stringify({ chapter_explanation: good }));
assert.deepEqual(Object.keys(parsed.output_json), ["chapter_explanation"]);

console.log("chapter_grounding_smoke: OK");
