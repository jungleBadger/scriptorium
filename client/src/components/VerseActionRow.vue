<script setup>
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import Icon from './ui/Icon.vue';

const { t } = useI18n();

const props = defineProps({
  verseNumber: { type: Number, required: true },
  verseText: { type: String, required: true },
  bookId: { type: String, required: true },
  chapter: { type: Number, required: true },
  translation: { type: String, required: true },
  isBookmarked: { type: Boolean, default: false },
  isSpeaking: { type: Boolean, default: false },
  isSpeakLoading: { type: Boolean, default: false },
  exploreEnabled: { type: Boolean, default: true },
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
  <div class="verse-action-row" role="toolbar" :aria-label="`${t('verseActions.explore')} ${verseNumber}`">
    <button
      v-if="exploreEnabled"
      class="verse-action-btn verse-action-btn--primary group flex items-center gap-2"
      type="button"
      @click.stop="emit('explore')"
    >
      <Icon name="Compass" :size="16" class="text-primary-600" aria-hidden="true" />
      <span>{{ t('verseActions.explore') }}</span>
    </button>

    <button
      v-if="ttsEnabled || isSpeaking || isSpeakLoading"
      class="verse-action-btn group flex items-center gap-2"
      :class="{ 'verse-action-btn--active': isSpeaking }"
      type="button"
      :title="(!ttsEnabled && !isSpeaking && !isSpeakLoading)
        ? (ttsDisabledReason || t('verseActions.readAloudUnavailable'))
        : (isSpeaking ? t('verseActions.stopReading') : t('verseActions.readAloud'))"
      :disabled="isSpeakLoading || (!ttsEnabled && !isSpeaking)"
      @click.stop="emit('speak')"
    >
      <Icon name="Volume2" :size="16" class="text-neutral-600 group-hover:text-neutral-900" aria-hidden="true" />
      <span>{{ isSpeakLoading ? '...' : isSpeaking ? t('verseActions.stop') : t('verseActions.listen') }}</span>
    </button>

    <button
      class="verse-action-btn group flex items-center gap-2"
      type="button"
      :title="copyStatus === 'copied' ? t('verseActions.copied') : t('verseActions.copyVerse')"
      @click.stop="copyVerse"
    >
      <Icon name="Copy" :size="16" class="text-neutral-600 group-hover:text-neutral-900" aria-hidden="true" />
      <span>{{ copyStatus === 'copied' ? t('verseActions.copied') : t('verseActions.copy') }}</span>
    </button>

    <button
      class="verse-action-btn group flex items-center gap-2"
      :class="{ 'verse-action-btn--active': isBookmarked }"
      type="button"
      :title="isBookmarked ? t('verseActions.removeBookmark') : t('verseActions.bookmarkVerse')"
      @click.stop="emit('toggle-bookmark')"
    >
      <Icon
        name="Bookmark"
        :size="16"
        :class="isBookmarked ? 'text-primary-600' : 'text-neutral-600 group-hover:text-neutral-900'"
        aria-hidden="true"
      />
      <span>{{ isBookmarked ? t('verseActions.bookmarked') : t('verseActions.bookmark') }}</span>
    </button>

    <button
      v-if="showClear"
      class="verse-action-btn group flex items-center gap-2"
      type="button"
      :title="t('verseActions.clearSelection')"
      @click.stop="emit('clear')"
    >
      <Icon name="X" :size="16" class="text-neutral-600 group-hover:text-neutral-900" aria-hidden="true" />
      <span>{{ t('verseActions.clear') }}</span>
    </button>
  </div>
</template>
