import { add, endOfHour, startOfHour, sub } from 'date-fns';

import type { CameraManager } from '../../camera-manager/manager';
import type { ViewMedia } from '../../view/item';
import { ViewItemClassifier } from '../../view/item-classifier';

const EVENTS_LIMIT = 200;
const EVENTS_MAX_AGE_SECONDS = 60;

// Events are matched by the time they started, so look far enough back to find
// an event that began before the hour being watched.
const EVENTS_LOOKBACK_MINUTES = 10;

const getLabels = (items: ViewMedia[]): string[] => [
  ...new Set(
    items.flatMap((item) =>
      ViewItemClassifier.isEvent(item)
        ? [...(item.getWhat() ?? []), ...(item.getTags() ?? [])]
        : ViewItemClassifier.isReview(item)
          ? item.getWhat() ?? []
          : [],
    ),
  ),
];

/**
 * Gets what an event in the viewer is tagged as. Recordings have no labels of
 * their own, so those use the events happening at the time being watched.
 */
export class EventLabelProvider {
  private _events: Promise<ViewMedia[]> | null = null;
  private _eventsKey: string | null = null;
  private _loadedAt: Date | null = null;

  public async getLabels(
    media: ViewMedia,
    time: Date | null,
    cameraManager: CameraManager,
  ): Promise<string[]> {
    if (!ViewItemClassifier.isRecording(media)) {
      return getLabels([media]);
    }
    const cameraID = media.getCameraID();
    if (!time || !cameraID) {
      return [];
    }
    const events = await this._getEvents(cameraID, time, cameraManager);
    return getLabels(events.filter((event) => event.includesTime(time)));
  }

  private _getEvents(
    cameraID: string,
    time: Date,
    cameraManager: CameraManager,
  ): Promise<ViewMedia[]> {
    const start = startOfHour(time);
    const key = `${cameraID}/${start.getTime()}`;
    const now = new Date();

    if (
      !this._events ||
      key !== this._eventsKey ||
      !this._loadedAt ||
      now >= add(this._loadedAt, { seconds: EVENTS_MAX_AGE_SECONDS })
    ) {
      this._eventsKey = key;
      this._loadedAt = now;
      this._events = this._fetchEvents(cameraID, start, time, cameraManager);
    }
    return this._events;
  }

  private async _fetchEvents(
    cameraID: string,
    start: Date,
    time: Date,
    cameraManager: CameraManager,
  ): Promise<ViewMedia[]> {
    const queries = cameraManager.generateDefaultEventQueries(cameraID, {
      start: sub(start, { minutes: EVENTS_LOOKBACK_MINUTES }),
      end: endOfHour(time),
      limit: EVENTS_LIMIT,
    });
    try {
      return (queries && (await cameraManager.executeMediaQueries(queries))) ?? [];
    } catch {
      return [];
    }
  }
}
