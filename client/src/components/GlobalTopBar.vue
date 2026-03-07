<script setup>
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import ReaderSettingsPanel from "./ReaderSettingsPanel.vue";
import Icon from "./ui/Icon.vue";

const { t } = useI18n();

defineProps({
  translation: { type: String, required: true },
  availableTranslations: { type: Array, default: () => ["WEBU"] },
  quickQuery: { type: String, default: "" },
  voiceId: { type: String, default: "" },
  isExploring: { type: Boolean, default: false },
  exploreError: { type: String, default: null },
  chromeHidden: { type: Boolean, default: false },
  exploreEnabled: { type: Boolean, default: true },
  exploreDisabledReason: { type: String, default: null },
  ttsEnabled: { type: Boolean, default: true },
  ttsDisabledReason: { type: String, default: null },
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
  <header class="global-top-bar" :class="{ 'global-top-bar--hidden': chromeHidden }">
    <div class="global-top-bar-row">
      <button
        class="nav-icon-btn panel-toggle-btn group flex items-center gap-2"
        type="button"
        :aria-pressed="libraryActive"
        :class="{ 'panel-toggle-btn--active': libraryActive }"
        :aria-label="t('nav.toggleLibrary')"
        :title="t('nav.library') + ' (L)'"
        @click="emit('toggle-library')"
      >
        <span class="panel-toggle-icon text-neutral-600 transition-colors group-hover:text-neutral-900" aria-hidden="true">
          <Icon name="BookOpen" :size="20" />
        </span>
        <span class="panel-toggle-label">{{ t('nav.library') }}</span>
      </button>

      <input
        v-if="exploreEnabled"
        :value="quickQuery"
        type="text"
        class="field-input gtb-explore-input"
        :placeholder="t('nav.explorePlaceholder')"
        :aria-label="t('nav.explore')"
        :aria-busy="isExploring ? 'true' : 'false'"
        title="Focus search (/)"
        @input="emit('quick-query-change', $event.target.value)"
        @keyup.enter.prevent="emit('explore-query')"
      />
      <button
        v-if="exploreEnabled"
        class="primary-btn compact gtb-explore-btn flex items-center gap-2"
        type="button"
        :disabled="isExploring"
        :title="t('nav.exploreTitle')"
        :aria-busy="isExploring ? 'true' : 'false'"
        @click="emit('explore-query')"
      >
        <span class="inline-flex h-4 w-4 items-center justify-center" aria-hidden="true">
          <span v-if="isExploring" class="gtb-spinner"></span>
          <Icon v-else name="Compass" :size="16" class="gtb-explore-btn__icon" />
        </span>
        <span>{{ isExploring ? t('nav.exploring') : t('nav.explore') }}</span>
      </button>

      <span class="gtb-spacer" aria-hidden="true"></span>

      <button
        ref="gearBtnRef"
        class="nav-icon-btn reader-settings-btn group"
        type="button"
        :aria-pressed="showSettings"
        :aria-label="t('nav.settings')"
        :title="t('nav.settings') + ' (Esc to close)'"
        @click="openSettings"
      >
        <Icon
          name="Settings"
          :size="20"
          class="text-neutral-600 transition-colors group-hover:text-neutral-900"
          aria-hidden="true"
        />
      </button>

      <button
        class="nav-icon-btn panel-toggle-btn group flex items-center gap-2"
        type="button"
        :aria-pressed="insightsActive"
        :class="{ 'panel-toggle-btn--active': insightsActive }"
        :aria-label="t('nav.toggleInsights')"
        :title="t('nav.insights') + ' (Alt+I)'"
        @click="emit('toggle-insights')"
      >
        <span class="panel-toggle-icon text-neutral-600 transition-colors group-hover:text-neutral-900" aria-hidden="true">
          <Icon name="Sparkles" :size="20" />
        </span>
        <span class="panel-toggle-label">{{ t('nav.insights') }}</span>
      </button>
    </div>

    <Teleport to="body">
      <ReaderSettingsPanel
        v-if="showSettings"
        :translation="translation"
        :available-translations="availableTranslations"
        :voice-id="voiceId"
        :tts-enabled="ttsEnabled"
        :tts-disabled-reason="ttsDisabledReason"
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
