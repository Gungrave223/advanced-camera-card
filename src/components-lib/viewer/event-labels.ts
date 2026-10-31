import { add, endOfHour, startOfHour, sub } from 'date-fns';

import type { CameraManager } from '../../camera-manager/manager';
import type { ViewMedia } from '../../view/item';
import { ViewItemClassifier } from '../../view/item-classifier';

const REVIEWS_LIMIT = 200;
const REVIEWS_MAX_AGE_SECONDS = 60;

// Reviews are matched by the time they started, so look far enough back to find
// one that began before the hour being watched.
const REVIEWS_LOOKBACK_MINUTES = 10;

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
 * their own, so those use the reviews at the time being watched: a review has all
 * the objects seen together, where each event has only one.
 */
export class EventLabelProvider {
  private _reviews: Promise<ViewMedia[]> | null = null;
  private _reviewsKey: string | null = null;
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
    const reviews = await this._getReviews(cameraID, time, cameraManager);
    return getLabels(reviews.filter((review) => review.includesTime(time)));
  }

  private _getReviews(
    cameraID: string,
    time: Date,
    cameraManager: CameraManager,
  ): Promise<ViewMedia[]> {
    const start = startOfHour(time);
    const key = `${cameraID}/${start.getTime()}`;
    const now = new Date();

    if (
      !this._reviews ||
      key !== this._reviewsKey ||
      !this._loadedAt ||
      now >= add(this._loadedAt, { seconds: REVIEWS_MAX_AGE_SECONDS })
    ) {
      this._reviewsKey = key;
      this._loadedAt = now;
      this._reviews = this._fetchReviews(cameraID, start, time, cameraManager);
    }
    return this._reviews;
  }

  private async _fetchReviews(
    cameraID: string,
    start: Date,
    time: Date,
    cameraManager: CameraManager,
  ): Promise<ViewMedia[]> {
    const queries = cameraManager.generateDefaultReviewQueries(cameraID, {
      start: sub(start, { minutes: REVIEWS_LOOKBACK_MINUTES }),
      end: endOfHour(time),
      limit: REVIEWS_LIMIT,
    });
    try {
      return (queries && (await cameraManager.executeMediaQueries(queries))) ?? [];
    } catch {
      return [];
    }
  }
}
