import { describe, expect, it } from 'vitest';

import {
  chooseTickStepSeconds,
  clampSecondsPerPixel,
  getFillHeight,
  getTicks,
  getVisibleRange,
  layoutEvents,
  layoutEventsAbsolute,
  layoutToScreen,
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
    it('should center a thumbnail level with its pill', () => {
      const [item] = layoutEvents(
        createGeometry(),
        [{ id: 'a', start: NOW - 600 * 1000, end: NOW - 300 * 1000 }],
        56,
      );
      expect(item.top).toBeCloseTo(100);
      expect(item.bottom).toBeCloseTo(130);
      expect(item.anchor).toBeCloseTo(115);
      expect(item.thumbnailTop).toBeCloseTo(87);
    });

    it('should give short events a minimum height', () => {
      const [item] = layoutEvents(
        createGeometry(),
        [{ id: 'a', start: NOW - 1000, end: NOW }],
        56,
      );
      expect(item.bottom - item.top).toBeCloseTo(SCRUBBER_MIN_PILL_HEIGHT);
    });

    it('should leave out a thumbnail that would overlap, not push it', () => {
      const items = layoutEvents(
        createGeometry(),
        [
          { id: 'newest', start: NOW - 20 * 1000, end: NOW },
          { id: 'close', start: NOW - 400 * 1000, end: NOW - 200 * 1000 },
          { id: 'far', start: NOW - 1200 * 1000, end: NOW - 1000 * 1000 },
        ],
        56,
      );
      expect(items.map((item) => item.id)).toEqual(['newest', 'close', 'far']);
      // Centered on its pill (70-80).
      expect(items[0].thumbnailTop).toBeCloseTo(47);
      // Would start at 72, inside the first thumbnail (47-103).
      expect(items[1].thumbnailTop).toBeNull();
      // Clear of the first, so centered on its pill (170-190).
      expect(items[2].thumbnailTop).toBeCloseTo(152);
    });

    it('should not change the layout when the strip scrolls', () => {
      const events = Array.from({ length: 30 }, (_, index) => ({
        id: `event-${index}`,
        start: NOW - (index * 37 + 30) * 1000,
        end: NOW - index * 37 * 1000,
      }));
      const layout = layoutEventsAbsolute(events, 10, 56);

      const shown = (time: number) =>
        layoutToScreen(createGeometry({ time, height: 2000 }), layout, 56)
          .filter((item) => item.thumbnailTop !== null)
          .map((item) => item.id);

      // Scrolled by 3 and then 7.5 minutes: the same thumbnails remain, each
      // moved by the scroll distance.
      expect(shown(NOW - 180 * 1000)).toEqual(shown(NOW));
      expect(shown(NOW - 450 * 1000)).toEqual(shown(NOW));

      const before = layoutToScreen(createGeometry(), layout, 56);
      const after = layoutToScreen(createGeometry({ time: NOW - 100 * 1000 }), layout, 56);
      const first = after.find((item) => item.id === before[0].id);
      expect(first?.top).toBeCloseTo(before[0].top - 10);
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

  describe('should fill the space the video does not need', () => {
    const base = {
      containerWidth: 450,
      containerHeight: 1000,
      headerHeight: 44,
      minHeight: 280,
    };

    it('should take what is left under a square video', () => {
      expect(getFillHeight({ ...base, mediaAspect: 1 })).toBe(1000 - 450 - 44);
    });

    it('should not go below the configured height', () => {
      expect(getFillHeight({ ...base, containerHeight: 700, mediaAspect: 1 })).toBe(280);
    });

    it('should use the configured height until the video size is known', () => {
      expect(getFillHeight({ ...base, mediaAspect: null })).toBe(280);
      expect(getFillHeight({ ...base, containerHeight: 0, mediaAspect: 1 })).toBe(280);
    });
  });
});
