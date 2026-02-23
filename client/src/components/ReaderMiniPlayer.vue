<script setup>
import { computed } from 'vue';
import { useTts } from '../composables/useTts.js';
import Icon from './ui/Icon.vue';

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
            <Icon v-else name="Volume2" :size="22" class="text-primary-600" />
          </span>
          <div class="mini-player-text">
            <span class="mini-player-label">{{ label }}</span>
            <span class="mini-player-status">{{ statusLabel }}</span>
          </div>
        </div>

        <div class="mini-player-actions">
          <button
            class="mini-player-btn group"
            type="button"
            :disabled="!tts.state.canPrev || tts.state.loading"
            aria-label="Previous verse"
            title="Previous verse"
            @click="tts.prevVerse()"
          >
            <Icon name="SkipBack" :size="16" class="text-neutral-600 group-hover:text-neutral-900" aria-hidden="true" />
          </button>
          <button
            class="mini-player-btn mini-player-btn--primary group"
            type="button"
            :disabled="tts.state.loading"
            :aria-label="tts.state.playing ? 'Pause reading' : 'Resume reading'"
            :title="tts.state.playing ? 'Pause reading' : 'Resume reading'"
            @click="tts.togglePlayPause()"
          >
            <Icon
              :name="tts.state.playing ? 'Pause' : 'Play'"
              :size="16"
              class="text-primary-600"
              aria-hidden="true"
            />
          </button>
          <button
            class="mini-player-btn group"
            type="button"
            :disabled="!tts.state.canNext || tts.state.loading"
            aria-label="Next verse"
            title="Next verse"
            @click="tts.nextVerse()"
          >
            <Icon name="SkipForward" :size="16" class="text-neutral-600 group-hover:text-neutral-900" aria-hidden="true" />
          </button>
          <button
            class="mini-player-speed group flex items-center gap-2"
            type="button"
            aria-label="Change playback speed"
            :title="`Playback speed ${speedLabel}`"
            @click="tts.cycleSpeed()"
          >
            <Icon name="Gauge" :size="16" class="text-neutral-600 group-hover:text-neutral-900" aria-hidden="true" />
            <span>{{ speedLabel }}</span>
          </button>
          <button
            class="mini-player-close group"
            type="button"
            aria-label="Close read aloud player"
            title="Stop and close"
            @click="onClose"
          >
            <Icon name="X" :size="16" class="text-neutral-600 group-hover:text-neutral-900" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div class="mini-player-track" aria-hidden="true">
        <div class="mini-player-progress-bar" :style="{ width: progressPct + '%' }"></div>
      </div>
    </div>
  </Transition>
</template>
