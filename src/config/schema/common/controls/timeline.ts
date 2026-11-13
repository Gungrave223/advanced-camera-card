import { z } from 'zod';

export const timelineCoreConfigDefault = {
  clustering_threshold: 3,
  window_seconds: 60 * 60,
  show_recordings: true,
  style: 'stack' as const,
  format: {
    '24h': true,
  },
};

const timelinePanModeSchema = z.enum(['pan', 'seek', 'seek-in-media', 'seek-in-camera']);
export type TimelinePanMode = z.infer<typeof timelinePanModeSchema>;

const timelineFormatSchema = z.object({
  '24h': z.boolean().optional().default(timelineCoreConfigDefault.format['24h']),
});

export const timelineCoreConfigSchema = z.object({
  clustering_threshold: z
    .number()
    .optional()
    .default(timelineCoreConfigDefault.clustering_threshold),
  window_seconds: z
    .number()
    .min(1 * 60)
    .max(24 * 60 * 60)
    .optional()
    .default(timelineCoreConfigDefault.window_seconds),
  show_recordings: z
    .boolean()
    .optional()
    .default(timelineCoreConfigDefault.show_recordings),
  style: z.enum(['stack', 'ribbon']).optional().default(timelineCoreConfigDefault.style),
  format: timelineFormatSchema.optional().default(timelineCoreConfigDefault.format),
});
type TimelineCoreConfig = z.infer<typeof timelineCoreConfigSchema>;

export const miniTimelineConfigDefault = {
  ...timelineCoreConfigDefault,
  mode: 'none' as const,

  // The non-`pan` modes seek within playing media, so `pan_mode` only applies
  // to a mini timeline shown alongside media.
  pan_mode: 'pan' as const,

  // Mini-timeline defaults to ribbon style.
  style: 'ribbon' as const,
};

// Options for the `scrubber` style (a separate, vertical timeline). Kept out of
// the mini timeline defaults so cards not using it are unchanged.
export const scrubberConfigDefault = {
  height: 280,
  thumbnails: true,
};

const scrubberConfigSchema = z.object({
  height: z
    .number()
    .min(100)
    .max(2000)
    .optional()
    .default(scrubberConfigDefault.height),
  thumbnails: z
    .boolean()
    .optional()
    .default(scrubberConfigDefault.thumbnails),
});
export type ScrubberConfig = z.infer<typeof scrubberConfigSchema>;

export const miniTimelineConfigSchema = timelineCoreConfigSchema.extend({
  mode: z.enum(['none', 'above', 'below']).default(miniTimelineConfigDefault.mode),
  pan_mode: timelinePanModeSchema.optional().default(miniTimelineConfigDefault.pan_mode),
  // `scrubber` swaps in a separate vertical timeline component; the other
  // styles keep the original timeline.
  style: z
    .enum(['stack', 'ribbon', 'scrubber'])
    .optional()
    .default(miniTimelineConfigDefault.style),
  // Optional with no default, so cards not using the scrubber are unchanged.
  scrubber: scrubberConfigSchema.optional(),
});
export type MiniTimelineControlConfig = z.infer<typeof miniTimelineConfigSchema>;

// The config consumed by the shared `timeline-core` component: the core fields,
// plus the mini-only extras (`pan_mode` etc.) made optional since the full
// timeline omits them.
export type TimelineCoreComponentConfig = TimelineCoreConfig &
  Partial<MiniTimelineControlConfig>;
