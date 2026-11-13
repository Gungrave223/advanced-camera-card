import { describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import type { FoldersManager } from '../../../src/card-controller/folders/manager';
import { MergeContextViewModifier } from '../../../src/card-controller/view/modifiers/merge-context';
import type {
  ViewManagerEpoch,
  ViewManagerInterface,
} from '../../../src/card-controller/view/types';
import {
  getScrubberEventCategory,
  getScrubberEventColor,
  SCRUBBER_COLORS,
  SCRUBBER_ICONS,
  ScrubberController,
} from '../../../src/components-lib/scrubber/controller';
import type { ConditionStateManagerReadonlyInterface } from '../../../src/condition-trigger/conditions/types';
import type { AdvancedCameraCardView } from '../../../src/config/schema/common/const';
import type { MiniTimelineControlConfig } from '../../../src/config/schema/common/controls/timeline';
import { ViewMediaType } from '../../../src/view/item';
import { QueryResults } from '../../../src/view/query-results';
import { UnifiedQuery } from '../../../src/view/unified-query';
import { createCameraManager, createStore } from '../../camera-manager/test-utils';
import {
  createEventQuery,
  createRecordingQuery,
  createReviewQuery,
  createView,
  TestViewMedia,
} from '../../view/test-utils';

const CAMERA_ID = 'camera-1';

const createConfig = (): MiniTimelineControlConfig => ({
  clustering_threshold: 3,
  window_seconds: 60 * 60,
  show_recordings: false,
  style: 'scrubber',
  format: { '24h': true },
  mode: 'below',
  pan_mode: 'pan',
  scrubber: { height: 280, thumbnails: true, position: 'below', width: 380 },
});

const createReview = (id: string, start: string, end: string, what = ['person']) =>
  new TestViewMedia({
    id,
    mediaType: ViewMediaType.Review,
    cameraID: CAMERA_ID,
    startTime: new Date(start),
    endTime: new Date(end),
    what,
    thumbnail: `/thumb/${id}`,
  });

const createHarness = (options?: {
  view?: AdvancedCameraCardView;
  media?: TestViewMedia[];
  selectedIndex?: number;
}) => {
  const query = new UnifiedQuery();
  query.addNode(createReviewQuery(CAMERA_ID));

  const media = options?.media ?? [
    createReview('newer', '2026-09-02T10:10:00Z', '2026-09-02T10:11:00Z'),
    createReview('older', '2026-09-02T10:00:00Z', '2026-09-02T10:01:00Z', ['car']),
  ];

  const manager = mock<ViewManagerInterface>();
  manager.getView.mockReturnValue(
    createView({
      view: options?.view ?? 'media',
      camera: CAMERA_ID,
      query,
      queryResults: new QueryResults({
        results: media,
        selectedIndex: options?.selectedIndex ?? 0,
      }),
    }),
  );

  const onChange = vi.fn();
  const controller = new ScrubberController(onChange);
  const controllerOptions = {
    cameraManager: createCameraManager(createStore([{ cameraID: CAMERA_ID }])),
    foldersManager: mock<FoldersManager>(),
    conditionStateManager: mock<ConditionStateManagerReadonlyInterface>(),
    timelineConfig: createConfig(),
    query,
  };
  controller.setOptions(controllerOptions);
  controller.setView(mock<ViewManagerEpoch>({ manager }));
  return { controller, manager, media, onChange, options: controllerOptions };
};

const RANGE = {
  start: new Date('2026-09-02T09:00:00Z').getTime(),
  end: new Date('2026-09-02T11:00:00Z').getTime(),
};

describe('getScrubberEventColor', () => {
  it.each([
    [['person'], SCRUBBER_COLORS.person],
    [['Dog'], SCRUBBER_COLORS.animal],
    [['car', 'person'], SCRUBBER_COLORS.vehicle],
    [['package'], SCRUBBER_COLORS.package],
    [['umbrella'], SCRUBBER_COLORS.other],
    [null, SCRUBBER_COLORS.other],
  ])('%s', (what, color) => {
    expect(getScrubberEventColor(what)).toBe(color);
  });
});

describe('getScrubberEventCategory', () => {
  it.each([
    [['person'], 'person'],
    [['face'], 'person'],
    [['cat'], 'animal'],
    [['truck'], 'vehicle'],
    [['ups'], 'package'],
    [[], 'other'],
    [undefined, 'other'],
  ])('%s', (what, category) => {
    expect(getScrubberEventCategory(what)).toBe(category);
  });
});

describe('ScrubberController', () => {
  it('should list events in a range from the view', () => {
    const { controller } = createHarness();

    const events = controller.getEvents(RANGE);
    expect(events.map((event) => event.id).sort()).toEqual(['newer', 'older']);

    const newer = events.find((event) => event.id === 'newer');
    expect(newer).toEqual(
      expect.objectContaining({
        label: 'Person',
        color: SCRUBBER_COLORS.person,
        icon: SCRUBBER_ICONS.person,
        thumbnail: '/thumb/newer',
        selected: true,
        start: new Date('2026-09-02T10:10:00Z').getTime(),
        end: new Date('2026-09-02T10:11:00Z').getTime(),
      }),
    );
    expect(events.find((event) => event.id === 'older')?.selected).toBe(false);
  });

  it('should keep events when a recordings-only query arrives', () => {
    const { controller, options } = createHarness();

    // Seeking opens the continuous recording, with a recordings-only query.
    const recordings = new UnifiedQuery();
    recordings.addNode(createRecordingQuery(CAMERA_ID));
    controller.setOptions({ ...options, query: recordings });

    expect(controller.getEvents(RANGE)).toHaveLength(2);
  });

  it('should rebuild for a query with different events', () => {
    const { controller, options } = createHarness();

    const events = new UnifiedQuery();
    events.addNode(createEventQuery(CAMERA_ID));
    controller.setOptions({ ...options, query: events });

    expect(controller.getEvents(RANGE)).toEqual([]);
  });

  it('should leave out events outside the range', () => {
    const { controller } = createHarness();
    expect(
      controller.getEvents({
        start: new Date('2026-09-02T10:05:00Z').getTime(),
        end: new Date('2026-09-02T10:06:00Z').getTime(),
      }),
    ).toEqual([]);
  });

  it('should know when the view is live', () => {
    expect(createHarness({ view: 'live' }).controller.isLive()).toBe(true);
    expect(createHarness({ view: 'media' }).controller.isLive()).toBe(false);
  });

  it('should report the selected media in the viewer', () => {
    expect(createHarness().controller.getSelectedMedia()).toEqual({
      id: 'newer',
      start: new Date('2026-09-02T10:10:00Z'),
    });
    expect(createHarness({ view: 'live' }).controller.getSelectedMedia()).toBeNull();
  });

  it('should go live when seeking to now', async () => {
    const { controller, manager } = createHarness();

    expect(await controller.seek(new Date())).toBe('live');
    expect(manager.setViewByParameters).toHaveBeenCalledWith({
      params: { view: 'live' },
    });
  });

  it('should not change the view when already live and seeking to now', async () => {
    const { controller, manager } = createHarness({ view: 'live' });

    expect(await controller.seek(new Date())).toBe('live');
    expect(manager.setViewByParameters).not.toHaveBeenCalled();
  });

  it('should seek within the playing media when it covers the time', async () => {
    const { controller, manager } = createHarness();

    expect(await controller.seek(new Date('2026-09-02T10:10:30Z'))).toBe('in-media');
    expect(manager.setViewByParameters).toHaveBeenCalledWith({
      modifiers: [expect.any(MergeContextViewModifier)],
    });
  });

  it('should open an event covering the time when there are no recordings', async () => {
    const { controller, manager, media } = createHarness();

    expect(await controller.seek(new Date('2026-09-02T10:00:30Z'))).toBe('event');

    const call = manager.setViewByParameters.mock.calls[0][0];
    expect(call?.params?.view).toBe('media');
    expect(call?.params?.queryResults?.getSelectedResult()).toBe(media[1]);
  });

  it('should report when there is no footage at the time', async () => {
    const { controller, manager } = createHarness();

    expect(await controller.seek(new Date('2026-09-02T10:05:00Z'))).toBe('none');
    expect(manager.setViewByParameters).not.toHaveBeenCalled();
  });

  it('should play a tapped event, oldest first like the card', () => {
    const { controller, manager, media } = createHarness();

    expect(controller.playEvent('older')).toBe(true);
    const call = manager.setViewByParameters.mock.calls[0][0];
    expect(call?.params?.view).toBe('media');
    // Oldest first, so the viewer's next control moves forward in time.
    expect(call?.params?.queryResults?.getResults()).toEqual([media[1], media[0]]);
    expect(call?.params?.queryResults?.getSelectedResult()).toBe(media[1]);
  });

  it('should not play an unknown event', () => {
    const { controller, manager } = createHarness();
    expect(controller.playEvent('missing')).toBe(false);
    expect(manager.setViewByParameters).not.toHaveBeenCalled();
  });

  it('should go live on request', () => {
    const { controller, manager } = createHarness();
    controller.goLive();
    expect(manager.setViewByParameters).toHaveBeenCalledWith({
      params: { view: 'live' },
    });
  });

  it('should have no recordings when they are not shown', () => {
    const { controller } = createHarness();
    expect(controller.getRecordings(RANGE)).toEqual([]);
    expect(controller.hasRecordingAt(RANGE.start)).toBe(false);
  });
});
