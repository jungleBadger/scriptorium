// Mapping from OSIS book abbreviations (used in OpenBible data) to
// 3-letter USFM book IDs (used in our `verses` table).

const osisToUsfm = {
    // Pentateuch
    Gen: "GEN", Exod: "EXO", Lev: "LEV", Num: "NUM", Deut: "DEU",
    // Historical
    Josh: "JOS", Judg: "JDG", Ruth: "RUT",
    "1Sam": "1SA", "2Sam": "2SA", "1Kgs": "1KI", "2Kgs": "2KI",
    "1Chr": "1CH", "2Chr": "2CH", Ezra: "EZR", Neh: "NEH", Esth: "EST",
    // Poetic
    Job: "JOB", Ps: "PSA", Prov: "PRO", Eccl: "ECC", Song: "SNG",
    // Major Prophets
    Isa: "ISA", Jer: "JER", Lam: "LAM", Ezek: "EZK", Dan: "DAN",
    // Minor Prophets
    Hos: "HOS", Joel: "JOL", Amos: "AMO", Obad: "OBA", Jonah: "JON",
    Mic: "MIC", Nah: "NAM", Hab: "HAB", Zeph: "ZEP", Hag: "HAG",
    Zech: "ZEC", Mal: "MAL",
    // NT
    Matt: "MAT", Mark: "MRK", Luke: "LUK", John: "JHN",
    Acts: "ACT", Rom: "ROM",
    "1Cor": "1CO", "2Cor": "2CO",
    Gal: "GAL", Eph: "EPH", Phil: "PHP", Col: "COL",
    "1Thess": "1TH", "2Thess": "2TH",
    "1Tim": "1TI", "2Tim": "2TI", Titus: "TIT", Phlm: "PHM",
    Heb: "HEB", Jas: "JAS",
    "1Pet": "1PE", "2Pet": "2PE",
    "1John": "1JN", "2John": "2JN", "3John": "3JN",
    Jude: "JUD", Rev: "REV",
    // Deuterocanonical / Apocrypha
    Tob: "TOB", Jdt: "JDT", AddEsth: "ESG", Wis: "WIS", Sir: "SIR",
    Bar: "BAR", EpJer: "LJE", PrAzar: "S3Y", Sus: "SUS", Bel: "BEL",
    "1Macc": "1MA", "2Macc": "2MA", "3Macc": "3MA", "4Macc": "4MA",
    PrMan: "MAN", "1Esd": "1ES", "2Esd": "2ES", AddPs: "PS2",
};

/**
 * Convert an OSIS reference like "2Kgs.5.12" to { book_id, chapter, verse }.
 * Returns null if the book is unknown.
 */
export function parseOsis(osis) {
    const parts = osis.split(".");
    if (parts.length < 3) return null;
    const book_id = osisToUsfm[parts[0]];
    if (!book_id) return null;
    return { book_id, chapter: parseInt(parts[1], 10), verse: parseInt(parts[2], 10) };
}

/**
 * Parse a USX-style reference like "2KI 5:12" to { book_id, chapter, verse }.
 * Returns null on failure.
 */
export function parseUsx(usx) {
    const m = usx.match(/^(\S+)\s+(\d+):(\d+)$/);
    if (!m) return null;
    return { book_id: m[1], chapter: parseInt(m[2], 10), verse: parseInt(m[3], 10) };
}
