<script setup>
import { computed } from 'vue';
import { useTts } from '../composables/useTts.js';

const tts = useTts();

const visible = computed(() => tts.state.loading || tts.state.playing);

const label = computed(() => {
  const { bookId, chapter, verseStart, verseEnd } = tts.state;
  if (!bookId || !verseStart) return '';
  const base = `${bookId} ${chapter}:${verseStart}`;
  return verseEnd && verseEnd !== verseStart ? `${base} – ${verseEnd}` : base;
});

const progressPct = computed(() => Math.round(tts.state.progress * 100));
</script>

<template>
  <Transition name="mini-player">
    <div v-if="visible" class="reader-mini-player" role="status" aria-live="polite">
      <span class="mini-player-icon" aria-hidden="true">
        <span v-if="tts.state.loading" class="mini-player-spinner"></span>
        <span v-else>♪</span>
      </span>

      <span class="mini-player-label">{{ label }}</span>

      <div class="mini-player-track" aria-hidden="true">
        <div class="mini-player-progress-bar" :style="{ width: progressPct + '%' }"></div>
      </div>

      <button class="mini-player-stop" type="button" title="Stop reading" @click="tts.stop()">
        ⏹
      </button>
    </div>
  </Transition>
</template>
