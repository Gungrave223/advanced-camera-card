import { format } from 'date-fns';
import { css, html, LitElement, type CSSResultGroup, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import type { CameraManager } from '../../camera-manager/manager.js';
import type { HomeAssistant } from '../../ha/types.js';
import { uses24HourClock } from '../../utils/ha-time-format.js';
import {
  EventLabelProvider,
  formatEventLabels,
  type EventLabels,
} from '../../components-lib/viewer/event-labels.js';
import { fireAdvancedCameraCardEvent } from '../../utils/fire-advanced-camera-card-event.js';
import { Timer } from '../../utils/timer.js';
import type { ViewMedia } from '../../view/item.js';
import { ViewItemClassifier } from '../../view/item-classifier.js';

const UPDATE_INTERVAL_SECONDS = 0.5;

/**
 * Shows the real-world time of the video currently playing back (recordings,
 * and event clips or reviews picked on the timeline; time of day only, on the user's
 * 12 / 24 hour clock, where the LIVE label sits in live view), and optionally what any event at
 * that time is tagged as. Players only know their position in the video, which
 * for hour-long recordings is not the time the footage was captured.
 */
@customElement('advanced-camera-card-viewer-footage-time')
export class AdvancedCameraCardViewerFootageTime extends LitElement {
  @property({ attribute: false })
  public media?: ViewMedia;

  @property({ attribute: false })
  public cameraManager?: CameraManager;

  // Only used to follow the user's 12 / 24 hour setting.
  @property({ attribute: false })
  public hass?: HomeAssistant;

  @property({ attribute: false })
  public getPosition?: () => Promise<number | null>;

  // The time is still worked out (for the timeline playhead) when it is not
  // shown.
  @property({ attribute: false })
  public showTime = true;

  @property({ attribute: false })
  public showLabels = true;

  @state()
  private _time: Date | null = null;

  @state()
  private _labels = '';

  private _labelProvider = new EventLabelProvider();
  private _timer = new Timer();
  private _lastPosition: number | null = null;
  private _lastMedia: ViewMedia | null = null;

  connectedCallback(): void {
    super.connectedCallback();
    this._timer.startRepeated(UPDATE_INTERVAL_SECONDS, () => void this._update());
  }

  disconnectedCallback(): void {
    this._timer.stop();
    super.disconnectedCallback();
  }

  private async _update(): Promise<void> {
    const media = this.media;
    const position = (await this.getPosition?.()) ?? null;
    if (!media || !this.cameraManager) {
      this._setTime(null);
      this._setLabels({ what: [], where: [] });
      return;
    }
    if (position === null) {
      this._setTime(null);
      this._setLabels(
        await this._labelProvider.getLabels(media, null, this.cameraManager),
      );
      return;
    }
    if (media === this._lastMedia && position === this._lastPosition) {
      return;
    }
    const time = await this.cameraManager.getMediaTimeAtPosition(media, position);
    const labels = await this._labelProvider.getLabels(media, time, this.cameraManager);

    // The media may have changed while the segments were being fetched.
    if (media === this.media) {
      this._lastMedia = media;
      this._lastPosition = position;
      this._setTime(time);
      this._setLabels(labels);
    }
  }

  private _setLabels(labels: EventLabels): void {
    this._labels = formatEventLabels(labels);
  }

  private _setTime(time: Date | null): void {
    if (time?.getTime() !== this._time?.getTime()) {
      this._time = time;
      fireAdvancedCameraCardEvent(this, 'media:footage-time', time);
    }
  }

  protected render(): TemplateResult | void {
    return html`${this.showLabels && this._labels
      ? html`<div class="labels">${this._labels}</div>`
      : ''}
    ${this.showTime && this._time && ViewItemClassifier.isVideo(this.media)
      ? html`<div class="time">${format(this._time, uses24HourClock(this.hass) ? 'HH:mm:ss' : 'h:mm:ss a')}</div>`
      : ''}`;
  }

  static get styles(): CSSResultGroup {
    return css`
      :host {
        position: absolute;
        top: 0;
        bottom: 0;
        left: 8px;
        right: 8px;
        z-index: 3;
        pointer-events: none;
        white-space: nowrap;
        font-size: 14px;
        font-variant-numeric: tabular-nums;
        color: white;
      }
      div {
        position: absolute;
      }
      /* Above the back to live button, with some space between them. */
      .labels {
        padding: 4px 10px;
        border-radius: 6px;
        background: rgba(0, 0, 0, 0.65);
        bottom: 72px;
        left: 50%;
        transform: translateX(-50%);
        font-size: 18px;
        text-transform: capitalize;
      }
      /* Where (and styled like) the LIVE label in live view: the host is inset 8px. */
      .time {
        top: calc(16px + var(--advanced-camera-card-menu-top-offset, 0px));
        left: 8px;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.5px;
        text-shadow:
          0 0 3px rgba(0, 0, 0, 0.9),
          0 1px 2px rgba(0, 0, 0, 0.8);
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'advanced-camera-card-viewer-footage-time': AdvancedCameraCardViewerFootageTime;
  }
}
