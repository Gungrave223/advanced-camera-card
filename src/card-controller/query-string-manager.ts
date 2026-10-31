import { add, sub } from 'date-fns';

import type { ViewActionConfig } from '../config/schema/actions/custom/view';
import type { AdvancedCameraCardCustomActionConfig } from '../config/schema/actions/types';
import {
  createCameraAction,
  createGeneralAction,
  createSubstreamOffAction,
  createSubstreamOnAction,
  createViewAction,
} from '../utils/action.js';
import { UnifiedQueryBuilder } from '../view/unified-query-builder.js';
import type { CardQueryStringAPI } from './types';
import { MergeContextViewModifier } from './view/modifiers/merge-context';
import { SubstreamViewModifier } from './view/modifiers/substream';
import type { ViewParametersUserSpecified } from './view/types.js';

interface QueryStringViewIntent {
  view?: ViewParametersUserSpecified & {
    default?: boolean;

    // The substream change to apply alongside the view. Tri-state:
    //   - `undefined`: no substream URL action present, no modifier issued.
    //   - `string`:    `substream_on=X` -- engage stream X.
    //   - `null`:      `substream_off` -- explicitly clear the override.
    stream?: string | null;

    // Open the recording at this time (`recording_at=<unix seconds>`).
    recordingTime?: Date;
  };
  other?: AdvancedCameraCardCustomActionConfig[];
}

export class QueryStringManager {
  private _api: CardQueryStringAPI;
  private _shouldRun = true;

  constructor(api: CardQueryStringAPI) {
    this._api = api;
  }

  public hasViewRelatedActionsToRun(): boolean {
    return !!this._calculateIntent().view && this._shouldRun;
  }

  public requestExecution = (): void => {
    this._shouldRun = true;
    this._api.getCardElementManager().update();
  };

  public executeIfNecessary = async (): Promise<void> => {
    if (this._shouldRun) {
      this._shouldRun = false;
      await this._executeViewRelated(this._calculateIntent());
      await this._executeNonViewRelated(this._calculateIntent());
    }
  };

  private async _executeViewRelated(intent: QueryStringViewIntent): Promise<void> {
    if (intent.view?.recordingTime) {
      await this._openRecordingAtTime(
        intent.view.recordingTime,
        intent.view.camera ?? undefined,
      );
    } else if (intent.view) {
      const modifiers =
        intent.view.stream !== undefined
          ? [
              new SubstreamViewModifier(
                intent.view.stream === null ? {} : { stream: intent.view.stream },
              ),
            ]
          : undefined;
      if (intent.view.default) {
        await this._api.getViewManager().setViewDefaultWithNewQuery({
          params: {
            camera: intent.view.camera,
          },
          ...(modifiers && { modifiers }),
        });
      } else {
        await this._api.getViewManager().setViewByParametersWithNewQuery({
          params: {
            ...(intent.view.view && { view: intent.view.view }),
            ...(intent.view.camera && { camera: intent.view.camera }),
          },
          ...(modifiers && { modifiers }),
        });
      }
    }
  }

  private async _openRecordingAtTime(time: Date, camera?: string): Promise<void> {
    const cameraManager = this._api.getCameraManager();
    const query = new UnifiedQueryBuilder(
      cameraManager,
      this._api.getFoldersManager(),
    ).buildRecordingsQuery(
      camera ? new Set([camera]) : cameraManager.getStore().getCameraIDs(),
      { start: sub(time, { hours: 1 }), end: add(time, { hours: 1 }) },
    );
    if (query) {
      await this._api.getViewManager().setViewByParametersWithExistingQuery({
        params: { view: 'recording', query, ...(camera && { camera }) },
        queryExecutorOptions: {
          selectResult: {
            time: { time, ...(camera && { favorCameraID: camera }) },
          },
        },
        modifiers: [new MergeContextViewModifier({ mediaViewer: { seek: time } })],
      });
    }
  }

  private async _executeNonViewRelated(intent: QueryStringViewIntent): Promise<void> {
    if (intent.other) {
      await this._api.getActionsManager().executeActions({ actions: intent.other });
    }
  }

  private _calculateIntent(): QueryStringViewIntent {
    const result: QueryStringViewIntent = {};
    const recordingTime = this._getRecordingTime();
    if (recordingTime) {
      (result.view ??= {}).recordingTime = recordingTime;
    }
    for (const action of this._getActions()) {
      if (this._isViewAction(action)) {
        (result.view ??= {}).view = action.advanced_camera_card_action;
        (result.view ??= {}).default = undefined;
      } else if (action.advanced_camera_card_action === 'default') {
        (result.view ??= {}).default = true;
        (result.view ??= {}).view = undefined;
      } else if (action.advanced_camera_card_action === 'camera_select') {
        (result.view ??= {}).camera = action.camera;
      } else if (
        action.advanced_camera_card_action === 'substream_on' &&
        action.stream !== undefined
      ) {
        (result.view ??= {}).stream = action.stream;
      } else if (action.advanced_camera_card_action === 'substream_off') {
        (result.view ??= {}).stream = null;
      } else {
        (result.other ??= []).push(action);
      }
    }
    return result;
  }

  private _getRecordingTime(): Date | null {
    const value = this._getParams().find(
      (param) => param.actionName === 'recording_at',
    )?.value;
    const seconds = Number(value);
    return value && seconds > 0 && Number.isFinite(seconds)
      ? new Date(seconds * 1000)
      : null;
  }

  private _getParams(): { actionName: string; value: string; cardID?: string }[] {
    const params = new URLSearchParams(window.location.search);
    const results: { actionName: string; value: string; cardID?: string }[] = [];
    const configuredCardID = this._api.getConfigManager().getConfig()?.card_id;
    const actionRE = new RegExp(
      /^(advanced-camera-card|frigate-card)-action([.:](?<cardID>\w+))?[.:](?<action>\w+)/,
    );
    for (const [key, value] of params.entries()) {
      const match = key.match(actionRE);
      if (!match || !match.groups) {
        continue;
      }
      const cardID: string | undefined = match.groups['cardID'];

      // Skip actions targeted at other cards.
      if (cardID && cardID !== configuredCardID) {
        continue;
      }
      results.push({ actionName: match.groups['action'], value, cardID });
    }
    return results;
  }

  private _getActions(): AdvancedCameraCardCustomActionConfig[] {
    const actions: AdvancedCameraCardCustomActionConfig[] = [];
    for (const { actionName, value, cardID } of this._getParams()) {
      let action: AdvancedCameraCardCustomActionConfig | null = null;
      switch (actionName) {
        case 'recording_at':
          // Handled by _getRecordingTime, as it is not a card action.
          break;
        case 'camera_select':
          if (value) {
            action = createCameraAction(value, { cardID });
          }
          break;
        case 'substream_on':
          action = createSubstreamOnAction({
            ...(value && { stream: value }),
            cardID,
          });
          break;
        case 'substream_off':
          action = createSubstreamOffAction({ cardID });
          break;
        case 'camera_ui':
        case 'default':
        case 'download':
        case 'expand':
        case 'menu_toggle':
          action = createGeneralAction(actionName, { cardID });
          break;
        case 'clip':
        case 'clips':
        case 'diagnostics':
        case 'folder':
        case 'folders':
        case 'gallery':
        case 'image':
        case 'live':
        case 'media':
        case 'recording':
        case 'recordings':
        case 'review':
        case 'reviews':
        case 'snapshot':
        case 'snapshots':
        case 'timeline':
          action = createViewAction(actionName, { cardID });
          break;
        default:
          console.warn(
            `Advanced Camera Card received unknown card action in query string: ${actionName}`,
          );
      }
      if (action) {
        actions.push(action);
      }
    }
    return actions;
  }

  private _isViewAction = (
    action: AdvancedCameraCardCustomActionConfig,
  ): action is ViewActionConfig => {
    switch (action.advanced_camera_card_action) {
      case 'clip':
      case 'clips':
      case 'diagnostics':
      case 'folder':
      case 'folders':
      case 'gallery':
      case 'image':
      case 'live':
      case 'media':
      case 'recording':
      case 'recordings':
      case 'review':
      case 'reviews':
      case 'snapshot':
      case 'snapshots':
      case 'timeline':
        return true;
    }
    return false;
  };
}
