<script setup>
import { computed, ref } from "vue";
import { PT_BR_BOOK_NAMES } from "../../data/bookNamesPtBr.js";
import MapCard from "../MapCard.vue";
import Icon from "../ui/Icon.vue";
import {
  formatEntitySubtypeLabel,
  formatEntityTypeLabel,
  getEntityTypeParts,
  shouldShowEntitySubtypeTag,
} from "../../utils/entityTypeLabels.js";

const props = defineProps({
  thread: { type: Object, required: true },
  chapterEntities: { type: Array, default: () => [] },
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

const currentEntityTypeParts = computed(() => getEntityTypeParts(entity.value?.type));

const similarChapterEntities = computed(() => {
  const current = entity.value;
  if (!current) return [];

  const currentId = Number(current.id);
  const currentNameKey = String(current.canonical_name || "").trim().toLowerCase();
  const currentType = currentEntityTypeParts.value;
  if (!currentType?.groupKey || currentType.groupKey === "other") return [];

  const deduped = new Map();
  for (const raw of Array.isArray(props.chapterEntities) ? props.chapterEntities : []) {
    if (!raw || typeof raw !== "object") continue;

    const candidateId = Number(raw.id);
    const candidateName = String(raw.canonical_name || raw.name || "").trim();
    if (!candidateName && !Number.isFinite(candidateId)) continue;
    if (Number.isFinite(currentId) && Number.isFinite(candidateId) && candidateId === currentId) continue;
    if (!Number.isFinite(currentId) && currentNameKey && candidateName.toLowerCase() === currentNameKey) continue;

    const typeParts = getEntityTypeParts(raw.type);
    if (typeParts.groupKey !== currentType.groupKey) continue;

    const subtypeLabel = formatEntitySubtypeLabel(raw.type, "");
    const verseList = normalizeVerseList(raw.chapter_verses);
    const sameSubtype = Boolean(
      currentType.subtypeKey &&
      typeParts.subtypeKey &&
      currentType.subtypeKey === typeParts.subtypeKey
    );
    const dedupeKey = Number.isFinite(candidateId)
      ? `id:${candidateId}`
      : `${candidateName.toLowerCase()}|${typeParts.subtypeKey || ""}`;

    const existing = deduped.get(dedupeKey);
    if (!existing) {
      deduped.set(dedupeKey, {
        ...raw,
        id: Number.isFinite(candidateId) ? candidateId : null,
        canonical_name: candidateName || "Unknown",
        _sortName: (candidateName || "Unknown").toLowerCase(),
        _sameSubtype: sameSubtype,
        _occurrenceCount: verseList.length,
        chapter_verses: verseList,
        _subtypeLabel: subtypeLabel,
        _subtypeKey: typeParts.subtypeKey,
      });
      continue;
    }

    existing.chapter_verses = normalizeVerseList([...(existing.chapter_verses || []), ...verseList]);
    existing._occurrenceCount = existing.chapter_verses.length;
    existing._sameSubtype = existing._sameSubtype || sameSubtype;
    if (!existing._subtypeLabel && subtypeLabel) existing._subtypeLabel = subtypeLabel;
    if (!existing._subtypeKey && typeParts.subtypeKey) existing._subtypeKey = typeParts.subtypeKey;
    if (!existing.id && Number.isFinite(candidateId)) existing.id = candidateId;
  }

  return [...deduped.values()]
    .sort((a, b) => {
      if (a._sameSubtype !== b._sameSubtype) return a._sameSubtype ? -1 : 1;
      const countDiff = (b._occurrenceCount || 0) - (a._occurrenceCount || 0);
      if (countDiff) return countDiff;
      return String(a._sortName || "").localeCompare(String(b._sortName || ""));
    })
    .slice(0, 8);
});

const similarEntitiesTitle = computed(() => {
  const groupKey = currentEntityTypeParts.value?.groupKey;
  if (groupKey === "places") return "Similar Places in This Chapter";
  if (groupKey === "people") return "Similar People in This Chapter";
  return "Related in This Chapter";
});

const mapLanguage = computed(() => {
  return props.thread?.anchor?.translation === "PT1911" ? "pt" : "en";
});

const placeImageCredit = computed(() => String(entity.value?.thumbnail?.credit || "").trim());
const placeImageSourceDescription = computed(() => {
  if (placeImageCredit.value) {
    return `Image source: OpenBible Images. Credit: ${placeImageCredit.value}.`;
  }
  return "Image source: OpenBible Images.";
});

const failedImageUrls = ref({});

const hasLocationImage = computed(() => {
  const url = String(entity.value?.thumbnail?.url || "").trim();
  return Boolean(isLocationEntity.value && url && !failedImageUrls.value[url]);
});

const hasEntityThumbImage = computed(() => {
  const url = String(entity.value?.thumbnail?.url || "").trim();
  return Boolean(!isLocationEntity.value && url && !failedImageUrls.value[url]);
});

function onImageError(url) {
  const key = String(url || "").trim();
  if (!key || failedImageUrls.value[key]) return;
  failedImageUrls.value = {
    ...failedImageUrls.value,
    [key]: true,
  };
}

function getEntityInitials(name) {
  const clean = String(name || "").trim();
  if (!clean) return "?";
  const parts = clean.split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
}

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
  const entityId = Number(relatedEntity?.id);
  if (!Number.isFinite(entityId)) return;
  emit("open-entity", {
    entityId,
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

function normalizeVerseList(values) {
  const unique = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) unique.add(n);
  }
  return [...unique].sort((a, b) => a - b);
}

function formatVerseHint(chapterVerses) {
  const verses = normalizeVerseList(chapterVerses);
  if (!verses.length) return "";
  const ranges = [];
  let start = verses[0];
  let prev = verses[0];
  for (let i = 1; i < verses.length; i += 1) {
    const current = verses[i];
    if (current === prev + 1) {
      prev = current;
      continue;
    }
    ranges.push(start === prev ? String(start) : `${start}-${prev}`);
    start = current;
    prev = current;
  }
  ranges.push(start === prev ? String(start) : `${start}-${prev}`);
  return `${verses.length === 1 ? "v." : "vv."} ${ranges.join(", ")}`;
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
          v-if="hasLocationImage"
          :src="entity.thumbnail.url"
          :alt="entity.canonical_name"
          :title="placeImageSourceDescription"
          :aria-description="placeImageSourceDescription"
          @error="onImageError(entity.thumbnail.url)"
          class="entity-hero-image"
        />
        <div
          v-else-if="isLocationEntity && entity.thumbnail?.url"
          class="entity-hero-image entity-hero-image--fallback"
          role="img"
          :aria-label="`Image unavailable for ${entity.canonical_name}`"
        >
          Image unavailable
        </div>

        <div :class="['entity-detail-header', { 'entity-detail-header--hero': isLocationEntity && entity.thumbnail?.url }]">
          <img
            v-if="hasEntityThumbImage"
            :src="entity.thumbnail.url"
            :alt="entity.canonical_name"
            @error="onImageError(entity.thumbnail.url)"
            class="entity-thumb entity-thumb-lg"
          />
          <div
            v-else-if="!isLocationEntity && entity.thumbnail?.url"
            class="entity-thumb entity-thumb-lg entity-thumb-placeholder entity-thumb--fallback"
            role="img"
            :aria-label="`Image unavailable for ${entity.canonical_name}`"
          >
            {{ getEntityInitials(entity.canonical_name) }}
          </div>
          <div>
            <p class="entity-name">{{ entity.canonical_name }}</p>
            <p class="entity-type">{{ formatEntityTypeLabel(entity.type, { includeGroup: true }) }}</p>
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

      <section v-if="entity.lon != null && entity.lat != null" class="stack-block">
        <p class="section-label">Location</p>
        <MapCard
          :lat="Number(entity.lat)"
          :lon="Number(entity.lon)"
          :title="entity.canonical_name"
          :language="mapLanguage"
        />
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

      <section v-if="similarChapterEntities.length" class="stack-block">
        <p class="section-label">{{ similarEntitiesTitle }}</p>
        <div class="entity-context-list">
          <article
            v-for="similar in similarChapterEntities"
            :key="similar.id ?? `${similar.canonical_name}-${similar._subtypeKey || ''}`"
            class="entity-context-row"
            @click="openEntity(similar)"
          >
            <div class="entity-context-body">
              <p class="entity-name">
                {{ similar.canonical_name }}
                <span
                  v-if="shouldShowEntitySubtypeTag(similar.canonical_name, similar.type)"
                  class="entity-subtype"
                  :title="similar._subtypeLabel || formatEntitySubtypeLabel(similar.type)"
                >
                  {{ similar._subtypeLabel || formatEntitySubtypeLabel(similar.type) }}
                </span>
              </p>
              <p v-if="similar.chapter_verses?.length" class="verse-hint">
                Appears in: {{ formatVerseHint(similar.chapter_verses) }}
              </p>
            </div>
          </article>
        </div>
      </section>

      <section v-if="verseLinks.length" class="stack-block">
        <p class="section-label flex items-center gap-2">
          <Icon name="Link" :size="18" class="text-neutral-600" aria-hidden="true" />
          <span>Verse Links</span>
        </p>
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
