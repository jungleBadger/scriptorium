import { ref } from 'vue'

/**
 * Reactive breakpoints — module-level singleton, one resize listener for the
 * entire app lifetime, consistent with useTts / useReaderState patterns.
 *   Mobile  : < 768px
 *   Tablet  : 768–1199px
 *   Desktop : ≥ 1200px
 */
const isMobile = ref(false)
const isTablet = ref(false)
const isDesktop = ref(false)
const breakpoint = ref('desktop')

function update() {
  const w = window.innerWidth
  isMobile.value = w < 768
  isTablet.value = w >= 768 && w < 1200
  isDesktop.value = w >= 1200
  breakpoint.value = w < 768 ? 'mobile' : w < 1200 ? 'tablet' : 'desktop'
}

if (typeof window !== 'undefined') {
  update()
  window.addEventListener('resize', update, { passive: true })
}

export function useBreakpoint() {
  return { isMobile, isTablet, isDesktop, breakpoint }
}
