<script setup>
import { computed } from "vue";
import { PT_BR_BOOK_NAMES } from "../../data/bookNamesPtBr.js";

const props = defineProps({
  thread: { type: Object, required: true },
});

const emit = defineEmits(["open-reference", "open-entity"]);

const entity = computed(() => props.thread.data || null);
const enrichment = computed(() => entity.value?.metadata?.llm_enrichment || {});
const hasEnrichedDescription = computed(() => Boolean(enrichment.value.description_rich));
const description = computed(
  () => enrichment.value.description_rich || entity.value?.description || "No description available."
);
const enrichedDescriptionMetaTitle = computed(() => {
  const model = String(enrichment.value?.model || "").trim();
  const enrichedAt = formatDate(enrichment.value?.enriched_at);
  const parts = [];
  if (model) parts.push(`Model: ${model}`);
  if (enrichedAt) parts.push(`Enriched: ${enrichedAt}`);
  return parts.join(" | ");
});

const crossReferences = computed(() => {
  const refs = enrichment.value.cross_references;
  return Array.isArray(refs) ? refs : [];
});

const isLocationEntity = computed(() => {
  const typeValue = String(entity.value?.type || "").trim().toLowerCase();
  if (
    /(place|location|geo|region|river|mountain|city|town|village|sea|lake|island|desert|valley|country)/.test(typeValue)
  ) {
    return true;
  }
  return entity.value?.lon != null || entity.value?.lat != null;
});

const BOOK_INDEX = new Map(Object.keys(PT_BR_BOOK_NAMES).map((bookId, idx) => [bookId, idx]));
const UNKNOWN_BOOK_INDEX = Number.MAX_SAFE_INTEGER;

const verseLinks = computed(() => {
  const source = Array.isArray(entity.value?.verses) ? entity.value.verses : [];
  return [...source].sort(compareVerseRefs);
});

function compareVerseRefs(a, b) {
  const aBook = String(a?.book_id || "").trim();
  const bBook = String(b?.book_id || "").trim();
  const aBookIdx = BOOK_INDEX.has(aBook) ? BOOK_INDEX.get(aBook) : UNKNOWN_BOOK_INDEX;
  const bBookIdx = BOOK_INDEX.has(bBook) ? BOOK_INDEX.get(bBook) : UNKNOWN_BOOK_INDEX;

  if (aBookIdx !== bBookIdx) return aBookIdx - bBookIdx;
  if (aBookIdx === UNKNOWN_BOOK_INDEX && aBook !== bBook) return aBook.localeCompare(bBook);

  const aChapter = Number(a?.chapter);
  const bChapter = Number(b?.chapter);
  const safeAChapter = Number.isFinite(aChapter) ? aChapter : UNKNOWN_BOOK_INDEX;
  const safeBChapter = Number.isFinite(bChapter) ? bChapter : UNKNOWN_BOOK_INDEX;
  if (safeAChapter !== safeBChapter) return safeAChapter - safeBChapter;

  const aVerse = Number(a?.verse);
  const bVerse = Number(b?.verse);
  const safeAVerse = Number.isFinite(aVerse) ? aVerse : UNKNOWN_BOOK_INDEX;
  const safeBVerse = Number.isFinite(bVerse) ? bVerse : UNKNOWN_BOOK_INDEX;
  if (safeAVerse !== safeBVerse) return safeAVerse - safeBVerse;

  return `${aBook}:${aChapter}:${aVerse}`.localeCompare(`${bBook}:${bChapter}:${bVerse}`);
}

function openEntity(relatedEntity) {
  emit("open-entity", {
    entityId: relatedEntity.id,
    name: relatedEntity.canonical_name,
    anchor: props.thread.anchor,
  });
}

function openVerse(verseRef) {
  emit("open-reference", {
    book_id: verseRef.book_id,
    chapter: verseRef.chapter,
    verse: verseRef.verse,
  });
}

function formatDate(iso) {
  return iso
    ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    : "";
}
</script>

<template>
  <div>
    <p v-if="thread.status === 'loading'" class="state-text">Loading entity detail...</p>
    <p v-else-if="thread.status === 'error'" class="state-error">{{ thread.error }}</p>
    <p v-else-if="!entity" class="state-text">Entity detail unavailable.</p>

    <div v-else class="stack-list">
      <section class="stack-block">
        <img
          v-if="isLocationEntity && entity.thumbnail?.url"
          :src="entity.thumbnail.url"
          :alt="entity.canonical_name"
          class="entity-hero-image"
        />

        <div :class="['entity-detail-header', { 'entity-detail-header--hero': isLocationEntity && entity.thumbnail?.url }]">
          <img
            v-if="!isLocationEntity && entity.thumbnail?.url"
            :src="entity.thumbnail.url"
            :alt="entity.canonical_name"
            class="entity-thumb entity-thumb-lg"
          />
          <div>
            <p class="entity-name">{{ entity.canonical_name }}</p>
            <p class="entity-type">{{ entity.type || "unknown" }}</p>
          </div>
        </div>
        <p class="result-text">{{ description }}</p>
        <p
          v-if="hasEnrichedDescription"
          class="ai-disclaimer"
          :title="enrichedDescriptionMetaTitle || null"
        >
          Enriched with AI - may contain errors
        </p>
      </section>

      <section v-if="entity.lon != null" class="stack-block">
        <p class="section-label">Location</p>
        <p class="geo-coords">{{ entity.lat?.toFixed(4) }}, {{ entity.lon?.toFixed(4) }}</p>
        <p class="meta-note">Geo data available - map coming soon</p>
      </section>

      <section v-if="entity.aliases?.length" class="stack-block">
        <p class="section-label">Aliases</p>
        <div class="chip-row">
          <span v-for="alias in entity.aliases" :key="alias" class="chip">{{ alias }}</span>
        </div>
      </section>

      <section v-if="entity.related?.length" class="stack-block">
        <p class="section-label">Related Entities</p>
        <div class="chip-row">
          <button
            v-for="related in entity.related"
            :key="related.id"
            type="button"
            class="chip chip-button"
            @click="openEntity(related)"
          >
            {{ related.canonical_name }}
          </button>
        </div>
      </section>

      <section v-if="verseLinks.length" class="stack-block">
        <p class="section-label">Verse Links</p>
        <div class="chip-row">
          <button
            v-for="verseRef in verseLinks.slice(0, 12)"
            :key="`${verseRef.book_id}-${verseRef.chapter}-${verseRef.verse}`"
            type="button"
            class="chip chip-button"
            @click="openVerse(verseRef)"
          >
            {{ verseRef.book_id }} {{ verseRef.chapter }}:{{ verseRef.verse }}
          </button>
        </div>
      </section>

      <section v-if="crossReferences.length" class="stack-block">
        <p class="section-label">Cross References</p>
        <ul class="note-list">
          <li v-for="reference in crossReferences" :key="reference">{{ reference }}</li>
        </ul>
      </section>

    </div>
  </div>
</template>
