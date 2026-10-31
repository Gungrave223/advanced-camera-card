import type { CameraManager } from '../../camera-manager/manager';
import type { ViewManagerEpoch, ViewModifier } from '../../card-controller/view/types';
import type { ViewMedia } from '../../view/item';
import { ViewItemClassifier } from '../../view/item-classifier';
import { QueryResults } from '../../view/query-results';
import type { UnifiedQuery } from '../../view/unified-query';
import type { UnifiedQueryBuilder } from '../../view/unified-query-builder';
import type { View } from '../../view/view';

const EVENTS_LIMIT = 50;
const EVENTS_MAX_AGE_SECONDS = 60;

/**
 * While a recording plays, the view's results are hour-long recordings, which
 * have no event type to show. This keeps a separate list of the camera's events
 * so the thumbnails can show those instead, without disturbing what is playing.
 */
export class RecordingEventsController {
  private _changeCallback: () => void;
  private _cameraID: string | null = null;
  private _events: ViewMedia[] = [];
  private _query: UnifiedQuery | null = null;
  private _loadedAt: Date | null = null;
  private _loading = false;

  constructor(changeCallback: () => void) {
    this._changeCallback = changeCallback;
  }

  private _isPlayingRecording(view?: View | null): boolean {
    return ViewItemClassifier.isRecording(view?.queryResults?.getSelectedResult());
  }

  public getEvents(view?: View | null): ViewMedia[] | null {
    return this._isPlayingRecording(view) &&
      view?.camera === this._cameraID &&
      this._events.length
      ? this._events
      : null;
  }

  public async update(
    view?: View | null,
    builder?: UnifiedQueryBuilder | null,
    cameraManager?: CameraManager,
  ): Promise<void> {
    const cameraID = view?.camera;
    if (
      !cameraID ||
      !builder ||
      !cameraManager ||
      !this._isPlayingRecording(view) ||
      this._loading ||
      (cameraID === this._cameraID &&
        this._loadedAt &&
        new Date().getTime() - this._loadedAt.getTime() < EVENTS_MAX_AGE_SECONDS * 1000)
    ) {
      return;
    }

    const query = builder.buildReviewsQuery(new Set([cameraID]), {
      limit: EVENTS_LIMIT,
    });
    if (!query) {
      return;
    }

    this._loading = true;
    try {
      const events = await cameraManager.executeMediaQueries(query.getMediaQueries());
      this._cameraID = cameraID;
      this._query = query;
      this._events = events ?? [];
      this._loadedAt = new Date();
      this._changeCallback();
    } finally {
      this._loading = false;
    }
  }

  public select(
    media: ViewMedia,
    viewManagerEpoch?: ViewManagerEpoch,
    modifiers?: ViewModifier[],
  ): void {
    const cameraID = media.getCameraID();
    viewManagerEpoch?.manager.setViewByParameters({
      params: {
        view: 'media',
        query: this._query,
        queryResults: new QueryResults({
          results: this._events,
          selectedIndex: this._events.indexOf(media),
        }),
        ...(cameraID && { camera: cameraID }),
      },
      modifiers,
    });
  }
}
