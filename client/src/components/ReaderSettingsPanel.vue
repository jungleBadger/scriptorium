<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { fetchVoices, pickVoiceForLanguage, translationLanguage } from '../composables/useVoices.js';

const { t } = useI18n();

const props = defineProps({
  translation: { type: String, required: true },
  availableTranslations: { type: Array, default: () => ['WEBU'] },
  voiceId: { type: String, default: '' },
  ttsEnabled: { type: Boolean, default: true },
  ttsDisabledReason: { type: String, default: null },
});

const emit = defineEmits(['close', 'settings-change', 'translation-change']);

const localSettings = reactive({
  fontSize: 'md',
  lineSpacing: 'normal',
  font: 'serif',
  theme: 'light',
  voiceId: '',
});

const allVoices = ref([{ id: '', label: 'Default', language: 'en' }]);

const panelRef = ref(null);
const activeLanguage = computed(() => translationLanguage(props.translation));
const voiceOptions = computed(() => {
  const list = Array.isArray(allVoices.value) ? allVoices.value : [];
  const lang = activeLanguage.value;
  const filtered = list.filter((voice) => Boolean(voice?.isAuto) || voice?.language === lang);
  return filtered.length ? filtered : list;
});
const TRANSLATION_LABEL_SUFFIX = {
  WEBU: "en-us",
  PT1911: "pt-br",
  ARC: "pt-br",
};
const translationOptions = computed(() =>
  (Array.isArray(props.availableTranslations) ? props.availableTranslations : []).map((code) => {
    const key = String(code || "").toUpperCase();
    const suffix = TRANSLATION_LABEL_SUFFIX[key];
    return {
      value: code,
      label: suffix ? `${code} (${suffix})` : String(code || ""),
    };
  })
);

const fontSizeOptions = computed(() => [
  { v: 'sm', l: t('settings.sizes.sm') },
  { v: 'md', l: t('settings.sizes.md') },
  { v: 'lg', l: t('settings.sizes.lg') },
  { v: 'xl', l: t('settings.sizes.xl') },
]);

const spacingOptions = computed(() => [
  { v: 'normal', l: t('settings.spacing.normal') },
  { v: 'relaxed', l: t('settings.spacing.relaxed') },
  { v: 'loose', l: t('settings.spacing.loose') },
]);

const fontOptions = computed(() => [
  { v: 'serif', l: t('settings.fonts.serif') },
  { v: 'sans', l: t('settings.fonts.sans') },
]);

onMounted(async () => {
  const saved = localStorage.getItem('scriptorium-reader-settings');
  if (saved) {
    try { Object.assign(localSettings, JSON.parse(saved)); } catch {}
  }
  // Parent state is authoritative; localStorage is just a bootstrap fallback.
  if (props.voiceId !== undefined) {
    localSettings.voiceId = String(props.voiceId || '');
  }
  if (props.ttsEnabled) {
    allVoices.value = await fetchVoices();
    normalizeVoiceSelection();
  }
  setTimeout(() => document.addEventListener('click', onDocClick), 0);
});

onUnmounted(() => document.removeEventListener('click', onDocClick));

function onDocClick(e) {
  if (!panelRef.value?.contains(e.target)) emit('close');
}

function normalizeVoiceSelection({ emitChange = false } = {}) {
  if (!props.ttsEnabled) return;
  const nextVoiceId = pickVoiceForLanguage(
    Array.isArray(allVoices.value) ? allVoices.value : [],
    activeLanguage.value,
    localSettings.voiceId
  );
  if (nextVoiceId === localSettings.voiceId) return;
  localSettings.voiceId = nextVoiceId;
  if (emitChange) emit('settings-change', { ...localSettings });
}

function update(key, value) {
  localSettings[key] = value;
  emit('settings-change', { ...localSettings });
}

watch(
  () => props.voiceId,
  (next) => {
    const normalized = String(next || '');
    if (localSettings.voiceId !== normalized) {
      localSettings.voiceId = normalized;
    }
  }
);

watch(
  () => props.translation,
  () => {
    normalizeVoiceSelection({ emitChange: true });
  }
);
</script>

<template>
  <div ref="panelRef" class="reader-settings-panel">
    <div class="settings-panel-header">
      <span class="settings-panel-title">{{ t('settings.title') }}</span>
      <button class="nav-icon-btn" type="button" :title="t('settings.close')" @click="emit('close')">✕</button>
    </div>

    <!-- Translation -->
    <div class="settings-group">
      <p class="settings-label">{{ t('settings.translation') }}</p>
      <select
        :value="translation"
        class="field-input settings-select"
        @change="emit('translation-change', $event.target.value)"
      >
        <option v-for="tr in translationOptions" :key="tr.value" :value="tr.value">{{ tr.label }}</option>
      </select>
    </div>

    <!-- Voice -->
    <div v-if="ttsEnabled" class="settings-group">
      <p class="settings-label">{{ t('settings.voice') }}</p>
      <select
        :value="localSettings.voiceId"
        class="field-input settings-select"
        :title="t('settings.voiceSelect')"
        @change="update('voiceId', $event.target.value)"
      >
        <option v-for="v in voiceOptions" :key="v.id" :value="v.id">{{ v.label }}</option>
      </select>
    </div>

    <!-- Text size -->
    <div class="settings-group">
      <p class="settings-label">{{ t('settings.textSize') }}</p>
      <div class="settings-option-row">
        <button
          v-for="opt in fontSizeOptions"
          :key="opt.v"
          class="ghost-btn compact"
          :class="{ 'settings-option-active': localSettings.fontSize === opt.v }"
          type="button"
          @click="update('fontSize', opt.v)"
        >{{ opt.l }}</button>
      </div>
    </div>

    <!-- Line spacing -->
    <div class="settings-group">
      <p class="settings-label">{{ t('settings.lineSpacing') }}</p>
      <div class="settings-option-row">
        <button
          v-for="opt in spacingOptions"
          :key="opt.v"
          class="ghost-btn compact"
          :class="{ 'settings-option-active': localSettings.lineSpacing === opt.v }"
          type="button"
          @click="update('lineSpacing', opt.v)"
        >{{ opt.l }}</button>
      </div>
    </div>

    <!-- Font -->
    <div class="settings-group">
      <p class="settings-label">{{ t('settings.font') }}</p>
      <div class="settings-option-row">
        <button
          v-for="opt in fontOptions"
          :key="opt.v"
          class="ghost-btn compact"
          :class="{ 'settings-option-active': localSettings.font === opt.v }"
          type="button"
          @click="update('font', opt.v)"
        >{{ opt.l }}</button>
      </div>
    </div>

    <!-- Theme -->
    <div class="settings-group">
      <p class="settings-label">{{ t('settings.theme') }}</p>
      <div class="settings-option-row">
        <button
          class="ghost-btn compact theme-btn--light"
          :class="{ 'settings-option-active': localSettings.theme === 'light' }"
          type="button"
          @click="update('theme', 'light')"
        >{{ t('settings.themes.light') }}</button>
        <button
          class="ghost-btn compact theme-btn--sepia"
          :class="{ 'settings-option-active': localSettings.theme === 'sepia' }"
          type="button"
          @click="update('theme', 'sepia')"
        >{{ t('settings.themes.sepia') }}</button>
        <button
          class="ghost-btn compact theme-btn--dark"
          :class="{ 'settings-option-active': localSettings.theme === 'dark' }"
          type="button"
          @click="update('theme', 'dark')"
        >{{ t('settings.themes.dark') }}</button>
      </div>
    </div>
  </div>
</template>
