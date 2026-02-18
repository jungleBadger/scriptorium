// server/data/bookNames.js
// Static mapping of USFM book IDs to display names and testament.
// Canonical order matches Protestant canon (66 books).

export const BOOK_ORDER = [
  // OT – Pentateuch
  { book_id: "GEN", name: "Genesis", testament: "OT" },
  { book_id: "EXO", name: "Exodus", testament: "OT" },
  { book_id: "LEV", name: "Leviticus", testament: "OT" },
  { book_id: "NUM", name: "Numbers", testament: "OT" },
  { book_id: "DEU", name: "Deuteronomy", testament: "OT" },
  // OT – Historical
  { book_id: "JOS", name: "Joshua", testament: "OT" },
  { book_id: "JDG", name: "Judges", testament: "OT" },
  { book_id: "RUT", name: "Ruth", testament: "OT" },
  { book_id: "1SA", name: "1 Samuel", testament: "OT" },
  { book_id: "2SA", name: "2 Samuel", testament: "OT" },
  { book_id: "1KI", name: "1 Kings", testament: "OT" },
  { book_id: "2KI", name: "2 Kings", testament: "OT" },
  { book_id: "1CH", name: "1 Chronicles", testament: "OT" },
  { book_id: "2CH", name: "2 Chronicles", testament: "OT" },
  { book_id: "EZR", name: "Ezra", testament: "OT" },
  { book_id: "NEH", name: "Nehemiah", testament: "OT" },
  { book_id: "EST", name: "Esther", testament: "OT" },
  // OT – Poetic
  { book_id: "JOB", name: "Job", testament: "OT" },
  { book_id: "PSA", name: "Psalms", testament: "OT" },
  { book_id: "PRO", name: "Proverbs", testament: "OT" },
  { book_id: "ECC", name: "Ecclesiastes", testament: "OT" },
  { book_id: "SNG", name: "Song of Solomon", testament: "OT" },
  // OT – Major Prophets
  { book_id: "ISA", name: "Isaiah", testament: "OT" },
  { book_id: "JER", name: "Jeremiah", testament: "OT" },
  { book_id: "LAM", name: "Lamentations", testament: "OT" },
  { book_id: "EZK", name: "Ezekiel", testament: "OT" },
  { book_id: "DAN", name: "Daniel", testament: "OT" },
  // OT – Minor Prophets
  { book_id: "HOS", name: "Hosea", testament: "OT" },
  { book_id: "JOL", name: "Joel", testament: "OT" },
  { book_id: "AMO", name: "Amos", testament: "OT" },
  { book_id: "OBA", name: "Obadiah", testament: "OT" },
  { book_id: "JON", name: "Jonah", testament: "OT" },
  { book_id: "MIC", name: "Micah", testament: "OT" },
  { book_id: "NAM", name: "Nahum", testament: "OT" },
  { book_id: "HAB", name: "Habakkuk", testament: "OT" },
  { book_id: "ZEP", name: "Zephaniah", testament: "OT" },
  { book_id: "HAG", name: "Haggai", testament: "OT" },
  { book_id: "ZEC", name: "Zechariah", testament: "OT" },
  { book_id: "MAL", name: "Malachi", testament: "OT" },
  // NT – Gospels
  { book_id: "MAT", name: "Matthew", testament: "NT" },
  { book_id: "MRK", name: "Mark", testament: "NT" },
  { book_id: "LUK", name: "Luke", testament: "NT" },
  { book_id: "JHN", name: "John", testament: "NT" },
  // NT – History
  { book_id: "ACT", name: "Acts", testament: "NT" },
  // NT – Pauline Epistles
  { book_id: "ROM", name: "Romans", testament: "NT" },
  { book_id: "1CO", name: "1 Corinthians", testament: "NT" },
  { book_id: "2CO", name: "2 Corinthians", testament: "NT" },
  { book_id: "GAL", name: "Galatians", testament: "NT" },
  { book_id: "EPH", name: "Ephesians", testament: "NT" },
  { book_id: "PHP", name: "Philippians", testament: "NT" },
  { book_id: "COL", name: "Colossians", testament: "NT" },
  { book_id: "1TH", name: "1 Thessalonians", testament: "NT" },
  { book_id: "2TH", name: "2 Thessalonians", testament: "NT" },
  { book_id: "1TI", name: "1 Timothy", testament: "NT" },
  { book_id: "2TI", name: "2 Timothy", testament: "NT" },
  { book_id: "TIT", name: "Titus", testament: "NT" },
  { book_id: "PHM", name: "Philemon", testament: "NT" },
  // NT – General Epistles
  { book_id: "HEB", name: "Hebrews", testament: "NT" },
  { book_id: "JAS", name: "James", testament: "NT" },
  { book_id: "1PE", name: "1 Peter", testament: "NT" },
  { book_id: "2PE", name: "2 Peter", testament: "NT" },
  { book_id: "1JN", name: "1 John", testament: "NT" },
  { book_id: "2JN", name: "2 John", testament: "NT" },
  { book_id: "3JN", name: "3 John", testament: "NT" },
  { book_id: "JUD", name: "Jude", testament: "NT" },
  // NT – Apocalyptic
  { book_id: "REV", name: "Revelation", testament: "NT" },
];

// Lookup by book_id for O(1) access
export const BOOK_MAP = Object.fromEntries(
  BOOK_ORDER.map((b) => [b.book_id, b])
);
