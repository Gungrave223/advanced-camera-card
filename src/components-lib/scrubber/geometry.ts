// Pure layout maths for the vertical scrubber. Newest time is at the top; a
// fixed horizontal playhead sits at `playheadY` and the strip moves under it.

export interface ScrubberGeometry {
  // Height of the strip in pixels.
  height: number;

  // Distance of the playhead from the top of the strip in pixels.
  playheadY: number;

  // Zoom: seconds of footage per vertical pixel.
  secondsPerPixel: number;

  // The time (epoch ms) under the playhead.
  time: number;
}

export interface ScrubberRange {
  start: number;
  end: number;
}

export interface ScrubberTick {
  time: number;
  y: number;

  // On an hour boundary (labels drawn stronger).
  major: boolean;

  // On a local midnight (a date label is drawn).
  midnight: boolean;
}

export interface ScrubberLayoutInput {
  id: string;
  start: number;
  end: number;
}

export interface ScrubberLayoutItem {
  id: string;

  // Top and bottom of the event pill (top is the end of the event).
  top: number;
  bottom: number;

  // Top of the thumbnail beside the pill, or null when there is no room.
  thumbnailTop: number | null;
}

export const SCRUBBER_MIN_SECONDS_PER_PIXEL = 0.25;
export const SCRUBBER_MAX_SECONDS_PER_PIXEL = 240;

// Minimum height of a pill, so very short events stay tappable.
export const SCRUBBER_MIN_PILL_HEIGHT = 10;

const TICK_STEPS_SECONDS = [
  10, 15, 30, 60, 2 * 60, 5 * 60, 10 * 60, 15 * 60, 30 * 60, 60 * 60, 2 * 60 * 60,
  3 * 60 * 60, 6 * 60 * 60, 12 * 60 * 60, 24 * 60 * 60,
];

export const clampSecondsPerPixel = (secondsPerPixel: number): number =>
  Math.min(
    SCRUBBER_MAX_SECONDS_PER_PIXEL,
    Math.max(SCRUBBER_MIN_SECONDS_PER_PIXEL, secondsPerPixel),
  );

export const timeToY = (geometry: ScrubberGeometry, time: number): number =>
  geometry.playheadY + (geometry.time - time) / 1000 / geometry.secondsPerPixel;

export const yToTime = (geometry: ScrubberGeometry, y: number): number =>
  geometry.time - (y - geometry.playheadY) * geometry.secondsPerPixel * 1000;

export const getVisibleRange = (geometry: ScrubberGeometry): ScrubberRange => ({
  start: yToTime(geometry, geometry.height),
  end: yToTime(geometry, 0),
});

/**
 * Move the strip by a pointer movement. Dragging down brings newer footage
 * (from above) under the playhead.
 */
export const timeAfterDrag = (
  geometry: ScrubberGeometry,
  deltaY: number,
): number => geometry.time + deltaY * geometry.secondsPerPixel * 1000;

export const chooseTickStepSeconds = (
  secondsPerPixel: number,
  minGapPixels = 44,
): number =>
  TICK_STEPS_SECONDS.find((step) => step / secondsPerPixel >= minGapPixels) ??
  TICK_STEPS_SECONDS[TICK_STEPS_SECONDS.length - 1];

const getTimezoneOffsetMs = (time: number): number =>
  new Date(time).getTimezoneOffset() * 60 * 1000;

const isLocalMidnight = (time: number): boolean => {
  const date = new Date(time);
  return (
    date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0
  );
};

/**
 * Ticks for the visible strip, aligned to local time, newest first.
 */
export const getTicks = (
  geometry: ScrubberGeometry,
  minGapPixels = 44,
): ScrubberTick[] => {
  const stepMs = chooseTickStepSeconds(geometry.secondsPerPixel, minGapPixels) * 1000;
  const range = getVisibleRange(geometry);
  const ticks: ScrubberTick[] = [];

  // Align in local time so hour and multi-hour steps land on local hours.
  const offset = getTimezoneOffsetMs(range.end);
  let time = Math.floor((range.end - offset) / stepMs) * stepMs + offset;

  // Guard against pathological inputs producing huge loops.
  for (let i = 0; time >= range.start && i < 1000; i++, time -= stepMs) {
    const date = new Date(time);
    ticks.push({
      time,
      y: timeToY(geometry, time),
      major: date.getMinutes() === 0 && date.getSeconds() === 0,
      midnight: isLocalMidnight(time),
    });
  }
  return ticks;
};

/**
 * Zoom around the playhead (the time under it does not change), as in Google
 * Home: the footage being watched stays put while the scale changes.
 */
export const zoom = (geometry: ScrubberGeometry, factor: number): ScrubberGeometry => ({
  ...geometry,
  secondsPerPixel: clampSecondsPerPixel(geometry.secondsPerPixel * factor),
});

/**
 * Lay out event pills and their thumbnails. Thumbnails sit beside the pill's
 * top (the newest moment of the event); when they would overlap the one above,
 * they are pushed down, and dropped if that moves them too far from the pill.
 */
export const layoutEvents = (
  geometry: ScrubberGeometry,
  events: ScrubberLayoutInput[],
  thumbnailHeight: number,
  gap = 4,
): ScrubberLayoutItem[] => {
  const sorted = [...events].sort((a, b) => b.end - a.end);
  const items: ScrubberLayoutItem[] = [];
  let lastThumbnailBottom = -Infinity;

  for (const event of sorted) {
    const top = timeToY(geometry, event.end);
    const bottom = Math.max(timeToY(geometry, event.start), top + SCRUBBER_MIN_PILL_HEIGHT);

    if (bottom < 0 || top > geometry.height) {
      continue;
    }

    let thumbnailTop: number | null = Math.max(top, lastThumbnailBottom + gap);
    if (thumbnailTop - bottom > thumbnailHeight / 2) {
      thumbnailTop = null;
    } else {
      lastThumbnailBottom = thumbnailTop + thumbnailHeight;
    }

    items.push({ id: event.id, top, bottom, thumbnailTop });
  }
  return items;
};

/**
 * Advance a fling. Velocity is in pixels per millisecond and decays
 * exponentially; returns the new velocity and the distance travelled.
 */
export const stepMomentum = (
  velocity: number,
  elapsedMs: number,
  decayPer16ms = 0.95,
): { velocity: number; distance: number } => {
  const decay = Math.pow(decayPer16ms, elapsedMs / 16);
  return { velocity: velocity * decay, distance: velocity * elapsedMs };
};
