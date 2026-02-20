import { describe, it, expect } from "vitest";
import {
    cleanUsfmInline,
    parseUsfmToVerseRecords,
} from "../../ingest/scripts/001_usfm_to_verses.mjs";

describe("USFM parser sanitization", () => {
    it("removes inline cross-reference blocks from 1ES-like content", () => {
        const usfm = [
            "\\id 1ES",
            "\\c 5",
            "\\v 7 \\x + \\xo 5:7 \\xt Ezra 2:1\\x*These are the of Judeans who came up from the captivity.",
        ].join("\n");

        const rows = parseUsfmToVerseRecords(usfm, {
            translation: "WEBU",
            sourceFile: "54-1ESengwebu.usfm",
        });

        expect(rows).toHaveLength(1);
        expect(rows[0].text_clean).toBe(
            "These are the of Judeans who came up from the captivity."
        );
        expect(rows[0].text_clean).not.toMatch(/\+\s*5:7/);
        expect(rows[0].text_clean).not.toContain("Ezra 2:1");
    });

    it("removes inline footnote payloads while keeping verse text around them", () => {
        const usfm = [
            "\\id 1ES",
            "\\c 5",
            "\\v 8 They returned to Jerusalem, \\f + \\fr 5:8 \\fqa Seralah.\\f*Zaraias, Resaias,\\f + \\fr 5:8 \\ft Or, \\fqa Enenis.\\f*Eneneus, Mardocheus.",
        ].join("\n");

        const rows = parseUsfmToVerseRecords(usfm, {
            translation: "WEBU",
            sourceFile: "54-1ESengwebu.usfm",
        });

        expect(rows).toHaveLength(1);
        expect(rows[0].text_clean).toContain("They returned to Jerusalem");
        expect(rows[0].text_clean).toContain("Zaraias, Resaias, Eneneus");
        expect(rows[0].text_clean).not.toMatch(/\+\s*5:8/);
        expect(rows[0].text_clean).not.toContain("Seralah.");
        expect(rows[0].text_clean).not.toContain("Or,");
    });

    it("drops WEBU inline footnote notes from cleaned text", () => {
        const raw =
            "He created them Adam.\\f + \\fr 5:2 \\ft \"Adam\" and \"Man\" are spelled the same in Hebrew.\\f*";
        const cleaned = cleanUsfmInline(raw);

        expect(cleaned).toBe("He created them Adam.");
        expect(cleaned).not.toContain("+ 5:2");
        expect(cleaned).not.toContain("spelled the same in Hebrew");
    });
});
