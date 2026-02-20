import { ref } from "vue";

function getArrowDirection(key) {
  if (key === "ArrowLeft" || key === "ArrowUp") return -1;
  if (key === "ArrowRight" || key === "ArrowDown") return 1;
  return 0;
}

export function useKeyboardNav({ onChapterStep, onVerseStep } = {}) {
  const chapterControlRef = ref(null);
  const verseControlRef = ref(null);

  function onControlKeydown(event) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const direction = getArrowDirection(event.key);
    if (!direction) return;

    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    if (target === chapterControlRef.value) {
      event.preventDefault();
      onChapterStep?.(direction);
      return;
    }

    if (target === verseControlRef.value) {
      event.preventDefault();
      onVerseStep?.(direction);
    }
  }

  return {
    chapterControlRef,
    verseControlRef,
    onControlKeydown,
  };
}
