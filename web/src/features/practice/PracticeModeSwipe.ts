import { resolveHorizontalSwipe } from './QuestionSwipeNavigation';
import type { PracticeCenterMode } from './usePracticeQuestionSetPagination';

const PRACTICE_MODES: readonly PracticeCenterMode[] = ['tutor', 'self', 'true'];

export function usePracticeModeSwipe(
  getActiveMode: () => PracticeCenterMode,
  selectMode: (mode: PracticeCenterMode) => void
) {
  let startedAt = 0;
  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let currentY = 0;
  let horizontal = false;

  function handleTouchStart(event: TouchEvent) {
    const touch = event.touches[0];
    if (!touch || isBlocked(event.target)) return;
    startX = touch.clientX;
    startY = touch.clientY;
    currentX = touch.clientX;
    currentY = touch.clientY;
    startedAt = Date.now();
    horizontal = false;
  }

  function handleTouchMove(event: TouchEvent) {
    const touch = event.touches[0];
    if (!touch || !startedAt) return;
    currentX = touch.clientX;
    currentY = touch.clientY;
    const deltaX = currentX - startX;
    const deltaY = currentY - startY;
    if (!horizontal && Math.abs(deltaX) >= 12 && Math.abs(deltaX) > Math.abs(deltaY) * 1.25) {
      horizontal = true;
    }
    if (horizontal && event.cancelable) event.preventDefault();
  }

  function handleTouchEnd() {
    if (!startedAt) return;
    const direction = resolveHorizontalSwipe({
      deltaX: currentX - startX,
      deltaY: currentY - startY,
      durationMs: Date.now() - startedAt
    });
    resetTouch();
    if (!direction) return;
    const currentIndex = PRACTICE_MODES.indexOf(getActiveMode());
    const nextMode = PRACTICE_MODES[currentIndex + direction];
    if (nextMode) selectMode(nextMode);
  }

  function resetTouch() {
    startedAt = 0;
    horizontal = false;
  }

  return {
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    resetTouch
  };
}

function isBlocked(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest(
    'input, textarea, select, [contenteditable="true"], [data-horizontal-scroll], .choice-row, .capability-list'
  ));
}
