<script setup>
import { ref } from "vue";
import ReaderSettingsPanel from "./ReaderSettingsPanel.vue";

defineProps({
  translation: { type: String, required: true },
  availableTranslations: { type: Array, default: () => ["WEBU"] },
  quickQuery: { type: String, default: "" },
  isExploring: { type: Boolean, default: false },
  exploreError: { type: String, default: null },
  libraryActive: { type: Boolean, default: false },
  insightsActive: { type: Boolean, default: false },
});

const emit = defineEmits([
  "translation-change",
  "quick-query-change",
  "explore-query",
  "settings-change",
  "toggle-library",
  "toggle-insights",
]);

const showSettings = ref(false);
const gearBtnRef = ref(null);
const settingsAnchor = ref({ top: 0, right: 0 });

function openSettings() {
  const rect = gearBtnRef.value?.getBoundingClientRect();
  if (rect) {
    settingsAnchor.value = {
      top: rect.bottom + 8,
      right: window.innerWidth - rect.right,
    };
  }
  showSettings.value = !showSettings.value;
}
</script>

<template>
  <header class="global-top-bar">
    <div class="global-top-bar-row">
      <button
        class="nav-icon-btn panel-toggle-btn"
        type="button"
        :aria-pressed="libraryActive"
        :class="{ 'panel-toggle-btn--active': libraryActive }"
        aria-label="Toggle Library panel"
        title="Library"
        @click="emit('toggle-library')"
      >
        <span class="panel-toggle-icon" aria-hidden="true">&#9776;</span>
        <span class="panel-toggle-label">Library</span>
      </button>

      <input
        :value="quickQuery"
        type="text"
        class="field-input gtb-explore-input"
        placeholder="Ask about this passage..."
        aria-label="Explore query"
        :aria-busy="isExploring ? 'true' : 'false'"
        @input="emit('quick-query-change', $event.target.value)"
        @keyup.enter.prevent="emit('explore-query')"
      />
      <button
        class="primary-btn compact gtb-explore-btn"
        type="button"
        :disabled="isExploring"
        :aria-busy="isExploring ? 'true' : 'false'"
        @click="emit('explore-query')"
      >
        <span v-if="isExploring" class="gtb-spinner" aria-hidden="true"></span>
        {{ isExploring ? "Exploring..." : "Explore" }}
      </button>

      <span class="gtb-spacer" aria-hidden="true"></span>

      <button
        ref="gearBtnRef"
        class="nav-icon-btn reader-settings-btn"
        type="button"
        :aria-pressed="showSettings"
        title="Reader settings"
        @click="openSettings"
      >
        &#9881;
      </button>

      <button
        class="nav-icon-btn panel-toggle-btn"
        type="button"
        :aria-pressed="insightsActive"
        :class="{ 'panel-toggle-btn--active': insightsActive }"
        aria-label="Toggle Insights panel"
        title="Insights"
        @click="emit('toggle-insights')"
      >
        <span class="panel-toggle-label">Insights</span>
        <span class="panel-toggle-icon" aria-hidden="true">&#10024;</span>
      </button>
    </div>

    <Teleport to="body">
      <ReaderSettingsPanel
        v-if="showSettings"
        :translation="translation"
        :available-translations="availableTranslations"
        :style="{
          position: 'fixed',
          top: settingsAnchor.top + 'px',
          right: settingsAnchor.right + 'px',
          zIndex: 1200,
        }"
        @close="showSettings = false"
        @settings-change="emit('settings-change', $event)"
        @translation-change="emit('translation-change', $event)"
      />
    </Teleport>

    <p v-if="exploreError" class="gtb-explore-error" role="status" aria-live="polite">
      {{ exploreError }}
    </p>
  </header>
</template>
