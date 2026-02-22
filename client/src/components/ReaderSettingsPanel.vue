<script setup>
import { onMounted, onUnmounted, reactive, ref } from 'vue';

import { fetchVoices } from '../composables/useVoices.js';

defineProps({
  translation: { type: String, required: true },
  availableTranslations: { type: Array, default: () => ['WEBU'] },
});

const emit = defineEmits(['close', 'settings-change', 'translation-change']);

const localSettings = reactive({
  fontSize: 'md',
  lineSpacing: 'normal',
  font: 'serif',
  theme: 'light',
  voiceId: '',
});

const voices = ref([{ id: '', label: 'Default' }]);

const panelRef = ref(null);

onMounted(async () => {
  const saved = localStorage.getItem('scriptorium-reader-settings');
  if (saved) {
    try { Object.assign(localSettings, JSON.parse(saved)); } catch {}
  }
  voices.value = await fetchVoices();
  setTimeout(() => document.addEventListener('click', onDocClick), 0);
});

onUnmounted(() => document.removeEventListener('click', onDocClick));

function onDocClick(e) {
  if (!panelRef.value?.contains(e.target)) emit('close');
}

function update(key, value) {
  localSettings[key] = value;
  emit('settings-change', { ...localSettings });
}
</script>

<template>
  <div ref="panelRef" class="reader-settings-panel">
    <div class="settings-panel-header">
      <span class="settings-panel-title">Reader Settings</span>
      <button class="nav-icon-btn" type="button" title="Close settings" @click="emit('close')">✕</button>
    </div>

    <!-- Translation -->
    <div class="settings-group">
      <p class="settings-label">Translation</p>
      <select
        :value="translation"
        class="field-input settings-select"
        @change="emit('translation-change', $event.target.value)"
      >
        <option v-for="t in availableTranslations" :key="t" :value="t">{{ t }}</option>
      </select>
    </div>

    <!-- Voice -->
    <div class="settings-group">
      <p class="settings-label">Read aloud voice</p>
      <select
        :value="localSettings.voiceId"
        class="field-input settings-select"
        @change="update('voiceId', $event.target.value)"
      >
        <option v-for="v in voices" :key="v.id" :value="v.id">{{ v.label }}</option>
      </select>
    </div>

    <!-- Text size -->
    <div class="settings-group">
      <p class="settings-label">Text size</p>
      <div class="settings-option-row">
        <button
          v-for="opt in [{ v:'sm', l:'SM' }, { v:'md', l:'MD' }, { v:'lg', l:'LG' }, { v:'xl', l:'XL' }]"
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
      <p class="settings-label">Line spacing</p>
      <div class="settings-option-row">
        <button
          v-for="opt in [{ v:'normal', l:'Normal' }, { v:'relaxed', l:'Relaxed' }, { v:'loose', l:'Loose' }]"
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
      <p class="settings-label">Font</p>
      <div class="settings-option-row">
        <button
          v-for="opt in [{ v:'serif', l:'Serif' }, { v:'sans', l:'Sans' }]"
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
      <p class="settings-label">Theme</p>
      <div class="settings-option-row">
        <button
          class="ghost-btn compact theme-btn--light"
          :class="{ 'settings-option-active': localSettings.theme === 'light' }"
          type="button"
          @click="update('theme', 'light')"
        >Light</button>
        <button
          class="ghost-btn compact theme-btn--sepia"
          :class="{ 'settings-option-active': localSettings.theme === 'sepia' }"
          type="button"
          @click="update('theme', 'sepia')"
        >Sepia</button>
        <button
          class="ghost-btn compact theme-btn--dark"
          :class="{ 'settings-option-active': localSettings.theme === 'dark' }"
          type="button"
          @click="update('theme', 'dark')"
        >Dark</button>
      </div>
    </div>
  </div>
</template>
