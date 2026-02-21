<script setup>
import { ref } from "vue";

const props = defineProps({
  thread: { type: Object, required: true },
});

const emit = defineEmits(["open-entity"]);
const failedImageUrls = ref({});

function openEntity(entity) {
  emit("open-entity", {
    entityId: entity.id,
    name: entity.canonical_name,
    anchor: props.thread.anchor,
  });
}

function isPlaceEntity(entity) {
  const typeValue = String(entity?.type || "").trim().toLowerCase();
  if (
    /(place|location|geo|region|river|mountain|city|town|village|sea|lake|island|desert|valley|country)/.test(typeValue)
  ) {
    return true;
  }
  return entity?.lon != null || entity?.lat != null;
}

function getPlaceImageDescription(entity) {
  const credit = String(entity?.thumbnail?.credit || "").trim();
  if (credit) return `Image source: OpenBible Images. Credit: ${credit}.`;
  return "Image source: OpenBible Images.";
}

function onImageError(url) {
  const key = String(url || "").trim();
  if (!key || failedImageUrls.value[key]) return;
  failedImageUrls.value = {
    ...failedImageUrls.value,
    [key]: true,
  };
}

function hasImageFailed(url) {
  const key = String(url || "").trim();
  return key ? Boolean(failedImageUrls.value[key]) : false;
}

function getEntityInitials(name) {
  const clean = String(name || "").trim();
  if (!clean) return "?";
  const parts = clean.split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
}
</script>

<template>
  <div>
    <p v-if="thread.status === 'loading'" class="state-text">Looking up entities...</p>
    <p v-else-if="thread.status === 'error'" class="state-error">{{ thread.error }}</p>
    <p v-else-if="!thread.data?.length" class="state-text">No linked entities for this verse.</p>

    <div v-else class="stack-list">
      <article
        v-for="entity in thread.data"
        :key="entity.id"
        class="entity-context-row entity-row"
        @click="openEntity(entity)"
      >
        <img
          v-if="entity.thumbnail?.url && !hasImageFailed(entity.thumbnail.url)"
          :src="entity.thumbnail.url"
          :alt="entity.canonical_name"
          :title="isPlaceEntity(entity) ? getPlaceImageDescription(entity) : null"
          :aria-description="isPlaceEntity(entity) ? getPlaceImageDescription(entity) : null"
          @error="onImageError(entity.thumbnail.url)"
          class="entity-thumb"
        />
        <div
          v-else-if="entity.thumbnail?.url"
          class="entity-thumb entity-thumb-placeholder entity-thumb--fallback"
          role="img"
          :aria-label="`Image unavailable for ${entity.canonical_name}`"
        >
          {{ getEntityInitials(entity.canonical_name) }}
        </div>
        <div class="entity-context-body">
          <p class="entity-name">{{ entity.canonical_name }}</p>
          <p class="entity-type">{{ entity.type || "unknown" }}</p>
        </div>
      </article>
    </div>
  </div>
</template>
