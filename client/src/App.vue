<script setup>
import { computed, onMounted, reactive, ref, watch } from "vue";
import {
  getBooks,
  getChapter,
  getChapterContext,
  getEntityById,
  search,
  searchEntities,
} from "./services/api.js";
import ReaderPane from "./components/ReaderPane.vue";
import ContextPane from "./components/ContextPane.vue";
import { PT_BR_BOOK_NAMES } from "./data/bookNamesPtBr.js";

const AVAILABLE_TRANSLATIONS = ["WEBU", "PT1911"];

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

// ── Search / explore options ───────────────────────────────────────────────
const quickQuery = ref("");
const showAdvanced = ref(false);
const mode = ref("explorer");
const topk = ref(8);
const includeDeutero = ref(true);
const highlightEntities = ref(true);

// ── Panel navigation stack ─────────────────────────────────────────────────
// Each entry is a reactive view: { type, title, anchor, status, error, data }
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

// ── Lifecycle ──────────────────────────────────────────────────────────────
onMounted(async () => {
  await initializeReader();
});

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
    readerError.value = err.message;
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

    if (focusVerse != null) {
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
    readerError.value = err.message;
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
    view.error = err.message;
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
    view.error = err.message;
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
  } catch (err) {
    view.status = "error";
    view.error = err.message;
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

function onClearSelection() {
  activeVerse.value = null;
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

async function onExploreQuery() {
  const query = quickQuery.value.trim();
  if (!query) return;
  const anchor = buildAnchor();

  try {
    const entityPayload = await searchEntities({ q: query, limit: 40 });
    await runSearch(query, anchor, {
      includeEntities: true,
      prefetchedEntities: entityPayload,
    });
    quickQuery.value = "";
    return;
  } catch {
    // Keep text explore functional if entity lookup fails.
  }

  await runSearch(query, anchor, { includeEntities: true });
  quickQuery.value = "";
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
    <header class="workspace-header">
      <div>
        <h1 class="workspace-title">Scriptorium</h1>
        <p class="workspace-subtitle">Contextual Bible Reader</p>
      </div>

      <div class="control-row">
        <label class="field">
          <span>Translation</span>
          <select v-model="translation" class="field-input">
            <option v-for="t in AVAILABLE_TRANSLATIONS" :key="t" :value="t">{{ t }}</option>
          </select>
        </label>

        <label class="field">
          <span>Book</span>
          <select :value="bookId" class="field-input" @change="onBookChange">
            <option v-for="book in books" :key="book.book_id" :value="book.book_id">
              {{ getDisplayBookName(book.book_id, book.name) }}
            </option>
          </select>
        </label>

        <label class="field">
          <span>Chapter</span>
          <select :value="chapter" class="field-input" @change="onChapterChange">
            <option v-for="n in chapterOptions" :key="n" :value="n">{{ n }}</option>
          </select>
        </label>

        <label class="field">
          <span>Verse</span>
          <select :value="activeVerse ?? ''" class="field-input" @change="onVerseChange">
            <option value="">None</option>
            <option v-for="n in verseOptions" :key="n" :value="n">{{ n }}</option>
          </select>
        </label>
      </div>

      <div class="explore-row">
        <input
          v-model="quickQuery"
          type="text"
          class="field-input explore-input"
          placeholder="Explore from current context"
          @keyup.enter.prevent="onExploreQuery"
        />
        <button class="primary-btn" type="button" @click="onExploreQuery">Explore</button>
        <button class="ghost-btn" type="button" @click="showAdvanced = !showAdvanced">
          {{ showAdvanced ? "Hide Options" : "Search Options" }}
        </button>
      </div>

      <div v-if="showAdvanced" class="advanced-row">
        <label class="field compact">
          <span>Mode</span>
          <select v-model="mode" class="field-input">
            <option value="explorer">explorer</option>
            <option value="exact">exact</option>
          </select>
        </label>

        <label class="field compact">
          <span>TopK</span>
          <input
            v-model.number="topk"
            class="field-input"
            type="number"
            min="1"
            max="100"
            step="1"
          />
        </label>

        <label class="toggle">
          <input v-model="includeDeutero" type="checkbox" />
          <span>Include deuterocanonical books</span>
        </label>

        <label class="toggle">
          <input v-model="highlightEntities" type="checkbox" />
          <span>Highlight entity terms</span>
        </label>
      </div>
    </header>

    <main class="workspace-grid">
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
        @select-verse="onSelectVerse"
        @find-parallels="onFindParallels"
        @clear-selection="onClearSelection"
        @go-prev="onNavigate('prev')"
        @go-next="onNavigate('next')"
      />

      <section class="surface-card context-column">
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
  </div>
</template>
