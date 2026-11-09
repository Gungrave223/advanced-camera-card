import {
  html,
  LitElement,
  unsafeCSS,
  type CSSResultGroup,
  type PropertyValues,
  type TemplateResult,
} from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { guard } from 'lit/directives/guard.js';
import { createRef, ref, type Ref } from 'lit/directives/ref.js';

import type { CameraManager } from '../../camera-manager/manager.js';
import { QueryType } from '../../camera-manager/types.js';
import type { ViewManagerEpoch } from '../../card-controller/view/types.js';
import { LazyLoadController } from '../../components-lib/lazy-load-controller.js';
import { MediaLoadWatchdogController } from '../../components-lib/media-load-watchdog-controller.js';
import { MediaStartPositionController } from '../../components-lib/media-start-position-controller.js';
import { ResolvedMediaController } from '../../components-lib/resolved-media-controller.js';
import {
  getSignedURLErrorText,
  SignedURLController,
} from '../../components-lib/signed-url-controller.js';
import type { ZoomSettingsObserved } from '../../components-lib/zoom/types.js';
import { handleZoomSettingsObservedEvent } from '../../components-lib/zoom/zoom-view-context.js';
import type { CameraConfig } from '../../config/schema/cameras.js';
import type { CardWideConfig } from '../../config/schema/types.js';
import type { ViewerConfig } from '../../config/schema/viewer.js';
import { canonicalizeHAURL } from '../../ha/canonical-url.js';
import { isHARelativeURL } from '../../ha/is-ha-relative-url.js';
import type { ResolvedMediaCache } from '../../ha/resolved-media.js';
import type { HomeAssistant } from '../../ha/types.js';

import '../../patches/ha-hls-player.js';

import viewerProviderStyle from '../../scss/viewer-provider.scss?inline';

import '../icon.js';
import './footage-time.js';

import { localize } from '../../localize/localize.js';
import type {
  MediaPlayer,
  MediaPlayerController,
  MediaPlayerElement,
} from '../../types.js';
import { classifyMimeType, type MimeTypeClassification } from '../../utils/mime-type.js';
import { stopEventFromActivatingCardWideActions } from '../../utils/action.js';
import { togglePlayback } from '../../utils/playback.js';
import { Timer } from '../../utils/timer.js';
import { ViewItemClassifier } from '../../view/item-classifier.js';
import type { ViewMedia } from '../../view/item.js';
import { UnifiedQueryTransformer } from '../../view/unified-query-transformer.js';

import '../image-player.js';

import { renderNotificationBlockFromText } from '../notification/block.js';
import { renderProgressIndicator } from '../progress-indicator.js';

import '../video-player.js';
import './../media-dimensions-container';

const PLAYBACK_ICON_RESUME_SECONDS = 0.8;

@customElement('advanced-camera-card-viewer-provider')
export class AdvancedCameraCardViewerProvider extends LitElement implements MediaPlayer {
  @property({ attribute: false })
  public hass?: HomeAssistant;

  @property({ attribute: false })
  public viewManagerEpoch?: ViewManagerEpoch;

  @property({ attribute: false })
  public media?: ViewMedia;

  @property({ attribute: false })
  public viewerConfig?: ViewerConfig;

  @property({ attribute: false })
  public resolvedMediaCache?: ResolvedMediaCache;

  @property({ attribute: false })
  public cameraManager?: CameraManager;

  @property({ attribute: false })
  public cardWideConfig?: CardWideConfig;

  // Whether to force this slide to behave as if it is selected and
  // intersecting. Set by the carousel on its currently-selected slide. This is
  // necessary: `render` below draws nothing until the slide has loaded, and a
  // slide drawing nothing can have no height for IntersectionObserver to see.
  // Left to the observer only, the slide would wait to be seen before drawing
  // anything there was to see. See `LazyLoadConfiguration.forceSelected`.
  @property({ attribute: false })
  public forceSelected = false;

  private _refProvider: Ref<MediaPlayerElement> = createRef();

  // Neighboring slides are also loaded, but only the visible one is playing.
  private _getPosition = async (): Promise<number | null> => {
    const selected = this.viewManagerEpoch?.manager
      .getView()
      ?.queryResults?.getSelectedResult();
    return selected?.getID() === this.media?.getID()
      ? (await this.getMediaPlayerController())?.getCurrentTime?.() ?? null
      : null;
  };
  private _lazyLoadController: LazyLoadController = new LazyLoadController(this);

  // Lit runs controllers in declaration order: resolve first, since signing and
  // the start position both read the resolved media.
  private _resolvedMediaController = new ResolvedMediaController(this, () => ({
    hass: this.hass,
    contentID: this._shouldLoad() ? this.media?.getContentID() ?? null : null,
    cache: this.resolvedMediaCache,
  }));

  private _signedURLController = new SignedURLController(this, () => {
    const resolvedMedia = this._resolvedMediaController.getValue();
    if (!this.hass || !resolvedMedia) {
      return {};
    }
    // HA-relative URLs need no proxying or signing.
    if (isHARelativeURL(resolvedMedia.url)) {
      return {
        endpoint: { endpoint: canonicalizeHAURL(this.hass, resolvedMedia.url) },
      };
    }
    const cameraID = this.media?.getCameraID();
    const camera = cameraID ? this.cameraManager?.getStore().getCamera(cameraID) : null;
    return {
      hass: this.hass,
      endpoint: { endpoint: resolvedMedia.url },
      proxyConfig: camera?.getMediaProxyConfig(),
    };
  });

  // Only HLS media is given a start position: the HLS player is the one that
  // can start loading part way through.
  private _mediaStartPositionController = new MediaStartPositionController(this, () => ({
    cameraManager: this.cameraManager,
    view: this.viewManagerEpoch?.manager.getView() ?? undefined,
    media: this._shouldLoad() && this._classifyMedia().isHLS ? this.media : undefined,
  }));

  constructor() {
    super();

    // Watch for media load failure (including resolving media ID and signing).
    new MediaLoadWatchdogController(this, {
      getTargetID: () => this.media?.getID() ?? null,
      isLoadExpected: () => this._shouldLoad(),
    });
  }

  // Paused stays on screen, as a frozen picture is otherwise easily missed.
  // Resuming only needs a brief confirmation.
  @state()
  private _playbackIcon: 'mdi:play' | 'mdi:pause' | null = null;
  private _playbackIconTimer = new Timer();

  private _playHandler = (): void => {
    this._playbackIconTimer.stop();
    if (this._playbackIcon) {
      this._playbackIcon = 'mdi:pause';
      this._playbackIconTimer.start(PLAYBACK_ICON_RESUME_SECONDS, () => {
        this._playbackIcon = null;
      });
    }
  };

  connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener('click', this._tapHandler);
    this.addEventListener('advanced-camera-card:media:play', this._playHandler);
  }

  disconnectedCallback(): void {
    this._playbackIconTimer.stop();
    this.removeEventListener('click', this._tapHandler);
    this.removeEventListener('advanced-camera-card:media:play', this._playHandler);
    super.disconnectedCallback();
  }

  private _backToLive(ev: Event): void {
    // This sits on the video, where a tap would otherwise also pause playback.
    ev.stopPropagation();
    stopEventFromActivatingCardWideActions(ev);
    void this.viewManagerEpoch?.manager.setViewByParametersWithNewQuery({
      params: { view: 'live' },
    });
  }

  private _tapHandler = async (): Promise<void> => {
    if (this.viewerConfig?.controls.tap_to_play_pause) {
      const controller = await this.getMediaPlayerController();
      await togglePlayback(controller);

      // Only a tap sets this: the card also pauses media itself while scrubbing,
      // which would otherwise make the icon flicker.
      if (controller?.playback?.isPaused()) {
        this._playbackIconTimer.stop();
        this._playbackIcon = 'mdi:play';
      }
    }
  };

  public async getMediaPlayerController(): Promise<MediaPlayerController | null> {
    await this.updateComplete;
    return (await this._refProvider.value?.getMediaPlayerController()) ?? null;
  }

  private async _switchToRelatedClipView(): Promise<void> {
    const view = this.viewManagerEpoch?.manager.getView();
    if (
      !this.hass ||
      !view ||
      !this.cameraManager ||
      !this.media ||
      // If this specific media item has no clip, then do nothing (even if all
      // the other media items do).
      !ViewItemClassifier.isEvent(this.media) ||
      !view.query?.hasMediaQueriesOfType(QueryType.Event)
    ) {
      return;
    }

    // Convert the query to a clips equivalent.
    const clipQuery = UnifiedQueryTransformer.convertToClips(view.query);

    await this.viewManagerEpoch?.manager.setViewByParametersWithExistingQuery({
      params: {
        view: 'media',
        query: clipQuery,
      },
      queryExecutorOptions: {
        selectResult: {
          id: this.media.getID() ?? undefined,
        },
        rejectResults: (results) => !results.hasSelectedResult(),
      },
    });
  }

  protected willUpdate(changedProps: PropertyValues): void {
    if (changedProps.has('viewerConfig') || changedProps.has('forceSelected')) {
      this._lazyLoadController.setConfiguration({
        lazyLoad: this.viewerConfig?.lazy_load,
        forceSelected: this.forceSelected,
      });
    }

    if (changedProps.has('viewerConfig') && this.viewerConfig?.zoomable) {
      void import('../zoomer.js');
    }
  }

  private _shouldLoad(): boolean {
    return this._lazyLoadController.isLoaded();
  }

  private _classifyMedia(): MimeTypeClassification {
    return classifyMimeType(this._resolvedMediaController.getValue()?.mime_type);
  }

  private _getRelevantCameraConfig(): CameraConfig | null {
    const cameraID = this.media?.getCameraID();
    return cameraID
      ? this.cameraManager?.getStore().getCameraConfig(cameraID) ?? null
      : null;
  }

  private _renderContainer(template: TemplateResult): TemplateResult {
    if (!this.media) {
      return template;
    }
    const cameraID = this.media.getCameraID();
    const mediaID = this.media.getID() ?? undefined;
    const cameraConfig = cameraID
      ? this.cameraManager?.getStore().getCameraConfig(cameraID) ?? null
      : null;
    const view = this.viewManagerEpoch?.manager.getView();

    const intermediateTemplate = html` <advanced-camera-card-media-dimensions-container
      .dimensionsConfig=${this._getRelevantCameraConfig()?.dimensions}
    >
      ${template}
    </advanced-camera-card-media-dimensions-container>`;

    return html`
      ${this.viewerConfig?.zoomable
        ? html`<advanced-camera-card-zoomer
            .defaultSettings=${guard([cameraConfig?.dimensions?.layout], () =>
              cameraConfig?.dimensions?.layout
                ? {
                    pan: cameraConfig.dimensions.layout.pan,
                    zoom: cameraConfig.dimensions.layout.zoom,
                  }
                : undefined,
            )}
            .settings=${mediaID ? view?.context?.zoom?.[mediaID]?.requested : undefined}
            @advanced-camera-card:zoom:zoomed=${async () =>
              (await this.getMediaPlayerController())?.setControls(false)}
            @advanced-camera-card:zoom:unzoomed=${async () =>
              (await this.getMediaPlayerController())?.setControls()}
            @advanced-camera-card:zoom:change=${(
              ev: CustomEvent<ZoomSettingsObserved>,
            ) =>
              handleZoomSettingsObservedEvent(
                ev,
                this.viewManagerEpoch?.manager,
                mediaID,
              )}
          >
            ${intermediateTemplate}
          </advanced-camera-card-zoomer>`
        : intermediateTemplate}
    `;
  }

  protected render(): TemplateResult | void {
    if (!this._shouldLoad() || !this.media || !this.hass || !this.viewerConfig) {
      return;
    }

    const error = this._signedURLController.getError();
    if (error) {
      const contentID = this.media?.getContentID();
      return renderNotificationBlockFromText(getSignedURLErrorText(error), {
        ...(contentID && { metadata: [{ text: contentID, icon: 'mdi:identifier' }] }),
      });
    }

    const { isHLS, isVideo } = this._classifyMedia();

    // The HLS player waits for its start position: hls.js starts loading as
    // soon as the player is created, and without the position it would download
    // the start of the stream only for the carousel to seek away from it.
    const url = this._signedURLController.getValue();
    if (!url || this._mediaStartPositionController.isPending()) {
      return renderProgressIndicator({
        cardWideConfig: this.cardWideConfig,
      });
    }

    // Note: crossorigin="anonymous" is required on <video> below in order to
    // allow screenshot of motionEye videos which currently go cross-origin.
    const mediaID = this.media.getID() ?? undefined;
    const startPosition = this._mediaStartPositionController.getValue() ?? undefined;

    return html`${this._renderContainer(html`
        ${isVideo
          ? isHLS
            ? html`<advanced-camera-card-ha-hls-player
                ${ref(this._refProvider)}
                allow-exoplayer
                aria-label="${this.media.getTitle() ?? ''}"
                ?autoplay=${false}
                controls
                muted
                playsinline
                title="${this.media.getTitle() ?? ''}"
                url=${url}
                .hass=${this.hass}
                .startPosition=${startPosition}
                .targetID=${mediaID}
                ?controls=${this.viewerConfig.controls.builtin}
              >
              </advanced-camera-card-ha-hls-player>`
            : html`
                <advanced-camera-card-video-player
                  ${ref(this._refProvider)}
                  url=${url}
                  aria-label="${this.media.getTitle() ?? ''}"
                  title="${this.media.getTitle() ?? ''}"
                  .targetID=${mediaID}
                  ?controls=${this.viewerConfig.controls.builtin}
                >
                </advanced-camera-card-video-player>
              `
          : html`<advanced-camera-card-image-player
              ${ref(this._refProvider)}
              url="${url}"
              aria-label="${this.media.getTitle() ?? ''}"
              title="${this.media.getTitle() ?? ''}"
              .targetID=${mediaID}
              @click=${() => {
                if (this.viewerConfig?.snapshot_click_plays_clip) {
                  void this._switchToRelatedClipView();
                }
              }}
            ></advanced-camera-card-image-player>`}
      `)}
      <advanced-camera-card-viewer-footage-time
        .media=${this.media}
        .cameraManager=${this.cameraManager}
        .getPosition=${this._getPosition}
        .showTime=${this.viewerConfig?.controls.footage_time ?? true}
        .showLabels=${this.viewerConfig?.controls.event_tags ?? true}
      ></advanced-camera-card-viewer-footage-time>
      ${isVideo && this.viewerConfig?.controls.back_to_live
        ? html`<button
            class="back-to-live"
            @click=${(ev: Event) => this._backToLive(ev)}
          >
            ${localize('media_viewer.back_to_live')}
          </button>`
        : ''}
      ${isVideo && this.viewerConfig?.controls.tap_to_play_pause && this._playbackIcon
        ? html`<advanced-camera-card-icon
            class="playback-state"
            .icon=${{ icon: this._playbackIcon }}
          ></advanced-camera-card-icon>`
        : ''}`;
  }

  static get styles(): CSSResultGroup {
    return unsafeCSS(viewerProviderStyle);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'advanced-camera-card-viewer-provider': AdvancedCameraCardViewerProvider;
  }
}
