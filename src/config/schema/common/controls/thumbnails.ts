import { z } from 'zod';

export const THUMBNAIL_SIZE_MIN = 75;
export const THUMBNAIL_SIZE_DEFAULT = 100;
export const THUMBNAIL_SIZE_MAX = 300;

const thumbnailStyleSchema = z.enum(['auto', 'plain', 'overlay', 'hover', 'panel']);
export type ThumbnailStyle = z.infer<typeof thumbnailStyleSchema>;

export const thumbnailsControlBaseDefaults = {
  size: THUMBNAIL_SIZE_DEFAULT,
  style: 'auto' as const,
  show_favorite_control: true,
  show_timeline_control: false,
  show_download_control: false,
  show_info_control: true,
  show_duration: false,
};

// Configuration for the actual rendered thumbnail.
export const thumbnailsControlBaseSchema = z.object({
  size: z
    .number()
    .min(THUMBNAIL_SIZE_MIN)
    .max(THUMBNAIL_SIZE_MAX)
    .default(thumbnailsControlBaseDefaults.size),
  style: thumbnailStyleSchema.default(thumbnailsControlBaseDefaults.style),
  show_favorite_control: z
    .boolean()
    .default(thumbnailsControlBaseDefaults.show_favorite_control),
  show_timeline_control: z
    .boolean()
    .default(thumbnailsControlBaseDefaults.show_timeline_control),
  show_download_control: z
    .boolean()
    .default(thumbnailsControlBaseDefaults.show_download_control),
  show_info_control: z
    .boolean()
    .default(thumbnailsControlBaseDefaults.show_info_control),

  // Whether the details panel shows how long the media lasted.
  show_duration: z.boolean().default(thumbnailsControlBaseDefaults.show_duration),
});
export type ThumbnailsControlBaseConfig = z.infer<typeof thumbnailsControlBaseSchema>;

export const thumbnailsControlDefaults = {
  ...thumbnailsControlBaseDefaults,
  mode: 'right' as const,
  order: 'newest_first' as const,
  start_offset: 2,
};

export const thumbnailsControlSchema = thumbnailsControlBaseSchema.extend({
  mode: z
    .enum(['none', 'above', 'below', 'left', 'right'])
    .default(thumbnailsControlDefaults.mode),

  // The order of the thumbnails in the carousel.
  order: z
    .enum(['newest_first', 'oldest_first'])
    .default(thumbnailsControlDefaults.order),

  // How many thumbnails' worth of space to leave above a vertical (left or
  // right) carousel's first thumbnail.
  start_offset: z.number().int().min(0).max(10).default(thumbnailsControlDefaults.start_offset),
});
export type ThumbnailsControlConfig = z.infer<typeof thumbnailsControlSchema>;
