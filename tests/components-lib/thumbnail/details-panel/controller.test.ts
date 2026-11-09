import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ThumbnailDetailsPanelController } from '../../../../src/components-lib/thumbnail/details-panel/controller';
import { ViewFolder, type ViewItem } from '../../../../src/view/item';
import { createCameraManagerWithMetadata } from '../../../camera-manager/test-utils';
import { createFolder } from '../../../test-utils';
import { TestViewMedia } from '../../../view/test-utils';

// An event with every value the panel can show.
const createEvent = (): TestViewMedia =>
  new TestViewMedia({
    cameraID: 'camera_1',
    startTime: new Date('2026-09-08T16:55:47'),
    endTime: new Date('2026-09-08T16:56:28'),
    what: ['person'],
    where: ['driveway'],
    tags: ['delivery'],
  });

const createController = (
  size: number,
  item: ViewItem = createEvent(),
): ThumbnailDetailsPanelController => {
  const controller = new ThumbnailDetailsPanelController();
  controller.calculate({
    cameraManager: createCameraManagerWithMetadata({
      title: 'Office',
      icon: { icon: 'mdi:cctv' },
    }),
    item,
    size,
  });
  return controller;
};

describe('ThumbnailDetailsPanelController', () => {
  it('should put the camera, where and tags on a line each', () => {
    const controller = createController(300);

    expect(controller.getTier()).toBe('poster');
    expect(controller.getLabel()).toBe('Person');
    expect(controller.getDetails()).toEqual(['Office', 'Driveway', 'Delivery']);
    expect(controller.getHiddenDetailCount()).toBe(0);
  });

  it('should leave out how long the media lasted', () => {
    expect(createController(300).getDetails().join()).not.toContain('41s');
  });

  it('should give the day and time a line of their own', () => {
    const controller = createController(300);

    expect(controller.getTime()).toEqual({
      day: '2026-09-08',
      hoursMinutes: '16:55',
      seconds: ':47',
    });
    expect(controller.getDetails().join()).not.toContain('16:55');
  });

  it('should show no time for media that does not say when it starts', () => {
    expect(createController(300, new TestViewMedia()).getTime()).toBeNull();
  });

  it('should show no time for a folder, which has no start at all', () => {
    const controller = createController(300, new ViewFolder(createFolder(), []));

    expect(controller.getTime()).toBeNull();
  });

  it.each([[175], [300]])('should show every value at size %s', (size) => {
    const controller = createController(size);

    expect(controller.getDetails()).toHaveLength(3);
    expect(controller.getHiddenDetailCount()).toBe(0);
  });

  it('should hide what does not fit behind the chip on a small thumbnail', () => {
    // The standard panel shows four lines: the label, the time, one value and
    // the chip that reaches the two left over.
    const controller = createController(100);

    expect(controller.getDetails()).toEqual(['Office']);
    expect(controller.getHiddenDetailCount()).toBe(2);
  });

  it('should skip the zone line when there is no zone', () => {
    const controller = createController(
      300,
      new TestViewMedia({
        cameraID: 'camera_1',
        startTime: new Date('2026-09-08T16:55:47'),
        what: ['person'],
      }),
    );

    expect(controller.getDetails()).toEqual(['Office']);
  });

  it('should not repeat a camera title the heading already carries', () => {
    const controller = createController(
      300,
      new TestViewMedia({
        cameraID: 'camera_1',
        startTime: new Date('2026-09-08T16:55:47'),
        endTime: new Date('2026-09-08T16:56:28'),
      }),
    );

    expect(controller.getLabel()).toBe('Office');
    expect(controller.getDetails()).toEqual([]);
  });

  describe('should name the day the media starts', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-10T22:45:00'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    const createEventOn = (day: string): TestViewMedia =>
      new TestViewMedia({
        cameraID: 'camera_1',
        startTime: new Date(`${day}T16:55:47`),
        endTime: new Date(`${day}T16:56:28`),
        what: ['person'],
      });

    it.each([
      ['2026-09-10', 'Today'],
      ['2026-09-09', 'Yesterday'],
      ['2026-09-08', '2026-09-08'],
    ])('should name %s as %s', (day, expected) => {
      expect(createController(300, createEventOn(day)).getTime()?.day).toBe(expected);
    });
  });

  it('should keep the seek time separate from the other details', () => {
    const controller = new ThumbnailDetailsPanelController();

    controller.calculate({
      cameraManager: createCameraManagerWithMetadata({
        title: 'Office',
        icon: { icon: 'mdi:cctv' },
      }),
      item: createEvent(),
      seek: new Date('2026-09-08T16:55:52'),
      size: 175,
    });

    expect(controller.getDetails()).toHaveLength(3);
    expect(controller.getSeekTime()).toBe('16:55:52');
    expect(controller.getHiddenDetailCount()).toBe(0);
  });

  it('should give the seek time a line of the budget', () => {
    const controller = new ThumbnailDetailsPanelController();

    // Standard: label + time + seek + chip, so no value line is left.
    controller.calculate({
      cameraManager: createCameraManagerWithMetadata({
        title: 'Office',
        icon: { icon: 'mdi:cctv' },
      }),
      item: createEvent(),
      seek: new Date('2026-09-08T16:55:52'),
      size: 100,
    });

    expect(controller.getDetails()).toEqual([]);
    expect(controller.getHiddenDetailCount()).toBe(3);
  });

  it('should show no seek time where the reader is not seeking', () => {
    expect(createController(175).getSeekTime()).toBeNull();
  });

  it('should report an in-progress recording', () => {
    const controller = createController(
      300,
      new TestViewMedia({
        cameraID: 'camera_1',
        startTime: new Date('2026-09-08T16:55:47'),
        inProgress: true,
      }),
    );

    expect(controller.isInProgress()).toBe(true);
  });

  it('should not report a finished recording as in progress', () => {
    expect(createController(300).isInProgress()).toBe(false);
  });

  it('should give the in-progress pill a line of the budget', () => {
    const controller = new ThumbnailDetailsPanelController();

    controller.calculate({
      cameraManager: createCameraManagerWithMetadata({
        title: 'Office',
        icon: { icon: 'mdi:cctv' },
      }),
      item: new TestViewMedia({
        cameraID: 'camera_1',
        startTime: new Date('2026-09-08T16:55:47'),
        endTime: new Date('2026-09-08T16:56:28'),
        what: ['person'],
        where: ['driveway'],
        tags: ['delivery'],
        inProgress: true,
      }),
      size: 175,
    });

    // Comfortable budget is 7: label + time + pill + the three values.
    expect(controller.getDetails()).toEqual(['Office', 'Driveway', 'Delivery']);
    expect(controller.getHiddenDetailCount()).toBe(0);
  });

  it('should give the details a line more where there is no label', () => {
    const controller = new ThumbnailDetailsPanelController();

    // Nothing names this media: no detected object, and no camera manager to
    // resolve a camera title from. That frees the heading's line.
    controller.calculate({
      item: new TestViewMedia({
        cameraID: 'camera_1',
        startTime: new Date('2026-09-08T16:55:47'),
        endTime: new Date('2026-09-08T16:56:28'),
        where: ['driveway'],
        tags: ['delivery'],
      }),
      size: 100,
    });

    expect(controller.getLabel()).toBeNull();
    expect(controller.getDetails()).toEqual(['Driveway', 'Delivery']);
  });

  it('should show nothing for media that says nothing about itself', () => {
    const controller = new ThumbnailDetailsPanelController();

    controller.calculate({
      item: new TestViewMedia(),
      size: 100,
    });

    expect(controller.getLabel()).toBeNull();
    expect(controller.getDetails()).toEqual([]);
    expect(controller.getHiddenDetailCount()).toBe(0);
  });
});
