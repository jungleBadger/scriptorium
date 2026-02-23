<script setup>
import { useKeyboardNav } from "../composables/useKeyboardNav.js";

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
      aria-label="Previous chapter"
      @click="$emit('go-prev')"
    >
      &lsaquo; Prev
    </button>

    <div class="chapterbar-center">
      <h2 class="chapterbar-title">
        <span class="chapterbar-book">{{ bookName }}</span>
        <span class="chapterbar-sep" aria-hidden="true"> &middot; </span>
        <select
          ref="chapterControlRef"
          class="chapterbar-chapter-select"
          :value="chapter"
          aria-label="Chapter"
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
      aria-label="Next chapter"
      @click="$emit('go-next')"
    >
      Next &rsaquo;
    </button>
  </div>
</template>
