import { format } from 'date-fns';
import { css, html, LitElement, type CSSResultGroup, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import type { CameraManager } from '../../camera-manager/manager.js';
import {
  EventLabelProvider,
  formatEventLabels,
  type EventLabels,
} from '../../components-lib/viewer/event-labels.js';
import { fireAdvancedCameraCardEvent } from '../../utils/fire-advanced-camera-card-event.js';
import { Timer } from '../../utils/timer.js';
import type { ViewMedia } from '../../view/item.js';

const UPDATE_INTERVAL_SECONDS = 0.5;

/**
 * Shows the real-world time of the footage currently playing, and what any event
 * at that time is tagged as. Players only know their position in the video, which
 * for hour-long recordings is not the time the footage was captured.
 */
@customElement('advanced-camera-card-viewer-footage-time')
export class AdvancedCameraCardViewerFootageTime extends LitElement {
  @property({ attribute: false })
  public media?: ViewMedia;

  @property({ attribute: false })
  public cameraManager?: CameraManager;

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
    ${this.showTime && this._time
      ? html`<div class="time">${format(this._time, 'EEE, MMM d, h:mm:ss a')}</div>`
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
        padding: 4px 10px;
        border-radius: 6px;
        background: rgba(0, 0, 0, 0.65);
      }
      /* Above the back to live button, with some space between them. */
      .labels {
        bottom: 72px;
        left: 50%;
        transform: translateX(-50%);
        font-size: 18px;
        text-transform: capitalize;
      }
      .time {
        top: calc(56px + var(--advanced-camera-card-menu-top-offset, 0px));
        right: 0;
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'advanced-camera-card-viewer-footage-time': AdvancedCameraCardViewerFootageTime;
  }
}
