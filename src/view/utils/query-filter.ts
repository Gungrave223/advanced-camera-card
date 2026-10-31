import type { CameraMediaReviewedFilter } from '../../config/schema/cameras';

/**
 * Convert a reviewed config value to a boolean filter.
 * @param reviewed The config value ('reviewed', 'all', 'unreviewed' or undefined)
 * @returns true (reviewed only), false (unreviewed only), or undefined (all)
 */
export function getReviewedQueryFilterFromConfig(
  reviewed?: CameraMediaReviewedFilter,
): boolean | undefined {
  return reviewed === 'reviewed' ? true : reviewed === 'all' ? undefined : false;
}
