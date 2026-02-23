<script setup>
import { computed } from 'vue';
import { useTts } from '../composables/useTts.js';

const tts = useTts();

const visible = computed(() => tts.state.loading || tts.state.playing || tts.state.paused);

const label = computed(() => {
  const { bookId, chapter, activeVerseNumber, verseStart, verseEnd } = tts.state;
  if (!bookId || !chapter) return '';
  const current = Number.isFinite(activeVerseNumber) ? activeVerseNumber : verseStart;
  const rangeStart = Number.isFinite(verseStart) ? verseStart : current;
  const rangeEnd = Number.isFinite(verseEnd) ? verseEnd : rangeStart;
  if (!Number.isFinite(current)) return `${bookId} ${chapter}`;
  if (Number.isFinite(rangeStart) && Number.isFinite(rangeEnd) && rangeStart !== rangeEnd) {
    return `${bookId} ${chapter}:${current} (from ${rangeStart}-${rangeEnd})`;
  }
  return `${bookId} ${chapter}:${current}`;
});

const statusLabel = computed(() => {
  if (tts.state.loading) return 'Loading';
  if (tts.state.playing) return 'Playing';
  if (tts.state.paused) return 'Paused';
  return 'Idle';
});

const progressPct = computed(() => Math.max(0, Math.min(100, Math.round((tts.state.progress || 0) * 100))));
const speedLabel = computed(() => `${String(Number(tts.state.speed || 1).toFixed(2)).replace(/\.00$/, '')}x`);

function onClose() {
  tts.stop();
}
</script>

<template>
  <Transition name="mini-player">
    <div v-if="visible" class="reader-mini-player" role="group" aria-label="Read aloud mini player">
      <div class="mini-player-main">
        <div class="mini-player-meta">
          <span class="mini-player-icon" aria-hidden="true">
            <span v-if="tts.state.loading" class="mini-player-spinner"></span>
            <span v-else>Listen</span>
          </span>
          <div class="mini-player-text">
            <span class="mini-player-label">{{ label }}</span>
            <span class="mini-player-status">{{ statusLabel }}</span>
          </div>
        </div>

        <div class="mini-player-actions">
          <button
            class="mini-player-btn"
            type="button"
            :disabled="!tts.state.canPrev || tts.state.loading"
            aria-label="Previous verse"
            title="Previous verse"
            @click="tts.prevVerse()"
          >
            Prev
          </button>
          <button
            class="mini-player-btn mini-player-btn--primary"
            type="button"
            :disabled="tts.state.loading"
            :aria-label="tts.state.playing ? 'Pause reading' : 'Resume reading'"
            :title="tts.state.playing ? 'Pause reading' : 'Resume reading'"
            @click="tts.togglePlayPause()"
          >
            {{ tts.state.playing ? 'Pause' : 'Play' }}
          </button>
          <button
            class="mini-player-btn"
            type="button"
            :disabled="!tts.state.canNext || tts.state.loading"
            aria-label="Next verse"
            title="Next verse"
            @click="tts.nextVerse()"
          >
            Next
          </button>
          <button
            class="mini-player-speed"
            type="button"
            aria-label="Change playback speed"
            :title="`Playback speed ${speedLabel}`"
            @click="tts.cycleSpeed()"
          >
            {{ speedLabel }}
          </button>
          <button
            class="mini-player-close"
            type="button"
            aria-label="Close read aloud player"
            title="Stop and close"
            @click="onClose"
          >
            x
          </button>
        </div>
      </div>

      <div class="mini-player-track" aria-hidden="true">
        <div class="mini-player-progress-bar" :style="{ width: progressPct + '%' }"></div>
      </div>
    </div>
  </Transition>
</template>
