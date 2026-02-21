<script setup>
import { computed, nextTick, onMounted, reactive, ref, watch } from "vue";
import {
  ask,
  getBooks,
  getChapter,
  getChapterContext,
  getEntityById,
  getApiErrorMessage,
  search,
  searchEntities,
} from "./services/api.js";
import ReaderPane from "./components/ReaderPane.vue";
import ContextPane from "./components/ContextPane.vue";
import LibrarySidebar from "./components/LibrarySidebar.vue";
import DrawerShell from "./components/DrawerShell.vue";
import { useBreakpoint } from "./composables/useBreakpoint.js";
import { PT_BR_BOOK_NAMES } from "./data/bookNamesPtBr.js";

const AVAILABLE_TRANSLATIONS = ["WEBU", "PT1911"];

// ── Breakpoints ────────────────────────────────────────────────────────────
const { isMobile, isTablet, isDesktop } = useBreakpoint();

// ── Layout state ───────────────────────────────────────────────────────────
const LS_LAYOUT = "scriptorium-layout";

const libraryPinned  = ref(false); // true = Library shown as column (desktop/tablet)
const insightsPinned = ref(true);  // true = Insights shown as column (desktop/tablet)
const libraryOpen    = ref(false); // true = Library drawer open
const insightsOpen   = ref(false); // true = Insights drawer open

function loadLayoutPrefs() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_LAYOUT) || "{}");
    if (typeof s.libraryPinned  === "boolean") libraryPinned.value  = s.libraryPinned;
    if (typeof s.insightsPinned === "boolean") insightsPinned.value = s.insightsPinned;
  } catch {}
}

watch([libraryPinned, insightsPinned], () => {
  localStorage.setItem(
    LS_LAYOUT,
    JSON.stringify({ libraryPinned: libraryPinned.value, insightsPinned: insightsPinned.value })
  );
});

// ── Computed layout visibility ─────────────────────────────────────────────
const showLibraryColumn = computed(() => {
  if (isMobile.value) return false;
  return libraryPinned.value;
});

const showInsightsColumn = computed(() => {
  if (isMobile.value) return false;
  if (!insightsPinned.value) return false;
  // Tablet can show at most 2 columns: if library pinned, insights is drawer
  if (isTablet.value && libraryPinned.value) return false;
  return true;
});

const libraryDrawerOpen = computed(() => {
  // Drawer not needed when column is shown
  if (showLibraryColumn.value) return false;
  return libraryOpen.value;
});

const insightsDrawerOpen = computed(() => {
  if (showInsightsColumn.value) return false;
  return insightsOpen.value;
});

const gridClass = computed(() => {
  const lib = showLibraryColumn.value;
  const ins = showInsightsColumn.value;
  if (lib && ins)  return "workspace-grid--3col";
  if (lib && !ins) return "workspace-grid--lib-reader";
  if (!lib && ins) return "workspace-grid--reader-ins";
  return "workspace-grid--reader";
});

// Track active (pressed) state for toggle buttons
const libraryActive = computed(() => showLibraryColumn.value || libraryDrawerOpen.value);
const insightsActive = computed(() => showInsightsColumn.value || insightsDrawerOpen.value);

// ── Toggle handlers ────────────────────────────────────────────────────────
function onToggleLibrary() {
  if (isDesktop.value) {
    libraryPinned.value = !libraryPinned.value;
    if (!libraryPinned.value) libraryOpen.value = false;
  } else {
    libraryOpen.value = !libraryOpen.value;
  }
}

function onToggleInsights() {
  if (isDesktop.value || isTablet.value) {
    insightsPinned.value = !insightsPinned.value;
    if (!insightsPinned.value) insightsOpen.value = false;
  } else {
    insightsOpen.value = !insightsOpen.value;
  }
}

function onInsightsClearContext() {
  onClearContext();
  // On mobile, also close the drawer
  if (isMobile.value) insightsOpen.value = false;
}

// ── Reader state ──────────────────────────────────────────────────────────
const translation = ref("WEBU");
const books = ref([]);
const bookId = ref("");
const chapter = ref(1);
const chapterData = ref(null);
const readerLoading = ref(false);
const readerError = ref(null);
const activeVerse = ref(null);
const selectedEntityId = ref(null);

// ── Reader settings ────────────────────────────────────────────────────────
const readerSettings = reactive({ fontSize: 'md', lineSpacing: 'normal', font: 'serif', theme: 'light' });

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const root = document.documentElement;
  const themes = {
    light: { '--ink':'#1e1612','--muted':'#695e57','--paper':'#fff9f2','--card':'#fffdf8','--line':'#e7d7c6','--accent':'#ad3f2b','--accent-soft':'#f6d8c6' },
    sepia: { '--ink':'#2c1f14','--muted':'#7a6250','--paper':'#f4ead8','--card':'#f9f2e2','--line':'#d9c9ae','--accent':'#8b3a20','--accent-soft':'#f0d8bf' },
    dark:  { '--ink':'#e8ddd4','--muted':'#9e8e84','--paper':'#1a1614','--card':'#211e1b','--line':'#3a302a','--accent':'#d46e55','--accent-soft':'#3d241c' },
  };
  Object.entries(themes[theme] ?? themes.light).forEach(([k, v]) => root.style.setProperty(k, v));
}

function applySettingsCSSVars() {
  const root = document.documentElement;
  root.style.setProperty('--reader-font-size',  { sm:'0.95rem', md:'1.12rem', lg:'1.25rem', xl:'1.4rem' }[readerSettings.fontSize]);
  root.style.setProperty('--reader-line-height', { normal:'1.9', relaxed:'2.15', loose:'2.5' }[readerSettings.lineSpacing]);
  root.style.setProperty('--reader-font-family', readerSettings.font === 'sans' ? 'var(--ui)' : 'var(--reader)');
  applyTheme(readerSettings.theme);
}

function onSettingsChange(updated) { Object.assign(readerSettings, updated); }

// ── Search / explore options ───────────────────────────────────────────────
const quickQuery = ref("");
const isExploring = ref(false);
const exploreError = ref(null);
const showAdvanced = ref(false);
const mode = ref("explorer");
const topk = ref(8);
const includeDeutero = ref(true);
const highlightEntities = ref(true);

// ── Panel navigation stack ─────────────────────────────────────────────────
const panelStack = ref([]);
const currentView = computed(() => panelStack.value[panelStack.value.length - 1] ?? null);
const canGoBack = computed(() => panelStack.value.length > 1);
const stackDepth = computed(() => panelStack.value.length);

// ── Stale-request guards ───────────────────────────────────────────────────
let chapterRequestToken = 0;
let chapterContextToken = 0;

// ── Position memory ────────────────────────────────────────────────────────
const chapterVerseMemory = new Map();
const bookPositionMemory = new Map();

// ── Computed ───────────────────────────────────────────────────────────────
const activeBook = computed(
  () => books.value.find((b) => b.book_id === bookId.value) || null
);
const activeBookName = computed(() =>
  activeBook.value
    ? getDisplayBookName(activeBook.value.book_id, activeBook.value.name)
    : bookId.value
);
const chapterOptions = computed(() => {
  const total = activeBook.value?.chapters || 0;
  return Array.from({ length: total }, (_, i) => i + 1);
});
const verseOptions = computed(() =>
  (chapterData.value?.verses || []).map((v) => v.verse)
);
const activeVerseAnchorKey = computed(() => {
  if (activeVerse.value == null || !bookId.value) return null;
  return `${translation.value}:${bookId.value}:${chapter.value}:${activeVerse.value}`;
});

const selectedChapterEntity = computed(() => {
  if (!Number.isFinite(selectedEntityId.value)) return null;
  const baseView = panelStack.value[0];
  if (!baseView || baseView.type !== "chapterContext" || baseView.status !== "ready") return null;
  const entities = baseView.data?.entities || [];
  return entities.find((entity) => entity.id === selectedEntityId.value) || null;
});

const selectedEntityFromStack = computed(() => {
  if (!Number.isFinite(selectedEntityId.value)) return null;
  for (let i = panelStack.value.length - 1; i >= 0; i -= 1) {
    const view = panelStack.value[i];
    if (!view || view.type !== "entityDetail" || view.status !== "ready") continue;
    if (Number(view.data?.id) === selectedEntityId.value) return view.data;
  }
  return null;
});

const selectedEntitySource = computed(
  () => selectedChapterEntity.value || selectedEntityFromStack.value || null
);

const selectedEntityTerms = computed(() => {
  const selectedEntity = selectedEntitySource.value;
  if (!selectedEntity) return [];
  const candidates = [selectedEntity.canonical_name, ...(selectedEntity.aliases || [])];
  const seen = new Set();
  const terms = [];
  for (const candidate of candidates) {
    const term = String(candidate || "").trim();
    if (!term) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
  }
  return terms;
});

const selectedEntityVerses = computed(() => {
  const chapterEntity = selectedChapterEntity.value;
  if (Array.isArray(chapterEntity?.chapter_verses)) {
    return chapterEntity.chapter_verses;
  }

  const detailEntity = selectedEntityFromStack.value;
  if (!Array.isArray(detailEntity?.verses)) return [];

  const verses = [];
  for (const verse of detailEntity.verses) {
    if (verse?.book_id !== bookId.value) continue;
    if (Number(verse?.chapter) !== chapter.value) continue;
    const verseNumber = Number(verse?.verse);
    if (!Number.isFinite(verseNumber)) continue;
    verses.push(verseNumber);
  }
  return verses;
});

const activeEntityHighlightTerms = computed(() => {
  if (!highlightEntities.value) return [];
  return selectedEntityTerms.value;
});

const displayBooks = computed(() =>
  books.value.map(b => ({ ...b, displayName: getDisplayBookName(b.book_id, b.name) }))
);

// ── Lifecycle ──────────────────────────────────────────────────────────────
onMounted(async () => {
  loadLayoutPrefs();
  const saved = localStorage.getItem('scriptorium-reader-settings');
  if (saved) try { Object.assign(readerSettings, JSON.parse(saved)); } catch {}
  applySettingsCSSVars();
  await initializeReader();
});

watch(readerSettings, () => {
  localStorage.setItem('scriptorium-reader-settings', JSON.stringify({ ...readerSettings }));
  applySettingsCSSVars();
}, { deep: true });

watch(translation, async (next, prev) => {
  if (next !== prev) await initializeReader();
});

watch(activeVerseAnchorKey, (nextAnchorKey) => {
  if (nextAnchorKey) {
    rememberPosition(bookId.value, chapter.value, activeVerse.value);
  }
});

// ── Reader ─────────────────────────────────────────────────────────────────
async function initializeReader() {
  readerLoading.value = true;
  readerError.value = null;
  activeVerse.value = null;
  panelStack.value = [];

  try {
    const booksPayload = await getBooks(translation.value);
    books.value = booksPayload.books || [];

    if (!books.value.length) {
      bookId.value = "";
      chapterData.value = null;
      return;
    }

    const hasCurrentBook = books.value.some((b) => b.book_id === bookId.value);
    if (!hasCurrentBook) {
      bookId.value = books.value[0].book_id;
      chapter.value = 1;
    }

    const currentBook = books.value.find((b) => b.book_id === bookId.value);
    if (currentBook && chapter.value > currentBook.chapters) {
      chapter.value = currentBook.chapters;
    }

    await loadChapter(bookId.value, chapter.value);
  } catch (err) {
    readerError.value = getApiErrorMessage(err, { context: "books" });
    chapterData.value = null;
  } finally {
    readerLoading.value = false;
  }
}

async function loadChapter(nextBookId, nextChapter, { focusVerse = null } = {}) {
  const requestToken = ++chapterRequestToken;
  readerLoading.value = true;
  readerError.value = null;
  selectedEntityId.value = null;

  try {
    const payload = await getChapter(nextBookId, nextChapter, translation.value);
    if (requestToken !== chapterRequestToken) return;

    bookId.value = nextBookId;
    chapter.value = nextChapter;
    chapterData.value = payload;

    const verses = payload.verses || [];
    const firstVerse = verses[0]?.verse ?? null;
    let nextActiveVerse = null;

    if (typeof focusVerse === "string" && focusVerse.toLowerCase() === "last") {
      nextActiveVerse = verses[verses.length - 1]?.verse ?? firstVerse;
    } else if (focusVerse != null) {
      nextActiveVerse = verses.some((v) => v.verse === focusVerse) ? focusVerse : firstVerse;
    } else if (activeVerse.value != null) {
      nextActiveVerse = verses.some((v) => v.verse === activeVerse.value) ? activeVerse.value : null;
    }

    activeVerse.value = nextActiveVerse;
    if (nextActiveVerse != null) {
      rememberPosition(nextBookId, nextChapter, nextActiveVerse);
    }

    void loadChapterContextView(nextBookId, nextChapter);
  } catch (err) {
    if (requestToken !== chapterRequestToken) return;
    readerError.value = getApiErrorMessage(err, { context: "chapter" });
    chapterData.value = null;
  } finally {
    if (requestToken === chapterRequestToken) readerLoading.value = false;
  }
}

// ── Panel navigation ───────────────────────────────────────────────────────
async function loadChapterContextView(nextBookId, nextChapter) {
  const token = ++chapterContextToken;
  const anchor = {
    translation: translation.value,
    book_id: nextBookId,
    chapter: nextChapter,
    verse: null,
    reference: `${nextBookId} ${nextChapter}`,
  };
  const view = reactive({
    type: "chapterContext",
    title: `${nextBookId} ${nextChapter}`,
    anchor,
    status: "loading",
    error: null,
    data: null,
  });
  panelStack.value = [view];

  try {
    const payload = await getChapterContext(nextBookId, nextChapter, translation.value);
    if (token !== chapterContextToken) return;
    view.status = "ready";
    view.data = payload;
  } catch (err) {
    if (token !== chapterContextToken) return;
    view.status = "error";
    view.error = getApiErrorMessage(err, { context: "chapterContext" });
  }
}

async function openEntityDetail(entityId, name, anchor) {
  const view = reactive({
    type: "entityDetail",
    title: name || `#${entityId}`,
    anchor: anchor || buildAnchor(),
    status: "loading",
    error: null,
    data: null,
  });
  panelStack.value.push(view);

  try {
    const payload = await getEntityById(entityId);
    view.status = "ready";
    view.title = payload.canonical_name;
    view.data = payload;
  } catch (err) {
    view.status = "error";
    view.error = getApiErrorMessage(err, { context: "entityDetail" });
  }
}

async function runSearch(query, anchor, { includeEntities = true, prefetchedEntities = null } = {}) {
  const safeTopk = Math.min(100, Math.max(1, Math.trunc(Number(topk.value) || 8)));
  topk.value = safeTopk;
  const label = query.length > 28 ? `${query.slice(0, 28)}\u2026` : query;
  const view = reactive({
    type: "parallelSearch",
    title: `\u201C${label}\u201D`,
    anchor: anchor || buildAnchor(),
    status: "loading",
    error: null,
    data: null,
    query,
  });
  panelStack.value.push(view);

  try {
    const passageSearch = () =>
      search({
        q: query,
        topk: safeTopk,
        mode: mode.value,
        includeDeutero: includeDeutero.value,
        translation: translation.value,
      });

    let passagePayload;
    let entityPayload = includeEntities ? prefetchedEntities : null;
    if (includeEntities && !entityPayload) {
      [passagePayload, entityPayload] = await Promise.all([
        passageSearch(),
        searchEntities({ q: query, limit: 40 }),
      ]);
    } else {
      passagePayload = await passageSearch();
    }

    const { people, places } = includeEntities
      ? splitEntityMatches(entityPayload?.results || [])
      : { people: [], places: [] };

    view.status = "ready";
    view.data = {
      passages: passagePayload.results || [],
      people,
      places,
    };
    view.total = passagePayload.total || 0;
    view.entityTotal = entityPayload?.total ?? people.length + places.length;
    view.query = passagePayload.query;
    view.mode = passagePayload.mode;
    view.includeDeutero = passagePayload.includeDeutero;
    return true;
  } catch (err) {
    const message = getApiErrorMessage(err, { context: "search" });
    view.status = "error";
    view.error = message;
    return false;
  }
}

function getActiveEntityIdsForAsk() {
  const selectedEntity = selectedEntitySource.value;
  if (!selectedEntity) return [];

  const ids = [];
  const numericId = Number(selectedEntity.id);
  if (Number.isFinite(numericId)) ids.push(String(numericId));

  const typePrefix = String(selectedEntity.type || "entity").split(".")[0] || "entity";
  const sourceId = String(selectedEntity.source_id || "").trim();
  if (sourceId) ids.push(`${typePrefix}:${sourceId}`);

  return [...new Set(ids)];
}

function getAskAnchorVerse() {
  if (Number.isFinite(activeVerse.value)) return activeVerse.value;
  const firstChapterVerse = Number(chapterData.value?.verses?.[0]?.verse);
  return Number.isFinite(firstChapterVerse) ? firstChapterVerse : 1;
}

async function runAsk(query, anchor) {
  const safePassages = Math.min(40, Math.max(1, Math.trunc(Number(topk.value) || 8)));
  topk.value = safePassages;
  const label = query.length > 28 ? `${query.slice(0, 28)}\u2026` : query;
  const view = reactive({
    type: "askResponse",
    title: `\u201C${label}\u201D`,
    anchor: anchor || buildAnchor(),
    status: "loading",
    error: null,
    data: null,
    query,
  });
  panelStack.value.push(view);

  try {
    const payload = await ask({
      question: query,
      translation: translation.value,
      book: bookId.value,
      chapter: chapter.value,
      verse: getAskAnchorVerse(),
      active_entity_ids: getActiveEntityIdsForAsk(),
      k_entities: 12,
      k_passages: safePassages,
    });

    view.status = "ready";
    view.data = payload;
    return true;
  } catch (err) {
    const message = getApiErrorMessage(err, { context: "ask" });
    view.status = "error";
    view.error = message;
    exploreError.value = message;
    return false;
  }
}

function goBack() {
  if (panelStack.value.length <= 1) return;
  const popped = panelStack.value.pop();
  if (popped?.type === "entityDetail") {
    selectedEntityId.value = null;
  }
}

function onClearContext() {
  if (!panelStack.value.length) return;
  panelStack.value = [];
  selectedEntityId.value = null;
}

function onSelectEntity(payload) {
  const entityId = Number(payload?.entityId);
  if (!Number.isFinite(entityId)) {
    selectedEntityId.value = null;
    return;
  }
  selectedEntityId.value = entityId;
}

// ── Navigation helpers ─────────────────────────────────────────────────────
async function onBookChange(event) {
  const nextBook = event.target.value;
  if (!nextBook) return;
  const remembered = getRememberedBookPosition(nextBook);
  const nextBookMeta = books.value.find((b) => b.book_id === nextBook);
  const maxChapters = nextBookMeta?.chapters || 1;
  const targetChapter = Math.max(1, Math.min(maxChapters, Number(remembered?.chapter) || 1));
  const targetVerse =
    Number.isFinite(remembered?.verse) && remembered.verse > 0 ? remembered.verse : 1;
  await loadChapter(nextBook, targetChapter, { focusVerse: targetVerse });
}

async function onChapterChange(event) {
  const nextChapter = Number(event.target.value);
  if (!Number.isFinite(nextChapter)) return;
  const rememberedVerse = getRememberedVerse(bookId.value, nextChapter);
  await loadChapter(bookId.value, nextChapter, { focusVerse: rememberedVerse ?? 1 });
}

function onQuickQueryChange(value) {
  quickQuery.value = value;
  if (exploreError.value) exploreError.value = null;
}

async function onChapterStep(direction) {
  if (readerLoading.value) return;
  if (direction < 0 && chapterData.value?.prev) {
    await onNavigate("prev");
    return;
  }
  if (direction > 0 && chapterData.value?.next) {
    await onNavigate("next");
  }
}

function onVerseChange(event) {
  const value = event.target.value;
  if (!value) {
    activeVerse.value = null;
    return;
  }
  const verseNumber = Number(value);
  if (!Number.isFinite(verseNumber)) return;
  activeVerse.value = verseNumber;
}

function onSelectVerse(verse) {
  activeVerse.value = activeVerse.value === verse ? null : verse;
}

function onActivateVerse(verse) {
  const verseNumber = Number(verse);
  if (!Number.isFinite(verseNumber)) return;
  activeVerse.value = verseNumber;
}

function onClearSelection() {
  activeVerse.value = null;
}

async function onVerseStep(payload) {
  const direction =
    typeof payload === "number"
      ? payload
      : Number(payload?.direction);
  const fromVerse =
    typeof payload === "object" && payload != null && Number.isFinite(Number(payload.fromVerse))
      ? Number(payload.fromVerse)
      : null;
  if (!Number.isFinite(direction) || direction === 0) return;

  if (readerLoading.value) return;
  const verses = (chapterData.value?.verses || [])
    .map((verse) => Number(verse?.verse))
    .filter((verseNumber) => Number.isFinite(verseNumber));
  if (!verses.length) return;

  const firstVerse = verses[0];
  const lastVerse = verses[verses.length - 1];
  const currentVerse = Number.isFinite(activeVerse.value)
    ? activeVerse.value
    : Number.isFinite(fromVerse)
      ? fromVerse
      : firstVerse;
  const currentIndex = Math.max(0, verses.indexOf(currentVerse));

  if (direction < 0) {
    if (currentVerse > firstVerse && currentIndex > 0) {
      activeVerse.value = verses[currentIndex - 1];
      return;
    }
    const prevNav = chapterData.value?.prev;
    if (!prevNav) return;
    const prevBook = books.value.find((book) => book.book_id === prevNav.book_id);
    if (!prevBook) return;
    const prevChapter = prevNav.chapter ?? prevBook.chapters;
    await loadChapter(prevNav.book_id, prevChapter, { focusVerse: "last" });
    return;
  }

  if (currentVerse < lastVerse && currentIndex < verses.length - 1) {
    activeVerse.value = verses[currentIndex + 1];
    return;
  }
  const nextNav = chapterData.value?.next;
  if (!nextNav) return;
  const nextBook = books.value.find((book) => book.book_id === nextNav.book_id);
  if (!nextBook) return;
  const nextChapter = nextNav.chapter ?? 1;
  await loadChapter(nextNav.book_id, nextChapter, { focusVerse: 1 });
}

async function onNavigate(direction) {
  const nav = chapterData.value?.[direction];
  if (!nav) return;
  const targetBook = books.value.find((b) => b.book_id === nav.book_id);
  if (!targetBook) return;
  const targetChapter = nav.chapter ?? (direction === "prev" ? targetBook.chapters : 1);
  const targetVerse =
    direction === "next" ? 1 : getRememberedVerse(nav.book_id, targetChapter) ?? 1;
  await loadChapter(nav.book_id, targetChapter, { focusVerse: targetVerse });
}

async function onFindParallels(verse) {
  const text = getVerseText(verse);
  if (!text) return;
  await runSearch(text, buildAnchor(verse), { includeEntities: false });
}

function classifyEntityGroup(entityType) {
  const value = String(entityType || "").trim().toLowerCase();
  if (!value) return null;
  if (/(person|people|human|tribe|clan|family|ethnic|nation|group|character|prophet|king|queen|priest|apostle|disciple)/.test(value)) {
    return "people";
  }
  if (/(place|location|geo|region|river|mountain|city|town|village|sea|lake|island|desert|valley|country)/.test(value)) {
    return "places";
  }
  return null;
}

function splitEntityMatches(entities) {
  const people = [];
  const places = [];
  const seen = new Set();
  for (const entity of entities || []) {
    const id = Number(entity?.id);
    if (!Number.isFinite(id) || seen.has(id)) continue;
    seen.add(id);
    const group = classifyEntityGroup(entity?.type);
    if (group === "people" && people.length < 12) people.push(entity);
    if (group === "places" && places.length < 12) places.push(entity);
  }
  return { people, places };
}

async function ensureInsightsVisibleAfterExplore() {
  if (isMobile.value) {
    insightsOpen.value = true;
  } else if (isTablet.value && libraryPinned.value) {
    insightsOpen.value = true;
  } else {
    insightsPinned.value = true;
    insightsOpen.value = false;
  }

  await nextTick();
  const drawerScroll = document.querySelector(".drawer-panel--right .view-scroll");
  const columnScroll = document.querySelector(".context-column .view-scroll");
  const target = insightsOpen.value ? drawerScroll : columnScroll;
  if (target && typeof target.scrollTo === "function") {
    target.scrollTo({ top: 0, behavior: "smooth" });
  }
}

async function onExploreQuery() {
  const query = quickQuery.value.trim();
  if (!query || isExploring.value) return;
  const anchor = buildAnchor();
  isExploring.value = true;
  exploreError.value = null;

  try {
    const exploreSucceeded = await runAsk(query, anchor);
    if (exploreSucceeded) {
      quickQuery.value = "";
      await ensureInsightsVisibleAfterExplore();
    } else if (!exploreError.value) {
      exploreError.value = "Could not explore this passage right now. Try again.";
    }
  } finally {
    isExploring.value = false;
  }
}

async function onOpenEntity(payload) {
  if (!payload?.entityId) return;
  const entityId = Number(payload.entityId);
  if (!Number.isFinite(entityId)) return;
  selectedEntityId.value = entityId;
  await openEntityDetail(entityId, payload.name, payload.anchor);
}

async function onOpenReference(payload) {
  if (!payload?.book_id || !payload?.chapter) return;
  const nextBook = payload.book_id;
  const nextChapter = Number(payload.chapter);
  const nextVerse = Number(payload.verse ?? payload.verse_start ?? 1);
  if (nextBook === bookId.value && nextChapter === chapter.value) {
    activeVerse.value = Number.isFinite(nextVerse) ? nextVerse : null;
    return;
  }
  await loadChapter(nextBook, nextChapter, {
    focusVerse: Number.isFinite(nextVerse) ? nextVerse : null,
  });
}

// ── Library navigation ─────────────────────────────────────────────────────
async function onLibraryNavigate({ bookId: nextBookId, chapter: nextChapter }) {
  const remembered = getRememberedBookPosition(nextBookId);
  const targetVerse = nextChapter === (remembered?.chapter)
    ? (remembered?.verse ?? 1)
    : 1;
  await loadChapter(nextBookId, nextChapter, { focusVerse: targetVerse });
  // Auto-close drawer on mobile after navigation
  if (isMobile.value) libraryOpen.value = false;
}

// ── Utilities ──────────────────────────────────────────────────────────────
function buildAnchor(verse = null) {
  const finalVerse = verse ?? activeVerse.value;
  const base = `${bookId.value} ${chapter.value}`;
  return {
    translation: translation.value,
    book_id: bookId.value,
    chapter: chapter.value,
    verse: finalVerse,
    reference: finalVerse == null ? base : `${base}:${finalVerse}`,
  };
}

function getVerseText(verse) {
  return chapterData.value?.verses.find((v) => v.verse === verse)?.text || "";
}

function makeBookMemoryKey(book) {
  return `${translation.value}:${book}`;
}

function makeChapterMemoryKey(book, chapterNumber) {
  return `${translation.value}:${book}:${chapterNumber}`;
}

function rememberPosition(book, chapterNumber, verseNumber) {
  if (!book || !Number.isFinite(chapterNumber) || !Number.isFinite(verseNumber)) return;
  if (chapterNumber < 1 || verseNumber < 1) return;
  chapterVerseMemory.set(makeChapterMemoryKey(book, chapterNumber), verseNumber);
  bookPositionMemory.set(makeBookMemoryKey(book), { chapter: chapterNumber, verse: verseNumber });
}

function getRememberedVerse(book, chapterNumber) {
  if (!book || !Number.isFinite(chapterNumber)) return null;
  const value = chapterVerseMemory.get(makeChapterMemoryKey(book, chapterNumber));
  return Number.isFinite(value) && value >= 1 ? value : null;
}

function getRememberedBookPosition(book) {
  return book ? bookPositionMemory.get(makeBookMemoryKey(book)) || null : null;
}

function getDisplayBookName(id, fallbackName) {
  return translation.value === "PT1911" ? PT_BR_BOOK_NAMES[id] || fallbackName : fallbackName;
}
</script>

<template>
  <div class="workspace-shell">
    <main class="workspace-grid" :class="gridClass">

      <!-- ── Library column (desktop/tablet pinned) ── -->
      <section v-if="showLibraryColumn" class="surface-card library-column">
        <LibrarySidebar
          :books="displayBooks"
          :current-book-id="bookId"
          :current-chapter="chapter"
          :translation="translation"
          @navigate="onLibraryNavigate"
          @close="libraryPinned = false"
        />
      </section>

      <!-- ── Reader ── -->
      <ReaderPane
        :book-id="bookId"
        :book-name="activeBookName"
        :chapter="chapter"
        :translation="translation"
        :verses="chapterData?.verses || []"
        :highlight-terms="activeEntityHighlightTerms"
        :selected-highlight-terms="activeEntityHighlightTerms"
        :selected-entity-verses="selectedEntityVerses"
        :active-verse="activeVerse"
        :has-prev="Boolean(chapterData?.prev)"
        :has-next="Boolean(chapterData?.next)"
        :loading="readerLoading"
        :error="readerError"
        :available-translations="AVAILABLE_TRANSLATIONS"
        :chapter-options="chapterOptions"
        :quick-query="quickQuery"
        :is-exploring="isExploring"
        :explore-error="exploreError"
        :library-active="libraryActive"
        :insights-active="insightsActive"
        @select-verse="onSelectVerse"
        @activate-verse="onActivateVerse"
        @find-parallels="onFindParallels"
        @clear-selection="onClearSelection"
        @go-prev="onNavigate('prev')"
        @go-next="onNavigate('next')"
        @chapter-step="onChapterStep"
        @chapter-change="onChapterChange"
        @verse-step="onVerseStep"
        @translation-change="(t) => (translation = t)"
        @explore-query="onExploreQuery"
        @quick-query-change="onQuickQueryChange"
        @settings-change="onSettingsChange"
        @toggle-library="onToggleLibrary"
        @toggle-insights="onToggleInsights"
      />

      <!-- ── Insights column (desktop/tablet pinned) ── -->
      <section v-if="showInsightsColumn" class="surface-card context-column">
        <ContextPane
          :current-view="currentView"
          :can-go-back="canGoBack"
          :stack-depth="stackDepth"
          :selected-entity-id="selectedEntityId"
          :book-name="activeBookName"
          :chapter="chapter"
          :chapter-total="activeBook?.chapters || null"
          :verse-count="chapterData?.verses?.length || 0"
          :selected-entity-type="selectedEntitySource?.type || null"
          @go-back="goBack"
          @clear-context="onClearContext"
          @select-entity="onSelectEntity"
          @open-reference="onOpenReference"
          @open-entity="onOpenEntity"
        />
      </section>
    </main>

    <!-- ── Library drawer (mobile / tablet / unpinned desktop) ── -->
    <DrawerShell
      :is-open="libraryDrawerOpen"
      side="left"
      aria-label="Library"
      @close="libraryOpen = false"
    >
      <LibrarySidebar
        :books="displayBooks"
        :current-book-id="bookId"
        :current-chapter="chapter"
        :translation="translation"
        @navigate="onLibraryNavigate"
        @close="libraryOpen = false"
      />
    </DrawerShell>

    <!-- ── Insights drawer (mobile / unpinned) ── -->
    <DrawerShell
      :is-open="insightsDrawerOpen"
      side="right"
      aria-label="Insights"
      @close="insightsOpen = false"
    >
      <ContextPane
        :current-view="currentView"
        :can-go-back="canGoBack"
        :stack-depth="stackDepth"
        :selected-entity-id="selectedEntityId"
        :book-name="activeBookName"
        :chapter="chapter"
        :chapter-total="activeBook?.chapters || null"
        :verse-count="chapterData?.verses?.length || 0"
        :selected-entity-type="selectedEntitySource?.type || null"
        @go-back="goBack"
        @clear-context="onInsightsClearContext"
        @select-entity="onSelectEntity"
        @open-reference="onOpenReference"
        @open-entity="onOpenEntity"
      />
    </DrawerShell>
  </div>
</template>
