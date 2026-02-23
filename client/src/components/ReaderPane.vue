<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import GlobalTopBar from './GlobalTopBar.vue';
import ReaderHeader from './ReaderHeader.vue';
import ReaderMiniPlayer from './ReaderMiniPlayer.vue';
import VerseActionRow from './VerseActionRow.vue';
import { useTts } from '../composables/useTts.js';
import { useBreakpoint } from '../composables/useBreakpoint.js';
import { useReaderState } from '../composables/useReaderState.js';

const props = defineProps({
  bookId: { type: String, required: true },
  bookName: { type: String, required: true },
  chapter: { type: Number, required: true },
  translation: { type: String, required: true },
  verses: { type: Array, required: true },
  highlightTerms: { type: Array, default: () => [] },
  selectedHighlightTerms: { type: Array, default: () => [] },
  selectedEntityVerses: { type: Array, default: () => [] },
  activeVerse: { type: Number, default: null },
  selectionMode: { type: String, default: 'none' },
  selectionStartVerse: { type: Number, default: null },
  selectionEndVerse: { type: Number, default: null },
  selectionLabel: { type: String, default: '' },
  chromeHidden: { type: Boolean, default: false },
  hasPrev: { type: Boolean, default: false },
  hasNext: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  error: { type: String, default: null },
  availableTranslations: { type: Array, default: () => ['WEBU'] },
  chapterOptions: { type: Array, default: () => [] },
  quickQuery: { type: String, default: '' },
  voiceId: { type: String, default: '' },
  isExploring: { type: Boolean, default: false },
  exploreError: { type: String, default: null },
  exploreEnabled: { type: Boolean, default: true },
  exploreDisabledReason: { type: String, default: null },
  ttsEnabled: { type: Boolean, default: true },
  ttsDisabledReason: { type: String, default: null },
  libraryActive: { type: Boolean, default: false },
  insightsActive: { type: Boolean, default: false },
});

const emit = defineEmits([
  'select-verse',
  'activate-verse',
  'extend-selection',
  'explore-selection',
  'clear-selection',
  'go-prev',
  'go-next',
  'chapter-step',
  'chapter-change',
  'verse-step',
  'translation-change',
  'explore-query',
  'quick-query-change',
  'settings-change',
  'toggle-library',
  'toggle-insights',
  'set-chrome-hidden',
]);

const { isMobile } = useBreakpoint();
const tts = useTts();
const readerUx = useReaderState();

/* QA checklist
 * - Desktop: selecting a verse shows contextual toolbar and Explore opens Insights
 * - Mobile: long-press enters selection, bottom toolbar appears, Explore opens Insights sheet
 * - TTS: mini-player appears only while loading/playing/paused and close stops playback
 * - Header never shows playback controls
 * - Verse highlight remains subtle (tint + left accent)
 * - Chrome auto-hide does not block chapter navigation or search access
 */

const bookmarkedVerses = ref(new Set());
const readerPaneRef = ref(null);
const verseElements = new Map();
const readerContentRef = ref(null);
let lastScrollTop = 0;
let suppressKeyboardClickUntil = 0;
let longPressTimer = null;
let longPressConsumed = false;
let mobileHintTimeout = null;
const showMobileExtendHint = ref(false);

function isBookmarked(verseNumber) {
  return bookmarkedVerses.value.has(verseNumber);
}

function toggleBookmark(verseNumber) {
  const next = new Set(bookmarkedVerses.value);
  if (next.has(verseNumber)) next.delete(verseNumber);
  else next.add(verseNumber);
  bookmarkedVerses.value = next;
}

function normalizeTerm(term) {
  return String(term || '').trim();
}

function normalizeTermKey(term) {
  return normalizeTerm(term).toLowerCase();
}

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
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`(${escaped.join('|')})`, 'gi');
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

const selectionRange = computed(() => {
  const start = Number(props.selectionStartVerse);
  const end = Number(props.selectionEndVerse);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return start <= end ? { start, end } : { start: end, end: start };
});

const hasSelection = computed(() => props.selectionMode !== 'none' && !!selectionRange.value);
const ttsVisible = computed(() => tts.state.loading || tts.state.playing || tts.state.paused);
const ttsActionEnabled = computed(() => props.ttsEnabled || ttsVisible.value);
const selectionListenLabel = computed(() => 'Listen from selection');

function getHighlightedParts(text) {
  const content = String(text || '');
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

function getWordParts(text) {
  const parts = [];
  const wordRegex = /(\S+)(\s*)/g;
  let match;
  while ((match = wordRegex.exec(text)) !== null) {
    parts.push({ word: match[1], trailing: match[2] });
  }
  return parts;
}

function isSelectedEntityVerse(verseNumber) {
  return selectedEntityVerseSet.value.has(verseNumber);
}

function isVerseSelected(verseNumber) {
  const range = selectionRange.value;
  if (!range) return false;
  return verseNumber >= range.start && verseNumber <= range.end;
}

function getVerseSelectionClass(verseNumber) {
  const range = selectionRange.value;
  if (!range) return null;
  if (verseNumber < range.start || verseNumber > range.end) return null;
  if (range.start === range.end) return 'verse-row--selected';
  if (verseNumber === range.start) return 'verse-row--range-start';
  if (verseNumber === range.end) return 'verse-row--range-end';
  return 'verse-row--range-middle';
}

function isFocusedVerse(verseNumber) {
  return Number(props.activeVerse) === Number(verseNumber);
}

function setVerseElement(verseNumber, el) {
  if (el) verseElements.set(verseNumber, el);
  else verseElements.delete(verseNumber);
}

async function scrollToActiveVerse(behavior = 'smooth') {
  if (props.activeVerse == null) return;
  await nextTick();
  const el = verseElements.get(props.activeVerse);
  if (!el) return;
  const container = readerContentRef.value;
  if (!container) {
    el.scrollIntoView({ behavior, block: 'center' });
    return;
  }

  const containerRect = container.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  const targetTop = container.scrollTop + (elRect.top - containerRect.top) - container.clientHeight * 0.28;
  container.scrollTo({ top: Math.max(0, targetTop), behavior });
}

watch(
  () => props.activeVerse,
  (v) => {
    if (v != null) scrollToActiveVerse('smooth');
  }
);
watch(
  () => props.verses,
  () => {
    if (props.activeVerse != null) scrollToActiveVerse('auto');
  }
);

function clearLongPress() {
  if (longPressTimer) clearTimeout(longPressTimer);
  longPressTimer = null;
}

function showExtendSelectionHint() {
  if (!isMobile.value) return;
  if (mobileHintTimeout) clearTimeout(mobileHintTimeout);
  showMobileExtendHint.value = true;
  mobileHintTimeout = setTimeout(() => {
    mobileHintTimeout = null;
    showMobileExtendHint.value = false;
  }, 1800);
}

function onVersePointerDown(event, verseNumber) {
  if (!isMobile.value) return;
  if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
  clearLongPress();
  longPressConsumed = false;
  longPressTimer = setTimeout(() => {
    longPressTimer = null;
    longPressConsumed = true;
    emit('activate-verse', verseNumber);
    if (!hasSelection.value) emit('select-verse', verseNumber);
    else emit('extend-selection', verseNumber);
    showExtendSelectionHint();
  }, 380);
}

function onVersePointerEnd() {
  clearLongPress();
}

function getActivationTargetVerse(fallbackVerse) {
  return Number.isFinite(props.activeVerse) ? props.activeVerse : fallbackVerse;
}

function onVerseButtonKeydown(event, verseNumber) {
  if (event.key === 'Enter') {
    event.preventDefault();
    emit('explore-selection', { verse: getActivationTargetVerse(verseNumber) });
    return;
  }
  if (event.key === ' ') {
    event.preventDefault();
    suppressKeyboardClickUntil = Date.now() + 200;
    if (event.shiftKey) emit('extend-selection', verseNumber);
    else emit('select-verse', verseNumber);
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    emit('clear-selection');
    return;
  }
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;

  const direction =
    event.key === 'ArrowLeft' || event.key === 'ArrowUp'
      ? -1
      : event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : 0;
  if (!direction) return;

  event.preventDefault();
  emit('verse-step', { direction, fromVerse: verseNumber, extend: event.shiftKey });
}

function onVerseButtonClick(event, verseNumber) {
  if (longPressConsumed) {
    longPressConsumed = false;
    return;
  }

  if (event.shiftKey) {
    emit('extend-selection', verseNumber);
    return;
  }

  const keyboardLikeClick = event?.detail === 0 || (event?.clientX === 0 && event?.clientY === 0);
  if (Date.now() <= suppressKeyboardClickUntil || keyboardLikeClick) {
    suppressKeyboardClickUntil = 0;
    emit('activate-verse', getActivationTargetVerse(verseNumber));
    return;
  }

  if (isMobile.value && hasSelection.value) {
    emit('extend-selection', verseNumber);
    return;
  }

  emit('select-verse', verseNumber);
}

function onReaderScroll(event) {
  const el = event.target;
  if (!(el instanceof HTMLElement)) return;
  const next = readerUx.updateChromeFromScroll({
    scrollTop: el.scrollTop,
    previousScrollTop: lastScrollTop,
  });
  lastScrollTop = next.previousScrollTop;
}

function ttsBase() {
  return {
    bookId: props.bookId,
    chapter: props.chapter,
    translation: props.translation,
    voiceId: props.voiceId,
  };
}

function handleSpeak(verseNumber) {
  if (!props.ttsEnabled && !(tts.state.playing || tts.state.loading || tts.state.paused)) return;
  if (
    tts.state.verseStart === verseNumber &&
    tts.state.verseEnd === verseNumber &&
    (tts.state.playing || tts.state.loading || tts.state.paused)
  ) {
    tts.stop();
    return;
  }
  tts.play({ ...ttsBase(), verseNumbers: [verseNumber] });
}

function playVerses(verseNumbers) {
  if (!props.ttsEnabled && !(tts.state.playing || tts.state.loading || tts.state.paused)) return;
  if (!Array.isArray(verseNumbers) || !verseNumbers.length) return;
  if (tts.state.playing || tts.state.loading || tts.state.paused) {
    tts.stop();
  }
  tts.play({ ...ttsBase(), verseNumbers });
}

function handlePlaySelection() {
  if (!hasSelection.value) return;
  const range = selectionRange.value;
  if (!range) return;

  const verseNumbers = (props.verses || [])
    .map((v) => Number(v?.verse))
    .filter((v) => Number.isFinite(v));

  if (props.selectionMode === 'range') {
    playVerses(verseNumbers.filter((v) => v >= range.start && v <= range.end));
    return;
  }

  playVerses(verseNumbers.filter((v) => v >= range.start));
}

function handlePlayChapter() {
  const verseNumbers = (props.verses || [])
    .map((v) => Number(v?.verse))
    .filter((v) => Number.isFinite(v));
  if (!verseNumbers.length) return;
  playVerses(verseNumbers);
}

function isActiveReadingVerse(v) {
  return (
    tts.state.activeVerseNumber === v &&
    (tts.state.playing || tts.state.loading || tts.state.paused) &&
    tts.state.bookId === props.bookId &&
    tts.state.chapter === props.chapter
  );
}

function isVerseInPlayRange(v) {
  if (!tts.state.verseStart || tts.state.bookId !== props.bookId || tts.state.chapter !== props.chapter) return false;
  return v >= tts.state.verseStart && v <= (tts.state.verseEnd ?? tts.state.verseStart);
}

function showVerseActionBar(verseNumber) {
  if (isMobile.value) return false;
  if (hasSelection.value) return Number(props.activeVerse) === Number(verseNumber);
  return Number(props.activeVerse) === Number(verseNumber);
}

function handleVerseExplore(verseNumber) {
  emit('explore-selection', { verse: verseNumber });
}

function getSelectedVerseRows() {
  const range = selectionRange.value;
  if (!range) return [];
  return (props.verses || []).filter((verse) => verse.verse >= range.start && verse.verse <= range.end);
}

async function copySelection() {
  const rows = getSelectedVerseRows();
  if (!rows.length) return;
  const content = rows
    .map((row) => `${props.bookId} ${props.chapter}:${row.verse} (${props.translation}) ${row.text}`)
    .join('\n');
  try {
    await navigator.clipboard.writeText(content);
  } catch {}
}

watch(
  () => props.verses,
  () => {
    lastScrollTop = 0;
    readerUx.resetChrome();
  }
);

onMounted(() => {
  if (!import.meta.env.DEV) return;
  const root = readerPaneRef.value;
  if (!(root instanceof HTMLElement)) return;
  const nodes = [root, ...root.querySelectorAll("*")];
  const scrollables = nodes.filter((node) => {
    if (!(node instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(node);
    const overflowY = style.overflowY;
    return (overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight + 4;
  });
  if (scrollables.length > 1) {
    console.warn("[ReaderPane] multiple scrollable elements detected", scrollables);
  }
});

onUnmounted(() => {
  clearLongPress();
  if (mobileHintTimeout) clearTimeout(mobileHintTimeout);
});
</script>

<template>
  <section ref="readerPaneRef" class="surface-card reader-pane">
    <GlobalTopBar
      :translation="translation"
      :available-translations="availableTranslations"
      :quick-query="quickQuery"
      :is-exploring="isExploring"
      :explore-error="exploreError"
      :chrome-hidden="chromeHidden"
      :explore-enabled="exploreEnabled"
      :explore-disabled-reason="exploreDisabledReason"
      :tts-enabled="ttsEnabled"
      :tts-disabled-reason="ttsDisabledReason"
      :library-active="libraryActive"
      :insights-active="insightsActive"
      @translation-change="$emit('translation-change', $event)"
      @quick-query-change="$emit('quick-query-change', $event)"
      @explore-query="$emit('explore-query')"
      @settings-change="$emit('settings-change', $event)"
      @toggle-library="$emit('toggle-library')"
      @toggle-insights="$emit('toggle-insights')"
    />

    <div
      ref="readerContentRef"
      class="reader-content reader-scroll"
      :class="{
        'reader-content--chrome-hidden': chromeHidden,
        'reader-content--tts-active': ttsVisible,
      }"
      @scroll.passive="onReaderScroll"
    >
      <ReaderHeader
        :book-name="bookName"
        :chapter="chapter"
        :has-prev="hasPrev"
        :has-next="hasNext"
        :chapter-options="chapterOptions"
        @go-prev="$emit('go-prev')"
        @go-next="$emit('go-next')"
        @chapter-step="$emit('chapter-step', $event)"
        @chapter-change="$emit('chapter-change', $event)"
      />

      <div v-if="hasSelection" class="reader-selection-strip" role="status" aria-live="polite">
        <span class="reader-selection-strip__label">{{ selectionLabel || 'Selection active' }}</span>
        <button
          class="ghost-btn compact reader-selection-strip__explore"
          type="button"
          :disabled="!exploreEnabled"
          :title="!exploreEnabled ? (exploreDisabledReason || 'Explore unavailable') : 'Explore selected verse(s)'"
          @click="$emit('explore-selection', { verse: activeVerse })"
        >
          Explore
        </button>
        <button
          class="ghost-btn compact"
          type="button"
          :disabled="!ttsActionEnabled"
          :title="!ttsEnabled ? (ttsDisabledReason || 'Read aloud unavailable') : 'Listen from selection'"
          @click="handlePlaySelection"
        >
          {{ selectionListenLabel }}
        </button>
        <button class="ghost-btn compact" type="button" @click="$emit('clear-selection')">Clear</button>
      </div>

      <div v-if="loading && verses.length" class="reader-loading-banner">Loading chapter...</div>

      <div v-if="error" class="state-error">{{ error }}</div>
      <div v-else-if="!verses.length && loading" class="reader-skeleton">
        <div v-for="line in 8" :key="line" class="skeleton-line"></div>
      </div>
      <div v-else-if="!verses.length" class="state-text">No verses found for this chapter.</div>

      <div
        v-if="!error && verses.length && !loading && !hasSelection && ttsEnabled"
        class="reader-secondary-actions"
        role="toolbar"
        aria-label="Reader actions"
      >
        <button
          class="reader-listen-secondary"
          type="button"
          title="Listen to this chapter from verse 1"
          @click="handlePlayChapter"
        >
          <span class="reader-listen-secondary__label">Listen chapter</span>
          <span class="reader-listen-secondary__meta">from verse 1</span>
        </button>
      </div>

      <ol v-if="!error && verses.length && !loading" class="verse-list reader-text" role="list">
        <li
          v-for="verse in verses"
          :key="verse.verse"
          :ref="(el) => setVerseElement(verse.verse, el)"
          :class="[
            'verse-row',
            getVerseSelectionClass(verse.verse),
            {
              'verse-row--focused': isFocusedVerse(verse.verse),
              'verse-row--selected-entity': isSelectedEntityVerse(verse.verse),
              'verse-row--bookmarked': isBookmarked(verse.verse),
              'verse-row--reading': isVerseInPlayRange(verse.verse) && !isActiveReadingVerse(verse.verse),
              'verse-row--reading-active': isActiveReadingVerse(verse.verse),
            },
          ]"
        >
          <button
            class="verse-button"
            type="button"
            :aria-pressed="isVerseSelected(verse.verse) ? 'true' : 'false'"
            @pointerdown="onVersePointerDown($event, verse.verse)"
            @pointerup="onVersePointerEnd"
            @pointercancel="onVersePointerEnd"
            @pointerleave="onVersePointerEnd"
            @click="onVerseButtonClick($event, verse.verse)"
            @keydown="onVerseButtonKeydown($event, verse.verse)"
          >
            <span class="verse-number">{{ verse.verse }}</span>
            <span>
              <template v-if="tts.state.activeVerseNumber === verse.verse && (tts.state.playing || tts.state.loading || tts.state.paused)">
                <span
                  v-for="(part, wi) in getWordParts(verse.text)"
                  :key="wi"
                  :class="{ 'tts-word-active': (tts.state.playing || tts.state.paused) && wi === tts.state.activeWordIdx }"
                >{{ part.word }}{{ part.trailing }}</span>
              </template>
              <template v-else>
                <template v-for="(part, i) in getHighlightedParts(verse.text)" :key="i">
                  <mark v-if="part.isMatch" :class="['entity-highlight', { 'entity-highlight-selected': part.isSelectedMatch }]">{{ part.text }}</mark>
                  <span v-else>{{ part.text }}</span>
                </template>
              </template>
            </span>
          </button>

          <VerseActionRow
            v-if="showVerseActionBar(verse.verse)"
            :verse-number="verse.verse"
            :verse-text="verse.text"
            :book-id="bookId"
            :chapter="chapter"
            :translation="translation"
            :is-bookmarked="isBookmarked(verse.verse)"
            :is-speaking="tts.state.playing && tts.state.activeVerseNumber === verse.verse"
            :is-speak-loading="tts.state.loading && tts.state.activeVerseNumber === verse.verse"
            :tts-enabled="ttsEnabled"
            :tts-disabled-reason="ttsDisabledReason"
            :show-clear="hasSelection"
            @explore="handleVerseExplore(verse.verse)"
            @toggle-bookmark="toggleBookmark(verse.verse)"
            @speak="handleSpeak(verse.verse)"
            @clear="$emit('clear-selection')"
          />
        </li>
      </ol>

      <div v-if="verses.length && (hasPrev || hasNext)" class="chapter-footer-nav">
        <button v-if="hasPrev" class="ghost-btn chapter-footer-prev" type="button" @click="$emit('go-prev')">
          Previous chapter
        </button>
        <span v-else class="chapter-footer-spacer" aria-hidden="true"></span>
        <button class="primary-btn chapter-footer-next" type="button" :disabled="!hasNext" @click="$emit('go-next')">
          Next chapter
        </button>
      </div>

      <div v-if="tts.state.error" class="state-error" role="status" aria-live="polite">
        {{ tts.state.error }}
      </div>

      <div v-if="hasSelection && isMobile" class="reader-selection-toolbar" role="toolbar" aria-label="Selection actions">
        <button
          class="primary-btn compact"
          type="button"
          :disabled="!exploreEnabled"
          :title="!exploreEnabled ? (exploreDisabledReason || 'Explore unavailable') : 'Explore selected verse(s)'"
          @click="$emit('explore-selection', { verse: activeVerse })"
        >
          Explore
        </button>
        <button
          class="ghost-btn compact"
          type="button"
          :disabled="!ttsActionEnabled"
          :title="!ttsEnabled ? (ttsDisabledReason || 'Read aloud unavailable') : 'Listen from selection'"
          @click="handlePlaySelection"
        >
          Listen from selection
        </button>
        <button class="ghost-btn compact" type="button" @click="copySelection">Copy</button>
        <button class="ghost-btn compact" type="button" @click="$emit('clear-selection')">Clear</button>
      </div>

      <p v-if="showMobileExtendHint && hasSelection && isMobile" class="reader-selection-hint" role="status" aria-live="polite">
        Tap another verse to extend range.
      </p>

      <ReaderMiniPlayer />
    </div>
  </section>
</template>
