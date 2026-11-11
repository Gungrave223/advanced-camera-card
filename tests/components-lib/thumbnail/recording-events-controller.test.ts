import { add } from 'date-fns';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import type { CameraManager } from '../../../src/camera-manager/manager';
import type { ViewManagerEpoch } from '../../../src/card-controller/view/types';
import { RecordingEventsController } from '../../../src/components-lib/thumbnail/recording-events-controller';
import { ViewMediaType } from '../../../src/view/item';
import { QueryResults } from '../../../src/view/query-results';
import type { UnifiedQuery } from '../../../src/view/unified-query';
import type { UnifiedQueryBuilder } from '../../../src/view/unified-query-builder';
import { View } from '../../../src/view/view';
import { TestViewMedia } from '../../view/test-utils';

const CAMERA = 'camera-1';

const createView = (mediaType: ViewMediaType, camera: string = CAMERA) =>
  new View({
    view: 'media',
    camera,
    queryResults: new QueryResults({
      results: [new TestViewMedia({ mediaType, cameraID: camera })],
      selectedIndex: 0,
    }),
  });

const createHarness = (options?: { noQuery?: boolean }) => {
  const query = mock<UnifiedQuery>();
  query.getMediaQueries.mockReturnValue([]);
  const builder = mock<UnifiedQueryBuilder>();
  builder.buildReviewsQuery.mockReturnValue(options?.noQuery ? null : query);
  const cameraManager = mock<CameraManager>();
  const events = [
    new TestViewMedia({ mediaType: ViewMediaType.Review, cameraID: CAMERA }),
    new TestViewMedia({ mediaType: ViewMediaType.Review, cameraID: CAMERA }),
  ];
  cameraManager.executeMediaQueries.mockResolvedValue(events);
  const callback = vi.fn();
  return {
    builder,
    cameraManager,
    callback,
    events,
    query,
    controller: new RecordingEventsController(callback),
  };
};

describe('RecordingEventsController', () => {
  const start = new Date('2026-10-30T20:00:00');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(start);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should provide events while a recording plays', async () => {
    const { controller, builder, cameraManager, callback, events } = createHarness();
    const view = createView(ViewMediaType.Recording);

    expect(controller.getEvents(view)).toBeNull();
    await controller.update(view, builder, cameraManager);

    expect(callback).toHaveBeenCalled();
    expect(controller.getEvents(view)).toBe(events);
  });

  it('should fetch as many events as the card asks for', async () => {
    const { controller, builder, cameraManager } = createHarness();
    await controller.update(createView(ViewMediaType.Recording), builder, cameraManager, 150);

    expect(builder.buildReviewsQuery).toHaveBeenCalledWith(new Set([CAMERA]), { limit: 150 });
  });

  it('should fetch 50 events when the card gives no limit', async () => {
    const { controller, builder, cameraManager } = createHarness();
    await controller.update(createView(ViewMediaType.Recording), builder, cameraManager);

    expect(builder.buildReviewsQuery).toHaveBeenCalledWith(new Set([CAMERA]), { limit: 50 });
  });

  it('should not provide events for other media or other cameras', async () => {
    const { controller, builder, cameraManager } = createHarness();
    await controller.update(createView(ViewMediaType.Recording), builder, cameraManager);

    expect(controller.getEvents(createView(ViewMediaType.Review))).toBeNull();
    expect(
      controller.getEvents(createView(ViewMediaType.Recording, 'other')),
    ).toBeNull();
    expect(controller.getEvents(null)).toBeNull();
  });

  it('should fall back when there are no events', async () => {
    const { controller, builder, cameraManager } = createHarness();
    cameraManager.executeMediaQueries.mockResolvedValue(null);
    const view = createView(ViewMediaType.Recording);

    await controller.update(view, builder, cameraManager);

    expect(controller.getEvents(view)).toBeNull();
  });

  it('should not load when it cannot or need not', async () => {
    const { controller, builder, cameraManager } = createHarness();

    await controller.update(createView(ViewMediaType.Review), builder, cameraManager);
    await controller.update(null, builder, cameraManager);
    await controller.update(createView(ViewMediaType.Recording), null, cameraManager);
    await controller.update(createView(ViewMediaType.Recording), builder);

    expect(cameraManager.executeMediaQueries).not.toHaveBeenCalled();
  });

  it('should not load without a query', async () => {
    const { controller, builder, cameraManager } = createHarness({ noQuery: true });

    await controller.update(createView(ViewMediaType.Recording), builder, cameraManager);

    expect(cameraManager.executeMediaQueries).not.toHaveBeenCalled();
  });

  it('should only refresh events when they are old', async () => {
    const { controller, builder, cameraManager } = createHarness();
    const view = createView(ViewMediaType.Recording);

    await controller.update(view, builder, cameraManager);
    await controller.update(view, builder, cameraManager);
    expect(cameraManager.executeMediaQueries).toHaveBeenCalledTimes(1);

    vi.setSystemTime(add(start, { seconds: 61 }));
    await controller.update(view, builder, cameraManager);
    expect(cameraManager.executeMediaQueries).toHaveBeenCalledTimes(2);
  });

  it('should not load twice at once', async () => {
    const { controller, builder, cameraManager } = createHarness();
    const view = createView(ViewMediaType.Recording);

    const first = controller.update(view, builder, cameraManager);
    await controller.update(view, builder, cameraManager);
    await first;

    expect(cameraManager.executeMediaQueries).toHaveBeenCalledTimes(1);
  });

  it('should recover from a failed load', async () => {
    const { controller, builder, cameraManager } = createHarness();
    const view = createView(ViewMediaType.Recording);
    cameraManager.executeMediaQueries.mockRejectedValueOnce(new Error());

    await expect(controller.update(view, builder, cameraManager)).rejects.toThrow();
    await controller.update(view, builder, cameraManager);

    expect(controller.getEvents(view)).not.toBeNull();
  });

  it('should open the selected event', async () => {
    const { controller, builder, cameraManager, events, query } = createHarness();
    await controller.update(createView(ViewMediaType.Recording), builder, cameraManager);
    const epoch = mock<ViewManagerEpoch>({ manager: mock() });

    controller.select(events[1], epoch);

    const params = vi.mocked(epoch.manager.setViewByParameters).mock.calls[0][0]?.params;
    expect(params?.view).toBe('media');
    expect(params?.camera).toBe(CAMERA);
    expect(params?.query).toBe(query);
    expect(params?.queryResults?.getSelectedResult()).toBe(events[1]);
  });

  it('should open an event without a camera', async () => {
    const { controller, builder, cameraManager, events } = createHarness();
    await controller.update(createView(ViewMediaType.Recording), builder, cameraManager);
    const epoch = mock<ViewManagerEpoch>({ manager: mock() });
    const media = new TestViewMedia({ mediaType: ViewMediaType.Review, cameraID: null });
    events.push(media);

    controller.select(media, epoch);

    expect(
      vi.mocked(epoch.manager.setViewByParameters).mock.calls[0][0]?.params?.camera,
    ).toBeUndefined();
  });
});
