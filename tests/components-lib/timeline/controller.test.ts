import { add } from 'date-fns';
import { LitElement } from 'lit';
import type { TimelineEventPropertiesResult, TimelineWindow } from 'vis-timeline';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import type { FoldersManager } from '../../../src/card-controller/folders/manager';
import type {
  ViewManagerEpoch,
  ViewManagerInterface,
} from '../../../src/card-controller/view/types';
import { TimelineController } from '../../../src/components-lib/timeline/controller';
import type { AdvancedCameraCardTimelineItem } from '../../../src/components-lib/timeline/source';
import type {
  ExtendedTimeline,
  TimelineRangeChange,
} from '../../../src/components-lib/timeline/types';
import type { ConditionStateManagerReadonlyInterface } from '../../../src/condition-trigger/conditions/types';
import type {
  TimelineCoreComponentConfig,
  TimelinePanMode,
} from '../../../src/config/schema/common/controls/timeline';
import { ViewMediaType, type ViewMedia } from '../../../src/view/item';
import { QueryResults } from '../../../src/view/query-results';
import { UnifiedQuery } from '../../../src/view/unified-query';
import { createCameraManager, createStore } from '../../camera-manager/test-utils';
import { createHASS, stubMatchMedia } from '../../test-utils';
import { createReviewQuery, createView, TestViewMedia } from '../../view/test-utils';

// Vitest hoists vi.mock above this, so its factory can only reach a vi.hoisted value.
const { timelineConstructor } = vi.hoisted(() => ({
  timelineConstructor: vi.fn(),
}));
vi.mock('vis-timeline', () => ({
  Timeline: timelineConstructor,
}));

const CAMERA_ID = 'camera-1';

// The window the mocked timeline reports for the duration of every test.
const WINDOW: TimelineWindow = {
  start: new Date('2026-09-01T12:00:00Z'),
  end: new Date('2026-09-01T13:00:00Z'),
};

class TimelineControllerTestHost extends LitElement {}
customElements.define(
  'advanced-camera-card-timeline-controller-test-host',
  TimelineControllerTestHost,
);

const createTimelineConfig = (
  panMode: TimelinePanMode,
  style: 'ribbon' | 'stack' = 'ribbon',
): TimelineCoreComponentConfig => ({
  clustering_threshold: 3,
  window_seconds: 60 * 60,
  show_recordings: false,
  style,
  format: { '24h': true },
  pan_mode: panMode,
});

interface TestHarness {
  controller: TimelineController;
  timeline: ExtendedTimeline;
  manager: ViewManagerInterface;
  trigger: (event: string, ...args: unknown[]) => void;
}

const createHarness = async (options?: {
  panMode?: TimelinePanMode;
  media?: ViewMedia[];
  mini?: boolean;
  style?: 'ribbon' | 'stack';
}): Promise<TestHarness> => {
  stubMatchMedia().mockReturnValue({ matches: true });

  const handlers = new Map<string, (...args: unknown[]) => void>();
  const selection: string[] = [];

  const timeline = mock<ExtendedTimeline>();
  timeline.on.mockImplementation((event?: string, callback?): void => {
    if (event && callback) {
      handlers.set(event, callback);
    }
  });
  timeline.getWindow.mockReturnValue(WINDOW);
  timeline.getSelection.mockReturnValue(selection);
  timeline.setSelection.mockImplementation((ids): void => {
    selection.length = 0;
    selection.push(...(Array.isArray(ids) ? ids.map(String) : [String(ids)]));
  });
  timelineConstructor.mockImplementation(function () {
    return timeline;
  });

  const cameraManager = createCameraManager(createStore([{ cameraID: CAMERA_ID }]));
  vi.mocked(cameraManager.getCameraMetadata).mockReturnValue({
    title: 'Camera Title',
    icon: { icon: 'mdi:camera' },
  });
  vi.mocked(cameraManager.executeMediaQueries).mockResolvedValue([]);

  const query = new UnifiedQuery();
  query.addNode(createReviewQuery(CAMERA_ID));

  const controller = new TimelineController(new TimelineControllerTestHost());
  controller.setHass(createHASS());
  controller.setOptions({
    cameraManager: cameraManager,
    foldersManager: mock<FoldersManager>(),
    conditionStateManager: mock<ConditionStateManagerReadonlyInterface>(),
    timelineConfig: createTimelineConfig(options?.panMode ?? 'pan', options?.style),
    mini: options?.mini ?? true,
    query,
  });
  controller.setTimelineElement(document.createElement('div'));

  const manager = mock<ViewManagerInterface>();
  manager.getView.mockReturnValue(
    createView({
      view: 'live',
      camera: CAMERA_ID,
      query: query,
      queryResults: new QueryResults({
        results: options?.media ?? [],
        selectedIndex: 0,
      }),
    }),
  );
  await controller.setView(mock<ViewManagerEpoch>({ manager: manager }));

  return {
    controller: controller,
    timeline: timeline,
    manager: manager,
    trigger: (event: string, ...args: unknown[]): void => {
      handlers.get(event)?.(...args);
    },
  };
};

const createEventMedia = (options?: { id?: string }): TestViewMedia =>
  new TestViewMedia({
    mediaType: ViewMediaType.Clip,
    cameraID: CAMERA_ID,
    id: options?.id ?? 'event-1',
    startTime: add(WINDOW.start, { minutes: 29 }),
    endTime: add(WINDOW.start, { minutes: 31 }),
  });

const createReviewMedia = (options?: {
  id?: string;
  startTime?: Date;
  endTime?: Date;
}): TestViewMedia =>
  new TestViewMedia({
    mediaType: ViewMediaType.Review,
    cameraID: CAMERA_ID,
    id: options?.id ?? 'review-1',
    startTime: options?.startTime ?? add(WINDOW.start, { minutes: 29 }),
    endTime: options?.endTime ?? add(WINDOW.start, { minutes: 31 }),
  });

const dragTimeline = (harness: TestHarness, pointerTime: Date): void => {
  harness.trigger(
    'mouseDown',
    mock<TimelineEventPropertiesResult>({ time: pointerTime }),
  );

  const rangeChange: TimelineRangeChange = {
    start: WINDOW.start,
    end: WINDOW.end,
    byUser: true,
    event: new Event('pointermove'),
  };
  harness.trigger('rangechange', rangeChange);
};

// @vitest-environment jsdom
describe('TimelineController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render the item severity as a data attribute', async () => {
    await createHarness();

    const options = timelineConstructor.mock.calls[0]?.at(-1);

    expect(options).toEqual(expect.objectContaining({ dataAttributes: ['severity'] }));
  });

  describe('should decide what can be clustered', () => {
    const createItem = (
      media: ViewMedia,
      type: 'range' | 'background' = 'range',
    ): AdvancedCameraCardTimelineItem => ({
      id: media.getID() ?? '',
      group: CAMERA_ID,
      content: '',
      start: WINDOW.start.getTime(),
      type,
      media,
      query: new UnifiedQuery(),
    });

    const getCriteria = async (
      media?: ViewMedia[],
    ): Promise<
      (
        first: AdvancedCameraCardTimelineItem,
        second: AdvancedCameraCardTimelineItem,
      ) => boolean
    > => {
      await createHarness({ style: 'stack', media });
      return timelineConstructor.mock.calls[0]?.at(-1).cluster.clusterCriteria;
    };

    it('should cluster two reviews', async () => {
      const criteria = await getCriteria();

      expect(
        criteria(
          createItem(createReviewMedia({ id: 'review-1' })),
          createItem(createReviewMedia({ id: 'review-2' })),
        ),
      ).toBe(true);
    });

    it('should not cluster a review with an event', async () => {
      const criteria = await getCriteria();

      expect(
        criteria(createItem(createReviewMedia()), createItem(createEventMedia())),
      ).toBe(false);
    });

    it('should cluster two events', async () => {
      const criteria = await getCriteria();

      expect(
        criteria(
          createItem(createEventMedia({ id: 'event-1' })),
          createItem(createEventMedia({ id: 'event-2' })),
        ),
      ).toBe(true);
    });

    it('should not cluster a recording', async () => {
      const criteria = await getCriteria();

      expect(
        criteria(
          createItem(createReviewMedia({ id: 'review-1' }), 'background'),
          createItem(createReviewMedia({ id: 'review-2' }), 'background'),
        ),
      ).toBe(false);
    });

    it('should not cluster an item with a recording', async () => {
      const criteria = await getCriteria();

      expect(
        criteria(
          createItem(createReviewMedia({ id: 'review-1' })),
          createItem(createReviewMedia({ id: 'review-2' }), 'background'),
        ),
      ).toBe(false);
    });

    it('should not cluster the selected item', async () => {
      const selected = createReviewMedia({ id: 'review-1' });
      const criteria = await getCriteria([selected]);

      expect(
        criteria(
          createItem(selected),
          createItem(createReviewMedia({ id: 'review-2' })),
        ),
      ).toBe(false);
    });

    it('should not cluster an item that carries no media', async () => {
      const criteria = await getCriteria();
      const withoutMedia: AdvancedCameraCardTimelineItem = {
        id: 'no-media',
        group: CAMERA_ID,
        content: '',
        start: WINDOW.start.getTime(),
        type: 'range',
      };

      expect(criteria(withoutMedia, createItem(createReviewMedia()))).toBe(false);
      expect(criteria(createItem(createReviewMedia()), withoutMedia)).toBe(false);
    });
  });

  it('should redraw a new timeline after it is created', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const { timeline } = await createHarness();
      expect(timeline.redraw).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1000);

      expect(timeline.redraw).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('should make a hidden timeline visible', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const { controller } = await createHarness();
      const element = document.createElement('div');
      const root = document.createElement('div');
      root.className = 'vis-timeline';
      root.style.visibility = 'hidden';
      element.appendChild(root);

      controller.setTimelineElement(element);
      vi.advanceTimersByTime(300);

      expect(root.style.visibility).toBe('visible');
    } finally {
      vi.useRealTimers();
    }
  });

  it('should not redraw a destroyed timeline', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const { controller, timeline } = await createHarness();

      controller.destroyTimeline();
      vi.advanceTimersByTime(1000);

      expect(timeline.redraw).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('should reveal a new timeline whose window is already correct', async () => {
    const { controller, timeline, manager } = await createHarness();

    expect(timeline.setWindow).toHaveBeenCalledTimes(1);
    expect(timeline.setWindow).toHaveBeenCalledWith(
      WINDOW.start,
      add(WINDOW.end, { seconds: 1 }),
    );

    await controller.setView(mock<ViewManagerEpoch>({ manager: manager }));
    expect(timeline.setWindow).toHaveBeenCalledTimes(1);
  });

  describe('should show the position of the footage', () => {
    const start = WINDOW.start.getTime();
    const length = WINDOW.end.getTime() - start;

    it('should add then move the playhead', async () => {
      const { controller, timeline } = await createHarness();
      const first = new Date(start + length / 2);
      const second = new Date(start + length / 2 + 1000);

      controller.setPlayhead(first);
      expect(timeline.addCustomTime).toHaveBeenCalledWith(first, 'playhead');
      expect(timeline.setCustomTimeMarker).toHaveBeenCalled();

      controller.setPlayhead(second);
      expect(timeline.addCustomTime).toHaveBeenCalledTimes(1);
      expect(timeline.setCustomTime).toHaveBeenCalledWith(second, 'playhead');
      expect(timeline.moveTo).not.toHaveBeenCalled();
    });

    it.each([
      ['start', start + length * 0.05],
      ['end', start + length * 0.95],
    ])('should recenter near the %s of the window', async (_name, ms) => {
      const { controller, timeline } = await createHarness();
      const time = new Date(ms);

      controller.setPlayhead(time);

      expect(timeline.moveTo).toHaveBeenCalledWith(time, { animation: false });
    });

    it('should not move the window during a drag', async () => {
      const { controller, timeline, trigger } = await createHarness();
      trigger('mouseDown', { time: WINDOW.start });

      controller.setPlayhead(new Date(start + length * 0.95));

      expect(timeline.moveTo).not.toHaveBeenCalled();
    });

    it('should remove the playhead', async () => {
      const { controller, timeline } = await createHarness();

      controller.setPlayhead(null);
      expect(timeline.removeCustomTime).not.toHaveBeenCalled();

      controller.setPlayhead(new Date(start + length / 2));
      controller.setPlayhead(null);
      expect(timeline.removeCustomTime).toHaveBeenCalledWith('playhead');
    });

    it('should ignore the playhead without a timeline', () => {
      stubMatchMedia().mockReturnValue({ matches: true });
      const controller = new TimelineController(new TimelineControllerTestHost());

      expect(() => controller.setPlayhead(new Date())).not.toThrow();
    });
  });

  describe('should set the target bar during a drag', () => {
    // The time the pointer is pressed at. dragTimeline() leaves the window where
    // it was, so the controller places the target bar at this same time.
    const POINTER_TIME = add(WINDOW.start, { minutes: 30 });

    it.each([
      ['pan' as const, false],
      ['seek' as const, true],
      ['seek-in-camera' as const, true],
      ['seek-in-media' as const, true],
    ])('%s', async (panMode: TimelinePanMode, expectedVisible: boolean) => {
      const harness = await createHarness({ panMode: panMode });

      dragTimeline(harness, POINTER_TIME);

      if (expectedVisible) {
        expect(harness.timeline.addCustomTime).toHaveBeenCalledWith(
          POINTER_TIME,
          'target_bar',
        );
      } else {
        expect(harness.timeline.addCustomTime).not.toHaveBeenCalled();
      }
    });

    it('should set the target bar when the target time is outside the selected media', async () => {
      const harness = await createHarness({
        panMode: 'seek-in-media',
        media: [
          createReviewMedia({
            startTime: add(WINDOW.start, { minutes: 50 }),
            endTime: add(WINDOW.start, { minutes: 55 }),
          }),
        ],
      });

      dragTimeline(harness, POINTER_TIME);

      expect(harness.timeline.addCustomTime).toHaveBeenCalledWith(
        POINTER_TIME,
        'target_bar',
      );
    });

    it('should remove the target bar when the pointer is released', async () => {
      const harness = await createHarness({ panMode: 'seek' });

      dragTimeline(harness, POINTER_TIME);
      expect(harness.timeline.addCustomTime).toHaveBeenCalled();

      harness.trigger('mouseUp');
      expect(harness.timeline.removeCustomTime).toHaveBeenCalledWith('target_bar');
    });
  });

  describe('should select the media from the view', () => {
    it('should select a review', async () => {
      const harness = await createHarness({ media: [createReviewMedia()] });

      expect(harness.timeline.setSelection).toHaveBeenCalledWith(
        ['review-1'],
        expect.anything(),
      );
    });

    it('should select an event', async () => {
      const harness = await createHarness({
        media: [
          new TestViewMedia({
            mediaType: ViewMediaType.Clip,
            cameraID: CAMERA_ID,
            id: 'clip-1',
            startTime: add(WINDOW.start, { minutes: 29 }),
            endTime: add(WINDOW.start, { minutes: 31 }),
          }),
        ],
      });

      expect(harness.timeline.setSelection).toHaveBeenCalledWith(
        ['clip-1'],
        expect.anything(),
      );
    });

    it('should not select a recording', async () => {
      const harness = await createHarness({
        media: [
          new TestViewMedia({
            mediaType: ViewMediaType.Recording,
            cameraID: CAMERA_ID,
            id: 'recording-1',
            startTime: add(WINDOW.start, { minutes: 29 }),
            endTime: add(WINDOW.start, { minutes: 31 }),
          }),
        ],
      });

      expect(harness.timeline.setSelection).not.toHaveBeenCalled();
    });
  });

  describe('should handle a click on an item', () => {
    it('should seek to the clicked time within a review', async () => {
      const harness = await createHarness({ media: [createReviewMedia()] });
      const clickTime = add(WINDOW.start, { minutes: 30 });

      harness.trigger('click', {
        what: 'item',
        item: 'review-1',
        group: CAMERA_ID,
        time: clickTime,
        event: new Event('click'),
      });

      const parameters = vi.mocked(harness.manager.setViewByParameters).mock
        .calls[0]?.[0];
      const view = createView();
      parameters?.modifiers?.forEach((modifier) => modifier.modify(view));

      expect(view.context?.mediaViewer?.seek).toEqual(clickTime);
    });
  });
});

declare global {
  interface HTMLElementTagNameMap {
    'advanced-camera-card-timeline-controller-test-host': TimelineControllerTestHost;
  }
}
