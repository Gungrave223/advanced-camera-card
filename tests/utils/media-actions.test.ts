import { describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import type { ViewItemManager } from '../../src/card-controller/view/item-manager';
import { RemoveContextViewModifier } from '../../src/card-controller/view/modifiers/remove-context';
import type { ViewManagerEpoch } from '../../src/card-controller/view/types';
import type { ViewManager } from '../../src/card-controller/view/view-manager';
import {
  downloadMedia,
  navigateToTimeline,
  showMediaInfoNotification,
  toggleFavorite,
} from '../../src/utils/media-actions';
import { ViewMediaType, type ViewItem } from '../../src/view/item';
import { QueryResults } from '../../src/view/query-results';
import type { View } from '../../src/view/view';
import { createView, TestViewMedia } from '../view/test-utils';

const createViewManagerWithResults = (
  results: ViewItem[],
): { viewManager: ViewManager; viewManagerEpoch: ViewManagerEpoch } => {
  const viewManager = mock<ViewManager>();
  const viewManagerEpoch = mock<ViewManagerEpoch>();
  const view = mock<View>();

  viewManagerEpoch.manager = viewManager;
  viewManager.getView.mockReturnValue(view);
  view.queryResults = new QueryResults({ results });

  return { viewManager, viewManagerEpoch };
};

const getQueryResultsAfterModifiers = (
  viewManager: ViewManager,
): QueryResults | null => {
  const modifiers = vi.mocked(viewManager.setViewWithModifiers).mock.calls[0]?.[0] ?? [];
  const view = createView({
    queryResults: viewManager.getView()?.queryResults?.clone() ?? null,
  });
  modifiers.forEach((modifier) => modifier.modify(view));
  return view.queryResults;
};

describe('MediaActions', () => {
  describe('toggleFavorite', () => {
    it('should return false if item is not media', async () => {
      const viewItemManager = mock<ViewItemManager>();

      expect(await toggleFavorite(null as unknown as ViewItem, viewItemManager)).toBe(
        false,
      );
    });

    it('should return false if manager is missing', async () => {
      const item = new TestViewMedia({ mediaType: ViewMediaType.Clip });

      expect(await toggleFavorite(item)).toBe(false);
    });

    it('should toggle favorite status', async () => {
      const item = new TestViewMedia({
        mediaType: ViewMediaType.Clip,
        favorite: false,
      });
      const viewItemManager = mock<ViewItemManager>();

      expect(await toggleFavorite(item, viewItemManager)).toBe(true);
      expect(viewItemManager.favorite).toHaveBeenCalledWith(item, true);
    });

    it('should update the item in the view', async () => {
      const item = new TestViewMedia({
        id: 'clip-1',
        mediaType: ViewMediaType.Clip,
        favorite: false,
      });
      const viewItemManager = mock<ViewItemManager>();
      const { viewManager, viewManagerEpoch } = createViewManagerWithResults([item]);

      expect(await toggleFavorite(item, viewItemManager, viewManagerEpoch)).toBe(true);

      const results = getQueryResultsAfterModifiers(viewManager)?.getResults();
      expect(results?.[0]).not.toBe(item);
      expect(results?.[0]?.getID()).toBe('clip-1');
    });

    it('should remove an un-favorited item from a favorites-only gallery', async () => {
      const item = new TestViewMedia({
        id: 'clip-1',
        mediaType: ViewMediaType.Clip,
        favorite: true,
      });
      const other = new TestViewMedia({ id: 'clip-2', mediaType: ViewMediaType.Clip });
      const viewItemManager = mock<ViewItemManager>();
      const { viewManager, viewManagerEpoch } = createViewManagerWithResults([
        item,
        other,
      ]);

      expect(await toggleFavorite(item, viewItemManager, viewManagerEpoch, true)).toBe(
        true,
      );

      expect(viewItemManager.favorite).toHaveBeenCalledWith(item, false);
      expect(getQueryResultsAfterModifiers(viewManager)?.getResults()).toEqual([other]);
    });

    it('should keep a favorited item in a favorites-only gallery', async () => {
      const item = new TestViewMedia({
        id: 'clip-1',
        mediaType: ViewMediaType.Clip,
        favorite: false,
      });
      const viewItemManager = mock<ViewItemManager>();
      const { viewManager, viewManagerEpoch } = createViewManagerWithResults([item]);

      expect(await toggleFavorite(item, viewItemManager, viewManagerEpoch, true)).toBe(
        true,
      );

      const results = getQueryResultsAfterModifiers(viewManager)?.getResults();
      expect(results?.[0]).not.toBe(item);
      expect(results?.[0]?.getID()).toBe('clip-1');
    });

    it('should handle manager error', async () => {
      const item = new TestViewMedia({
        mediaType: ViewMediaType.Clip,
        favorite: false,
      });
      const viewItemManager = mock<ViewItemManager>();
      const error = new Error('fail');
      viewItemManager.favorite.mockRejectedValue(error);

      const consoleSpy = vi.spyOn(console, 'warn');

      expect(await toggleFavorite(item, viewItemManager)).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith(error.message);

      consoleSpy.mockRestore();
    });
  });

  describe('downloadMedia', () => {
    it('should return false if manager is missing', async () => {
      const item = new TestViewMedia({ mediaType: ViewMediaType.Clip });

      expect(await downloadMedia(item)).toBe(false);
    });

    it('should download media', async () => {
      const item = new TestViewMedia({ mediaType: ViewMediaType.Clip });
      const viewItemManager = mock<ViewItemManager>();

      expect(await downloadMedia(item, viewItemManager)).toBe(true);
      expect(viewItemManager.download).toHaveBeenCalledWith(item);
    });

    it('should handle manager error', async () => {
      const item = new TestViewMedia({ mediaType: ViewMediaType.Clip });
      const viewItemManager = mock<ViewItemManager>();
      const error = new Error('fail');
      viewItemManager.download.mockRejectedValue(error);

      const consoleSpy = vi.spyOn(console, 'warn');

      expect(await downloadMedia(item, viewItemManager)).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith(error.message);

      consoleSpy.mockRestore();
    });
  });

  describe('showMediaInfo', () => {
    it('should dispatch an action to open a notification', () => {
      const host = mock<HTMLElement>();
      const item = new TestViewMedia({
        mediaType: ViewMediaType.Clip,
        what: ['person'],
      });

      showMediaInfoNotification(host, item, {});

      expect(host.dispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: expect.objectContaining({
            actions: [
              expect.objectContaining({
                notification: expect.objectContaining({
                  heading: expect.objectContaining({ text: 'Person' }),
                }),
              }),
            ],
          }),
        }),
      );
    });
  });

  describe('navigateToTimeline', () => {
    it('should return early if epoch is missing', () => {
      const item = new TestViewMedia({ mediaType: ViewMediaType.Clip });

      expect(navigateToTimeline(item)).toBeUndefined();
    });

    it('should navigate to timeline with correct parameters', () => {
      const item = new TestViewMedia({ mediaType: ViewMediaType.Clip });
      const viewManagerEpoch = mock<ViewManagerEpoch>();
      const viewManager = mock<ViewManager>();
      const view = mock<View>();
      const queryResults = mock<QueryResults>();

      viewManagerEpoch.manager = viewManager;
      viewManager.getView.mockReturnValue(view);
      view.queryResults = queryResults;
      queryResults.clone.mockReturnValue(queryResults);

      // Make selectResultIfFound call the predicate to gain coverage.
      queryResults.selectResultIfFound.mockImplementation((predicate) => {
        predicate(item);
        return queryResults;
      });

      navigateToTimeline(item, viewManagerEpoch);

      expect(viewManager.setViewByParameters).toHaveBeenCalledWith({
        params: {
          view: 'timeline',
          queryResults: queryResults,
        },
        modifiers: [expect.any(RemoveContextViewModifier)],
      });
    });

    it('should handle missing view/queryResults during navigation', () => {
      const item = new TestViewMedia({ mediaType: ViewMediaType.Clip });
      const viewManagerEpoch = mock<ViewManagerEpoch>();
      const viewManager = mock<ViewManager>();

      viewManagerEpoch.manager = viewManager;
      viewManager.getView.mockReturnValue(null);

      navigateToTimeline(item, viewManagerEpoch);

      expect(viewManager.setViewByParameters).toHaveBeenCalledWith({
        params: {
          view: 'timeline',
          queryResults: undefined,
        },
        modifiers: [new RemoveContextViewModifier(['timeline'])],
      });
    });
  });
});
