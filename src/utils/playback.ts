import type { MediaPlayerController } from '../types';

export const togglePlayback = async (
  controller?: MediaPlayerController | null,
): Promise<void> => {
  const playback = controller?.playback;
  if (playback) {
    await (playback.isPaused() ? playback.play() : playback.pause());
  }
};
