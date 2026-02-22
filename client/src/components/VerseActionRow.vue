<script setup>
import { ref } from 'vue';

const props = defineProps({
  verseNumber:    { type: Number,  required: true },
  verseText:      { type: String,  required: true },
  bookId:         { type: String,  required: true },
  chapter:        { type: Number,  required: true },
  translation:    { type: String,  required: true },
  isBookmarked:   { type: Boolean, default: false },
  isSpeaking:     { type: Boolean, default: false },
  isSpeakLoading: { type: Boolean, default: false },
});

const emit = defineEmits(['find-parallels', 'toggle-bookmark', 'speak']);

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
  setTimeout(() => { copyStatus.value = 'idle'; }, 2000);
}
</script>

<template>
  <div class="verse-action-row">
    <button
      class="verse-action-btn"
      :class="{ 'verse-action-btn--active': isSpeaking }"
      type="button"
      :title="isSpeaking ? 'Stop reading' : 'Read aloud'"
      :disabled="isSpeakLoading"
      @click.stop="emit('speak')"
    >{{ isSpeakLoading ? '…' : isSpeaking ? '⏹' : '▶' }}</button>
    <button
      class="verse-action-btn"
      type="button"
      :title="copyStatus === 'copied' ? 'Copied!' : 'Copy verse'"
      @click.stop="copyVerse"
    >
      {{ copyStatus === 'copied' ? '✓' : '⎘' }}
    </button>
    <button
      class="verse-action-btn"
      type="button"
      title="Find parallel passages"
      @click.stop="emit('find-parallels')"
    >
      ⇔
    </button>
    <button
      class="verse-action-btn"
      :class="{ 'verse-action-btn--active': isBookmarked }"
      type="button"
      :title="isBookmarked ? 'Remove bookmark' : 'Bookmark verse'"
      @click.stop="emit('toggle-bookmark')"
    >
      {{ isBookmarked ? '♥' : '♡' }}
    </button>
  </div>
</template>
