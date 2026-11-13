import { describe, expect, it } from 'vitest';

import {
  chooseTickStepSeconds,
  clampSecondsPerPixel,
  getTicks,
  getVisibleRange,
  layoutEvents,
  SCRUBBER_MAX_SECONDS_PER_PIXEL,
  SCRUBBER_MIN_PILL_HEIGHT,
  SCRUBBER_MIN_SECONDS_PER_PIXEL,
  stepMomentum,
  timeAfterDrag,
  timeToY,
  yToTime,
  zoom,
  type ScrubberGeometry,
} from '../../../src/components-lib/scrubber/geometry';

const NOW = new Date('2026-11-13T15:00:00').getTime();

const createGeometry = (geometry?: Partial<ScrubberGeometry>): ScrubberGeometry => ({
  height: 280,
  playheadY: 70,
  secondsPerPixel: 10,
  time: NOW,
  ...geometry,
});

describe('scrubber geometry', () => {
  it('should put the playhead time at the playhead', () => {
    const geometry = createGeometry();
    expect(timeToY(geometry, NOW)).toBe(70);
    expect(yToTime(geometry, 70)).toBe(NOW);
  });

  it('should put newer time above and older time below', () => {
    const geometry = createGeometry();
    expect(timeToY(geometry, NOW + 100 * 1000)).toBe(60);
    expect(timeToY(geometry, NOW - 100 * 1000)).toBe(80);
  });

  it('should round-trip time and position', () => {
    const geometry = createGeometry({ secondsPerPixel: 3.5 });
    expect(yToTime(geometry, timeToY(geometry, NOW - 12345))).toBeCloseTo(NOW - 12345);
  });

  it('should report the visible range', () => {
    expect(getVisibleRange(createGeometry())).toEqual({
      start: NOW - 210 * 10 * 1000,
      end: NOW + 70 * 10 * 1000,
    });
  });

  it('should bring newer footage under the playhead when dragged down', () => {
    expect(timeAfterDrag(createGeometry(), 10)).toBe(NOW + 100 * 1000);
    expect(timeAfterDrag(createGeometry(), -10)).toBe(NOW - 100 * 1000);
  });

  it('should clamp the zoom', () => {
    expect(clampSecondsPerPixel(0)).toBe(SCRUBBER_MIN_SECONDS_PER_PIXEL);
    expect(clampSecondsPerPixel(1e9)).toBe(SCRUBBER_MAX_SECONDS_PER_PIXEL);
    expect(clampSecondsPerPixel(7)).toBe(7);
  });

  it('should zoom without moving the playhead time', () => {
    const zoomed = zoom(createGeometry(), 2);
    expect(zoomed.secondsPerPixel).toBe(20);
    expect(zoomed.time).toBe(NOW);
  });

  describe('should choose tick steps', () => {
    it.each([
      [0.25, 15],
      [1, 60],
      [10, 600],
      [25, 1800],
      [60, 3600],
      [240, 3 * 60 * 60],
    ])('%s seconds per pixel', (secondsPerPixel, step) => {
      expect(chooseTickStepSeconds(secondsPerPixel)).toBe(step);
    });
  });

  it('should produce local, newest-first ticks inside the strip', () => {
    const ticks = getTicks(createGeometry({ secondsPerPixel: 60 }));
    expect(ticks.length).toBeGreaterThan(2);
    for (const [index, tick] of ticks.entries()) {
      expect(new Date(tick.time).getMinutes()).toBe(0);
      expect(tick.major).toBe(true);
      if (index) {
        expect(tick.time).toBeLessThan(ticks[index - 1].time);
      }
    }
    expect(ticks.find((tick) => tick.time === NOW)?.y).toBe(70);
  });

  it('should mark local midnight', () => {
    const midnight = new Date('2026-11-13T00:00:00').getTime();
    const ticks = getTicks(createGeometry({ time: midnight, secondsPerPixel: 60 }));
    expect(ticks.find((tick) => tick.time === midnight)?.midnight).toBe(true);
    expect(ticks.filter((tick) => tick.midnight)).toHaveLength(1);
  });

  describe('should lay out events', () => {
    it('should place a pill from end (top) to start (bottom)', () => {
      const [item] = layoutEvents(
        createGeometry(),
        [{ id: 'a', start: NOW - 600 * 1000, end: NOW - 300 * 1000 }],
        56,
      );
      expect(item).toEqual({ id: 'a', top: 100, bottom: 130, thumbnailTop: 100 });
    });

    it('should give short events a minimum height', () => {
      const [item] = layoutEvents(
        createGeometry(),
        [{ id: 'a', start: NOW - 1000, end: NOW }],
        56,
      );
      expect(item.bottom - item.top).toBe(SCRUBBER_MIN_PILL_HEIGHT);
    });

    it('should push overlapping thumbnails down and drop ones too far away', () => {
      const items = layoutEvents(
        createGeometry(),
        [
          { id: 'newest', start: NOW - 20 * 1000, end: NOW },
          { id: 'close', start: NOW - 400 * 1000, end: NOW - 200 * 1000 },
          { id: 'crowded', start: NOW - 500 * 1000, end: NOW - 450 * 1000 },
        ],
        56,
      );
      expect(items.map((item) => item.id)).toEqual(['newest', 'close', 'crowded']);
      expect(items[0].thumbnailTop).toBe(70);
      // Pushed below the first thumbnail (70 + 56 + 4 gap).
      expect(items[1].thumbnailTop).toBe(130);
      // Would need to sit at 190, far below its pill (115-125).
      expect(items[2].thumbnailTop).toBeNull();
    });

    it('should skip events outside the strip', () => {
      expect(
        layoutEvents(
          createGeometry(),
          [{ id: 'old', start: NOW - 10 * 3600 * 1000, end: NOW - 9 * 3600 * 1000 }],
          56,
        ),
      ).toEqual([]);
    });
  });

  it('should slow a fling down', () => {
    const first = stepMomentum(1, 16);
    expect(first.distance).toBe(16);
    expect(first.velocity).toBeCloseTo(0.95);
    expect(stepMomentum(1, 32).velocity).toBeCloseTo(0.9025);
  });
});
