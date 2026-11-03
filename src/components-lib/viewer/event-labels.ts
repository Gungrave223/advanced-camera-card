import { add, endOfHour, startOfHour, sub } from 'date-fns';

import type { CameraManager } from '../../camera-manager/manager';
import { prettifyTitle } from '../../utils/basic';
import type { EventViewMedia, ReviewViewMedia, ViewMedia } from '../../view/item';
import { ViewItemClassifier } from '../../view/item-classifier';

const REVIEWS_LIMIT = 200;
const REVIEWS_MAX_AGE_SECONDS = 60;

// Reviews are matched by the time they started, so look far enough back to find
// one that began before the hour being watched.
const REVIEWS_LOOKBACK_MINUTES = 10;

export interface EventLabels {
  what: string[];
  where: string[];
}

const getEventLabels = (items: ViewMedia[]): EventLabels => {
  const media = items.filter(
    (item): item is EventViewMedia | ReviewViewMedia =>
      ViewItemClassifier.isEvent(item) || ViewItemClassifier.isReview(item),
  );
  const what = [
    ...new Set(
      media.flatMap((item) =>
        (item.getWhat() ?? []).map((label) => label.replace(/-verified$/, '')),
      ),
    ),
  ];
  const tags = [...new Set(media.flatMap((item) => item.getTags() ?? []))].filter(
    (tag) => !what.includes(tag),
  );

  return {
    // A recognized face names the person.
    what: what.includes('person')
      ? what.flatMap((label) => (label === 'person' && tags.length ? tags : [label]))
      : [...what, ...tags],
    where: [...new Set(media.flatMap((item) => item.getWhere() ?? []))],
  };
};

/**
 * Formats labels as what was detected and then where, e.g. `Person · Front Porch`.
 */
export const formatEventLabels = (labels: EventLabels): string =>
  [labels.what.join(' • '), labels.where.map((where) => prettifyTitle(where)).join(', ')]
    .filter(Boolean)
    .join(' · ');

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
  ): Promise<EventLabels> {
    if (!ViewItemClassifier.isRecording(media)) {
      return getEventLabels([media]);
    }
    const cameraID = media.getCameraID();
    if (!time || !cameraID) {
      return { what: [], where: [] };
    }
    const reviews = await this._getReviews(cameraID, time, cameraManager);
    return getEventLabels(reviews.filter((review) => review.includesTime(time)));
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
