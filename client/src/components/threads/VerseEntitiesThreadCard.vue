<script setup>
const props = defineProps({
  thread: { type: Object, required: true },
});

const emit = defineEmits(["open-entity"]);

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
          v-if="entity.thumbnail?.url"
          :src="entity.thumbnail.url"
          :alt="entity.canonical_name"
          :title="isPlaceEntity(entity) ? getPlaceImageDescription(entity) : null"
          :aria-description="isPlaceEntity(entity) ? getPlaceImageDescription(entity) : null"
          class="entity-thumb"
        />
        <div class="entity-context-body">
          <p class="entity-name">{{ entity.canonical_name }}</p>
          <p class="entity-type">{{ entity.type || "unknown" }}</p>
        </div>
      </article>
    </div>
  </div>
</template>
