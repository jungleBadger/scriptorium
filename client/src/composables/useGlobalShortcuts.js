import { onMounted, onUnmounted } from 'vue';

const INPUT_SELECTOR = 'input, textarea, select, [contenteditable]';

function isTypingTarget(target) {
  return Boolean(target?.closest(INPUT_SELECTOR));
}

/**
 * Global keyboard shortcuts for the workspace.
 *
 * Callbacks:
 *   prevChapter()       — navigate to previous chapter
 *   nextChapter()       — navigate to next chapter
 *   toggleLibrary()     — toggle library sidebar/drawer
 *   toggleInsights()    — toggle insights panel/drawer
 *   focusSearch()       — focus the explore/search input
 *   clearSelection()    — clear active verse selection (Escape fallback)
 *   openShortcutsModal() — open keyboard shortcuts modal (Phase 7 stub)
 */
export function useGlobalShortcuts({
  prevChapter,
  nextChapter,
  toggleLibrary,
  toggleInsights,
  focusSearch,
  clearSelection,
  openShortcutsModal,
} = {}) {
  function onKeydown(e) {
    // Never intercept inside text inputs
    if (isTypingTarget(e.target)) return;
    // Never intercept with ctrl/meta (browser/OS reserved)
    if (e.ctrlKey || e.metaKey) return;

    const { key, altKey, shiftKey } = e;

    // Alt+key bindings
    if (altKey && !shiftKey) {
      if (key === 'ArrowLeft')  { e.preventDefault(); prevChapter?.(); return; }
      if (key === 'ArrowRight') { e.preventDefault(); nextChapter?.(); return; }
      if (key === 'i')          { e.preventDefault(); toggleInsights?.(); return; }
      return;
    }

    if (altKey || shiftKey) return;

    // Single-letter bindings (no modifiers, no special characters)
    switch (key) {
      case 'j':      e.preventDefault(); prevChapter?.(); break;
      case 'k':      e.preventDefault(); nextChapter?.(); break;
      case 'l':      e.preventDefault(); toggleLibrary?.(); break;
      case '/':      e.preventDefault(); focusSearch?.(); break;
      case 'h':      e.preventDefault(); openShortcutsModal?.(); break;
      case 'Escape': e.preventDefault(); clearSelection?.(); break;
    }
  }

  onMounted(() => window.addEventListener('keydown', onKeydown));
  onUnmounted(() => window.removeEventListener('keydown', onKeydown));
}
