import { isEqual } from 'lodash-es';

import type { CameraManager } from '../../camera-manager/manager';
import { QueryType } from '../../camera-manager/types';
import type { FoldersManager } from '../../card-controller/folders/manager';
import { MergeContextViewModifier } from '../../card-controller/view/modifiers/merge-context';
import type { ViewManagerEpoch } from '../../card-controller/view/types';
import type { ConditionStateManagerReadonlyInterface } from '../../condition-trigger/conditions/types';
import type { MiniTimelineControlConfig } from '../../config/schema/common/controls/timeline';
import { isTruthy } from '../../utils/basic';
import type { EventViewMedia, ReviewViewMedia } from '../../view/item';
import { ViewItemClassifier } from '../../view/item-classifier';
import { QueryResults } from '../../view/query-results';
import type { UnifiedQuery } from '../../view/unified-query';
import { UnifiedQueryBuilder } from '../../view/unified-query-builder';
import { UnifiedQueryTransformer } from '../../view/unified-query-transformer';
import {
  canMediaBeShownAsTimelineItem,
  TimelineDataSource,
  type AdvancedCameraCardTimelineItem,
} from '../timeline/source';
import type { ScrubberRange } from './geometry';

// The scrubber reuses the original timeline's data source (events, reviews and
// recording blocks) but none of its drawing or interaction code.

// A seek this close to now (or later) goes back to the live view.
export const SCRUBBER_LIVE_TOLERANCE_MS = 10 * 1000;

// How long a recordings query opened by a seek covers, either side of the
// target time.
const RECORDING_QUERY_HALF_WINDOW_MS = 60 * 60 * 1000;

export type ScrubberSeekResult = 'live' | 'in-media' | 'recording' | 'event' | 'none';

export interface ScrubberEvent {
  id: string;
  start: number;
  end: number;
  media: EventViewMedia | ReviewViewMedia;
  label: string;
  color: string;
  icon: string;
  thumbnail: string | null;
  selected: boolean;
}

export interface ScrubberRecording {
  start: number;
  end: number;
}

export interface ScrubberControllerOptions {
  cameraManager?: CameraManager;
  foldersManager?: FoldersManager;
  conditionStateManager?: ConditionStateManagerReadonlyInterface;
  timelineConfig?: MiniTimelineControlConfig;
  query?: UnifiedQuery;

  // The view's camera, used to build a query of its own when the view has
  // none (e.g. live view with the thumbnail drawer turned off).
  camera?: string;
}

const ANIMALS = new Set([
  'animal',
  'bear',
  'bird',
  'cat',
  'cow',
  'deer',
  'dog',
  'fox',
  'goat',
  'horse',
  'raccoon',
  'rabbit',
  'sheep',
  'squirrel',
]);
const VEHICLES = new Set([
  'bicycle',
  'boat',
  'bus',
  'car',
  'motorcycle',
  'school_bus',
  'truck',
  'vehicle',
]);
const PACKAGES = new Set(['package', 'amazon', 'fedex', 'ups', 'usps', 'dhl']);

export const SCRUBBER_COLORS = {
  person: '#4285f4',
  animal: '#34a853',
  vehicle: '#fbbc04',
  package: '#a142f4',
  other: '#9aa0a6',
};

export type ScrubberEventCategory = 'person' | 'animal' | 'vehicle' | 'package' | 'other';

export const SCRUBBER_ICONS: Record<ScrubberEventCategory, string> = {
  person: 'mdi:account-outline',
  animal: 'mdi:paw-outline',
  vehicle: 'mdi:car-outline',
  package: 'mdi:package-variant-closed',
  other: 'mdi:motion-sensor',
};

export const getScrubberEventCategory = (
  what: string[] | null | undefined,
): ScrubberEventCategory => {
  const first = what?.[0]?.toLowerCase();
  if (first === 'person' || first === 'face') {
    return 'person';
  }
  if (first && ANIMALS.has(first)) {
    return 'animal';
  }
  if (first && VEHICLES.has(first)) {
    return 'vehicle';
  }
  if (first && PACKAGES.has(first)) {
    return 'package';
  }
  return 'other';
};

export const getScrubberEventColor = (what: string[] | null | undefined): string =>
  SCRUBBER_COLORS[getScrubberEventCategory(what)];

const isRecordingsOnly = (query: UnifiedQuery): boolean =>
  query.hasMediaQueriesOfType(QueryType.Recording) &&
  !query.hasMediaQueriesOfType(QueryType.Event) &&
  !query.hasMediaQueriesOfType(QueryType.Review);

const capitalize = (value: string): string =>
  value ? value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, ' ') : value;

const getEventLabel = (media: EventViewMedia | ReviewViewMedia): string => {
  const what = media.getWhat();
  if (what?.length) {
    return what.map(capitalize).join(', ');
  }
  return media.getTitle() ?? '';
};

export class ScrubberController {
  private _onChange: () => void;

  private _source: TimelineDataSource | null = null;
  private _cameraManager: CameraManager | null = null;
  private _foldersManager: FoldersManager | null = null;
  private _timelineConfig: MiniTimelineControlConfig | null = null;
  private _viewManagerEpoch: ViewManagerEpoch | null = null;

  // The range most recently fetched (with prefetch margin).
  private _fetchedRange: ScrubberRange | null = null;
  private _fetching: Promise<void> | null = null;

  constructor(onChange: () => void) {
    this._onChange = onChange;
  }

  public setOptions(options: ScrubberControllerOptions): void {
    const query = options.query ?? this._buildDefaultQuery(options);
    const newShape = query ? UnifiedQueryTransformer.stripTimeRange(query) : null;

    // Seeking opens the continuous recording, whose query only covers
    // recordings. Keep the existing shape (events, reviews and recordings)
    // then, or the event pills and thumbnails would disappear.
    const shape =
      this._source && newShape && isRecordingsOnly(newShape)
        ? this._source.shape
        : newShape;

    const needsRebuild =
      !this._source ||
      this._cameraManager !== (options.cameraManager ?? null) ||
      this._foldersManager !== (options.foldersManager ?? null) ||
      !isEqual(this._timelineConfig, options.timelineConfig ?? null) ||
      !this._hasSameShape(this._source.shape, shape);

    this._cameraManager = options.cameraManager ?? null;
    this._foldersManager = options.foldersManager ?? null;
    this._timelineConfig = options.timelineConfig ?? null;

    if (!needsRebuild) {
      return;
    }

    this._fetchedRange = null;
    this._source =
      shape &&
      options.cameraManager &&
      options.foldersManager &&
      options.conditionStateManager &&
      options.timelineConfig
        ? new TimelineDataSource(
            options.cameraManager,
            options.foldersManager,
            options.conditionStateManager,
            shape,
            options.timelineConfig.show_recordings,
          )
        : null;
  }

  private _buildDefaultQuery(options: ScrubberControllerOptions): UnifiedQuery | null {
    if (!options.cameraManager || !options.foldersManager || !options.camera) {
      return null;
    }
    return new UnifiedQueryBuilder(
      options.cameraManager,
      options.foldersManager,
    ).buildDefaultCameraQuery(options.camera);
  }

  private _hasSameShape(a?: UnifiedQuery | null, b?: UnifiedQuery | null): boolean {
    if (!a || !b) {
      return !a && !b;
    }
    return a.isEqual(b);
  }

  public setView(viewManagerEpoch: ViewManagerEpoch | null): void {
    this._viewManagerEpoch = viewManagerEpoch;
    const view = viewManagerEpoch?.manager.getView();
    if (view?.query && this._source) {
      this._source.addMediaToDataset(view.query, view.queryResults?.getResults());
    }
  }

  public isLive(): boolean {
    return !!this._viewManagerEpoch?.manager.getView()?.is('live');
  }

  /**
   * The selected media in the viewer, if any (used to place the strip when
   * a clip is opened from elsewhere before its playback position arrives).
   */
  public getSelectedMedia(): { id: string | null; start: Date | null } | null {
    const view = this._viewManagerEpoch?.manager.getView();
    if (!view?.isViewerView()) {
      return null;
    }
    const selected = view.queryResults?.getSelectedResult();
    if (!ViewItemClassifier.isMedia(selected)) {
      return null;
    }
    return { id: selected.getID(), start: selected.getStartTime() };
  }

  private _getCameraGroupID(): string | null {
    const camera = this._viewManagerEpoch?.manager.getView()?.camera;
    return camera ? `camera/${camera}` : null;
  }

  private _getItems(
    range: ScrubberRange,
    type: 'range' | 'background',
  ): AdvancedCameraCardTimelineItem[] {
    if (!this._source) {
      return [];
    }
    const group = this._getCameraGroupID();
    const now = Date.now();
    return this._source.dataset.get({
      filter: (item) =>
        item.type === type &&
        (!group || item.group === group) &&
        item.start <= range.end &&
        (item.end ?? now) >= range.start,
    });
  }

  private _getSelectedIDs(): Set<string> {
    const view = this._viewManagerEpoch?.manager.getView();
    return new Set(
      (
        view?.queryResults?.getMultipleSelectedResults({
          main: true,
        }) ?? []
      )
        .map((media) => media.getID())
        .filter(isTruthy),
    );
  }

  public getEvents(range: ScrubberRange): ScrubberEvent[] {
    const selected = this._getSelectedIDs();
    const now = Date.now();
    return this._getItems(range, 'range')
      .map((item): ScrubberEvent | null => {
        const media = item.media;
        if (!canMediaBeShownAsTimelineItem(media)) {
          return null;
        }
        return {
          id: String(item.id),
          start: item.start,
          end: item.end ?? now,
          media,
          label: getEventLabel(media),
          color: getScrubberEventColor(media.getWhat()),
          icon: SCRUBBER_ICONS[getScrubberEventCategory(media.getWhat())],
          thumbnail: media.getThumbnail(),
          selected: selected.has(String(item.id)),
        };
      })
      .filter(isTruthy);
  }

  public getRecordings(range: ScrubberRange): ScrubberRecording[] {
    const now = Date.now();
    return this._getItems(range, 'background')
      .map((item) => ({ start: item.start, end: Math.min(item.end ?? now, now) }))
      .sort((a, b) => a.start - b.start);
  }

  public hasRecordingAt(time: number): boolean {
    return this.getRecordings({ start: time, end: time }).some(
      (recording) => recording.start <= time && recording.end >= time,
    );
  }

  /**
   * Make sure data covers the range (plus the same again either side, so
   * small drags do not refetch). Resolves once any fetch has finished.
   */
  public async ensureData(range: ScrubberRange): Promise<void> {
    if (!this._source) {
      return;
    }
    const fetched = this._fetchedRange;
    if (
      fetched &&
      fetched.start <= range.start &&
      // Allow the newest edge to lag slightly; the source has its own
      // freshness tolerance.
      fetched.end >= Math.min(range.end, Date.now()) - 30 * 1000
    ) {
      return;
    }

    const span = Math.max(range.end - range.start, 60 * 1000);
    const prefetch = { start: range.start - span, end: range.end + span };
    this._fetchedRange = prefetch;

    const source = this._source;
    const fetch = source.refresh({
      start: new Date(prefetch.start),
      end: new Date(prefetch.end),
    });
    this._fetching = fetch;
    await fetch;
    if (this._fetching === fetch) {
      this._fetching = null;
    }
    if (source === this._source) {
      this._onChange();
    }
  }

  public goLive(): void {
    this._viewManagerEpoch?.manager.setViewByParameters({
      params: { view: 'live' },
    });
  }

  /**
   * Play the footage at a time: live if at (or near) now, within the playing
   * media if it covers the time, else the continuous recording, else an event
   * covering the time.
   */
  public async seek(time: Date): Promise<ScrubberSeekResult> {
    const manager = this._viewManagerEpoch?.manager;
    const view = manager?.getView();
    if (!manager || !view) {
      return 'none';
    }

    if (time.getTime() >= Date.now() - SCRUBBER_LIVE_TOLERANCE_MS) {
      if (!view.is('live')) {
        this.goLive();
      }
      return 'live';
    }

    const selected = view.queryResults?.getSelectedResult();
    if (
      view.isViewerView() &&
      ViewItemClassifier.isMedia(selected) &&
      selected.getEndTime() &&
      selected.includesTime(time)
    ) {
      manager.setViewByParameters({
        modifiers: [new MergeContextViewModifier({ mediaViewer: { seek: time } })],
      });
      return 'in-media';
    }

    if (this._timelineConfig?.show_recordings && this.hasRecordingAt(time.getTime())) {
      if (await this._openRecordingAtTime(time)) {
        return 'recording';
      }
    }

    const event = this.getEvents({ start: time.getTime(), end: time.getTime() }).find(
      (candidate) =>
        candidate.start <= time.getTime() && candidate.end >= time.getTime(),
    );
    if (event && this._playItem(event.id, time)) {
      return 'event';
    }
    return 'none';
  }

  /**
   * Play an event from its start (tapping its pill or thumbnail).
   */
  public playEvent(id: string): boolean {
    const item = this._source?.dataset.get(id);
    if (!item?.media) {
      return false;
    }
    return this._playItem(id, item.media.getStartTime() ?? undefined);
  }

  private _playItem(id: string, seek?: Date): boolean {
    const manager = this._viewManagerEpoch?.manager;
    const item = this._source?.dataset.get(id);
    if (!manager || !item?.query || !this._source) {
      return false;
    }

    const query = item.query;
    const media = this._source.dataset
      .get({ filter: (candidate) => candidate.query === query })
      .map((candidate) => candidate.media)
      .filter(isTruthy)
      .sort((a, b) => (b.getStartTime()?.getTime() ?? 0) - (a.getStartTime()?.getTime() ?? 0));
    const selectedIndex = media.findIndex((candidate) => candidate.getID() === id);
    if (selectedIndex < 0) {
      return false;
    }

    manager.setViewByParameters({
      params: {
        view: 'media',
        query,
        queryResults: new QueryResults({ results: media, selectedIndex }),
      },
      modifiers: [
        new MergeContextViewModifier({
          ...(seek && item.media?.getEndTime() && { mediaViewer: { seek } }),
        }),
      ],
    });
    return true;
  }

  private async _openRecordingAtTime(time: Date): Promise<boolean> {
    const manager = this._viewManagerEpoch?.manager;
    const view = manager?.getView();
    const query = this._source?.buildRecordingsWindowedQuery({
      start: new Date(time.getTime() - RECORDING_QUERY_HALF_WINDOW_MS),
      end: new Date(
        Math.min(Date.now(), time.getTime() + RECORDING_QUERY_HALF_WINDOW_MS),
      ),
    });
    if (!manager || !view || !query) {
      return false;
    }

    await manager.setViewByParametersWithExistingQuery({
      baseView: view,
      params: { view: 'recording', query },
      queryExecutorOptions: { selectResult: { time: { time } } },
      modifiers: [new MergeContextViewModifier({ mediaViewer: { seek: time } })],
    });
    return true;
  }
}
