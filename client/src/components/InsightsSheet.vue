<script setup>
import { nextTick, onUnmounted, ref, watch } from 'vue';

const props = defineProps({
  isOpen: { type: Boolean, default: false },
  ariaLabel: { type: String, default: 'Insights' },
});

const emit = defineEmits(['close']);

const panelRef = ref(null);
const snap = ref(0.6);
let previousFocus = null;
let dragging = false;
let dragStartY = 0;
let dragStartSnap = 0.6;

function close() {
  emit('close');
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function onKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault();
    close();
  }
}

function onBackdropPointerDown(event) {
  if (event.target === event.currentTarget) close();
}

function onHandleClick() {
  snap.value = snap.value >= 0.8 ? 0.6 : 0.9;
}

function onHandlePointerDown(event) {
  dragging = true;
  dragStartY = event.clientY;
  dragStartSnap = snap.value;
  try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch {}
  window.addEventListener('pointermove', onWindowPointerMove, { passive: true });
  window.addEventListener('pointerup', onWindowPointerUp, { passive: true });
  window.addEventListener('pointercancel', onWindowPointerUp, { passive: true });
}

function onWindowPointerMove(event) {
  if (!dragging) return;
  const deltaY = event.clientY - dragStartY;
  const deltaSnap = deltaY / Math.max(window.innerHeight || 1, 1);
  snap.value = clamp(dragStartSnap - deltaSnap, 0.28, 0.94);
}

function onWindowPointerUp() {
  if (!dragging) return;
  dragging = false;
  window.removeEventListener('pointermove', onWindowPointerMove);
  window.removeEventListener('pointerup', onWindowPointerUp);
  window.removeEventListener('pointercancel', onWindowPointerUp);

  if (snap.value < 0.42) {
    close();
    snap.value = 0.6;
    return;
  }

  snap.value = snap.value >= 0.78 ? 0.9 : 0.6;
}

watch(
  () => props.isOpen,
  async (next) => {
    if (next) {
      snap.value = 0.6;
      previousFocus = document.activeElement;
      document.addEventListener('keydown', onKeydown);
      await nextTick();
      const firstFocusable = panelRef.value?.querySelector(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      firstFocusable?.focus();
      return;
    }

    document.removeEventListener('keydown', onKeydown);
    previousFocus?.focus?.();
    previousFocus = null;
  },
  { immediate: true }
);

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown);
  window.removeEventListener('pointermove', onWindowPointerMove);
  window.removeEventListener('pointerup', onWindowPointerUp);
  window.removeEventListener('pointercancel', onWindowPointerUp);
});
</script>

<template>
  <Teleport to="body">
    <Transition name="drawer-backdrop">
      <div v-if="isOpen" class="drawer-backdrop insights-sheet-backdrop" @pointerdown="onBackdropPointerDown">
        <div
          ref="panelRef"
          class="insights-sheet-panel"
          role="dialog"
          :aria-modal="true"
          :aria-label="ariaLabel"
          :style="{ '--sheet-height': (snap * 100).toFixed(0) + 'vh' }"
          @pointerdown.stop
        >
          <button
            class="insights-sheet-handle"
            type="button"
            aria-label="Resize or close Insights sheet"
            title="Drag to resize"
            @click="onHandleClick"
            @pointerdown="onHandlePointerDown"
          >
            <span class="insights-sheet-grabber" aria-hidden="true"></span>
          </button>
          <div class="insights-sheet-content">
            <slot />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
