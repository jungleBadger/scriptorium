<script setup>
import { computed, nextTick, watch } from "vue";

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
  hasPrev: { type: Boolean, default: false },
  hasNext: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  error: { type: String, default: null },
});

const emit = defineEmits([
  "select-verse",
  "find-parallels",
  "show-entities",
  "clear-selection",
  "go-prev",
  "go-next",
]);

function selectVerse(verseNumber) {
  emit("select-verse", verseNumber);
}

function onFindParallels(verseNumber) {
  emit("find-parallels", verseNumber);
}

function normalizeTerm(term) {
  return String(term || "").trim();
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

  const escapedTerms = terms.map((term) =>
    term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  );

  return new RegExp(`(${escapedTerms.join("|")})`, "gi");
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
    const normalizedVerse = Number(verse);
    if (!Number.isFinite(normalizedVerse)) continue;
    verses.add(normalizedVerse);
  }
  return verses;
});

function getHighlightedParts(text) {
  const content = String(text || "");
  const regex = highlightRegex.value;
  if (!regex || !content) {
    return [{ text: content, isMatch: false }];
  }

  const parts = [];
  let lastIndex = 0;
  for (const match of content.matchAll(regex)) {
    const index = match.index ?? 0;
    const matchedText = match[0];
    if (!matchedText) continue;

    if (index > lastIndex) {
      parts.push({ text: content.slice(lastIndex, index), isMatch: false });
    }

    parts.push({
      text: matchedText,
      isMatch: true,
      isSelectedMatch: selectedTermKeys.value.has(normalizeTermKey(matchedText)),
    });
    lastIndex = index + matchedText.length;
  }

  if (parts.length === 0) {
    return [{ text: content, isMatch: false }];
  }

  if (lastIndex < content.length) {
    parts.push({ text: content.slice(lastIndex), isMatch: false });
  }

  return parts;
}

function isSelectedEntityVerse(verseNumber) {
  return selectedEntityVerseSet.value.has(verseNumber);
}

const verseElements = new Map();

function setVerseElement(verseNumber, el) {
  if (!el) {
    verseElements.delete(verseNumber);
    return;
  }
  verseElements.set(verseNumber, el);
}

async function scrollToActiveVerse(behavior = "smooth") {
  if (props.activeVerse == null) return;
  await nextTick();
  const target = verseElements.get(props.activeVerse);
  if (!target) return;
  target.scrollIntoView({ behavior, block: "center" });
}

watch(
  () => props.activeVerse,
  (nextVerse) => {
    if (nextVerse == null) return;
    scrollToActiveVerse("smooth");
  }
);

watch(
  () => props.verses,
  () => {
    if (props.activeVerse == null) return;
    scrollToActiveVerse("auto");
  }
);
</script>

<template>
  <section class="surface-card reader-pane">
    <header class="reader-header">
      <div>
        <p class="reader-ref">{{ bookName }} {{ chapter }}</p>
        <p class="reader-subref">{{ bookId }} · {{ translation }}</p>
        <div v-if="activeVerse != null" class="reader-active-row">
          <p class="reader-active-ref">Active verse: {{ bookId }} {{ chapter }}:{{ activeVerse }}</p>
          <button class="inline-link-btn" type="button" @click="$emit('clear-selection')">
            Clear
          </button>
        </div>
      </div>
      <div class="reader-nav">
        <button class="ghost-btn" type="button" :disabled="!hasPrev" @click="$emit('go-prev')">
          Previous chapter
        </button>
        <button class="ghost-btn" type="button" :disabled="!hasNext" @click="$emit('go-next')">
          Next chapter
        </button>
      </div>
    </header>

    <div class="reader-content">
      <div v-if="loading && verses.length" class="reader-loading-banner">
        Loading chapter...
      </div>

      <div v-if="error" class="state-error">{{ error }}</div>
      <div v-else-if="!verses.length && loading" class="reader-skeleton">
        <div v-for="line in 8" :key="line" class="skeleton-line"></div>
      </div>
      <div v-else-if="!verses.length" class="state-text">No verses found for this chapter.</div>

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
            },
          ]"
        >
          <button class="verse-button" type="button" @click="selectVerse(verse.verse)">
            <span class="verse-number">{{ verse.verse }}</span>
            <span>
              <template v-for="(part, partIndex) in getHighlightedParts(verse.text)" :key="partIndex">
                <mark
                  v-if="part.isMatch"
                  :class="['entity-highlight', { 'entity-highlight-selected': part.isSelectedMatch }]"
                >
                  {{ part.text }}
                </mark>
                <span v-else>{{ part.text }}</span>
              </template>
            </span>
          </button>

          <div v-if="activeVerse === verse.verse" class="verse-actions">
            <button class="ghost-btn compact" type="button" @click="onFindParallels(verse.verse)">
              Find parallels
            </button>
          </div>
        </li>
      </ol>

      <div class="chapter-pager">
        <button class="ghost-btn" type="button" :disabled="!hasPrev" @click="$emit('go-prev')">
          Previous chapter
        </button>
        <button class="ghost-btn" type="button" :disabled="!hasNext" @click="$emit('go-next')">
          Next chapter
        </button>
      </div>
    </div>
  </section>
</template>
