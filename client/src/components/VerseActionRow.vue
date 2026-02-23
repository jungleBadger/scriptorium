<script setup>
import { ref } from 'vue';
import Icon from './ui/Icon.vue';

const props = defineProps({
  verseNumber: { type: Number, required: true },
  verseText: { type: String, required: true },
  bookId: { type: String, required: true },
  chapter: { type: Number, required: true },
  translation: { type: String, required: true },
  isBookmarked: { type: Boolean, default: false },
  isSpeaking: { type: Boolean, default: false },
  isSpeakLoading: { type: Boolean, default: false },
  ttsEnabled: { type: Boolean, default: true },
  ttsDisabledReason: { type: String, default: null },
  showClear: { type: Boolean, default: false },
});

const emit = defineEmits(['explore', 'toggle-bookmark', 'speak', 'clear']);

const copyStatus = ref('idle');

async function copyVerse() {
  try {
    await navigator.clipboard.writeText(
      `${props.bookId} ${props.chapter}:${props.verseNumber} (${props.translation})\n${props.verseText}`
    );
    copyStatus.value = 'copied';
  } catch {
    copyStatus.value = 'error';
  }
  setTimeout(() => {
    copyStatus.value = 'idle';
  }, 1800);
}
</script>

<template>
  <div class="verse-action-row" role="toolbar" :aria-label="`Verse ${verseNumber} actions`">
    <button class="verse-action-btn verse-action-btn--primary group flex items-center gap-2" type="button" @click.stop="emit('explore')">
      <Icon name="Compass" :size="16" class="text-primary-600" aria-hidden="true" />
      <span>Explore</span>
    </button>

    <button
      class="verse-action-btn group flex items-center gap-2"
      :class="{ 'verse-action-btn--active': isSpeaking }"
      type="button"
      :title="(!ttsEnabled && !isSpeaking)
        ? (ttsDisabledReason || 'Read aloud is unavailable')
        : (isSpeaking ? 'Stop reading' : 'Read aloud')"
      :disabled="isSpeakLoading || (!ttsEnabled && !isSpeaking)"
      @click.stop="emit('speak')"
    >
      <Icon name="Volume2" :size="16" class="text-neutral-600 group-hover:text-neutral-900" aria-hidden="true" />
      <span>{{ isSpeakLoading ? '...' : isSpeaking ? 'Stop' : 'Listen' }}</span>
    </button>

    <button
      class="verse-action-btn group flex items-center gap-2"
      type="button"
      :title="copyStatus === 'copied' ? 'Copied' : 'Copy verse'"
      @click.stop="copyVerse"
    >
      <Icon name="Copy" :size="16" class="text-neutral-600 group-hover:text-neutral-900" aria-hidden="true" />
      <span>{{ copyStatus === 'copied' ? 'Copied' : 'Copy' }}</span>
    </button>

    <button
      class="verse-action-btn group flex items-center gap-2"
      :class="{ 'verse-action-btn--active': isBookmarked }"
      type="button"
      :title="isBookmarked ? 'Remove bookmark' : 'Bookmark verse'"
      @click.stop="emit('toggle-bookmark')"
    >
      <Icon
        name="Bookmark"
        :size="16"
        :class="isBookmarked ? 'text-primary-600' : 'text-neutral-600 group-hover:text-neutral-900'"
        aria-hidden="true"
      />
      <span>{{ isBookmarked ? 'Bookmarked' : 'Bookmark' }}</span>
    </button>

    <button
      v-if="showClear"
      class="verse-action-btn group flex items-center gap-2"
      type="button"
      title="Clear selection"
      @click.stop="emit('clear')"
    >
      <Icon name="X" :size="16" class="text-neutral-600 group-hover:text-neutral-900" aria-hidden="true" />
      <span>Clear</span>
    </button>
  </div>
</template>
