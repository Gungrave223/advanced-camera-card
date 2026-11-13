import {
  css,
  html,
  LitElement,
  nothing,
  unsafeCSS,
  type CSSResultGroup,
  type PropertyValues,
  type TemplateResult,
} from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import type { CameraManager } from '../camera-manager/manager.js';
import type { FoldersManager } from '../card-controller/folders/manager.js';
import type { ViewItemManager } from '../card-controller/view/item-manager.js';
import type { ViewManagerEpoch } from '../card-controller/view/types.js';
import { VerticalSwipeTracker } from '../components-lib/scrubber/swipe.js';
import type { ConditionStateManagerReadonlyInterface } from '../condition-trigger/conditions/types.js';
import type { ThumbnailsControlConfig } from '../config/schema/common/controls/thumbnails.js';
import type { MiniTimelineControlConfig } from '../config/schema/common/controls/timeline.js';
import type { CardWideConfig } from '../config/schema/types.js';
import type { HomeAssistant } from '../ha/types.js';
import basicBlockStyle from '../scss/basic-block.scss?inline';
import { contentsChanged } from '../utils/basic.js';
import { fireAdvancedCameraCardEvent } from '../utils/fire-advanced-camera-card-event.js';

import './surround-basic.js';
import './thumbnail-carousel';

@customElement('advanced-camera-card-surround')
export class AdvancedCameraCardSurround extends LitElement {
  @property({ attribute: false })
  public hass?: HomeAssistant;

  @property({ attribute: false })
  public viewManagerEpoch?: ViewManagerEpoch;

  @property({ attribute: false, hasChanged: contentsChanged })
  public thumbnailConfig?: ThumbnailsControlConfig;

  @property({ attribute: false, hasChanged: contentsChanged })
  public timelineConfig?: MiniTimelineControlConfig;

  @property({ attribute: false })
  public cameraManager?: CameraManager;

  @property({ attribute: false })
  public foldersManager?: FoldersManager;

  @property({ attribute: false })
  public conditionStateManager?: ConditionStateManagerReadonlyInterface;

  @property({ attribute: false })
  public viewItemManager?: ViewItemManager;

  @property({ attribute: false })
  public cardWideConfig?: CardWideConfig;

  @property({ attribute: false })
  public locked?: boolean;

  @property({ attribute: false })
  public drawerPinned?: boolean;

  // Swiping down on the video hides the scrubber, swiping up shows it.
  @state()
  private _scrubberCollapsed = false;

  private _swipeTracker = new VerticalSwipeTracker((swipe) => {
    this._scrubberCollapsed = swipe === 'down';
  });

  /**
   * Determine if a drawer is being used.
   */
  private _hasDrawer(): boolean {
    return (
      !!this.thumbnailConfig && ['left', 'right'].includes(this.thumbnailConfig.mode)
    );
  }

  /**
   * Whether the separate vertical scrubber replaces the original timeline.
   */
  private _useScrubber(): boolean {
    return this.timelineConfig?.style === 'scrubber';
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected willUpdate(_changedProperties: PropertyValues): void {
    if (this.timelineConfig?.mode && this.timelineConfig.mode !== 'none') {
      if (this._useScrubber()) {
        void import('./scrubber.js');
      } else {
        void import('./timeline-core.js');
      }
    }
  }

  protected render(): TemplateResult | void {
    const view = this.viewManagerEpoch?.manager.getView();
    if (!this.hass || !view) {
      return;
    }

    const changeDrawer = (ev: CustomEvent, action: 'open' | 'close') => {
      // The event catch/re-dispatch below protect encapsulation: Catches the
      // request to view thumbnails and re-dispatches a request to open the drawer
      // (if the thumbnails are in a drawer). The new event needs to be dispatched
      // from the origin of the inbound event, so it can be handled by
      // <advanced-camera-card-surround> .
      if (this.thumbnailConfig && this._hasDrawer()) {
        fireAdvancedCameraCardEvent(ev.composedPath()[0], 'drawer:' + action, {
          drawer: this.thumbnailConfig.mode,
        });
      }
    };

    const useScrubber =
      !!this.timelineConfig && this.timelineConfig.mode !== 'none' && this._useScrubber();

    // On the right, the scrubber sits in a row beside the main content
    // instead of in one of the surround's (column) slots.
    const scrubberRight =
      useScrubber && this.timelineConfig?.scrubber?.position === 'right';
    const scrubber =
      this.timelineConfig && useScrubber
        ? html` <advanced-camera-card-scrubber
            slot=${scrubberRight ? nothing : this.timelineConfig.mode}
            .position=${scrubberRight ? 'right' : 'below'}
            .collapsed=${this._scrubberCollapsed}
            .hass=${this.hass}
            .viewManagerEpoch=${this.viewManagerEpoch}
            .timelineConfig=${this.timelineConfig}
            .cameraManager=${this.cameraManager}
            .foldersManager=${this.foldersManager}
            .conditionStateManager=${this.conditionStateManager}
          >
          </advanced-camera-card-scrubber>`
        : null;

    return html` <advanced-camera-card-surround-basic
      .locked=${this.locked}
      .drawerPinned=${this.drawerPinned}
      @touchstart=${useScrubber
        ? { handleEvent: this._swipeTracker.handleTouchStart, passive: true }
        : nothing}
      @touchend=${useScrubber
        ? { handleEvent: this._swipeTracker.handleTouchEnd, passive: true }
        : nothing}
      @touchcancel=${useScrubber
        ? { handleEvent: this._swipeTracker.handleTouchCancel, passive: true }
        : nothing}
      @advanced-camera-card:media:footage-time=${(ev: CustomEvent<Date | null>) => {
        const host = ev.currentTarget as HTMLElement;
        host.querySelector('advanced-camera-card-timeline-core')?.setPlayhead(ev.detail);
        host.querySelector('advanced-camera-card-scrubber')?.setPlayhead(ev.detail);
      }}
      @advanced-camera-card:thumbnails-carousel:media-select=${(ev: CustomEvent) =>
        changeDrawer(ev, 'close')}
    >
      ${this.thumbnailConfig && this.thumbnailConfig.mode !== 'none'
        ? html` <advanced-camera-card-thumbnail-carousel
            slot=${this.thumbnailConfig.mode}
            .hass=${this.hass}
            .config=${this.thumbnailConfig}
            .cameraManager=${this.cameraManager}
            .viewItemManager=${this.viewItemManager}
            .fadeThumbnails=${view.isViewerView()}
            .viewManagerEpoch=${this.viewManagerEpoch}
            .foldersManager=${this.foldersManager}
            .selected=${view.queryResults?.getSelectedIndex() ?? undefined}
            .cardWideConfig=${this.cardWideConfig}
            .locked=${this.locked}
          >
          </advanced-camera-card-thumbnail-carousel>`
        : ''}
      ${scrubberRight
        ? ''
        : scrubber
        ? scrubber
        : this.timelineConfig && this.timelineConfig.mode !== 'none'
        ? html` <advanced-camera-card-timeline-core
            slot=${this.timelineConfig.mode}
            .hass=${this.hass}
            .viewManagerEpoch=${this.viewManagerEpoch}
            .itemClickAction=${view.isViewerView() ||
            !this.thumbnailConfig ||
            this.thumbnailConfig?.mode === 'none'
              ? 'play'
              : 'select'}
            .mini=${true}
            .timelineConfig=${this.timelineConfig}
            .thumbnailConfig=${this.thumbnailConfig}
            .cameraManager=${this.cameraManager}
            .foldersManager=${this.foldersManager}
            .conditionStateManager=${this.conditionStateManager}
            .viewItemManager=${this.viewItemManager}
            .cardWideConfig=${this.cardWideConfig}
            .locked=${this.locked}
          >
          </advanced-camera-card-timeline-core>`
        : ''}
      ${scrubberRight
        ? html`<div class="scrubber-row"><slot></slot>${scrubber}</div>`
        : html`<slot></slot>`}
    </advanced-camera-card-surround-basic>`;
  }

  static get styles(): CSSResultGroup {
    return [
      unsafeCSS(basicBlockStyle),
      css`
        .scrubber-row {
          display: flex;
          flex-direction: row;
          min-width: 0;
          min-height: 0;
        }
        .scrubber-row ::slotted(*) {
          flex: 1;
          min-width: 0;
          min-height: 0;
        }
      `,
    ];
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'advanced-camera-card-surround': AdvancedCameraCardSurround;
  }
}
