// server/services/rerank.js
// Evidence-based reranking for search candidates.

// ---------- Deuterocanonical book list (WEBU) ----------
// Used when includeDeutero=false to filter out these books.
export const DEUTERO_BOOKS = new Set([
  "TOB", "JDT", "ESG", // Tobit, Judith, Esther Greek
  "WIS", "SIR",         // Wisdom, Sirach
  "BAR", "LJE",         // Baruch, Letter of Jeremiah
  "S3Y", "SUS", "BEL",  // Additions to Daniel
  "1MA", "2MA",          // 1-2 Maccabees
  "1ES", "2ES",          // 1-2 Esdras
  "MAN", "PS2",          // Prayer of Manasseh, Psalm 151
  "3MA", "4MA",          // 3-4 Maccabees
]);

// ---------- Keyword evidence rules ----------
// Each rule has signals (query terms that activate the rule) and keywords
// (terms to look for in chunk text) for both languages.
// A rule fires when at least one signal (PT or EN) matches the query.

const KEYWORD_RULES = [
  {
    pt_signals: ["princípio", "criou", "criação", "criar", "início"],
    en_signals: ["beginning", "created", "creation", "create"],
    en_keywords: ["in the beginning", "created", "heavens", "earth", "creation"],
    pt_keywords: ["no princípio", "criou", "céus", "terra", "criação"],
  },
  {
    pt_signals: ["dilúvio", "arca", "noé"],
    en_signals: ["flood", "ark", "noah"],
    en_keywords: ["flood", "ark", "noah"],
    pt_keywords: ["dilúvio", "arca", "noé"],
  },
  {
    pt_signals: ["êxodo", "egito", "moisés", "faraó", "pragas"],
    en_signals: ["exodus", "egypt", "moses", "pharaoh", "plague"],
    en_keywords: ["egypt", "moses", "pharaoh", "plague", "exodus", "red sea"],
    pt_keywords: ["egito", "moisés", "faraó", "praga", "êxodo", "mar vermelho"],
  },
  {
    pt_signals: ["mandamento", "lei", "sinai"],
    en_signals: ["commandment", "law", "sinai", "statute"],
    en_keywords: ["commandment", "law", "sinai", "statute"],
    pt_keywords: ["mandamento", "lei", "sinai", "estatuto"],
  },
  {
    pt_signals: ["amor", "amar"],
    en_signals: ["love", "loved"],
    en_keywords: ["love", "loved", "lovingkindness"],
    pt_keywords: ["amor", "amou", "amado", "benignidade"],
  },
  {
    pt_signals: ["ressurreição", "ressuscitou", "ressuscitar", "tumba", "sepulcro"],
    en_signals: ["resurrection", "raised", "risen", "tomb", "grave"],
    en_keywords: ["resurrection", "raised", "risen", "tomb", "grave"],
    pt_keywords: ["ressurreição", "ressuscitou", "ressuscitado", "sepulcro", "sepultura"],
  },
  {
    pt_signals: ["cruz", "crucificado", "crucificação"],
    en_signals: ["cross", "crucified", "crucifixion"],
    en_keywords: ["cross", "crucified", "crucifixion"],
    pt_keywords: ["cruz", "crucificado", "crucificaram"],
  },
  {
    pt_signals: ["batismo", "batizar", "batizou"],
    en_signals: ["baptize", "baptized", "baptism"],
    en_keywords: ["baptize", "baptized", "baptism"],
    pt_keywords: ["batismo", "batizou", "batizado", "batizar"],
  },
  {
    pt_signals: ["oração", "orar", "rezar"],
    en_signals: ["prayer", "pray", "prayed"],
    en_keywords: ["prayer", "pray", "prayed"],
    pt_keywords: ["oração", "orar", "orou", "orai"],
  },
  {
    pt_signals: ["fé", "acreditar", "crer"],
    en_signals: ["faith", "believe", "believed"],
    en_keywords: ["faith", "believe", "believed"],
    pt_keywords: ["fé", "crer", "creu", "crê"],
  },
  {
    pt_signals: ["pecado", "pecar", "iniquidade"],
    en_signals: ["sin", "sinned", "iniquity", "transgression"],
    en_keywords: ["sin", "sinned", "iniquity", "transgression"],
    pt_keywords: ["pecado", "pecou", "iniquidade", "transgressão"],
  },
  {
    pt_signals: ["salvação", "salvar", "redenção"],
    en_signals: ["salvation", "save", "saved", "redemption", "redeem"],
    en_keywords: ["salvation", "save", "saved", "redemption", "redeem"],
    pt_keywords: ["salvação", "salvar", "salvou", "redenção", "remiu"],
  },
  {
    pt_signals: ["espírito", "espírito santo"],
    en_signals: ["spirit", "holy spirit"],
    en_keywords: ["spirit", "holy spirit"],
    pt_keywords: ["espírito", "espírito santo"],
  },
  {
    pt_signals: ["profecia", "profeta", "profetizar"],
    en_signals: ["prophecy", "prophet", "prophesied"],
    en_keywords: ["prophecy", "prophet", "prophesied"],
    pt_keywords: ["profecia", "profeta", "profetizou"],
  },
  {
    pt_signals: ["aliança", "pacto"],
    en_signals: ["covenant", "promise"],
    en_keywords: ["covenant", "promise"],
    pt_keywords: ["aliança", "pacto", "concerto"],
  },
  {
    pt_signals: ["graça", "misericórdia"],
    en_signals: ["grace", "mercy", "merciful"],
    en_keywords: ["grace", "mercy", "merciful"],
    pt_keywords: ["graça", "misericórdia", "misericordioso"],
  },
];

/**
 * Compute keyword-based evidence score for a candidate.
 * @param {string} textClean - chunk text (English or Portuguese)
 * @param {string} query - original query (Portuguese or English)
 * @returns {{ score: number, keyword_hits: string[], notes: string[] }}
 */
function computeEvidence(textClean, query) {
  const textLower = textClean.toLowerCase();
  const queryLower = query.toLowerCase();
  const keyword_hits = [];
  const notes = [];
  let weightedHits = 0;

  // Check signal-gated rules (fires when any PT or EN signal matches the query)
  for (const rule of KEYWORD_RULES) {
    const ptMatches = rule.pt_signals.filter((s) => queryLower.includes(s));
    const enMatches = (rule.en_signals || []).filter((s) => queryLower.includes(s));
    if (ptMatches.length === 0 && enMatches.length === 0) continue;
    const hitsBefore = keyword_hits.length;
    // Check both EN and PT keywords against the chunk text
    const allKeywords = [...rule.en_keywords, ...(rule.pt_keywords || [])];
    for (const kw of allKeywords) {
      const re = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (re.test(textLower)) {
        keyword_hits.push(kw);
        weightedHits += 1.0;
      }
    }
    if (keyword_hits.length > hitsBefore) {
      const matched = [...ptMatches, ...enMatches];
      notes.push(`Query signal matched: [${matched.join(", ")}]`);
    }
  }

  // Normalize to 0..1: soft cap at ~5 weighted hits
  const score = Math.min(weightedHits / 5, 1.0);

  return { score, keyword_hits, notes };
}

/**
 * Rerank candidates with evidence-based scoring.
 * @param {Array} candidates - hydrated candidates with text_clean and score (semantic)
 * @param {string} query - original query text
 * @param {"explorer"|"exact"} mode
 * @param {Map<string,number>} [trigramScores] - optional trigram similarities
 * @returns {Array} sorted results with final_score and evidence
 */
export function rerank(candidates, query, mode = "explorer", trigramScores = null) {
  const semanticWeight = mode === "exact" ? 0.55 : 0.75;
  const evidenceWeight = mode === "exact" ? 0.45 : 0.25;

  const results = candidates.map((c) => {
    const evidence = computeEvidence(c.text_clean, query);

    let evidenceScore = evidence.score;

    // In exact mode, blend trigram similarity if available
    if (mode === "exact" && trigramScores) {
      const trgm = trigramScores.get(c.chunk_id) ?? 0;
      if (trgm > 0) {
        evidenceScore = 0.6 * evidenceScore + 0.4 * trgm;
        evidence.notes.push(`trigram_sim=${trgm.toFixed(3)}`);
      }
    }

    const semantic_score = c.score;
    const final_score = semanticWeight * semantic_score + evidenceWeight * evidenceScore;

    return {
      chunk_id: c.chunk_id,
      translation: c.translation,
      ref_start: c.ref_start,
      ref_end: c.ref_end,
      book_id: c.book_id,
      chapter: c.chapter,
      verse_start: c.verse_start,
      verse_end: c.verse_end,
      semantic_score: parseFloat(semantic_score.toFixed(4)),
      evidence: {
        keyword_hits: evidence.keyword_hits,
        notes: evidence.notes,
      },
      evidence_score: parseFloat(evidenceScore.toFixed(4)),
      final_score: parseFloat(final_score.toFixed(4)),
      text_clean: c.text_clean,
    };
  });

  results.sort((a, b) => b.final_score - a.final_score);
  return results;
}
