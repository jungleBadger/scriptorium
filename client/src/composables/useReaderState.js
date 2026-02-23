// client/src/composables/useReaderState.js
// Shared Reader UX state: focus/selection, responsive panel UI, explore context,
// and a lightweight mirror of TTS state for UI decisions.

import { computed, reactive } from "vue";

const state = reactive({
  bookId: "",
  bookLabel: "",
  chapter: 1,
  translationId: "WEBU",
  focusedVerse: null,
  selection: {
    mode: "none", // 'none' | 'single' | 'range'
    startVerse: null,
    endVerse: null,
  },
  ui: {
    isLibraryOpen: false,
    isInsightsOpen: false,
    chromeHidden: false,
  },
  explore: {
    promptText: "",
    context: null,
  },
  tts: {
    status: "idle", // 'idle' | 'playing' | 'paused'
    fromVerse: null,
    currentVerse: null,
    voiceId: "",
    speed: 1,
  },
});

function coerceVerse(verse) {
  const n = Number(verse);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

function normalizedRangeFromSelection(selection = state.selection) {
  const start = coerceVerse(selection.startVerse);
  const end = coerceVerse(selection.endVerse);
  if (start == null || end == null) return null;
  return start <= end ? { start, end } : { start: end, end: start };
}

function refreshExploreContext() {
  const range = normalizedRangeFromSelection();
  if (!range) {
    state.explore.context = null;
    return;
  }

  state.explore.context = {
    bookId: state.bookId,
    chapter: state.chapter,
    translationId: state.translationId,
    verse: state.selection.mode === "single" ? range.start : null,
    range: state.selection.mode === "range" ? range : null,
    selectedEntities: null,
  };
}

function setSelectionNone() {
  state.selection.mode = "none";
  state.selection.startVerse = null;
  state.selection.endVerse = null;
  refreshExploreContext();
}

function clearSelection() {
  setSelectionNone();
}

function setSelectionSingle(verse) {
  const v = coerceVerse(verse);
  if (v == null) {
    setSelectionNone();
    return;
  }
  state.focusedVerse = v;
  state.selection.mode = "single";
  state.selection.startVerse = v;
  state.selection.endVerse = v;
  refreshExploreContext();
}

function setSelectionRange(startVerse, endVerse) {
  const start = coerceVerse(startVerse);
  const end = coerceVerse(endVerse);
  if (start == null || end == null) {
    setSelectionNone();
    return;
  }
  state.focusedVerse = end;
  state.selection.mode = start === end ? "single" : "range";
  state.selection.startVerse = start;
  state.selection.endVerse = end;
  refreshExploreContext();
}

function extendSelectionToVerse(verse) {
  const v = coerceVerse(verse);
  if (v == null) return;
  if (state.selection.mode === "none") {
    setSelectionSingle(v);
    return;
  }
  const anchor = coerceVerse(state.selection.startVerse) ?? coerceVerse(state.focusedVerse) ?? v;
  setSelectionRange(anchor, v);
}

function focusVerse(verse) {
  state.focusedVerse = coerceVerse(verse);
  if (state.selection.mode === "single") {
    state.selection.startVerse = state.focusedVerse;
    state.selection.endVerse = state.focusedVerse;
    refreshExploreContext();
  }
}

function setLocation({ bookId, bookLabel = state.bookLabel, chapter, translationId }) {
  if (typeof bookId === "string") state.bookId = bookId;
  if (typeof bookLabel === "string") state.bookLabel = bookLabel;
  if (Number.isFinite(Number(chapter))) state.chapter = Number(chapter);
  if (typeof translationId === "string") state.translationId = translationId;
  refreshExploreContext();
}

function setPromptText(text) {
  state.explore.promptText = String(text ?? "");
}

function setUiState(partial) {
  Object.assign(state.ui, partial || {});
}

function setChromeHidden(hidden) {
  state.ui.chromeHidden = Boolean(hidden);
}

function resetChrome() {
  state.ui.chromeHidden = false;
}

function updateChromeFromScroll({ scrollTop = 0, previousScrollTop = 0, minTop = 56, minDelta = 12 } = {}) {
  const currentTop = Math.max(0, Number(scrollTop) || 0);
  const prevTop = Math.max(0, Number(previousScrollTop) || 0);
  const delta = currentTop - prevTop;

  if (currentTop < minTop) {
    setChromeHidden(false);
  } else if (Math.abs(delta) >= minDelta) {
    setChromeHidden(delta > 0);
  }

  return {
    previousScrollTop: currentTop,
    chromeHidden: state.ui.chromeHidden,
  };
}

function planInsightsOpen({ isMobile = false, isTablet = false, libraryPinned = false } = {}) {
  if (isMobile) {
    state.ui.isInsightsOpen = true;
    return { insightsOpen: true, insightsPinned: null };
  }
  if (isTablet && libraryPinned) {
    state.ui.isInsightsOpen = true;
    return { insightsOpen: true, insightsPinned: null };
  }
  state.ui.isInsightsOpen = true;
  return { insightsOpen: false, insightsPinned: true };
}

function prepareExploreTrigger({
  verse = null,
  fallbackVerse = null,
  promptText = null,
  selectedEntities = null,
} = {}) {
  const nextVerse = coerceVerse(verse) ?? coerceVerse(fallbackVerse);
  if (nextVerse != null) {
    if (state.selection.mode === "none") setSelectionSingle(nextVerse);
    else focusVerse(nextVerse);
  }

  if (promptText != null) setPromptText(promptText);
  refreshExploreContext();
  if (selectedEntities != null) setSelectedEntities(selectedEntities);

  return buildExploreContextPayload();
}

function setTtsState(partial) {
  Object.assign(state.tts, partial || {});
}

function setSelectedEntities(entityIds) {
  if (!state.explore.context) refreshExploreContext();
  if (!state.explore.context) return;
  state.explore.context = {
    ...state.explore.context,
    selectedEntities: Array.isArray(entityIds) ? [...entityIds] : null,
  };
}

function buildExploreContextPayload({ includePrompt = true } = {}) {
  const context = state.explore.context;
  if (!context) return null;
  const payload = {
    bookId: context.bookId,
    chapter: context.chapter,
    translationId: context.translationId,
  };
  if (context.verse != null) payload.verse = context.verse;
  if (context.range) payload.range = { ...context.range };
  if (Array.isArray(context.selectedEntities) && context.selectedEntities.length) {
    payload.selectedEntities = [...context.selectedEntities];
  }
  if (includePrompt) payload.promptText = state.explore.promptText;
  return payload;
}

const selectedRangeNormalized = computed(() => normalizedRangeFromSelection());
const hasSelection = computed(() => state.selection.mode !== "none" && !!selectedRangeNormalized.value);
const selectionVerseList = computed(() => {
  const range = selectedRangeNormalized.value;
  if (!range) return [];
  const verses = [];
  for (let v = range.start; v <= range.end; v += 1) verses.push(v);
  return verses;
});
const selectionLabel = computed(() => {
  const range = selectedRangeNormalized.value;
  if (!range || !state.bookId) return "";
  const book = state.bookLabel || state.bookId;
  if (range.start === range.end) return `${book} ${state.chapter}:${range.start}`;
  return `${book} ${state.chapter}:${range.start}\u2013${range.end}`;
});

export function useReaderState() {
  return {
    state,
    selectedRangeNormalized,
    selectionVerseList,
    hasSelection,
    selectionLabel,
    buildExploreContextPayload,
    setLocation,
    setPromptText,
    setUiState,
    setChromeHidden,
    resetChrome,
    updateChromeFromScroll,
    planInsightsOpen,
    setTtsState,
    setSelectedEntities,
    prepareExploreTrigger,
    focusVerse,
    clearSelection,
    setSelectionNone,
    setSelectionSingle,
    setSelectionRange,
    extendSelectionToVerse,
    refreshExploreContext,
  };
}
