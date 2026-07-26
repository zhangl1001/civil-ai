export interface QuestionSwipeGesture {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly durationMs: number;
}

export type QuestionSwipeDirection = -1 | 0 | 1;

const MIN_DISTANCE_PX = 48;
const MAX_DURATION_MS = 900;
const HORIZONTAL_DOMINANCE = 1.25;

/** Returns -1 for previous, 1 for next, and 0 when the gesture is vertical or ambiguous. */
export function resolveQuestionSwipe(gesture: QuestionSwipeGesture): QuestionSwipeDirection {
  const horizontalDistance = Math.abs(gesture.deltaX);
  const verticalDistance = Math.abs(gesture.deltaY);
  if (
    gesture.durationMs > MAX_DURATION_MS
    || horizontalDistance < MIN_DISTANCE_PX
    || horizontalDistance < verticalDistance * HORIZONTAL_DOMINANCE
  ) {
    return 0;
  }
  return gesture.deltaX < 0 ? 1 : -1;
}
