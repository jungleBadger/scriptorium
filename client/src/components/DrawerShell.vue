<script setup>
import { nextTick, onUnmounted, ref, watch } from 'vue'

const props = defineProps({
  isOpen:    { type: Boolean, default: false },
  /** 'left' | 'right' */
  side:      { type: String,  default: 'left' },
  ariaLabel: { type: String,  default: 'Drawer' },
})

const emit = defineEmits(['close'])

const drawerRef = ref(null)
let previousFocus = null

function close() {
  emit('close')
}

function trapFocus(e) {
  if (!drawerRef.value) return
  const focusable = Array.from(
    drawerRef.value.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  )
  if (focusable.length === 0) return
  const first = focusable[0]
  const last  = focusable[focusable.length - 1]
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault()
    first.focus()
  }
}

function onKeydown(e) {
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
  } else if (e.key === 'Tab') {
    trapFocus(e)
  }
}

watch(() => props.isOpen, async (next) => {
  if (next) {
    previousFocus = document.activeElement
    document.addEventListener('keydown', onKeydown)
    await nextTick()
    const first = drawerRef.value?.querySelector(
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
    first?.focus()
  } else {
    document.removeEventListener('keydown', onKeydown)
    previousFocus?.focus()
    previousFocus = null
  }
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <!-- Backdrop -->
    <Transition name="drawer-backdrop">
      <div
        v-if="isOpen"
        class="drawer-backdrop"
        aria-hidden="true"
        @click="close"
      />
    </Transition>

    <!-- Panel -->
    <Transition :name="side === 'left' ? 'drawer-left' : 'drawer-right'">
      <div
        v-if="isOpen"
        ref="drawerRef"
        class="drawer-panel"
        :class="`drawer-panel--${side}`"
        role="dialog"
        :aria-modal="true"
        :aria-label="ariaLabel"
      >
        <slot />
      </div>
    </Transition>
  </Teleport>
</template>
