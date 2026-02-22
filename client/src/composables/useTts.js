// client/src/composables/useTts.js
// Singleton TTS player: sequential verse-by-verse playback with look-ahead prefetch.
// One playback session runs at a time across the whole app.

import { reactive, readonly } from "vue";

const LOOK_AHEAD = 2;

const state = reactive({
  loading:           false,   // true while waiting for verse audio data
  playing:           false,
  error:             null,
  bookId:            null,
  chapter:           null,
  verseStart:        null,    // first verse in the queue
  verseEnd:          null,    // last verse in the queue
  activeVerseNumber: null,    // verse currently being spoken
  words:             [],      // word timings for the active verse
  activeWordIdx:     -1,
  progress:          0,       // 0-1 overall playback progress
});

// Internal queue state (not reactive)
let queue         = [];   // ordered array of verse numbers
let queueIdx      = 0;
let sessionParams = null; // { bookId, chapter, translation, voiceId }
const prefetched  = new Map(); // verseNumber -> Promise<{ audioUrl, words, audioEl }>

let audio = null;
let rafId = null;
let verseFrac = 0; // 0-1 progress within the current verse (for overall %)
let sessionToken = 0;
let audioEndedHandler = null;
let audioErrorHandler = null;
const pendingTimeouts = new Set();

function isCurrentSession(token) {
  return token === sessionToken && sessionParams !== null;
}

function clearPendingTimeouts() {
  for (const timeoutId of pendingTimeouts) clearTimeout(timeoutId);
  pendingTimeouts.clear();
}

function schedule(delayMs, fn) {
  const timeoutId = setTimeout(() => {
    pendingTimeouts.delete(timeoutId);
    fn();
  }, delayMs);
  pendingTimeouts.add(timeoutId);
  return timeoutId;
}

function createPreloadedAudio(audioUrl) {
  const audioEl = new Audio();
  audioEl.preload = "auto";
  audioEl.src = audioUrl;
  try { audioEl.load(); } catch {}
  return audioEl;
}

function ensurePlaybackAudio() {
  if (!audio) {
    audio = new Audio();
    audio.preload = "auto";
  }
  return audio;
}

// RAF tick: word highlighting + progress
function tick() {
  const currentAudio = audio;
  if (!currentAudio) return;

  const ms = currentAudio.currentTime * 1000;
  const dur = currentAudio.duration;

  if (Number.isFinite(dur) && dur > 0) {
    verseFrac = Math.min(1, currentAudio.currentTime / dur);
    const total = queue.length;
    state.progress = total > 0 ? (queueIdx + verseFrac) / total : 0;
  }

  const words = state.words;

  // Server timings are estimated from text. Scale them to real audio duration so
  // highlighting stays aligned when a voice reads faster/slower than average.
  let wordClockMs = ms;
  if (words.length && Number.isFinite(dur) && dur > 0) {
    const estimatedTotalMs = words[words.length - 1]?.endMs ?? 0;
    if (estimatedTotalMs > 0) {
      wordClockMs = Math.min(estimatedTotalMs, (currentAudio.currentTime / dur) * estimatedTotalMs);
    }
  }

  let idx = -1;
  for (let i = 0; i < words.length; i++) {
    if (wordClockMs >= words[i].startMs) idx = i;
    else break;
  }
  state.activeWordIdx = idx;

  if (audio === currentAudio && !currentAudio.paused && !currentAudio.ended) {
    rafId = requestAnimationFrame(tick);
  }
}

// Audio cleanup
function cleanupAudio() {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }

  if (!audio) return;

  if (audioEndedHandler) audio.removeEventListener("ended", audioEndedHandler);
  if (audioErrorHandler) audio.removeEventListener("error", audioErrorHandler);
  audioEndedHandler = null;
  audioErrorHandler = null;

  audio.pause();
  audio.src = "";
}

// Full reset (stop + clear everything)
function fullReset() {
  sessionToken += 1;
  clearPendingTimeouts();
  cleanupAudio();

  queue = [];
  queueIdx = 0;
  verseFrac = 0;
  sessionParams = null;
  prefetched.clear();

  Object.assign(state, {
    loading: false,
    playing: false,
    error: null,
    bookId: null,
    chapter: null,
    verseStart: null,
    verseEnd: null,
    activeVerseNumber: null,
    words: [],
    activeWordIdx: -1,
    progress: 0,
  });
}

// Prefetch helper
function prefetchFrom(startIdx) {
  if (!sessionParams) return;

  const end = Math.min(startIdx + LOOK_AHEAD, queue.length - 1);
  for (let i = startIdx; i <= end; i++) {
    const verseNumber = queue[i];
    if (verseNumber == null || prefetched.has(verseNumber)) continue;

    const { bookId, chapter, translation, voiceId } = sessionParams;

    let pending;
    pending = fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bookId,
        chapter,
        verse: verseNumber,
        translation,
        voiceId: voiceId || "",
      }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `TTS error ${res.status}`);
        }
        return res.json();
      })
      .then((data) => ({
        ...data,
        words: Array.isArray(data?.words) ? data.words : [],
        audioEl: createPreloadedAudio(data.audioUrl),
      }))
      .catch((err) => {
        if (prefetched.get(verseNumber) === pending) prefetched.delete(verseNumber);
        throw err;
      });

    prefetched.set(verseNumber, pending);
  }
}

// Play a verse by queue index
async function playVerseAt(idx, token) {
  if (!isCurrentSession(token)) return;

  if (idx >= queue.length) {
    state.playing = false;
    state.loading = false;
    state.progress = 1;
    schedule(600, () => {
      if (!isCurrentSession(token)) return;
      fullReset();
    });
    return;
  }

  const verseNumber = queue[idx];
  queueIdx = idx;
  verseFrac = 0;

  function failCurrentVerseAndMaybeContinue(message, cause) {
    if (!isCurrentSession(token)) return;

    const detail = `Read aloud failed at verse ${verseNumber}: ${message}`;
    state.error = detail;
    try { console.error(detail, cause); } catch {}

    cleanupAudio();

    const canContinue = queue.length > 1 && idx < queue.length - 1;
    if (canContinue) {
      state.playing = false;
      state.loading = true;
      schedule(0, () => {
        if (!isCurrentSession(token)) return;
        playVerseAt(idx + 1, token);
      });
      return;
    }

    state.playing = false;
    state.loading = false;
  }

  if (idx > 0) {
    state.loading = true;
    state.playing = false;
  }

  // Warm the next few verses early to reduce gaps between verse transitions.
  prefetchFrom(idx + 1);
  if (!prefetched.has(verseNumber)) prefetchFrom(idx);

  let data;
  try {
    const versePromise = prefetched.get(verseNumber);
    if (!versePromise) throw new Error("TTS prefetch missing");
    data = await versePromise;
    // This verse is now owned by the active playback flow; evict it so the cache
    // does not retain one Audio element per verse across a long chapter.
    prefetched.delete(verseNumber);
  } catch (err) {
    if (!isCurrentSession(token)) return;
    failCurrentVerseAndMaybeContinue(err?.message || "TTS fetch failed", err);
    return;
  }

  if (!isCurrentSession(token)) return;

  // Switch the highlighted verse only when that verse is actually ready, so the
  // previous verse highlight does not jump to the next row during fetch gaps.
  state.activeVerseNumber = verseNumber;
  state.words = Array.isArray(data.words) ? data.words : [];
  state.activeWordIdx = -1;
  state.loading = false;
  state.playing = true;

  cleanupAudio();

  const verseAudio = ensurePlaybackAudio();
  try {
    verseAudio.pause();
    verseAudio.src = data.audioUrl;
    verseAudio.currentTime = 0;
    verseAudio.load();
  } catch {}
  audio = verseAudio;

  audioEndedHandler = () => {
    if (audio !== verseAudio || !isCurrentSession(token)) return;

    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }

    state.activeWordIdx = Math.max(0, state.words.length - 1);

    if (idx === queue.length - 1) {
      state.playing = false;
      state.loading = false;
      state.progress = 1;
      schedule(600, () => {
        if (!isCurrentSession(token)) return;
        cleanupAudio();
        fullReset();
      });
      return;
    }

    state.playing = false;
    state.loading = true;
    if (!isCurrentSession(token)) return;
    void playVerseAt(idx + 1, token);
  };

  audioErrorHandler = () => {
    if (audio !== verseAudio || !isCurrentSession(token)) return;
    failCurrentVerseAndMaybeContinue("Audio playback failed");
  };

  audio.addEventListener("ended", audioEndedHandler);
  audio.addEventListener("error", audioErrorHandler);

  try {
    await verseAudio.play();
    if (audio !== verseAudio || !isCurrentSession(token)) return;
    rafId = requestAnimationFrame(tick);
  } catch (err) {
    if (!isCurrentSession(token)) return;
    failCurrentVerseAndMaybeContinue(err?.message || "Audio playback failed", err);
  }
}

// Public API
export function useTts() {
  async function play({ bookId, chapter, verseNumbers, translation, voiceId }) {
    fullReset();
    const token = sessionToken;

    queue = Array.isArray(verseNumbers) ? [...verseNumbers] : [];
    if (!queue.length) return;

    sessionParams = { bookId, chapter, translation, voiceId };

    Object.assign(state, {
      loading: true,
      playing: false,
      error: null,
      bookId,
      chapter,
      verseStart: queue[0],
      verseEnd: queue[queue.length - 1],
      activeVerseNumber: queue[0],
      words: [],
      activeWordIdx: -1,
      progress: 0,
    });

    // Prefetch first verse + look-ahead immediately.
    prefetchFrom(0);
    await playVerseAt(0, token);
  }

  function stop() {
    fullReset();
  }

  return { state: readonly(state), play, stop };
}
