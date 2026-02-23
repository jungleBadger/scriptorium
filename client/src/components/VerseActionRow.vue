<script setup>
import { ref } from 'vue';

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
    <button class="verse-action-btn verse-action-btn--primary" type="button" @click.stop="emit('explore')">
      Explore
    </button>

    <button
      class="verse-action-btn"
      :class="{ 'verse-action-btn--active': isSpeaking }"
      type="button"
      :title="(!ttsEnabled && !isSpeaking)
        ? (ttsDisabledReason || 'Read aloud is unavailable')
        : (isSpeaking ? 'Stop reading' : 'Read aloud')"
      :disabled="isSpeakLoading || (!ttsEnabled && !isSpeaking)"
      @click.stop="emit('speak')"
    >
      {{ isSpeakLoading ? '...' : isSpeaking ? 'Stop' : 'Listen' }}
    </button>

    <button
      class="verse-action-btn"
      type="button"
      :title="copyStatus === 'copied' ? 'Copied' : 'Copy verse'"
      @click.stop="copyVerse"
    >
      {{ copyStatus === 'copied' ? 'Copied' : 'Copy' }}
    </button>

    <button
      class="verse-action-btn"
      :class="{ 'verse-action-btn--active': isBookmarked }"
      type="button"
      :title="isBookmarked ? 'Remove bookmark' : 'Bookmark verse'"
      @click.stop="emit('toggle-bookmark')"
    >
      {{ isBookmarked ? 'Bookmarked' : 'Bookmark' }}
    </button>

    <button v-if="showClear" class="verse-action-btn" type="button" title="Clear selection" @click.stop="emit('clear')">
      Clear
    </button>
  </div>
</template>
