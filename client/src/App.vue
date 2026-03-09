<script setup>
import { computed, nextTick, onMounted, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  ask,
  getBooks,
  getChapter,
  getChapterContext,
  getEntityById,
  getApiErrorMessage,
  getHealth,
  search,
  searchEntities,
} from "./services/api.js";
import ReaderPane from "./components/ReaderPane.vue";
import ContextPane from "./components/ContextPane.vue";
import LibrarySidebar from "./components/LibrarySidebar.vue";
import DrawerShell from "./components/DrawerShell.vue";
import InsightsSheet from "./components/InsightsSheet.vue";
import { useBreakpoint } from "./composables/useBreakpoint.js";
import { fetchVoices, translationLanguage, pickVoiceForLanguage } from "./composables/useVoices.js";
import { useTts } from "./composables/useTts.js";
import { useReaderState } from "./composables/useReaderState.js";
import { PT_BR_BOOK_NAMES } from "./data/bookNamesPtBr.js";
import { useGlobalShortcuts } from "./composables/useGlobalShortcuts.js";
import KeyboardShortcutsModal from "./components/KeyboardShortcutsModal.vue";
import FeedbackModal from "./components/FeedbackModal.vue";

const AVAILABLE_TRANSLATIONS = ["WEBU", "PT1911"];

// ── i18n locale (follows active translation) ───────────────────────────────
const { locale, t } = useI18n();

// ── Breakpoints ────────────────────────────────────────────────────────────
const { isMobile, isTablet, isDesktop } = useBreakpoint();

// ── Layout state ───────────────────────────────────────────────────────────
const LS_LAYOUT = "scriptorium-layout";
const LS_READER_SETTINGS = "scriptorium-reader-settings";
const LS_LAST_READING_PLACE = "scriptorium-last-reading-place";

const libraryPinned  = ref(false); // true = Library shown as column (desktop/tablet)
const insightsPinned = ref(true);  // true = Insights shown as column (desktop/tablet)
const libraryOpen    = ref(false); // true = Library drawer open
const insightsOpen   = ref(false); // true = Insights drawer open

function readStoredJson(key, fallback = null) {
  if (typeof window === "undefined" || !window.localStorage) return fallback;
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStoredJson(key, value) {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function toPositiveInteger(value) {
  const num = Number(value);
  return Number.isInteger(num) && num >= 1 ? num : null;
}

function loadLayoutPrefs() {
  const savedLayout = readStoredJson(LS_LAYOUT, {});
  libraryPinned.value = false;
  libraryOpen.value = false;
  if (typeof savedLayout?.insightsPinned === "boolean") insightsPinned.value = savedLayout.insightsPinned;
}

loadLayoutPrefs();

watch(insightsPinned, () => {
  writeStoredJson(LS_LAYOUT, { insightsPinned: insightsPinned.value });
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

const libraryColumnMounted = ref(showLibraryColumn.value);
const insightsColumnMounted = ref(showInsightsColumn.value);

watch(showLibraryColumn, (next) => {
  if (next) libraryColumnMounted.value = true;
});

watch(showInsightsColumn, (next) => {
  if (next) insightsColumnMounted.value = true;
});

function onLibraryColumnAfterLeave() {
  libraryColumnMounted.value = false;
}

function onInsightsColumnAfterLeave() {
  insightsColumnMounted.value = false;
}

const gridClass = computed(() => {
  const lib = libraryColumnMounted.value;
  const ins = insightsColumnMounted.value;
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

function applyInsightsOpenPlan(plan) {
  if (!plan || typeof plan !== "object") return;
  if (typeof plan.insightsPinned === "boolean") insightsPinned.value = plan.insightsPinned;
  if (typeof plan.insightsOpen === "boolean") insightsOpen.value = plan.insightsOpen;
}

// ── Reader state ──────────────────────────────────────────────────────────
const translation = ref("WEBU");
const books = ref([]);
const bookId = ref("");
const chapter = ref(1);
const chapterData = ref(null);
const readerLoading = ref(true);
const readerError = ref(null);
const activeVerse = ref(null);
const selectedEntityId = ref(null);
// Prevent startup restore from triggering a second initializeReader() via translation watchers.
const readerBootstrapping = ref(true);
const readerUx = useReaderState();
const tts = useTts();

const serviceCapabilities = reactive({
  loaded: false,
  loading: false,
  features: {
    explore: true,
    readAloud: true,
    feedback: true,
  },
  statuses: {
    ollama: null,
    voiceAi: null,
  },
});

const exploreEnabled = computed(() => serviceCapabilities.loaded && serviceCapabilities.features.explore !== false);
const ttsEnabled = computed(() => serviceCapabilities.loaded && serviceCapabilities.features.readAloud !== false);
const feedbackEnabled = computed(() => serviceCapabilities.loaded && serviceCapabilities.features.feedback !== false);

const exploreUnavailableReason = computed(() => {
  if (exploreEnabled.value) return null;
  return t('errors.exploreUnavailable');
});

const ttsUnavailableReason = computed(() => {
  if (ttsEnabled.value) return null;
  return serviceCapabilities.statuses.voiceAi?.message || t('errors.ttsUnavailable');
});

async function refreshFeatureAvailability() {
  serviceCapabilities.loading = true;
  try {
    const payload = await getHealth();
    const exploreAvailable = payload?.features?.explore?.available;
    const readAloudAvailable = payload?.features?.read_aloud?.available;
    const feedbackAvailable = payload?.features?.feedback?.available;

    serviceCapabilities.features.explore =
      typeof exploreAvailable === "boolean" ? exploreAvailable : true;
    serviceCapabilities.features.readAloud =
      typeof readAloudAvailable === "boolean" ? readAloudAvailable : true;
    serviceCapabilities.features.feedback =
      typeof feedbackAvailable === "boolean" ? feedbackAvailable : true;
    serviceCapabilities.statuses.ollama = payload?.ollama || null;
    serviceCapabilities.statuses.voiceAi = payload?.voice_ai || null;
    serviceCapabilities.loaded = true;
  } catch {
    // Keep existing defaults so the UI remains usable if health probing fails.
    serviceCapabilities.loaded = true;
  } finally {
    serviceCapabilities.loading = false;
  }
}

// ── Reader settings ────────────────────────────────────────────────────────
const readerSettings = reactive({ fontSize: 'md', lineSpacing: 'normal', font: 'serif', theme: 'light', voiceId: '' });

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const root = document.documentElement;
  const themes = {
    light: { '--ink':'#1e1612','--muted':'#695e57','--paper':'#fff9f2','--card':'#fffdf8','--line':'#e7d7c6','--accent':'#ad3f2b','--accent-soft':'#f6d8c6' },
    sepia: { '--ink':'#2c1f14','--muted':'#7a6250','--paper':'#f4ead8','--card':'#f9f2e2','--line':'#d9c9ae','--accent':'#8b3a20','--accent-soft':'#f0d8bf' },
    dark:  { '--ink':'#eee2d8','--muted':'#b7a79b','--paper':'#171311','--card':'#27221e','--line':'#4a3e36','--accent':'#d46e55','--accent-soft':'#4a2c23' },
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

const feedbackModal = reactive({
  open: false,
  variant: "general",
  payloadContext: {},
});

function buildFeedbackPageContext(extra = {}) {
  const anchor = currentView.value?.anchor || buildAnchor();
  return {
    surface: extra.surface || "reader",
    view: currentView.value?.type || null,
    reference: anchor?.reference || null,
    ...extra,
  };
}

function openFeedbackModal(variant, payloadContext = {}) {
  if (!feedbackEnabled.value) return;
  feedbackModal.variant = variant;
  feedbackModal.payloadContext = payloadContext;
  feedbackModal.open = true;
}

function closeFeedbackModal() {
  feedbackModal.open = false;
}

function onOpenGeneralFeedback() {
  if (!feedbackEnabled.value) return;
  const currentBookId = bookId.value || null;
  openFeedbackModal("general", {
    kind: "bug_report",
    source_label: t("feedback.sources.general"),
    translation: translation.value || null,
    book_id: currentBookId,
    chapter: currentBookId && Number.isFinite(chapter.value) ? chapter.value : null,
    verse_start: null,
    verse_end: null,
    entity_id: null,
    target_type: null,
    content_snapshot: null,
    generation_metadata: null,
    page_context: buildFeedbackPageContext({ surface: "reader_settings" }),
  });
}

function onOpenContentFeedback(context = {}) {
  if (!feedbackEnabled.value) return;
  const anchor = currentView.value?.anchor || buildAnchor();
  const currentBookId = context.book_id ?? bookId.value ?? null;
  const verseStart = context.verse_start ?? anchor?.verse_start ?? anchor?.verse ?? null;
  const verseEnd = context.verse_end ?? anchor?.verse_end ?? anchor?.verse ?? null;

  openFeedbackModal("content", {
    kind: "content_report",
    source_label: context.source_label || t("feedback.sources.general"),
    target_type: context.target_type || null,
    translation: context.translation ?? translation.value ?? null,
    book_id: currentBookId,
    chapter: context.chapter ?? (currentBookId && Number.isFinite(chapter.value) ? chapter.value : null),
    verse_start: verseStart,
    verse_end: verseEnd,
    entity_id: context.entity_id ?? null,
    content_snapshot: context.content_snapshot ?? null,
    generation_metadata: context.generation_metadata ?? null,
    page_context: buildFeedbackPageContext(context.page_context || {}),
  });
}

watch(feedbackEnabled, (next) => {
  if (!next && feedbackModal.open) {
    feedbackModal.open = false;
  }
});

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

// Cap stack at 20 entries; on overflow evict from index 1 (FIFO), never index 0 (base chapter context).
function pushToStack(view) {
  panelStack.value.push(view);
  while (panelStack.value.length > 20) {
    panelStack.value.splice(1, 1);
  }
}

// ── Stale-request guards ───────────────────────────────────────────────────
let chapterRequestToken = 0;
let chapterContextToken = 0;
let chapterAbortController = null;
let chapterContextAbortController = null;
let askAbortController = null;

// ── Chapter look-ahead prefetch ────────────────────────────────────────────
const prefetchedChapter = ref(null); // { bookId, chapter, data } — next-chapter cache
let prefetchAbortController = null;
let prefetchTimer = null;

// ── Position memory ────────────────────────────────────────────────────────
const chapterVerseMemory = new Map();
const bookPositionMemory = new Map();

function readSavedReadingPlace() {
  const saved = readStoredJson(LS_LAST_READING_PLACE, null);
  if (!saved || typeof saved !== "object") return null;

  const savedTranslation =
    typeof saved.translation === "string" && AVAILABLE_TRANSLATIONS.includes(saved.translation)
      ? saved.translation
      : null;
  const savedBookId = typeof saved.bookId === "string" ? saved.bookId.trim() : "";
  const savedChapter = toPositiveInteger(saved.chapter);
  const savedVerse = toPositiveInteger(saved.verse);

  if (!savedTranslation || !savedBookId || savedChapter == null) return null;
  return {
    translation: savedTranslation,
    bookId: savedBookId,
    chapter: savedChapter,
    verse: savedVerse,
  };
}

// Keep reading context across refreshes without coupling it to Library visibility.
function persistLatestReadingPlace({
  translationId = translation.value,
  book = bookId.value,
  chapterNumber = chapter.value,
  verseNumber = activeVerse.value,
} = {}) {
  const safeTranslation = String(translationId || "");
  const safeBook = String(book || "").trim();
  const safeChapter = toPositiveInteger(chapterNumber);
  const safeVerse = toPositiveInteger(verseNumber);
  if (!safeBook || !safeChapter || !AVAILABLE_TRANSLATIONS.includes(safeTranslation)) return;

  const payload = {
    translation: safeTranslation,
    bookId: safeBook,
    chapter: safeChapter,
  };
  if (safeVerse != null) payload.verse = safeVerse;
  writeStoredJson(LS_LAST_READING_PLACE, payload);
}

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

const chapterContextEntitiesForInsights = computed(() => {
  const baseView = panelStack.value[0];
  if (!baseView || baseView.type !== "chapterContext" || baseView.status !== "ready") return [];
  return Array.isArray(baseView.data?.entities) ? baseView.data.entities : [];
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

const readerHasSelection = computed(() => readerUx.hasSelection.value);
const readerSelectionLabel = computed(() => readerUx.selectionLabel.value);
const showSelectionExploreStarter = computed(() => {
  if (!readerHasSelection.value) return false;
  if (!exploreEnabled.value) return false;
  if (String(quickQuery.value || "").trim()) return false;
  const type = currentView.value?.type || null;
  return type == null || type === "chapterContext";
});

const displayBooks = computed(() =>
  books.value.map(b => ({ ...b, displayName: getDisplayBookName(b.book_id, b.name) }))
);

watch(
  [bookId, activeBookName, chapter, translation],
  ([nextBookId, nextBookLabel, nextChapter, nextTranslation]) => {
    readerUx.setLocation({
      bookId: nextBookId,
      bookLabel: nextBookLabel || nextBookId,
      chapter: nextChapter,
      translationId: nextTranslation,
    });
  },
  { immediate: true }
);

watch(
  quickQuery,
  (value) => {
    readerUx.setPromptText(value);
  },
  { immediate: true }
);

watch(
  activeVerse,
  (verse) => {
    readerUx.focusVerse(Number.isFinite(verse) ? verse : null);
  },
  { immediate: true }
);

watch(
  [libraryDrawerOpen, insightsDrawerOpen, showLibraryColumn, showInsightsColumn],
  ([libraryDrawer, insightsDrawer, libraryColumn, insightsColumn]) => {
    readerUx.setUiState({
      isLibraryOpen: Boolean(libraryDrawer || libraryColumn),
      isInsightsOpen: Boolean(insightsDrawer || insightsColumn),
    });
  },
  { immediate: true }
);

watch(
  selectedEntityId,
  (value) => {
    const ids = Number.isFinite(Number(value)) ? [String(Number(value))] : [];
    readerUx.setSelectedEntities(ids);
  },
  { immediate: true }
);

watch(
  () => [
    tts.state.playing,
    tts.state.paused,
    tts.state.activeVerseNumber,
    tts.state.verseStart,
    tts.state.speed,
    readerSettings.voiceId,
  ],
  () => {
    readerUx.setTtsState({
      status: tts.state.playing ? "playing" : tts.state.paused ? "paused" : "idle",
      fromVerse: tts.state.verseStart ?? null,
      currentVerse: tts.state.activeVerseNumber ?? null,
      voiceId: readerSettings.voiceId || "",
      speed: Number.isFinite(Number(tts.state.speed)) ? Number(tts.state.speed) : 1,
    });
  },
  { immediate: true }
);

// ── Lifecycle ──────────────────────────────────────────────────────────────
onMounted(async () => {
  try {
    const savedSettings = readStoredJson(LS_READER_SETTINGS, null);
    if (savedSettings && typeof savedSettings === "object") {
      Object.assign(readerSettings, savedSettings);
      if (savedSettings.translation && AVAILABLE_TRANSLATIONS.includes(savedSettings.translation)) {
        translation.value = savedSettings.translation;
      }
    } else {
    // First visit — pick translation based on browser language.
      const lang = (navigator.language || '').toLowerCase();
      if (lang.startsWith('pt')) translation.value = 'PT1911';
    }
    const savedReadingPlace = readSavedReadingPlace();
    if (savedReadingPlace) translation.value = savedReadingPlace.translation;
    applySettingsCSSVars();
    await refreshFeatureAvailability();
    // Normalize saved voice (or pick one) for the current translation.
    if (ttsEnabled.value) {
      const voices = await fetchVoices();
      readerSettings.voiceId = pickVoiceForLanguage(
        voices,
        translationLanguage(translation.value),
        readerSettings.voiceId
      );
    }
    await initializeReader(savedReadingPlace);
  } finally {
    readerBootstrapping.value = false;
  }
});

watch([readerSettings, translation], () => {
  writeStoredJson(LS_READER_SETTINGS, { ...readerSettings, translation: translation.value });
  applySettingsCSSVars();
}, { deep: true });

watch(translation, (trans) => { locale.value = translationLanguage(trans); }, { immediate: true });

watch(translation, (trans) => {
  document.title = translationLanguage(trans) === 'pt'
    ? 'Scriptorium \u2013 Explore e Estude as Escrituras'
    : 'Scriptorium \u2013 Explore and Study Scripture';
}, { immediate: true });

watch(translation, async (next, prev) => {
  if (next === prev || readerBootstrapping.value) return;
  // Auto-select voice matching new language, unless current voice already matches.
  if (ttsEnabled.value) {
    const voices = await fetchVoices();
    const lang = translationLanguage(next);
    readerSettings.voiceId = pickVoiceForLanguage(voices, lang, readerSettings.voiceId);
  }
  await initializeReader();
});

watch(activeVerseAnchorKey, (nextAnchorKey) => {
  if (nextAnchorKey) {
    rememberPosition(bookId.value, chapter.value, activeVerse.value);
  }
});

// ── Reader ─────────────────────────────────────────────────────────────────
async function initializeReader(initialLocation = null) {
  readerLoading.value = true;
  readerError.value = null;
  activeVerse.value = null;
  readerUx.setSelectionNone();
  readerUx.setUiState({ chromeHidden: false });
  panelStack.value = [];

  try {
    const booksPayload = await getBooks(translation.value);
    books.value = booksPayload.books || [];

    if (!books.value.length) {
      bookId.value = "";
      chapterData.value = null;
      return;
    }

    const savedLocation = initialLocation?.translation === translation.value ? initialLocation : null;
    if (savedLocation?.bookId) {
      bookId.value = savedLocation.bookId;
      chapter.value = savedLocation.chapter;
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

    if (savedLocation?.bookId === bookId.value && savedLocation.chapter === chapter.value && savedLocation.verse != null) {
      const hasSavedVerse = (chapterData.value?.verses || []).some((verse) => Number(verse?.verse) === savedLocation.verse);
      if (hasSavedVerse) {
        activeVerse.value = savedLocation.verse;
        rememberPosition(bookId.value, chapter.value, savedLocation.verse);
      }
    }
  } catch (err) {
    readerError.value = getApiErrorMessage(err, { context: "books" });
    chapterData.value = null;
  } finally {
    readerLoading.value = false;
  }
}

async function loadChapter(nextBookId, nextChapter, { focusVerse = null } = {}) {
  tts.stop();
  if (chapterAbortController) chapterAbortController.abort();
  chapterAbortController = new AbortController();
  const requestToken = ++chapterRequestToken;

  // Optimistically update location so the sticky header reflects the destination
  // immediately, before the fetch resolves. Saved for rollback on failure.
  const prevBookId = bookId.value;
  const prevChapter = chapter.value;
  bookId.value = nextBookId;
  chapter.value = nextChapter;

  readerLoading.value = true;
  readerError.value = null;
  selectedEntityId.value = null;
  readerUx.setSelectionNone();
  readerUx.setUiState({ chromeHidden: false });
  // Start Insights loading immediately so center/right panes transition together.
  void loadChapterContextView(nextBookId, nextChapter);

  try {
    const payload = await getChapter(nextBookId, nextChapter, translation.value, { signal: chapterAbortController.signal });
    if (requestToken !== chapterRequestToken) return;

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
    } else {
      persistLatestReadingPlace({
        translationId: translation.value,
        book: nextBookId,
        chapterNumber: nextChapter,
        verseNumber: null,
      });
    }

  } catch (err) {
    if (err?.name === "AbortError") return;
    if (requestToken !== chapterRequestToken) return;
    // Revert the optimistic location update on failure.
    bookId.value = prevBookId;
    chapter.value = prevChapter;
    readerError.value = getApiErrorMessage(err, { context: "chapter" });
    chapterData.value = null;
    // Prevent a late context response from replacing the error state after a failed chapter load.
    chapterContextToken += 1;
  } finally {
    if (requestToken === chapterRequestToken) readerLoading.value = false;
  }
}

function cancelPrefetch() {
  if (prefetchTimer !== null) { clearTimeout(prefetchTimer); prefetchTimer = null; }
  if (prefetchAbortController) { prefetchAbortController.abort(); prefetchAbortController = null; }
}

function schedulePrefetch() {
  cancelPrefetch();
  const nav = chapterData.value?.next;
  if (!nav) return; // no next chapter (last chapter of last book)
  if (tts.state.playing) return; // skip while audio is already under load
  const targetBookId = nav.book_id;
  const targetChapter = nav.chapter ?? 1;
  prefetchTimer = setTimeout(async () => {
    prefetchTimer = null;
    prefetchAbortController = new AbortController();
    try {
      const data = await getChapter(targetBookId, targetChapter, translation.value, { signal: prefetchAbortController.signal });
      prefetchAbortController = null;
      prefetchedChapter.value = { bookId: targetBookId, chapter: targetChapter, data };
    } catch {
      prefetchAbortController = null;
    }
  }, 500);
}

// External trigger: cancel prefetch when a new chapter load begins; schedule
// one after a successful load finishes. loadChapter() itself is unchanged.
watch(readerLoading, (loading) => {
  if (loading) {
    cancelPrefetch();
    prefetchedChapter.value = null;
  } else if (!readerError.value) {
    schedulePrefetch();
  }
});

// ── Panel navigation ───────────────────────────────────────────────────────
async function loadChapterContextView(nextBookId, nextChapter) {
  if (chapterContextAbortController) chapterContextAbortController.abort();
  chapterContextAbortController = new AbortController();
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
    const payload = await getChapterContext(nextBookId, nextChapter, translation.value, { signal: chapterContextAbortController.signal });
    if (token !== chapterContextToken) return;
    view.status = "ready";
    view.data = payload;
  } catch (err) {
    if (err?.name === "AbortError") return;
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
  pushToStack(view);

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
  pushToStack(view);

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
  const range = readerUx.selectedRangeNormalized.value;
  if (range?.start != null) return range.start;
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
  if (askAbortController) askAbortController.abort();
  askAbortController = new AbortController();
  pushToStack(view);

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
      signal: askAbortController.signal,
    });

    view.status = "ready";
    view.data = payload;
    return true;
  } catch (err) {
    if (err?.name === "AbortError") return false;
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
  const verseNumber = Number(verse);
  if (!Number.isFinite(verseNumber)) return;
  if (activeVerse.value === verseNumber && (readerUx.state.selection.mode === "single" || readerUx.state.selection.mode === "range")) {
    activeVerse.value = null;
    readerUx.setSelectionNone();
    return;
  }
  activeVerse.value = verseNumber;
  readerUx.setSelectionSingle(verseNumber);
}

function onExtendSelection(verse) {
  const verseNumber = Number(verse);
  if (!Number.isFinite(verseNumber)) return;
  readerUx.extendSelectionToVerse(verseNumber);
}

function onActivateVerse(verse) {
  const verseNumber = Number(verse);
  if (!Number.isFinite(verseNumber)) return;
  activeVerse.value = verseNumber;
  readerUx.focusVerse(verseNumber);
}

function onClearSelection() {
  activeVerse.value = null;
  readerUx.clearSelection();
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
  const extendSelection =
    Boolean(typeof payload === "object" && payload != null && payload.extend);
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
      if (extendSelection) {
        if (readerUx.state.selection.mode === "none") readerUx.setSelectionRange(currentVerse, activeVerse.value);
        else readerUx.extendSelectionToVerse(activeVerse.value);
      }
      else readerUx.setSelectionSingle(activeVerse.value);
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
    if (extendSelection) {
      if (readerUx.state.selection.mode === "none") readerUx.setSelectionRange(currentVerse, activeVerse.value);
      else readerUx.extendSelectionToVerse(activeVerse.value);
    }
    else readerUx.setSelectionSingle(activeVerse.value);
    return;
  }
  const nextNav = chapterData.value?.next;
  if (!nextNav) return;
  const nextBook = books.value.find((book) => book.book_id === nextNav.book_id);
  if (!nextBook) return;
  const nextChapter = nextNav.chapter ?? 1;
  await loadChapter(nextNav.book_id, nextChapter, { focusVerse: 1 });
}

async function onExploreSelection(payload = {}) {
  const verseNumber = Number(payload?.verse);
  if (Number.isFinite(verseNumber)) activeVerse.value = verseNumber;
  readerUx.prepareExploreTrigger({
    verse: Number.isFinite(verseNumber) ? verseNumber : null,
    fallbackVerse: activeVerse.value,
    selectedEntities: getActiveEntityIdsForAsk(),
  });

  // Pop any non-base view so the explore-selection starter is visible.
  // selectedEntityId is preserved intentionally so the entity still feeds into
  // the query as context.
  const topType = currentView.value?.type;
  if (topType && topType !== "chapterContext" && panelStack.value.length > 1) {
    panelStack.value = panelStack.value.slice(0, 1);
  }

  if (!exploreEnabled.value) {
    exploreError.value = exploreUnavailableReason.value;
    return;
  }

  await ensureInsightsVisibleAfterExplore();
}

function selectionPromptByChip(chipKey, selectionLabel) {
  const ref = selectionLabel || buildAnchor().reference;
  const keyMap = {
    summary: "context.prompts.summary",
    themes: "context.prompts.themes",
    entities: "context.prompts.entities",
    cross_refs: "context.prompts.crossRefs",
  };
  const localeKey = keyMap[String(chipKey || "")] || "context.prompts.default";
  return t(localeKey, { ref });
}

async function onQuickExploreChip(chipKey) {
  if (!readerHasSelection.value || isExploring.value) return;
  quickQuery.value = selectionPromptByChip(chipKey, readerSelectionLabel.value);
  await onExploreQuery();
}

async function onNavigate(direction) {
  const nav = chapterData.value?.[direction];
  if (!nav) return;
  const targetBook = books.value.find((b) => b.book_id === nav.book_id);
  if (!targetBook) return;
  const targetChapter = nav.chapter ?? (direction === "prev" ? targetBook.chapters : 1);
  const targetVerse =
    direction === "next" ? 1 : getRememberedVerse(nav.book_id, targetChapter) ?? 1;

  // Cache-hit path: consume prefetched data instantly, skip the API round-trip.
  if (direction === "next") {
    const cached = prefetchedChapter.value;
    if (cached && cached.bookId === nav.book_id && cached.chapter === targetChapter) {
      cancelPrefetch();
      prefetchedChapter.value = null;
      tts.stop();
      if (chapterAbortController) chapterAbortController.abort();
      chapterRequestToken++; // invalidate any in-flight request
      bookId.value = nav.book_id;
      chapter.value = targetChapter;
      readerError.value = null;
      selectedEntityId.value = null;
      readerUx.setSelectionNone();
      readerUx.setUiState({ chromeHidden: false });
      void loadChapterContextView(nav.book_id, targetChapter);
      chapterData.value = cached.data;
      const verses = cached.data.verses || [];
      const firstVerse = verses[0]?.verse ?? null;
      const nextActiveVerse = verses.some((v) => v.verse === targetVerse) ? targetVerse : firstVerse;
      activeVerse.value = nextActiveVerse;
      if (nextActiveVerse != null) {
        rememberPosition(nav.book_id, targetChapter, nextActiveVerse);
      } else {
        persistLatestReadingPlace({
          translationId: translation.value,
          book: nav.book_id,
          chapterNumber: targetChapter,
          verseNumber: null,
        });
      }
      schedulePrefetch(); // begin warming the chapter after this one
      return;
    }
  }

  await loadChapter(nav.book_id, targetChapter, { focusVerse: targetVerse });
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
  applyInsightsOpenPlan(
    readerUx.planInsightsOpen({
      isMobile: isMobile.value,
      isTablet: isTablet.value,
      libraryPinned: libraryPinned.value,
    })
  );

  await nextTick();
  const sheetScroll = document.querySelector(".insights-sheet-panel .view-scroll");
  const drawerScroll = document.querySelector(".drawer-panel--right .view-scroll");
  const columnScroll = document.querySelector(".context-column .view-scroll");
  const target = isMobile.value ? sheetScroll : (insightsOpen.value ? drawerScroll : columnScroll);
  if (target && typeof target.scrollTo === "function") {
    target.scrollTo({ top: 0, behavior: "smooth" });
  }
}

async function onExploreQuery() {
  if (!exploreEnabled.value) {
    exploreError.value = exploreUnavailableReason.value;
    return;
  }
  const query = quickQuery.value.trim();
  if (!query || isExploring.value) return;
  readerUx.prepareExploreTrigger({
    promptText: query,
    fallbackVerse: activeVerse.value,
    selectedEntities: getActiveEntityIdsForAsk(),
  });
  const anchor = buildAnchor();
  isExploring.value = true;
  exploreError.value = null;

  try {
    const exploreSucceeded = await runAsk(query, anchor);
    if (exploreSucceeded) {
      quickQuery.value = "";
      await ensureInsightsVisibleAfterExplore();
    } else if (!exploreError.value) {
      exploreError.value = t('errors.exploreFailedRetry');
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
  const range = readerUx.selectedRangeNormalized.value;
  const finalVerse = verse ?? activeVerse.value ?? range?.start ?? null;
  const base = `${bookId.value} ${chapter.value}`;
  const rangeRef = range && range.start !== range.end ? `${base}:${range.start}-${range.end}` : null;
  const singleRef = finalVerse == null ? base : `${base}:${finalVerse}`;
  return {
    translation: translation.value,
    book_id: bookId.value,
    chapter: chapter.value,
    verse: finalVerse,
    verse_start: range?.start ?? null,
    verse_end: range?.end ?? null,
    reference: rangeRef || singleRef,
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
  persistLatestReadingPlace({
    translationId: translation.value,
    book,
    chapterNumber,
    verseNumber,
  });
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

// ── Global keyboard shortcuts ───────────────────────────────────────────────
const showShortcutsModal = ref(false);

useGlobalShortcuts({
  prevChapter: () => onChapterStep(-1),
  nextChapter: () => onChapterStep(1),
  toggleLibrary: onToggleLibrary,
  toggleInsights: onToggleInsights,
  focusSearch: () => document.querySelector('.gtb-explore-input')?.focus(),
  clearSelection: onClearSelection,
  openShortcutsModal: () => { showShortcutsModal.value = true; },
});
</script>

<template>
  <div class="workspace-shell">
    <main class="workspace-grid" :class="gridClass">

      <!-- ── Library column (desktop/tablet pinned) ── -->
      <Transition name="reader-panel-left" @after-leave="onLibraryColumnAfterLeave">
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
      </Transition>

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
        :selection-mode="readerUx.state.selection.mode"
        :selection-start-verse="readerUx.state.selection.startVerse"
        :selection-end-verse="readerUx.state.selection.endVerse"
        :selection-label="readerSelectionLabel"
        :chrome-hidden="readerUx.state.ui.chromeHidden"
        :has-prev="Boolean(chapterData?.prev)"
        :has-next="Boolean(chapterData?.next)"
        :loading="readerLoading"
        :error="readerError"
        :available-translations="AVAILABLE_TRANSLATIONS"
        :chapter-options="chapterOptions"
        :quick-query="quickQuery"
        :voice-id="readerSettings.voiceId"
        :is-exploring="isExploring"
        :explore-error="exploreError"
        :ready="serviceCapabilities.loaded"
        :explore-enabled="exploreEnabled"
        :explore-disabled-reason="exploreUnavailableReason"
        :tts-enabled="ttsEnabled"
        :tts-disabled-reason="ttsUnavailableReason"
        :feedback-enabled="feedbackEnabled"
        :library-active="libraryActive"
        :insights-active="insightsActive"
        @select-verse="onSelectVerse"
        @activate-verse="onActivateVerse"
        @extend-selection="onExtendSelection"
        @explore-selection="onExploreSelection"
        @clear-selection="onClearSelection"
        @go-prev="onNavigate('prev')"
        @go-next="onNavigate('next')"
        @chapter-step="onChapterStep"
        @chapter-change="onChapterChange"
        @verse-step="onVerseStep"
        @translation-change="(val) => (translation = val)"
        @explore-query="onExploreQuery"
        @quick-query-change="onQuickQueryChange"
        @settings-change="onSettingsChange"
        @open-feedback="onOpenGeneralFeedback"
        @toggle-library="onToggleLibrary"
        @toggle-insights="onToggleInsights"
      />

      <!-- ── Insights column (desktop/tablet pinned) ── -->
      <Transition name="reader-panel-right" @after-leave="onInsightsColumnAfterLeave">
        <section v-if="showInsightsColumn" class="surface-card context-column">
          <ContextPane
            :current-view="currentView"
            :loading="readerLoading"
            :can-go-back="canGoBack"
            :stack-depth="stackDepth"
            :selected-entity-id="selectedEntityId"
            :chapter-entities="chapterContextEntitiesForInsights"
            :book-name="activeBookName"
            :chapter="chapter"
            :chapter-total="activeBook?.chapters || null"
            :verse-count="chapterData?.verses?.length || 0"
            :selected-entity-type="selectedEntitySource?.type || null"
            :has-selection="readerHasSelection"
            :selection-label="readerSelectionLabel"
            :show-selection-explore-starter="showSelectionExploreStarter"
            :feedback-enabled="feedbackEnabled"
            @go-back="goBack"
            @clear-context="onClearContext"
            @clear-selection="onClearSelection"
            @quick-explore="onQuickExploreChip"
            @select-entity="onSelectEntity"
            @open-reference="onOpenReference"
            @open-entity="onOpenEntity"
            @open-feedback="onOpenContentFeedback"
          />
        </section>
      </Transition>
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
    <InsightsSheet
      v-if="isMobile"
      :is-open="insightsDrawerOpen"
      aria-label="Insights"
      @close="insightsOpen = false"
    >
      <ContextPane
        :current-view="currentView"
        :loading="readerLoading"
        :can-go-back="canGoBack"
        :stack-depth="stackDepth"
        :selected-entity-id="selectedEntityId"
        :chapter-entities="chapterContextEntitiesForInsights"
        :book-name="activeBookName"
        :chapter="chapter"
        :chapter-total="activeBook?.chapters || null"
        :verse-count="chapterData?.verses?.length || 0"
        :selected-entity-type="selectedEntitySource?.type || null"
        :has-selection="readerHasSelection"
        :selection-label="readerSelectionLabel"
        :show-selection-explore-starter="showSelectionExploreStarter"
        :feedback-enabled="feedbackEnabled"
        @go-back="goBack"
        @clear-context="onInsightsClearContext"
        @clear-selection="onClearSelection"
        @quick-explore="onQuickExploreChip"
        @select-entity="onSelectEntity"
        @open-reference="onOpenReference"
        @open-entity="onOpenEntity"
        @open-feedback="onOpenContentFeedback"
      />
    </InsightsSheet>

    <DrawerShell
      v-else
      :is-open="insightsDrawerOpen"
      side="right"
      aria-label="Insights"
      @close="insightsOpen = false"
    >
      <ContextPane
        :current-view="currentView"
        :loading="readerLoading"
        :can-go-back="canGoBack"
        :stack-depth="stackDepth"
        :selected-entity-id="selectedEntityId"
        :chapter-entities="chapterContextEntitiesForInsights"
        :book-name="activeBookName"
        :chapter="chapter"
        :chapter-total="activeBook?.chapters || null"
        :verse-count="chapterData?.verses?.length || 0"
        :selected-entity-type="selectedEntitySource?.type || null"
        :has-selection="readerHasSelection"
        :selection-label="readerSelectionLabel"
        :show-selection-explore-starter="showSelectionExploreStarter"
        :feedback-enabled="feedbackEnabled"
        @go-back="goBack"
        @clear-context="onInsightsClearContext"
        @clear-selection="onClearSelection"
        @quick-explore="onQuickExploreChip"
        @select-entity="onSelectEntity"
        @open-reference="onOpenReference"
        @open-entity="onOpenEntity"
        @open-feedback="onOpenContentFeedback"
      />
    </DrawerShell>
    <KeyboardShortcutsModal
      v-if="showShortcutsModal"
      @close="showShortcutsModal = false"
    />
    <FeedbackModal
      v-if="feedbackModal.open"
      :variant="feedbackModal.variant"
      :payload-context="feedbackModal.payloadContext"
      @close="closeFeedbackModal"
    />
  </div>
</template>
