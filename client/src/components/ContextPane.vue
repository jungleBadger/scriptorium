<script setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import ChapterContextThreadCard from "./threads/ChapterContextThreadCard.vue";
import EntityDetailThreadCard from "./threads/EntityDetailThreadCard.vue";
import ParallelThreadCard from "./threads/ParallelThreadCard.vue";
import AskThreadCard from "./threads/AskThreadCard.vue";
import Icon from "./ui/Icon.vue";
import { getEntityTypeParts } from "../utils/entityTypeLabels.js";

const { t } = useI18n();

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

const selectionQuickChips = computed(() => [
  { key: "summary", label: t("context.chips.summary") },
  { key: "themes", label: t("context.chips.themes") },
  { key: "entities", label: t("context.chips.entities") },
  { key: "cross_refs", label: t("context.chips.crossRefs") },
]);

function formatEntityTypeLabelI18n(type) {
  const { groupKey, subtypeKey } = getEntityTypeParts(type);
  const subtypeLabel = subtypeKey ? t(`entities.subtypes.${subtypeKey}`) : "";
  const groupLabel = (groupKey && groupKey !== "other") ? t(`entities.groups.${groupKey}`) : "";
  if (!groupLabel) return subtypeLabel;
  if (groupKey === "people" && subtypeKey === "person") return groupLabel;
  if (groupKey === "places" && subtypeKey === "place") return groupLabel;
  if (!subtypeLabel) return groupLabel;
  return `${groupLabel} \u2022 ${subtypeLabel}`;
}

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
      parts.push(`${count} ${count === 1 ? t('context.verse') : t('context.verses')}`);
    }
    return parts;
  }

  if (props.currentView?.type === "entityDetail") {
    if (props.selectedEntityType) {
      parts.push(formatEntityTypeLabelI18n(props.selectedEntityType));
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
          class="nav-icon-btn flex items-center gap-2"
          type="button"
          :aria-label="t('context.back')"
          @click="emit('go-back')"
        >
          <Icon name="ArrowLeft" :size="20" class="text-neutral-600" aria-hidden="true" />
          <span>{{ t('context.back') }}</span>
        </button>
        <div class="context-header-info">
          <span class="sr-only">{{ t('context.insightsPanel') }}</span>
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
        class="nav-icon-btn context-close-btn group"
        type="button"
        :aria-label="t('context.close')"
        :title="t('context.close')"
        @click="emit('clear-context')"
      >
        <Icon
          name="X"
          :size="20"
          class="text-neutral-600 transition-colors group-hover:text-neutral-900"
          aria-hidden="true"
        />
      </button>
    </header>

    <div v-if="hasSelection" class="context-selection-row" role="status" aria-live="polite">
      <span class="context-selection-label">{{ selectionLabel || t('context.selectionActive') }}</span>
      <button class="inline-link-btn" type="button" @click="emit('clear-selection')">
        {{ t('context.clearSelection') }}
      </button>
    </div>

    <div class="view-scroll">
      <div
        v-if="showSelectionExploreStarter && hasSelection"
        class="context-selection-starter"
        role="region"
        :aria-label="t('context.exploreSelection')"
      >
        <p class="section-label context-selection-starter__kicker">{{ t('context.exploreSelection') }}</p>
        <p class="context-selection-starter__hint">
          {{ t('context.quickPromptHint') }}
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
        {{ hasSelection ? t('context.emptyWithSelection') : t('context.emptyNoChapter') }}
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
