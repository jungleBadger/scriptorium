<script setup>
import { computed } from "vue";
import ChapterContextThreadCard from "./threads/ChapterContextThreadCard.vue";
import EntityDetailThreadCard from "./threads/EntityDetailThreadCard.vue";
import ParallelThreadCard from "./threads/ParallelThreadCard.vue";
import AskThreadCard from "./threads/AskThreadCard.vue";

const props = defineProps({
  currentView: { type: Object, default: null },
  canGoBack: { type: Boolean, default: false },
  stackDepth: { type: Number, default: 0 },
  selectedEntityId: { type: Number, default: null },
  bookName: { type: String, default: "" },
  chapter: { type: Number, default: null },
  chapterTotal: { type: Number, default: null },
  verseCount: { type: Number, default: null },
  selectedEntityType: { type: String, default: null },
});

const emit = defineEmits(["go-back", "clear-context", "select-entity", "open-reference", "open-entity"]);

const headerTitle = computed(() => {
  if (props.currentView?.type === "chapterContext") {
    return props.bookName || "Context";
  }
  return props.currentView?.title || "Context";
});

const headerChapterProgress = computed(() => {
  if (props.currentView?.type !== "chapterContext") return null;
  const current = Number(props.chapter);
  const total = Number(props.chapterTotal);
  if (Number.isFinite(current) && current > 0 && Number.isFinite(total) && total > 0)
    return `${current}/${total}`;
  if (Number.isFinite(current) && current > 0) return String(current);
  return null;
});

const headerSubtitle = computed(() => {
  if (props.currentView?.type === "chapterContext") {
    if (props.selectedEntityType) return props.selectedEntityType;
    const count = Number(props.verseCount);
    if (Number.isFinite(count) && count >= 0) {
      return `${count} verse${count === 1 ? "" : "s"}`;
    }
    return "";
  }
  if (props.currentView?.type === "entityDetail") {
    const parts = [];
    if (props.selectedEntityType) parts.push(props.selectedEntityType);
    const ref = props.currentView?.anchor?.reference;
    if (ref) parts.push(ref);
    return parts.join(" | ");
  }
  return props.currentView?.anchor?.reference || "";
});
</script>

<template>
  <aside class="context-pane">
    <header class="context-header">
      <div class="context-header-left">
        <button
          v-if="canGoBack"
          class="nav-icon-btn"
          type="button"
          @click="emit('go-back')"
        >
          &larr; Back
        </button>
        <div class="context-header-info">
          <p class="context-kicker">Insights</p>
          <h2 class="context-title">{{ headerTitle }}</h2>
          <p v-if="headerChapterProgress || headerSubtitle" class="context-subtitle">
            <span v-if="headerChapterProgress">{{ headerChapterProgress }}</span>
            <span v-if="headerChapterProgress && headerSubtitle" class="context-meta-sep">&middot;</span>
            <span v-if="headerSubtitle">{{ headerSubtitle }}</span>
          </p>
        </div>
      </div>
      <button
        v-if="currentView"
        class="nav-icon-btn"
        type="button"
        aria-label="Close"
        @click="emit('clear-context')"
      >
        &times;
      </button>
    </header>

    <div class="view-scroll">
      <div v-if="!currentView" class="state-text context-empty-state">
        Open a chapter to begin exploring.
      </div>

      <div v-else class="context-view-body">
        <ChapterContextThreadCard
          v-if="currentView.type === 'chapterContext'"
          :thread="currentView"
          :selected-entity-id="selectedEntityId"
          @select-entity="emit('select-entity', $event)"
          @open-entity="emit('open-entity', $event)"
        />

        <EntityDetailThreadCard
          v-else-if="currentView.type === 'entityDetail'"
          :thread="currentView"
          @open-reference="emit('open-reference', $event)"
          @open-entity="emit('open-entity', $event)"
        />

        <ParallelThreadCard
          v-else-if="currentView.type === 'parallelSearch'"
          :thread="currentView"
          @open-reference="emit('open-reference', $event)"
          @open-entity="emit('open-entity', $event)"
        />

        <AskThreadCard
          v-else-if="currentView.type === 'askResponse'"
          :thread="currentView"
          @open-reference="emit('open-reference', $event)"
          @open-entity="emit('open-entity', $event)"
        />
      </div>
    </div>
  </aside>
</template>
