<script setup>
import { computed } from "vue";
import ChapterContextThreadCard from "./threads/ChapterContextThreadCard.vue";
import EntityDetailThreadCard from "./threads/EntityDetailThreadCard.vue";
import ParallelThreadCard from "./threads/ParallelThreadCard.vue";
import AskThreadCard from "./threads/AskThreadCard.vue";
import { formatEntityTypeLabel } from "../utils/entityTypeLabels.js";

const props = defineProps({
  currentView: { type: Object, default: null },
  canGoBack: { type: Boolean, default: false },
  stackDepth: { type: Number, default: 0 },
  selectedEntityId: { type: Number, default: null },
  chapterEntities: { type: Array, default: () => [] },
  bookName: { type: String, default: "" },
  chapter: { type: Number, default: null },
  chapterTotal: { type: Number, default: null },
  verseCount: { type: Number, default: null },
  selectedEntityType: { type: String, default: null },
  hasSelection: { type: Boolean, default: false },
  selectionLabel: { type: String, default: "" },
  showSelectionExploreStarter: { type: Boolean, default: false },
});

const emit = defineEmits([
  "go-back",
  "clear-context",
  "clear-selection",
  "quick-explore",
  "select-entity",
  "open-reference",
  "open-entity",
]);

const selectionQuickChips = [
  { key: "summary", label: "Summary" },
  { key: "themes", label: "Themes" },
  { key: "entities", label: "Entities" },
  { key: "cross_refs", label: "Cross-refs" },
];

const headerTitle = computed(() => {
  if (props.currentView?.type === "chapterContext") {
    const book = String(props.bookName || "").trim();
    const chapter = Number(props.chapter);
    if (book && Number.isFinite(chapter) && chapter > 0) return `${book} ${chapter}`;
    return book || "Context";
  }
  return props.currentView?.title || "Context";
});

const headerMetaParts = computed(() => {
  const parts = [];

  if (props.currentView?.type === "chapterContext") {
    const count = Number(props.verseCount);
    if (Number.isFinite(count) && count >= 0) {
      parts.push(`${count} verse${count === 1 ? "" : "s"}`);
    }
    if (props.hasSelection && props.selectionLabel) {
      parts.push(`Selection: ${props.selectionLabel}`);
    }
    return parts;
  }

  if (props.currentView?.type === "entityDetail") {
    if (props.selectedEntityType) {
      parts.push(formatEntityTypeLabel(props.selectedEntityType, { includeGroup: true }));
    }
    const ref = props.currentView?.anchor?.reference;
    if (ref) parts.push(ref);
    return parts;
  }

  const ref = props.currentView?.anchor?.reference;
  if (ref) parts.push(ref);
  return parts;
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
          aria-label="Back"
          @click="emit('go-back')"
        >
          &larr; Back
        </button>
        <div class="context-header-info">
          <span class="sr-only">Insights panel</span>
          <h2 class="context-title">{{ headerTitle }}</h2>
          <p v-if="headerMetaParts.length" class="context-subtitle">
            <template v-for="(part, index) in headerMetaParts" :key="`${index}-${part}`">
              <span>{{ part }}</span>
              <span v-if="index < headerMetaParts.length - 1" class="context-meta-sep" aria-hidden="true">&bull;</span>
            </template>
          </p>
        </div>
      </div>
      <button
        v-if="currentView"
        class="nav-icon-btn context-close-btn"
        type="button"
        aria-label="Close insights"
        title="Close insights"
        @click="emit('clear-context')"
      >
        &times;
      </button>
    </header>

    <div v-if="hasSelection" class="context-selection-row" role="status" aria-live="polite">
      <span class="context-selection-label">{{ selectionLabel || "Selection active" }}</span>
      <button class="inline-link-btn" type="button" @click="emit('clear-selection')">
        Clear selection
      </button>
    </div>

    <div class="view-scroll">
      <div
        v-if="showSelectionExploreStarter && hasSelection"
        class="context-selection-starter"
        role="region"
        aria-label="Explore selected verses"
      >
        <p class="section-label context-selection-starter__kicker">Explore Selection</p>
        <p class="context-selection-starter__title">{{ selectionLabel || "Selected verses" }}</p>
        <p class="context-selection-starter__hint">
          Choose a quick prompt to generate insights for this verse selection.
        </p>
        <div class="chip-row">
          <button
            v-for="chip in selectionQuickChips"
            :key="chip.key"
            class="chip chip-button"
            type="button"
            @click="emit('quick-explore', chip.key)"
          >
            {{ chip.label }}
          </button>
        </div>
      </div>

      <div v-if="!currentView" class="state-text context-empty-state">
        {{ hasSelection ? "Use a quick prompt above or type a question to explore this selection." : "Open a chapter to begin exploring." }}
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
          :chapter-entities="chapterEntities"
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
