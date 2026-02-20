<script setup>
import { computed, nextTick, ref, watch } from "vue";
import GlobalTopBar from './GlobalTopBar.vue';
import ReaderHeader from './ReaderHeader.vue';
import VerseActionRow from './VerseActionRow.vue';

const props = defineProps({
  bookId:                 { type: String,  required: true },
  bookName:               { type: String,  required: true },
  chapter:                { type: Number,  required: true },
  translation:            { type: String,  required: true },
  verses:                 { type: Array,   required: true },
  highlightTerms:         { type: Array,   default: () => [] },
  selectedHighlightTerms: { type: Array,   default: () => [] },
  selectedEntityVerses:   { type: Array,   default: () => [] },
  activeVerse:            { type: Number,  default: null },
  hasPrev:                { type: Boolean, default: false },
  hasNext:                { type: Boolean, default: false },
  loading:                { type: Boolean, default: false },
  error:                  { type: String,  default: null },
  availableTranslations:  { type: Array,   default: () => ['WEBU'] },
  chapterOptions:         { type: Array,   default: () => [] },
  quickQuery:             { type: String,  default: '' },
  isExploring:            { type: Boolean, default: false },
  exploreError:           { type: String,  default: null },
  libraryActive:          { type: Boolean, default: false },
  insightsActive:         { type: Boolean, default: false },
});

const emit = defineEmits([
  "select-verse",
  "activate-verse",
  "find-parallels",
  "clear-selection",
  "go-prev",
  "go-next",
  "chapter-step",
  "chapter-change",
  "verse-step",
  "translation-change",
  "explore-query",
  "quick-query-change",
  "settings-change",
  "toggle-library",
  "toggle-insights",
]);

// ── Bookmarks ──────────────────────────────────────────────────────────────
const bookmarkedVerses = ref(new Set());

function isBookmarked(verseNumber) { return bookmarkedVerses.value.has(verseNumber); }

function toggleBookmark(n) {
  const s = new Set(bookmarkedVerses.value);
  s.has(n) ? s.delete(n) : s.add(n);
  bookmarkedVerses.value = s;
}

// ── Highlight ──────────────────────────────────────────────────────────────
function normalizeTerm(term) { return String(term || "").trim(); }
function normalizeTermKey(term) { return normalizeTerm(term).toLowerCase(); }

const mergedHighlightTerms = computed(() => {
  const sourceTerms =
    Array.isArray(props.selectedHighlightTerms) && props.selectedHighlightTerms.length
      ? props.selectedHighlightTerms
      : props.highlightTerms || [];
  const seen = new Set();
  const terms = [];
  for (const candidate of sourceTerms) {
    const term = normalizeTerm(candidate);
    if (!term) continue;
    const key = normalizeTermKey(term);
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
  }
  return terms.sort((a, b) => b.length - a.length);
});

const highlightRegex = computed(() => {
  const terms = mergedHighlightTerms.value;
  if (!terms.length) return null;
  const escaped = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`(${escaped.join("|")})`, "gi");
});

const selectedTermKeys = computed(() => {
  const keys = new Set();
  for (const term of props.selectedHighlightTerms || []) {
    const key = normalizeTermKey(term);
    if (key) keys.add(key);
  }
  return keys;
});

const selectedEntityVerseSet = computed(() => {
  const verses = new Set();
  for (const verse of props.selectedEntityVerses || []) {
    const n = Number(verse);
    if (Number.isFinite(n)) verses.add(n);
  }
  return verses;
});

function getHighlightedParts(text) {
  const content = String(text || "");
  const regex = highlightRegex.value;
  if (!regex || !content) return [{ text: content, isMatch: false }];

  const parts = [];
  let lastIndex = 0;
  for (const match of content.matchAll(regex)) {
    const index = match.index ?? 0;
    const matchedText = match[0];
    if (!matchedText) continue;
    if (index > lastIndex) parts.push({ text: content.slice(lastIndex, index), isMatch: false });
    parts.push({
      text: matchedText,
      isMatch: true,
      isSelectedMatch: selectedTermKeys.value.has(normalizeTermKey(matchedText)),
    });
    lastIndex = index + matchedText.length;
  }
  if (!parts.length) return [{ text: content, isMatch: false }];
  if (lastIndex < content.length) parts.push({ text: content.slice(lastIndex), isMatch: false });
  return parts;
}

function isSelectedEntityVerse(verseNumber) { return selectedEntityVerseSet.value.has(verseNumber); }

// ── Verse element tracking + scroll ───────────────────────────────────────
const verseElements = new Map();

function setVerseElement(verseNumber, el) {
  el ? verseElements.set(verseNumber, el) : verseElements.delete(verseNumber);
}

async function scrollToActiveVerse(behavior = "smooth") {
  if (props.activeVerse == null) return;
  await nextTick();
  verseElements.get(props.activeVerse)?.scrollIntoView({ behavior, block: "center" });
}

watch(() => props.activeVerse, (v) => { if (v != null) scrollToActiveVerse("smooth"); });
watch(() => props.verses,       () => { if (props.activeVerse != null) scrollToActiveVerse("auto"); });

let suppressKeyboardClickUntil = 0;

function getActivationTargetVerse(fallbackVerse) {
  return Number.isFinite(props.activeVerse) ? props.activeVerse : fallbackVerse;
}

function onVerseButtonKeydown(event, verseNumber) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    suppressKeyboardClickUntil = Date.now() + 200;
    emit("activate-verse", getActivationTargetVerse(verseNumber));
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    emit("clear-selection");
    return;
  }
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
  const direction =
    event.key === "ArrowLeft" || event.key === "ArrowUp"
      ? -1
      : event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : 0;
  if (!direction) return;
  event.preventDefault();
  emit("verse-step", { direction, fromVerse: verseNumber });
}

function onVerseButtonClick(event, verseNumber) {
  const keyboardLikeClick = event?.detail === 0 || (event?.clientX === 0 && event?.clientY === 0);
  if (Date.now() <= suppressKeyboardClickUntil || keyboardLikeClick) {
    suppressKeyboardClickUntil = 0;
    emit("activate-verse", getActivationTargetVerse(verseNumber));
    return;
  }
  emit("select-verse", verseNumber);
}
</script>

<template>
  <section class="surface-card reader-pane">

    <!-- ── Global controls bar ── -->
    <GlobalTopBar
      :translation="translation"
      :available-translations="availableTranslations"
      :quick-query="quickQuery"
      :is-exploring="isExploring"
      :explore-error="exploreError"
      :library-active="libraryActive"
      :insights-active="insightsActive"
      @translation-change="$emit('translation-change', $event)"
      @quick-query-change="$emit('quick-query-change', $event)"
      @explore-query="$emit('explore-query')"
      @settings-change="$emit('settings-change', $event)"
      @toggle-library="$emit('toggle-library')"
      @toggle-insights="$emit('toggle-insights')"
    />

    <!-- ── Scrollable reading area ── -->
    <div class="reader-content">

      <!-- Sticky chapter navigation bar -->
      <ReaderHeader
        :book-name="bookName"
        :chapter="chapter"
        :has-prev="hasPrev"
        :has-next="hasNext"
        :active-verse="activeVerse"
        :chapter-options="chapterOptions"
        @go-prev="$emit('go-prev')"
        @go-next="$emit('go-next')"
        @chapter-step="$emit('chapter-step', $event)"
        @chapter-change="$emit('chapter-change', $event)"
        @verse-step="$emit('verse-step', $event)"
        @clear-selection="$emit('clear-selection')"
      />

      <!-- Loading / error / empty states -->
      <div v-if="loading && verses.length" class="reader-loading-banner">
        Loading chapter…
      </div>

      <div v-if="error" class="state-error">{{ error }}</div>
      <div v-else-if="!verses.length && loading" class="reader-skeleton">
        <div v-for="line in 8" :key="line" class="skeleton-line"></div>
      </div>
      <div v-else-if="!verses.length" class="state-text">No verses found for this chapter.</div>

      <!-- Verse list -->
      <ol v-else class="verse-list reader-text">
        <li
          v-for="verse in verses"
          :key="verse.verse"
          :ref="(el) => setVerseElement(verse.verse, el)"
          :class="[
            'verse-row',
            {
              active: activeVerse === verse.verse,
              'verse-row--selected-entity': isSelectedEntityVerse(verse.verse),
              'verse-row--bookmarked': isBookmarked(verse.verse),
            },
          ]"
        >
          <button
            class="verse-button"
            type="button"
            @click="onVerseButtonClick($event, verse.verse)"
            @keydown="onVerseButtonKeydown($event, verse.verse)"
          >
            <span class="verse-number">{{ verse.verse }}</span>
            <span>
              <template v-for="(part, i) in getHighlightedParts(verse.text)" :key="i">
                <mark
                  v-if="part.isMatch"
                  :class="['entity-highlight', { 'entity-highlight-selected': part.isSelectedMatch }]"
                >{{ part.text }}</mark>
                <span v-else>{{ part.text }}</span>
              </template>
            </span>
          </button>
          <VerseActionRow
            :verse-number="verse.verse"
            :verse-text="verse.text"
            :book-id="bookId"
            :chapter="chapter"
            :translation="translation"
            :is-bookmarked="isBookmarked(verse.verse)"
            @find-parallels="$emit('find-parallels', verse.verse)"
            @toggle-bookmark="toggleBookmark(verse.verse)"
          />
        </li>
      </ol>

      <!-- Footer chapter navigation -->
      <div v-if="verses.length && (hasPrev || hasNext)" class="chapter-footer-nav">
        <button
          v-if="hasPrev"
          class="ghost-btn chapter-footer-prev"
          type="button"
          @click="$emit('go-prev')"
        >
          Previous chapter
        </button>
        <span v-else class="chapter-footer-spacer" aria-hidden="true"></span>

        <button
          class="primary-btn chapter-footer-next"
          type="button"
          :disabled="!hasNext"
          @click="$emit('go-next')"
        >
          Next chapter
        </button>
      </div>
    </div>
  </section>
</template>
