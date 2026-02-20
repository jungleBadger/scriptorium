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
