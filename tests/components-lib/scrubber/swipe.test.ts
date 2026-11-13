import { describe, expect, it, vi } from 'vitest';

import {
  detectVerticalSwipe,
  VerticalSwipeTracker,
} from '../../../src/components-lib/scrubber/swipe';

const at = (x: number, y: number, time = 0) => ({ x, y, time });

describe('detectVerticalSwipe', () => {
  it('should detect a swipe down and up', () => {
    expect(detectVerticalSwipe(at(100, 100), at(105, 200, 200))).toBe('down');
    expect(detectVerticalSwipe(at(100, 200), at(95, 100, 200))).toBe('up');
  });

  it('should ignore short movements', () => {
    expect(detectVerticalSwipe(at(100, 100), at(100, 140, 100))).toBeNull();
  });

  it('should ignore slow drags', () => {
    expect(detectVerticalSwipe(at(100, 100), at(100, 300, 1000))).toBeNull();
  });

  it('should ignore mostly sideways swipes', () => {
    expect(detectVerticalSwipe(at(100, 100), at(200, 180, 200))).toBeNull();
  });
});

const createTouchEvent = (options: {
  x: number;
  y: number;
  time: number;
  touches: number;
  path?: EventTarget[];
}): TouchEvent => {
  const touch = { clientX: options.x, clientY: options.y };
  return {
    touches: Array(options.touches).fill(touch),
    changedTouches: [touch],
    timeStamp: options.time,
    composedPath: () => options.path ?? [],
  } as unknown as TouchEvent;
};

// A stand-in element (these tests run without a DOM).
const createElement = (tagName: string, attributes: string[] = []): EventTarget =>
  ({
    tagName: tagName.toUpperCase(),
    hasAttribute: (name: string) => attributes.includes(name),
  }) as unknown as EventTarget;

describe('VerticalSwipeTracker', () => {
  it('should report a one-finger swipe', () => {
    const onSwipe = vi.fn();
    const tracker = new VerticalSwipeTracker(onSwipe);

    tracker.handleTouchStart(createTouchEvent({ x: 0, y: 0, time: 0, touches: 1 }));
    tracker.handleTouchEnd(createTouchEvent({ x: 0, y: 120, time: 150, touches: 0 }));

    expect(onSwipe).toHaveBeenCalledWith('down');
  });

  it('should ignore multi-finger gestures', () => {
    const onSwipe = vi.fn();
    const tracker = new VerticalSwipeTracker(onSwipe);

    tracker.handleTouchStart(createTouchEvent({ x: 0, y: 0, time: 0, touches: 2 }));
    tracker.handleTouchEnd(createTouchEvent({ x: 0, y: 120, time: 150, touches: 0 }));

    expect(onSwipe).not.toHaveBeenCalled();
  });

  it('should ignore a lift while another finger is down', () => {
    const onSwipe = vi.fn();
    const tracker = new VerticalSwipeTracker(onSwipe);

    tracker.handleTouchStart(createTouchEvent({ x: 0, y: 0, time: 0, touches: 1 }));
    tracker.handleTouchEnd(createTouchEvent({ x: 0, y: 120, time: 150, touches: 1 }));

    expect(onSwipe).not.toHaveBeenCalled();
  });

  it('should ignore touches on the scrubber', () => {
    const onSwipe = vi.fn();
    const tracker = new VerticalSwipeTracker(onSwipe);
    const scrubber = createElement('advanced-camera-card-scrubber');

    tracker.handleTouchStart(
      createTouchEvent({ x: 0, y: 0, time: 0, touches: 1, path: [scrubber] }),
    );
    tracker.handleTouchEnd(createTouchEvent({ x: 0, y: 120, time: 150, touches: 0 }));

    expect(onSwipe).not.toHaveBeenCalled();
  });

  it('should ignore touches on a zoomed-in video', () => {
    const onSwipe = vi.fn();
    const tracker = new VerticalSwipeTracker(onSwipe);
    const zoomer = createElement('advanced-camera-card-zoomer', ['zoomed']);

    tracker.handleTouchStart(
      createTouchEvent({ x: 0, y: 0, time: 0, touches: 1, path: [zoomer] }),
    );
    tracker.handleTouchEnd(createTouchEvent({ x: 0, y: 120, time: 150, touches: 0 }));

    expect(onSwipe).not.toHaveBeenCalled();
  });

  it('should forget a cancelled touch', () => {
    const onSwipe = vi.fn();
    const tracker = new VerticalSwipeTracker(onSwipe);

    tracker.handleTouchStart(createTouchEvent({ x: 0, y: 0, time: 0, touches: 1 }));
    tracker.handleTouchCancel();
    tracker.handleTouchEnd(createTouchEvent({ x: 0, y: 120, time: 150, touches: 0 }));

    expect(onSwipe).not.toHaveBeenCalled();
  });
});
