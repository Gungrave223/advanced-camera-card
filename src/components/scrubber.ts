import {
  html,
  LitElement,
  unsafeCSS,
  type CSSResultGroup,
  type PropertyValues,
  type TemplateResult,
} from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { createRef, ref, type Ref } from 'lit/directives/ref.js';
import { repeat } from 'lit/directives/repeat.js';
import { styleMap } from 'lit/directives/style-map.js';

import type { CameraManager } from '../camera-manager/manager';
import type { FoldersManager } from '../card-controller/folders/manager';
import type { ViewManagerEpoch } from '../card-controller/view/types';
import {
  ScrubberController,
  SCRUBBER_LIVE_TOLERANCE_MS,
  type ScrubberEvent,
} from '../components-lib/scrubber/controller';
import {
  getTicks,
  getFillHeight,
  getVisibleRange,
  layoutEventsAbsolute,
  layoutToScreen,
  stepMomentum,
  timeAfterDrag,
  timeToY,
  yToTime,
  zoom,
  type ScrubberGeometry,
  type ScrubberLayoutItem,
} from '../components-lib/scrubber/geometry';
import type { ConditionStateManagerReadonlyInterface } from '../condition-trigger/conditions/types';
import {
  scrubberConfigDefault,
  type MiniTimelineControlConfig,
} from '../config/schema/common/controls/timeline';
import type { HomeAssistant } from '../ha/types';
import type { MediaLoadedInfoEventDetail } from '../types';
import {
  findMediaAspect,
  releaseMediaCarouselHeights,
} from '../components-lib/scrubber/media-layout';
import scrubberStyle from '../scss/scrubber.scss?inline';
import { stopEventFromActivatingCardWideActions } from '../utils/action';
import { contentsChanged } from '../utils/basic';

import './icon.js';
import './thumbnail/feature/thumbnail.js';

// Horizontal layout of the strip (pixels from the left).
const BAR_X = 66;
const BAR_WIDTH = 4;
const PILL_WIDTH = 10;
const THUMBNAIL_X = 84;
const THUMBNAIL_SIZE = 56;

// Where the playhead sits, as a proportion of the strip height.
const PLAYHEAD_PROPORTION = 0.25;

// Default zoom: about two hours across a 280px strip.
const DEFAULT_SECONDS_PER_PIXEL = 25;

// A pointer that moves less than this, quickly, is a tap.
const TAP_MAX_MOVEMENT_PX = 6;
const TAP_MAX_DURATION_MS = 400;

// After the user lets go, playback positions are ignored for this long so the
// strip does not jump back before the new footage loads.
const FOLLOW_PAUSE_AFTER_INTERACTION_MS = 2500;

const WHEEL_SETTLE_MS = 350;

// Height of the header row (date and the timeline / list toggle).
const HEADER_HEIGHT = 44;

// After the panel changes size (it animates for 0.2s), wait this long before
// asking the video area to re-measure.
const RELAYOUT_DELAY_MS = 300;

// Load the previous day when the list is scrolled this close to its end.
const LIST_LOAD_MORE_PX = 200;
const MOMENTUM_MIN_VELOCITY = 0.02;

interface DragState {
  startY: number;
  startTime: number;
  downAt: number;
  lastY: number;
  lastAt: number;
  velocity: number;
  moved: number;
}

@customElement('advanced-camera-card-scrubber')
export class AdvancedCameraCardScrubber extends LitElement {
  @property({ attribute: false })
  public hass?: HomeAssistant;

  @property({ attribute: false })
  public viewManagerEpoch?: ViewManagerEpoch;

  @property({ attribute: false, hasChanged: contentsChanged })
  public timelineConfig?: MiniTimelineControlConfig;

  @property({ attribute: false })
  public cameraManager?: CameraManager;

  @property({ attribute: false })
  public foldersManager?: FoldersManager;

  @property({ attribute: false })
  public conditionStateManager?: ConditionStateManagerReadonlyInterface;

  // Hidden by a swipe down on the video (the strip folds away).
  @property({ type: Boolean, reflect: true })
  public collapsed = false;

  // Bumped to re-render on every animation frame that changes something.
  @state()
  private _frameCount = 0;

  @state()
  private _message: string | null = null;

  // Google Home style toggle between the timeline and a list of events.
  @state()
  private _mode: 'timeline' | 'list' = 'timeline';

  // The oldest time the list has asked to load (it grows as you scroll).
  private _listStart: number | null = null;

  private _controller = new ScrubberController(() => this._requestFrame());
  private _refStrip: Ref<HTMLElement> = createRef();
  private _refCanvas: Ref<HTMLCanvasElement> = createRef();

  private _geometry: ScrubberGeometry = {
    height: 280,
    playheadY: 280 * PLAYHEAD_PROPORTION,
    secondsPerPixel: DEFAULT_SECONDS_PER_PIXEL,
    time: Date.now(),
  };
  private _width = 0;

  // Whether the strip keeps now under the playhead.
  private _followLive = true;
  private _interacting = false;
  private _lastInteractionAt = 0;
  private _lastSelectedMediaID: string | null = null;

  private _pointers = new Map<number, { x: number; y: number }>();
  private _drag: DragState | null = null;
  private _pinch: { distance: number; secondsPerPixel: number } | null = null;
  private _momentumFrame: number | null = null;
  private _wheelTimer: number | null = null;
  private _wheelMovedTime = false;
  private _frame: number | null = null;
  private _liveTimer: number | null = null;
  private _messageTimer: number | null = null;

  private _events: ScrubberEvent[] = [];
  private _layout: ScrubberLayoutItem[] = [];
  private _absoluteLayout: ScrubberLayoutItem[] = [];
  private _absoluteLayoutKey: string | null = null;

  private _resizeObserver = new ResizeObserver(() => this._measure());

  // The surround the scrubber sits in, watched to fill the space the video
  // does not need.
  private _container: HTMLElement | null = null;
  private _containerObserver = new ResizeObserver(() => this._updateFillHeight());
  private _mediaAspect: number | null = null;

  private _relayoutTimer: number | null = null;
  private _aspectTimer: number | null = null;
  private _mediaLoadedHandler = (ev: CustomEvent<MediaLoadedInfoEventDetail>) => {
    const info = ev.detail?.info;
    if (info && info.width > 0 && info.height > 0) {
      this._mediaAspect = info.height / info.width;
      this._updateFillHeight();
    }
  };
  private _wheelHandler = (ev: WheelEvent) => this._handleWheel(ev);

  connectedCallback(): void {
    super.connectedCallback();
    this._container = this.parentElement;
    // Until the video's shape is known, keep looking for it (it may already
    // be playing, or still loading).
    this._aspectTimer = window.setInterval(() => {
      if (this._mediaAspect && this._aspectTimer !== null) {
        window.clearInterval(this._aspectTimer);
        this._aspectTimer = null;
        return;
      }
      this._updateFillHeight();
    }, 1000);
    if (this._container) {
      this._containerObserver.observe(this._container);
      this._container.addEventListener(
        'advanced-camera-card:media:loaded',
        this._mediaLoadedHandler,
      );
    }
    this._liveTimer = window.setInterval(() => {
      if (this._followLive && !this._interacting) {
        this._requestFrame();
      }
    }, 1000);
  }

  disconnectedCallback(): void {
    this._resizeObserver.disconnect();
    this._containerObserver.disconnect();
    this._container?.removeEventListener(
      'advanced-camera-card:media:loaded',
      this._mediaLoadedHandler,
    );
    this._container = null;
    for (const timer of [
      this._liveTimer,
      this._wheelTimer,
      this._messageTimer,
      this._relayoutTimer,
      this._aspectTimer,
    ]) {
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    }
    if (this._frame !== null) {
      cancelAnimationFrame(this._frame);
    }
    this._stopMomentum();
    super.disconnectedCallback();
  }

  /**
   * Playback position from the media viewer (`media:footage-time`).
   */
  public setPlayhead(time: Date | null): void {
    if (
      !time ||
      this._interacting ||
      Date.now() - this._lastInteractionAt < FOLLOW_PAUSE_AFTER_INTERACTION_MS
    ) {
      return;
    }
    if (this._controller.isLive()) {
      return;
    }
    this._followLive = false;
    this._geometry = { ...this._geometry, time: time.getTime() };
    this._requestFrame();
  }

  protected willUpdate(changedProps: PropertyValues): void {
    if (
      ['timelineConfig', 'cameraManager', 'foldersManager', 'conditionStateManager', 'viewManagerEpoch'].some(
        (prop) => changedProps.has(prop),
      )
    ) {
      this._controller.setOptions({
        cameraManager: this.cameraManager,
        foldersManager: this.foldersManager,
        conditionStateManager: this.conditionStateManager,
        timelineConfig: this.timelineConfig,
        query: this.viewManagerEpoch?.manager.getView()?.query ?? undefined,
        camera: this.viewManagerEpoch?.manager.getView()?.camera ?? undefined,
      });
    }

    if (changedProps.has('timelineConfig')) {
      this._updateFillHeight();
    }

    if (changedProps.has('viewManagerEpoch')) {
      this._controller.setView(this.viewManagerEpoch ?? null);
      this._syncWithView();
    }
  }

  private _syncWithView(): void {
    if (this._interacting) {
      return;
    }
    if (this._controller.isLive()) {
      this._followLive = true;
      this._lastSelectedMediaID = null;
      return;
    }

    // A clip opened from elsewhere (e.g. the clip list): show its start until
    // playback reports a position.
    const selected = this._controller.getSelectedMedia();
    if (selected && selected.id !== this._lastSelectedMediaID) {
      this._lastSelectedMediaID = selected.id;
      if (
        selected.start &&
        Date.now() - this._lastInteractionAt >= FOLLOW_PAUSE_AFTER_INTERACTION_MS
      ) {
        this._followLive = false;
        this._geometry = { ...this._geometry, time: selected.start.getTime() };
      }
    }
  }

  private _setHeight(height: number): void {
    if (height === this._geometry.height) {
      return;
    }
    this._geometry = {
      ...this._geometry,
      height,
      playheadY: Math.round(height * PLAYHEAD_PROPORTION),
    };
    this._requestFrame();
    this._scheduleRelayout();
  }

  private _updateFillHeight(): void {
    // The scrubber may appear after the video has loaded (so its load event
    // was missed): read the shape from the video itself.
    if (!this._mediaAspect && this._container) {
      this._mediaAspect = findMediaAspect(
        this._getMediaRoots(),
        this._container.clientWidth,
      );
    }
    this._setHeight(
      getFillHeight({
        containerWidth: this._container?.clientWidth ?? 0,
        containerHeight: this._container?.clientHeight ?? 0,
        mediaAspect: this._mediaAspect,
        headerHeight: HEADER_HEIGHT,
        minHeight: this.timelineConfig?.scrubber?.height ?? scrubberConfigDefault.height,
      }),
    );
  }

  /**
   * Once the panel has finished changing size, have the video area measure
   * itself again so the video is centered in the space it now has.
   */
  // The other elements in the surround (the video side), to look for the
  // video and its carousel.
  private _getMediaRoots(): Element[] {
    return Array.from(this._container?.children ?? []).filter(
      (element) => element !== this,
    );
  }

  /**
   * Once the panel has finished changing size, let the video area grow (or
   * shrink) into the space it now has so the video is centered in it.
   */
  private _scheduleRelayout(): void {
    if (this._relayoutTimer !== null) {
      window.clearTimeout(this._relayoutTimer);
    }
    this._relayoutTimer = window.setTimeout(() => {
      this._relayoutTimer = null;
      releaseMediaCarouselHeights(this._getMediaRoots());
    }, RELAYOUT_DELAY_MS);
  }

  protected firstUpdated(): void {
    const strip = this._refStrip.value;
    if (strip) {
      this._resizeObserver.observe(strip);
      // Non-passive so the page does not scroll while scrubbing with a wheel.
      strip.addEventListener('wheel', this._wheelHandler, { passive: false });
    }
    this._measure();
  }

  private _measure(): void {
    const strip = this._refStrip.value;
    if (!strip) {
      return;
    }
    this._width = strip.clientWidth;
    this._requestFrame();
  }

  private _requestFrame(): void {
    if (this._frame !== null) {
      return;
    }
    this._frame = requestAnimationFrame(() => {
      this._frame = null;
      this._frameCount++;
    });
  }

  private _now(): number {
    return Date.now();
  }

  private _clampTime(time: number): number {
    return Math.min(time, this._now());
  }

  private _setTime(time: number): void {
    this._geometry = { ...this._geometry, time: this._clampTime(time) };
    this._requestFrame();
  }

  private _isAtLive(): boolean {
    return this._geometry.time >= this._now() - SCRUBBER_LIVE_TOLERANCE_MS;
  }

  // ---- Interaction --------------------------------------------------------

  private _startInteraction(): void {
    this._interacting = true;
    this._followLive = false;
    this._stopMomentum();
  }

  private async _finishInteraction(seek = true): Promise<void> {
    this._interacting = false;
    this._lastInteractionAt = this._now();
    if (!seek) {
      return;
    }
    if (this._isAtLive()) {
      this._followLive = true;
    }
    const result = await this._controller.seek(new Date(this._geometry.time));
    if (result === 'none') {
      this._showMessage('No footage here');
    }
    this._requestFrame();
  }

  private _showMessage(message: string): void {
    this._message = message;
    if (this._messageTimer !== null) {
      window.clearTimeout(this._messageTimer);
    }
    this._messageTimer = window.setTimeout(() => {
      this._message = null;
      this._messageTimer = null;
    }, 2000);
  }

  private _getLocalPoint(ev: PointerEvent): { x: number; y: number } {
    const rect = this._refStrip.value?.getBoundingClientRect();
    return { x: ev.clientX - (rect?.left ?? 0), y: ev.clientY - (rect?.top ?? 0) };
  }

  private _pinchDistance(): number {
    const [a, b] = [...this._pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  private _handlePointerDown(ev: PointerEvent): void {
    stopEventFromActivatingCardWideActions(ev);
    if (ev.button > 0) {
      return;
    }
    (ev.currentTarget as HTMLElement).setPointerCapture?.(ev.pointerId);
    this._pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    this._startInteraction();

    if (this._pointers.size >= 2) {
      this._drag = null;
      this._pinch = {
        distance: this._pinchDistance(),
        secondsPerPixel: this._geometry.secondsPerPixel,
      };
      return;
    }

    const now = performance.now();
    this._drag = {
      startY: ev.clientY,
      startTime: this._geometry.time,
      downAt: now,
      lastY: ev.clientY,
      lastAt: now,
      velocity: 0,
      moved: 0,
    };
  }

  private _handlePointerMove(ev: PointerEvent): void {
    if (!this._pointers.has(ev.pointerId)) {
      return;
    }
    stopEventFromActivatingCardWideActions(ev);
    this._pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

    if (this._pinch && this._pointers.size >= 2) {
      const distance = this._pinchDistance();
      if (distance > 0 && this._pinch.distance > 0) {
        this._geometry = zoom(
          { ...this._geometry, secondsPerPixel: this._pinch.secondsPerPixel },
          this._pinch.distance / distance,
        );
        this._requestFrame();
      }
      return;
    }

    const drag = this._drag;
    if (!drag) {
      return;
    }
    const now = performance.now();
    const deltaY = ev.clientY - drag.lastY;
    const elapsed = Math.max(1, now - drag.lastAt);
    drag.velocity = 0.8 * (deltaY / elapsed) + 0.2 * drag.velocity;
    drag.moved += Math.abs(deltaY);
    drag.lastY = ev.clientY;
    drag.lastAt = now;
    this._setTime(timeAfterDrag(this._geometry, deltaY));
  }

  private _handlePointerUp(ev: PointerEvent): void {
    if (!this._pointers.has(ev.pointerId)) {
      return;
    }
    stopEventFromActivatingCardWideActions(ev);
    this._pointers.delete(ev.pointerId);

    if (this._pinch) {
      if (this._pointers.size < 2) {
        // Zooming does not move the footage, so there is nothing to seek.
        this._pinch = null;
        this._drag = null;
        if (!this._pointers.size) {
          void this._finishInteraction(false);
        }
      }
      return;
    }

    const drag = this._drag;
    this._drag = null;
    if (!drag) {
      return;
    }

    const duration = performance.now() - drag.downAt;
    if (
      ev.type === 'pointerup' &&
      drag.moved < TAP_MAX_MOVEMENT_PX &&
      duration < TAP_MAX_DURATION_MS
    ) {
      // Undo any tiny movement, then treat as a tap.
      this._geometry = { ...this._geometry, time: drag.startTime };
      this._handleTap(this._getLocalPoint(ev));
      return;
    }

    // Ignore a stale velocity if the pointer rested before release.
    const velocity = performance.now() - drag.lastAt > 80 ? 0 : drag.velocity;
    if (Math.abs(velocity) > MOMENTUM_MIN_VELOCITY * 2) {
      this._startMomentum(velocity);
    } else {
      void this._finishInteraction();
    }
  }

  private _handleTap(point: { x: number; y: number }): void {
    const hit = this._layout.find((item) => {
      const onThumbnail =
        item.thumbnailTop !== null &&
        point.x >= THUMBNAIL_X &&
        point.y >= item.thumbnailTop &&
        point.y <= item.thumbnailTop + THUMBNAIL_SIZE;
      const onPill =
        point.x >= BAR_X - 12 &&
        point.x <= BAR_X + PILL_WIDTH + 8 &&
        point.y >= item.top - 2 &&
        point.y <= item.bottom + 2;
      return onThumbnail || onPill;
    });

    if (hit) {
      const event = this._events.find((candidate) => candidate.id === hit.id);
      this._interacting = false;
      this._lastInteractionAt = this._now();
      if (event && this._controller.playEvent(event.id)) {
        this._followLive = false;
        this._setTime(event.start);
      }
      return;
    }

    // A tap elsewhere on the strip jumps to that time.
    this._setTime(yToTime(this._geometry, point.y));
    void this._finishInteraction();
  }

  private _startMomentum(velocity: number): void {
    let current = velocity;
    let last = performance.now();
    const step = (): void => {
      const now = performance.now();
      const result = stepMomentum(current, now - last);
      last = now;
      current = result.velocity;
      this._setTime(timeAfterDrag(this._geometry, result.distance));

      if (Math.abs(current) < MOMENTUM_MIN_VELOCITY || this._isAtLive()) {
        this._momentumFrame = null;
        void this._finishInteraction();
        return;
      }
      this._momentumFrame = requestAnimationFrame(step);
    };
    this._momentumFrame = requestAnimationFrame(step);
  }

  private _stopMomentum(): void {
    if (this._momentumFrame !== null) {
      cancelAnimationFrame(this._momentumFrame);
      this._momentumFrame = null;
    }
  }

  private _handleWheel(ev: WheelEvent): void {
    ev.preventDefault();
    stopEventFromActivatingCardWideActions(ev);
    if (!this._interacting) {
      this._startInteraction();
      this._wheelMovedTime = false;
    }

    // Trackpad pinches arrive as wheel events with ctrlKey set.
    if (ev.ctrlKey) {
      this._geometry = zoom(this._geometry, Math.exp(ev.deltaY * 0.01));
      this._requestFrame();
    } else {
      // Scrolling down moves back in time, as in a list.
      this._setTime(timeAfterDrag(this._geometry, -ev.deltaY));
      this._wheelMovedTime = true;
    }

    if (this._wheelTimer !== null) {
      window.clearTimeout(this._wheelTimer);
    }
    this._wheelTimer = window.setTimeout(() => {
      this._wheelTimer = null;
      void this._finishInteraction(this._wheelMovedTime);
    }, WHEEL_SETTLE_MS);
  }

  private _handleLiveClick(ev: Event): void {
    stopEventFromActivatingCardWideActions(ev);
    this._stopMomentum();
    this._interacting = false;
    this._followLive = true;
    this._lastInteractionAt = this._now();
    this._setTime(this._now());
    this._controller.goLive();
  }

  // ---- Rendering ----------------------------------------------------------

  private _formatTime(time: number, seconds: boolean): string {
    return new Date(time).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
      ...(seconds && { second: '2-digit' }),
      hour12: !(this.timelineConfig?.format?.['24h'] ?? true),
    });
  }

  private _formatDate(time: number): string {
    const date = new Date(time);
    const today = new Date();
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    if (date.toDateString() === today.toDateString()) {
      return 'Today';
    }
    if (date.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    }
    return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  }

  private _getBubbleText(): string {
    // Always with seconds, so the time visibly ticks along with playback.
    const time = this._geometry.time;
    const clock = this._formatTime(time, true);
    if (this._followLive && this._controller.isLive() && !this._interacting) {
      return `Live · ${clock}`;
    }
    const date = this._formatDate(time);
    return date === 'Today' ? clock : `${date} ${clock}`;
  }

  protected render(): TemplateResult | void {
    // Referenced so each animation frame re-renders.
    void this._frameCount;

    if (this._followLive && !this._interacting) {
      this._geometry = { ...this._geometry, time: this._now() };
    }

    const geometry = this._geometry;
    const range = getVisibleRange(geometry);
    void this._controller.ensureData(range);

    // Lay out every loaded event (not just the visible ones) so the layout
    // does not change as the strip scrolls; it is only redone when the zoom
    // or the events change.
    this._events = this._controller.getEvents({
      start: Number.NEGATIVE_INFINITY,
      end: Number.POSITIVE_INFINITY,
    });
    const layoutKey = `${geometry.secondsPerPixel}|${this._events
      .map((event) => `${event.id}:${event.start}:${event.end}`)
      .join(',')}`;
    if (layoutKey !== this._absoluteLayoutKey) {
      this._absoluteLayoutKey = layoutKey;
      this._absoluteLayout = layoutEventsAbsolute(
        this._events,
        geometry.secondsPerPixel,
        THUMBNAIL_SIZE,
      );
    }
    this._layout = layoutToScreen(geometry, this._absoluteLayout, THUMBNAIL_SIZE);
    const showThumbnails = this.timelineConfig?.scrubber?.thumbnails !== false;
    const eventsByID = new Map(this._events.map((event) => [event.id, event]));
    const thumbnails = showThumbnails
      ? this._layout.filter((item) => item.thumbnailTop !== null)
      : [];
    const live = this._followLive && this._controller.isLive() && !this._interacting;

    return html`<div
      class="panel"
      style=${styleMap({
        height: this.collapsed ? '0px' : `${geometry.height + HEADER_HEIGHT}px`,
      })}
    >
      ${this._renderHeader(live)}
      <div
      class=${classMap({ strip: true, hidden: this._mode !== 'timeline' })}
      style=${styleMap({ height: `${geometry.height}px` })}
      ${ref(this._refStrip)}
      @pointerdown=${(ev: PointerEvent) => this._handlePointerDown(ev)}
      @pointermove=${(ev: PointerEvent) => this._handlePointerMove(ev)}
      @pointerup=${(ev: PointerEvent) => this._handlePointerUp(ev)}
      @pointercancel=${(ev: PointerEvent) => this._handlePointerUp(ev)}
      @click=${(ev: Event) => stopEventFromActivatingCardWideActions(ev)}
    >
      <canvas ${ref(this._refCanvas)}></canvas>
      <div class="thumbnails">
        ${repeat(
          thumbnails,
          (item) => item.id,
          (item) => {
            const event = eventsByID.get(item.id);
            return event
              ? html`<div
                  class=${classMap({ thumbnail: true, selected: event.selected })}
                  style=${styleMap({
                    transform: `translate3d(0, ${item.thumbnailTop}px, 0)`,
                    '--advanced-camera-card-scrubber-event-color': event.color,
                  })}
                >
                  <advanced-camera-card-thumbnail-feature-thumbnail
                    .hass=${this.hass}
                    .thumbnail=${event.thumbnail ?? undefined}
                  ></advanced-camera-card-thumbnail-feature-thumbnail>
                  <div class="details">
                    <div class="label">${event.label}</div>
                    <div class="time">${this._formatTime(event.start, false)}</div>
                  </div>
                </div>`
              : '';
          },
        )}
      </div>
      <div class="playhead" style=${styleMap({ top: `${geometry.playheadY}px` })}></div>
      <div
        class=${classMap({ bubble: true, live })}
        style=${styleMap({ top: `${geometry.playheadY}px` })}
      >
        ${this._message ?? this._getBubbleText()}
      </div>
    </div>
      ${this._mode === 'list' ? this._renderList(geometry.height) : ''}
    </div>`;
  }

  private _renderHeader(live: boolean): TemplateResult {
    const list = this._mode === 'list';
    return html`<div
      class="header"
      @pointerdown=${(ev: Event) => stopEventFromActivatingCardWideActions(ev)}
      @click=${(ev: Event) => stopEventFromActivatingCardWideActions(ev)}
    >
      <advanced-camera-card-icon
        class="calendar"
        .icon=${{ icon: 'mdi:calendar-blank-outline' }}
      ></advanced-camera-card-icon>
      <span class="date">${this._formatDate(this._geometry.time)}</span>
      ${live
        ? ''
        : html`<button class="go-live" @click=${(ev: Event) => this._handleLiveClick(ev)}>
            Live
          </button>`}
      <button
        class="toggle"
        title=${list ? 'Timeline view' : 'Event history view'}
        aria-label=${list ? 'Timeline view' : 'Event history view'}
        @click=${(ev: Event) => this._toggleMode(ev)}
      >
        <advanced-camera-card-icon
          .icon=${{ icon: list ? 'mdi:timeline-clock-outline' : 'mdi:view-list-outline' }}
        ></advanced-camera-card-icon>
      </button>
    </div>`;
  }

  private _toggleMode(ev: Event): void {
    stopEventFromActivatingCardWideActions(ev);
    this._mode = this._mode === 'list' ? 'timeline' : 'list';
    if (this._mode === 'list') {
      // Start with the day being viewed, back to its midnight.
      const day = new Date(this._geometry.time);
      this._listStart = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
      void this._controller.ensureData({ start: this._listStart, end: this._now() });
    }
    this._requestFrame();
  }

  private _handleListScroll(ev: Event): void {
    const list = ev.currentTarget as HTMLElement;
    if (
      this._listStart !== null &&
      list.scrollTop + list.clientHeight >= list.scrollHeight - LIST_LOAD_MORE_PX
    ) {
      // Near the bottom: load the day before.
      this._listStart -= 24 * 60 * 60 * 1000;
      void this._controller.ensureData({ start: this._listStart, end: this._now() });
    }
  }

  private _formatDuration(event: ScrubberEvent): string {
    const seconds = Math.max(1, Math.round((event.end - event.start) / 1000));
    if (seconds < 60) {
      return `${seconds} sec`;
    }
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) {
      return `${minutes} min`;
    }
    return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  }

  private _renderList(height: number): TemplateResult {
    const events = [...this._events].sort((a, b) => b.start - a.start);
    let lastDay: string | null = null;

    return html`<div
      class="list"
      style=${styleMap({ height: `${height}px` })}
      @scroll=${(ev: Event) => this._handleListScroll(ev)}
      @pointerdown=${(ev: Event) => stopEventFromActivatingCardWideActions(ev)}
      @click=${(ev: Event) => stopEventFromActivatingCardWideActions(ev)}
    >
      ${events.length
        ? ''
        : html`<div class="empty">No events loaded for this day yet</div>`}
      ${repeat(
        events,
        (event) => event.id,
        (event) => {
          const day = this._formatDate(event.start);
          const heading = day !== lastDay ? day : null;
          lastDay = day;
          return html`${heading ? html`<div class="day">${heading}</div>` : ''}
            <button
              class=${classMap({ row: true, selected: event.selected })}
              @click=${(ev: Event) => this._handleListRowClick(ev, event)}
            >
              <advanced-camera-card-icon
                class="kind"
                style=${styleMap({ color: event.color })}
                .icon=${{ icon: event.icon }}
              ></advanced-camera-card-icon>
              <span class="text">
                <span class="label">${event.label}</span>
                <span class="time"
                  >${this._formatTime(event.start, false)} •
                  ${this._formatDuration(event)}</span
                >
              </span>
              ${this.timelineConfig?.scrubber?.thumbnails === false
                ? ''
                : html`<advanced-camera-card-thumbnail-feature-thumbnail
                    class="preview"
                    .hass=${this.hass}
                    .thumbnail=${event.thumbnail ?? undefined}
                  ></advanced-camera-card-thumbnail-feature-thumbnail>`}
            </button>`;
        },
      )}
    </div>`;
  }

  private _handleListRowClick(ev: Event, event: ScrubberEvent): void {
    stopEventFromActivatingCardWideActions(ev);
    this._stopMomentum();
    this._interacting = false;
    this._lastInteractionAt = this._now();
    if (this._controller.playEvent(event.id)) {
      this._followLive = false;
      this._setTime(event.start);
    }
  }

  protected updated(changedProps: PropertyValues): void {
    super.updated(changedProps);
    if (changedProps.has('collapsed') && changedProps.get('collapsed') !== undefined) {
      this._scheduleRelayout();
    }
    this._draw();
  }

  private _draw(): void {
    const canvas = this._refCanvas.value;
    const geometry = this._geometry;
    const width = this._width || canvas?.clientWidth || 0;
    if (!canvas || !width) {
      return;
    }

    const ratio = window.devicePixelRatio || 1;
    const pixelWidth = Math.round(width * ratio);
    const pixelHeight = Math.round(geometry.height * ratio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }

    const style = getComputedStyle(this);
    const primary = style.getPropertyValue('--advanced-camera-card-scrubber-text').trim() || '#e8eaed';
    const secondary =
      style.getPropertyValue('--advanced-camera-card-scrubber-text-secondary').trim() ||
      '#9aa0a6';
    const recordingColor =
      style.getPropertyValue('--advanced-camera-card-scrubber-recording').trim() ||
      '#5f6368';
    const futureColor =
      style.getPropertyValue('--advanced-camera-card-scrubber-future').trim() ||
      'rgba(255, 255, 255, 0.04)';

    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, geometry.height);

    // Shade the future (above now).
    const nowY = timeToY(geometry, this._now());
    if (nowY > 0) {
      context.fillStyle = futureColor;
      context.fillRect(0, 0, width, nowY);
    }

    // Time ticks and labels.
    context.font = '11px sans-serif';
    context.textBaseline = 'middle';
    for (const tick of getTicks(geometry)) {
      if (tick.y < -10 || tick.y > geometry.height + 10) {
        continue;
      }
      context.fillStyle = tick.major ? primary : secondary;
      context.fillRect(0, Math.round(tick.y), tick.major ? 8 : 5, 1);
      context.fillText(this._formatTime(tick.time, false), 12, tick.y);
      if (tick.midnight) {
        context.fillStyle = secondary;
        context.fillRect(BAR_X + 12, Math.round(tick.y), width - BAR_X - 12, 1);
        context.fillText(this._formatDate(tick.time), BAR_X + 16, tick.y - 8);
      }
    }

    // Continuous recordings: a bar, with gaps where nothing was recorded.
    const range = getVisibleRange(geometry);
    context.fillStyle = recordingColor;
    for (const recording of this._controller.getRecordings(range)) {
      const top = Math.max(0, timeToY(geometry, recording.end));
      const bottom = Math.min(geometry.height, timeToY(geometry, recording.start));
      if (bottom > top) {
        context.fillRect(BAR_X, top, BAR_WIDTH, bottom - top);
      }
    }

    // Event pills on the bar, and a connector to each thumbnail.
    const eventsByID = new Map(this._events.map((event) => [event.id, event]));
    const pillX = BAR_X + BAR_WIDTH / 2 - PILL_WIDTH / 2;
    for (const item of this._layout) {
      const event = eventsByID.get(item.id);
      if (!event) {
        continue;
      }
      context.fillStyle = event.color;
      this._roundRect(context, pillX, item.top, PILL_WIDTH, item.bottom - item.top, 5);
      context.fill();
      if (event.selected) {
        context.strokeStyle = primary;
        context.lineWidth = 2;
        context.stroke();
      }
      if (item.thumbnailTop !== null && this.timelineConfig?.scrubber?.thumbnails !== false) {
        // A level line from the middle of the pill to its thumbnail.
        context.fillStyle = secondary;
        context.globalAlpha = 0.5;
        context.fillRect(
          pillX + PILL_WIDTH + 2,
          Math.round(item.anchor),
          THUMBNAIL_X - pillX - PILL_WIDTH - 2,
          1,
        );
        context.globalAlpha = 1;
      }
    }
  }

  private _roundRect(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
  ): void {
    const r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + width, y, x + width, y + height, r);
    context.arcTo(x + width, y + height, x, y + height, r);
    context.arcTo(x, y + height, x, y, r);
    context.arcTo(x, y, x + width, y, r);
    context.closePath();
  }

  static get styles(): CSSResultGroup {
    return unsafeCSS(scrubberStyle);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'advanced-camera-card-scrubber': AdvancedCameraCardScrubber;
  }
}
