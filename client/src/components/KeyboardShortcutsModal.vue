<script setup>
import { nextTick, onMounted, onUnmounted, ref } from 'vue';

const emit = defineEmits(['close']);

const modalRef = ref(null);
let previousFocus = null;

function getFocusable() {
  return Array.from(
    modalRef.value?.querySelectorAll(
      'button:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ) ?? []
  );
}

function trapFocus(e) {
  const focusable = getFocusable();
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

function onKeydown(e) {
  if (e.key === 'Escape') { e.preventDefault(); emit('close'); }
  else if (e.key === 'Tab') trapFocus(e);
}

onMounted(async () => {
  previousFocus = document.activeElement;
  document.addEventListener('keydown', onKeydown);
  await nextTick();
  getFocusable()[0]?.focus();
});

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown);
  previousFocus?.focus();
  previousFocus = null;
});

const SHORTCUTS = [
  { group: 'Navigation', items: [
    { keys: 'J / Alt+←', description: 'Previous chapter' },
    { keys: 'K / Alt+→', description: 'Next chapter' },
  ]},
  { group: 'Panels', items: [
    { keys: 'L', description: 'Toggle Library' },
    { keys: 'Alt+I', description: 'Toggle Insights' },
    { keys: 'Esc', description: 'Close settings / clear selection' },
  ]},
  { group: 'Reader', items: [
    { keys: '/', description: 'Focus search' },
    { keys: 'H', description: 'Show this dialog' },
    { keys: '↑ / ↓', description: 'Step verse (when reader focused)' },
    { keys: 'Space', description: 'Select verse' },
    { keys: 'Shift+Space', description: 'Extend selection' },
    { keys: 'Enter', description: 'Open Explore for selection' },
  ]},
];
</script>

<template>
  <Teleport to="body">
    <div class="kbd-modal-backdrop" aria-hidden="true" @click="emit('close')" />
    <div
      ref="modalRef"
      class="kbd-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      tabindex="-1"
    >
      <div class="kbd-modal-header">
        <h2 class="kbd-modal-title">Keyboard shortcuts</h2>
        <button class="nav-icon-btn" type="button" aria-label="Close" @click="emit('close')">✕</button>
      </div>
      <div class="kbd-modal-body">
        <div v-for="group in SHORTCUTS" :key="group.group" class="kbd-group">
          <p class="kbd-group-label">{{ group.group }}</p>
          <dl class="kbd-list">
            <div v-for="item in group.items" :key="item.keys" class="kbd-row">
              <dt class="kbd-keys"><kbd>{{ item.keys }}</kbd></dt>
              <dd class="kbd-desc">{{ item.description }}</dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  </Teleport>
</template>
