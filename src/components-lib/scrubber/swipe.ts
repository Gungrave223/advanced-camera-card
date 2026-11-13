// Detects a quick vertical one-finger swipe over the video, used to hide
// (swipe down) or show (swipe up) the scrubber on touch screens.

export type VerticalSwipe = 'up' | 'down';

export const SWIPE_MIN_DISTANCE_PX = 60;
export const SWIPE_MAX_DURATION_MS = 700;

// The swipe must be mostly vertical: sideways movement at most this
// proportion of the vertical movement (so carousel swipes do not count).
export const SWIPE_MAX_SIDEWAYS_RATIO = 0.5;

export const detectVerticalSwipe = (
  start: { x: number; y: number; time: number },
  end: { x: number; y: number; time: number },
): VerticalSwipe | null => {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  if (
    end.time - start.time > SWIPE_MAX_DURATION_MS ||
    Math.abs(deltaY) < SWIPE_MIN_DISTANCE_PX ||
    Math.abs(deltaX) > Math.abs(deltaY) * SWIPE_MAX_SIDEWAYS_RATIO
  ) {
    return null;
  }
  return deltaY > 0 ? 'down' : 'up';
};

const isElement = (target: EventTarget): target is Element =>
  typeof (target as Element).hasAttribute === 'function' &&
  typeof (target as Element).tagName === 'string';

const isIgnoredTarget = (path: EventTarget[]): boolean =>
  path.some(
    (target) =>
      isElement(target) &&
      // Scrubbing the strip itself, or panning a zoomed-in video.
      (target.tagName.toUpperCase() === 'ADVANCED-CAMERA-CARD-SCRUBBER' ||
        target.hasAttribute('zoomed')),
  );

/**
 * Tracks touches on a container and reports vertical swipes. Ignores
 * multi-finger gestures (pinch zoom), touches that start on the scrubber, and
 * touches on a zoomed-in video (where a drag pans the image).
 */
export class VerticalSwipeTracker {
  private _start: { x: number; y: number; time: number } | null = null;
  private _onSwipe: (swipe: VerticalSwipe) => void;

  constructor(onSwipe: (swipe: VerticalSwipe) => void) {
    this._onSwipe = onSwipe;
  }

  public handleTouchStart = (ev: TouchEvent): void => {
    const touch = ev.touches[0];
    this._start =
      ev.touches.length === 1 && touch && !isIgnoredTarget(ev.composedPath())
        ? { x: touch.clientX, y: touch.clientY, time: ev.timeStamp }
        : null;
  };

  public handleTouchEnd = (ev: TouchEvent): void => {
    const start = this._start;
    this._start = null;
    const touch = ev.changedTouches[0];
    // Another finger still down means this was part of a multi-touch gesture.
    if (!start || !touch || ev.touches.length) {
      return;
    }
    const swipe = detectVerticalSwipe(start, {
      x: touch.clientX,
      y: touch.clientY,
      time: ev.timeStamp,
    });
    if (swipe) {
      this._onSwipe(swipe);
    }
  };

  public handleTouchCancel = (): void => {
    this._start = null;
  };
}
