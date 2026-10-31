import { describe, expect, it } from 'vitest';

import { getReviewedQueryFilterFromConfig } from '../../../src/view/utils/query-filter';

describe('query-filter', () => {
  describe('getReviewedQueryFilterFromConfig', () => {
    it('should return true for reviewed', () => {
      expect(getReviewedQueryFilterFromConfig('reviewed')).toBe(true);
    });

    it('should return undefined for all', () => {
      expect(getReviewedQueryFilterFromConfig('all')).toBeUndefined();
      expect(getReviewedQueryFilterFromConfig(undefined)).toBe(false);
    });

    it('should return false for unreviewed', () => {
      expect(getReviewedQueryFilterFromConfig('unreviewed')).toBe(false);
    });
  });
});
