<script setup>
import { computed, ref } from "vue";
import Icon from "../ui/Icon.vue";
import { formatEntitySubtypeLabel, shouldShowEntitySubtypeTag } from "../../utils/entityTypeLabels.js";

const props = defineProps({
  thread: { type: Object, required: true },
});

const emit = defineEmits(["open-reference", "open-entity"]);

const passagesOpen = ref(true);
const entitiesOpen = ref(true);

const answerText = computed(() => String(props.thread?.data?.raw_response_text || "").trim());
const relevantPassages = computed(() =>
  Array.isArray(props.thread?.data?.relevant_passages) ? props.thread.data.relevant_passages : []
);
const foundEntities = computed(() =>
  Array.isArray(props.thread?.data?.found_entities) ? props.thread.data.found_entities : []
);

function openPassage(passage) {
  emit("open-reference", {
    book_id: passage.book_id,
    chapter: passage.chapter,
    verse_start: passage.verse_start,
    verse_end: passage.verse_end,
  });
}

function openEntity(entity) {
  const entityId = Number(entity?.id);
  if (!Number.isFinite(entityId)) return;
  emit("open-entity", {
    entityId,
    name: entity.name || `#${entityId}`,
    anchor: props.thread.anchor,
  });
}

function openEntityRef(ref) {
  emit("open-reference", {
    book_id: ref.book_id,
    chapter: ref.chapter,
    verse: ref.verse,
  });
}
</script>

<template>
  <div>
    <p v-if="thread.status === 'loading'" class="state-text">Exploring with local assistant...</p>
    <p v-else-if="thread.status === 'error'" class="state-error">{{ thread.error }}</p>
    <p v-else-if="!answerText && !relevantPassages.length && !foundEntities.length" class="state-text">
      No response yet.
    </p>

    <div v-else class="stack-list">
      <section class="stack-block ask-answer-block">
        <p class="section-label">Answer</p>
        <p v-if="answerText" class="result-text ask-answer-text">{{ answerText }}</p>
        <p v-else class="state-text">No answer text returned.</p>
      </section>

      <section class="entity-group">
        <button class="entity-group-toggle" type="button" @click="passagesOpen = !passagesOpen">
          <span class="entity-group-title">Relevant Passages ({{ relevantPassages.length }})</span>
          <span class="entity-group-chevron">
            <Icon :name="passagesOpen ? 'ChevronUp' : 'ChevronDown'" :size="16" class="text-neutral-600" aria-hidden="true" />
          </span>
        </button>

        <div v-if="passagesOpen" class="stack-list">
          <p v-if="!relevantPassages.length" class="state-text">No relevant passages found.</p>

          <article v-for="passage in relevantPassages" :key="passage.id" class="result-card">
            <div class="result-header">
              <p class="result-ref">{{ passage.ref || `${passage.book_id} ${passage.chapter}:${passage.verse_start}` }}</p>
              <span class="pill">{{ passage.source || "chunk" }}</span>
            </div>
            <p class="result-text">{{ passage.snippet }}</p>
            <div class="result-actions">
              <button class="primary-btn compact" type="button" @click="openPassage(passage)">
                Open in reader
              </button>
            </div>
          </article>
        </div>
      </section>

      <section class="entity-group">
        <button class="entity-group-toggle" type="button" @click="entitiesOpen = !entitiesOpen">
          <span class="entity-group-title">Found Entities ({{ foundEntities.length }})</span>
          <span class="entity-group-chevron">
            <Icon :name="entitiesOpen ? 'ChevronUp' : 'ChevronDown'" :size="16" class="text-neutral-600" aria-hidden="true" />
          </span>
        </button>

        <div v-if="entitiesOpen" class="entity-context-list">
          <p v-if="!foundEntities.length" class="state-text">No entity matches found.</p>

          <article
            v-for="entity in foundEntities"
            :key="entity.id"
            class="entity-context-row"
            @click="openEntity(entity)"
          >
            <div class="entity-context-body">
              <p class="entity-name">
                {{ entity.name }}
                <span
                  v-if="shouldShowEntitySubtypeTag(entity.name, entity.type)"
                  class="entity-subtype"
                  :title="formatEntitySubtypeLabel(entity.type)"
                >
                  {{ formatEntitySubtypeLabel(entity.type) }}
                </span>
              </p>
              <div v-if="entity.appears_in?.length" class="chip-row ask-entity-refs">
                <button
                  v-for="ref in entity.appears_in.slice(0, 5)"
                  :key="ref.ref"
                  type="button"
                  class="chip chip-button"
                  @click.stop="openEntityRef(ref)"
                >
                  {{ ref.ref }}
                </button>
              </div>
            </div>
          </article>
        </div>
      </section>
    </div>
  </div>
</template>
