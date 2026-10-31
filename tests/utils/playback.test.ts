import { describe, expect, it } from 'vitest';
import { mock } from 'vitest-mock-extended';

import type { MediaPlayerController, PlaybackControl } from '../../src/types';
import { togglePlayback } from '../../src/utils/playback';

describe('togglePlayback', () => {
  const createController = (paused: boolean) => {
    const playback = mock<PlaybackControl>();
    playback.isPaused.mockReturnValue(paused);
    const controller = mock<MediaPlayerController>();
    controller.playback = playback;
    return { controller, playback };
  };

  it('should play paused media', async () => {
    const { controller, playback } = createController(true);
    await togglePlayback(controller);
    expect(playback.play).toHaveBeenCalled();
    expect(playback.pause).not.toHaveBeenCalled();
  });

  it('should pause playing media', async () => {
    const { controller, playback } = createController(false);
    await togglePlayback(controller);
    expect(playback.pause).toHaveBeenCalled();
    expect(playback.play).not.toHaveBeenCalled();
  });

  it('should ignore media that cannot be paused', async () => {
    const controller = mock<MediaPlayerController>();
    controller.playback = undefined;
    await expect(togglePlayback(controller)).resolves.toBeUndefined();
    await expect(togglePlayback(null)).resolves.toBeUndefined();
  });
});
