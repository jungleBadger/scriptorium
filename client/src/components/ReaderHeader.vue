<script setup>
import { useI18n } from "vue-i18n";
import { useKeyboardNav } from "../composables/useKeyboardNav.js";
import Icon from "./ui/Icon.vue";

const { t } = useI18n();

const props = defineProps({
  bookName: { type: String, default: "" },
  chapter: { type: Number, default: 1 },
  hasPrev: { type: Boolean, default: false },
  hasNext: { type: Boolean, default: false },
  chapterOptions: { type: Array, default: () => [] },
});

const emit = defineEmits([
  "go-prev",
  "go-next",
  "chapter-change",
  "chapter-step",
]);

const { chapterControlRef, onControlKeydown } = useKeyboardNav({
  onChapterStep: (direction) => emit("chapter-step", direction),
});
</script>

<template>
  <div class="reader-chapter-bar">
    <button
      class="chapterbar-nav"
      type="button"
      :disabled="!hasPrev"
      :aria-label="t('header.prevChapter')"
      title="Previous chapter (["
      @click="$emit('go-prev')"
    >
      <Icon name="ChevronLeft" :size="14" aria-hidden="true" />
      <span>{{ t('header.prev') }}</span>
    </button>

    <div class="chapterbar-center">
      <h2 class="chapterbar-title">
        <span class="chapterbar-book">{{ bookName }}</span>
        <span class="chapterbar-sep" aria-hidden="true"> &middot; </span>
        <select
          ref="chapterControlRef"
          class="chapterbar-chapter-select"
          :value="chapter"
          :aria-label="t('header.chapterSelect')"
          @change="$emit('chapter-change', $event)"
          @keydown="onControlKeydown"
        >
          <option v-for="n in chapterOptions" :key="n" :value="n">{{ n }}</option>
        </select>
      </h2>
    </div>

    <button
      class="chapterbar-nav chapterbar-nav--next"
      type="button"
      :disabled="!hasNext"
      :aria-label="t('header.nextChapter')"
      title="Next chapter (])"
      @click="$emit('go-next')"
    >
      <span>{{ t('header.next') }}</span>
      <Icon name="ChevronRight" :size="14" aria-hidden="true" />
    </button>
  </div>
</template>
