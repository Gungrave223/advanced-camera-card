import type { ViewItemManager } from '../card-controller/view/item-manager';
import { RemoveContextViewModifier } from '../card-controller/view/modifiers/remove-context';
import type { ViewManagerEpoch } from '../card-controller/view/types';
import type { ViewItem } from '../view/item';
import { ViewItemClassifier } from '../view/item-classifier';
import { errorToConsole } from './basic';

export async function toggleFavorite(
  item: ViewItem,
  viewItemManager?: ViewItemManager,
): Promise<boolean> {
  if (!ViewItemClassifier.isMedia(item) || !viewItemManager) {
    return false;
  }

  const newState = !item.isFavorite();
  try {
    await viewItemManager.favorite(item, newState);
  } catch (e) {
    errorToConsole(e);
    return false;
  }
  return true;
}

export async function downloadMedia(
  item: ViewItem,
  viewItemManager?: ViewItemManager,
): Promise<boolean> {
  if (!viewItemManager) {
    return false;
  }

  try {
    await viewItemManager.download(item);
  } catch (e) {
    errorToConsole(e);
    return false;
  }
  return true;
}

export function navigateToTimeline(
  item: ViewItem,
  viewManagerEpoch?: ViewManagerEpoch,
): void {
  if (!viewManagerEpoch) {
    return;
  }

  viewManagerEpoch.manager.setViewByParameters({
    params: {
      view: 'timeline',
      queryResults: viewManagerEpoch.manager
        .getView()
        ?.queryResults?.clone()
        .selectResultIfFound((media) => media === item),
    },
    modifiers: [new RemoveContextViewModifier(['timeline'])],
  });
}
