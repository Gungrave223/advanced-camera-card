import { describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import type { CameraManager } from '../../../src/camera-manager/manager';
import type { ReviewQuery } from '../../../src/camera-manager/types';
import { EventLabelProvider } from '../../../src/components-lib/viewer/event-labels';
import { ViewMediaType } from '../../../src/view/item';
import { TestViewMedia } from '../../view/test-utils';

const time = new Date('2026-10-31T15:42:00');

const createRecording = (): TestViewMedia =>
  new TestViewMedia({ mediaType: ViewMediaType.Recording });

const createCameraManager = (reviews: TestViewMedia[] | null = []): CameraManager => {
  const cameraManager = mock<CameraManager>();
  cameraManager.generateDefaultReviewQueries.mockReturnValue([mock<ReviewQuery>()]);
  cameraManager.executeMediaQueries.mockResolvedValue(reviews);
  return cameraManager;
};

describe('EventLabelProvider', () => {
  it('should use the labels of an event', async () => {
    const media = new TestViewMedia({
      what: ['person', 'car'],
      tags: ['person', 'bob'],
    });
    const cameraManager = createCameraManager();

    expect(await new EventLabelProvider().getLabels(media, null, cameraManager)).toEqual(
      ['person', 'car', 'bob'],
    );
    expect(cameraManager.executeMediaQueries).not.toHaveBeenCalled();
  });

  it('should use the labels of a review', async () => {
    const media = new TestViewMedia({
      mediaType: ViewMediaType.Review,
      what: ['dog'],
    });

    expect(
      await new EventLabelProvider().getLabels(media, null, createCameraManager()),
    ).toEqual(['dog']);
  });

  it('should use every label of the reviews at the time of a recording', async () => {
    const cameraManager = createCameraManager([
      new TestViewMedia({
        mediaType: ViewMediaType.Review,
        what: ['person', 'car'],
        startTime: new Date('2026-10-31T15:41:00'),
        endTime: new Date('2026-10-31T15:43:00'),
      }),
      new TestViewMedia({
        mediaType: ViewMediaType.Review,
        what: ['dog'],
        startTime: new Date('2026-10-31T15:10:00'),
        endTime: new Date('2026-10-31T15:11:00'),
      }),
    ]);

    expect(
      await new EventLabelProvider().getLabels(createRecording(), time, cameraManager),
    ).toEqual(['person', 'car']);
    expect(cameraManager.generateDefaultReviewQueries).toHaveBeenCalledWith(
      'camera',
      expect.objectContaining({ start: new Date('2026-10-31T14:50:00') }),
    );
  });

  it('should not fetch reviews for each update within an hour', async () => {
    const cameraManager = createCameraManager();
    const provider = new EventLabelProvider();

    await provider.getLabels(createRecording(), time, cameraManager);
    await provider.getLabels(createRecording(), time, cameraManager);

    expect(cameraManager.executeMediaQueries).toHaveBeenCalledTimes(1);
  });

  it('should fetch reviews again when they are stale', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(time);
    const cameraManager = createCameraManager();
    const provider = new EventLabelProvider();

    await provider.getLabels(createRecording(), time, cameraManager);
    vi.setSystemTime(new Date('2026-10-31T15:43:01'));
    await provider.getLabels(createRecording(), time, cameraManager);

    expect(cameraManager.executeMediaQueries).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('should have no labels without a time', async () => {
    expect(
      await new EventLabelProvider().getLabels(
        createRecording(),
        null,
        createCameraManager(),
      ),
    ).toEqual([]);
  });

  it('should have no labels when reviews cannot be fetched', async () => {
    const cameraManager = createCameraManager();
    vi.mocked(cameraManager.executeMediaQueries).mockRejectedValue(new Error());

    expect(
      await new EventLabelProvider().getLabels(createRecording(), time, cameraManager),
    ).toEqual([]);
  });
});
