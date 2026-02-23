<script setup>
import { computed, ref } from "vue";
import WhyThisToggle from "../WhyThisToggle.vue";
import Icon from "../ui/Icon.vue";
import { formatEntitySubtypeLabel, shouldShowEntitySubtypeTag } from "../../utils/entityTypeLabels.js";

const props = defineProps({
  thread: { type: Object, required: true },
});

const emit = defineEmits(["open-reference", "open-entity"]);

const passagesOpen = ref(true);
const placesOpen = ref(true);
const peopleOpen = ref(true);

const passages = computed(() => {
  if (Array.isArray(props.thread?.data)) return props.thread.data;
  return Array.isArray(props.thread?.data?.passages) ? props.thread.data.passages : [];
});

const places = computed(() =>
  Array.isArray(props.thread?.data?.places) ? props.thread.data.places : []
);

const people = computed(() =>
  Array.isArray(props.thread?.data?.people) ? props.thread.data.people : []
);

const hasAnyResults = computed(
  () => passages.value.length || places.value.length || people.value.length
);

function formatReference(result) {
  if (!result.ref_start || !result.ref_end || result.ref_start === result.ref_end) {
    return result.ref_start || `${result.book_id} ${result.chapter}:${result.verse_start}`;
  }
  return `${result.ref_start} - ${result.ref_end}`;
}

function openReference(result) {
  emit("open-reference", {
    book_id: result.book_id,
    chapter: result.chapter,
    verse_start: result.verse_start,
  });
}

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
    <p v-if="thread.status === 'loading'" class="state-text">Searching passages and entities...</p>
    <p v-else-if="thread.status === 'error'" class="state-error">{{ thread.error }}</p>
    <p v-else-if="!hasAnyResults" class="state-text">No results found.</p>

    <div v-else class="stack-list">
      <section class="entity-group">
        <button class="entity-group-toggle" type="button" @click="passagesOpen = !passagesOpen">
          <span class="entity-group-title flex items-center gap-2">
            <Icon name="Link" :size="18" class="text-neutral-600" aria-hidden="true" />
            <span>Vector Passages ({{ passages.length }})</span>
          </span>
          <span class="entity-group-chevron">
            <Icon :name="passagesOpen ? 'ChevronUp' : 'ChevronDown'" :size="16" class="text-neutral-600" aria-hidden="true" />
          </span>
        </button>

        <div v-if="passagesOpen" class="stack-list">
          <p v-if="!passages.length" class="state-text">No vector passages found.</p>

          <article v-for="result in passages" :key="result.chunk_id" class="result-card">
            <div class="result-header">
              <p class="result-ref">{{ formatReference(result) }}</p>
              <span class="pill">{{ result.translation }}</span>
            </div>

            <p class="result-text">{{ result.text_clean }}</p>

            <div class="result-actions">
              <button class="primary-btn compact" type="button" @click="openReference(result)">
                Open in reader
              </button>
              <WhyThisToggle :result="result" />
            </div>
          </article>
        </div>
      </section>

      <section class="entity-group">
        <button class="entity-group-toggle" type="button" @click="placesOpen = !placesOpen">
          <span class="entity-group-title flex items-center gap-2">
            <Icon name="MapPin" :size="18" class="text-neutral-600" aria-hidden="true" />
            <span>Places ({{ places.length }})</span>
          </span>
          <span class="entity-group-chevron">
            <Icon :name="placesOpen ? 'ChevronUp' : 'ChevronDown'" :size="16" class="text-neutral-600" aria-hidden="true" />
          </span>
        </button>

        <div v-if="placesOpen" class="entity-context-list">
          <p v-if="!places.length" class="state-text">No place matches.</p>

          <article
            v-for="entity in places"
            :key="entity.id"
            class="entity-context-row"
            @click="openEntity(entity)"
          >
            <div class="entity-context-body">
              <p class="entity-name">
                {{ entity.canonical_name }}
                <span
                  v-if="shouldShowEntitySubtypeTag(entity.canonical_name, entity.type)"
                  class="entity-subtype"
                  :title="formatEntitySubtypeLabel(entity.type)"
                >
                  {{ formatEntitySubtypeLabel(entity.type) }}
                </span>
              </p>
            </div>
          </article>
        </div>
      </section>

      <section class="entity-group">
        <button class="entity-group-toggle" type="button" @click="peopleOpen = !peopleOpen">
          <span class="entity-group-title flex items-center gap-2">
            <Icon name="Users" :size="18" class="text-neutral-600" aria-hidden="true" />
            <span>People ({{ people.length }})</span>
          </span>
          <span class="entity-group-chevron">
            <Icon :name="peopleOpen ? 'ChevronUp' : 'ChevronDown'" :size="16" class="text-neutral-600" aria-hidden="true" />
          </span>
        </button>

        <div v-if="peopleOpen" class="entity-context-list">
          <p v-if="!people.length" class="state-text">No people matches.</p>

          <article
            v-for="entity in people"
            :key="entity.id"
            class="entity-context-row"
            @click="openEntity(entity)"
          >
            <div class="entity-context-body">
              <p class="entity-name">
                {{ entity.canonical_name }}
                <span
                  v-if="shouldShowEntitySubtypeTag(entity.canonical_name, entity.type)"
                  class="entity-subtype"
                  :title="formatEntitySubtypeLabel(entity.type)"
                >
                  {{ formatEntitySubtypeLabel(entity.type) }}
                </span>
              </p>
            </div>
          </article>
        </div>
      </section>
    </div>
  </div>
</template>
