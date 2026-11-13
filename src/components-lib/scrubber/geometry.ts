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

  // Middle of the pill, where its thumbnail is centered and connected.
  anchor: number;

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

// Positions in "absolute" pixels: y = -time / secondsPerPixel. They depend
// only on the zoom, not on where the strip is scrolled to, so a layout
// computed in them stays put while scrubbing.
const toAbsoluteY = (time: number, secondsPerPixel: number): number =>
  -time / 1000 / secondsPerPixel;

const getAbsoluteOffset = (geometry: ScrubberGeometry): number =>
  geometry.playheadY + geometry.time / 1000 / geometry.secondsPerPixel;

/**
 * Lay out event pills and their thumbnails, independent of scrolling (only
 * the zoom matters). As in Google Home, each thumbnail is centered level with
 * its pill; when events are bunched up, a thumbnail that would overlap the one
 * above is left out (that event shows as a pill only) rather than pushed out
 * of line.
 */
export const layoutEventsAbsolute = (
  events: ScrubberLayoutInput[],
  secondsPerPixel: number,
  thumbnailHeight: number,
  gap = 8,
): ScrubberLayoutItem[] => {
  const items = events
    .map((event): ScrubberLayoutItem => {
      const top = toAbsoluteY(event.end, secondsPerPixel);
      const bottom = Math.max(
        toAbsoluteY(event.start, secondsPerPixel),
        top + SCRUBBER_MIN_PILL_HEIGHT,
      );
      return { id: event.id, top, bottom, anchor: (top + bottom) / 2, thumbnailTop: null };
    })
    .sort((a, b) => a.anchor - b.anchor || a.id.localeCompare(b.id));

  let lastThumbnailBottom = -Infinity;
  for (const item of items) {
    const thumbnailTop = item.anchor - thumbnailHeight / 2;
    if (thumbnailTop >= lastThumbnailBottom + gap) {
      item.thumbnailTop = thumbnailTop;
      lastThumbnailBottom = thumbnailTop + thumbnailHeight;
    }
  }
  return items;
};

/**
 * Move an absolute layout to the strip's current position, keeping only the
 * items (or thumbnails) that are on screen.
 */
export const layoutToScreen = (
  geometry: ScrubberGeometry,
  layout: ScrubberLayoutItem[],
  thumbnailHeight: number,
): ScrubberLayoutItem[] => {
  const offset = getAbsoluteOffset(geometry);
  const items: ScrubberLayoutItem[] = [];
  for (const item of layout) {
    const top = item.top + offset;
    const bottom = item.bottom + offset;
    const thumbnailTop = item.thumbnailTop === null ? null : item.thumbnailTop + offset;
    const pillVisible = bottom >= 0 && top <= geometry.height;
    const thumbnailVisible =
      thumbnailTop !== null &&
      thumbnailTop + thumbnailHeight >= 0 &&
      thumbnailTop <= geometry.height;
    if (pillVisible || thumbnailVisible) {
      items.push({ id: item.id, top, bottom, anchor: item.anchor + offset, thumbnailTop });
    }
  }
  return items;
};

export const layoutEvents = (
  geometry: ScrubberGeometry,
  events: ScrubberLayoutInput[],
  thumbnailHeight: number,
  gap = 8,
): ScrubberLayoutItem[] =>
  layoutToScreen(
    geometry,
    layoutEventsAbsolute(events, geometry.secondsPerPixel, thumbnailHeight, gap),
    thumbnailHeight,
  );

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
