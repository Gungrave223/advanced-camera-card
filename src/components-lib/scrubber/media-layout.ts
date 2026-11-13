// Helpers for fitting the scrubber around the video without changing the
// card's own components: they look through the components that share the
// scrubber's surround (into shadow roots and slots).

const MEDIA_CAROUSEL_TAGS = new Set([
  'ADVANCED-CAMERA-CARD-LIVE-CAROUSEL',
  'ADVANCED-CAMERA-CARD-VIEWER-CAROUSEL',
]);

// Upper bound on elements visited, so a very large tree cannot stall a frame.
const MAX_VISITED = 5000;

/**
 * Visit elements under the roots, crossing into shadow roots and following
 * slots to their assigned elements.
 */
export const walkComposedTree = (
  roots: Element[],
  visit: (element: Element) => void,
): void => {
  const stack = [...roots];
  const seen = new Set<Element>();
  while (stack.length && seen.size < MAX_VISITED) {
    const element = stack.pop();
    if (!element || seen.has(element)) {
      continue;
    }
    seen.add(element);
    visit(element);

    stack.push(...Array.from(element.children));
    if (element.shadowRoot) {
      stack.push(...Array.from(element.shadowRoot.children));
    }
    if (element instanceof HTMLSlotElement) {
      stack.push(...element.assignedElements({ flatten: true }));
    }
  }
};

/**
 * The shape (height / width) of the main video or image, taken from the
 * largest visible one at least half as wide as the container (so thumbnails
 * are ignored). Null if none is found yet.
 */
export const findMediaAspect = (roots: Element[], containerWidth: number): number | null => {
  let best: { area: number; aspect: number } | null = null;
  walkComposedTree(roots, (element) => {
    let width = 0;
    let height = 0;
    if (element instanceof HTMLVideoElement) {
      width = element.videoWidth;
      height = element.videoHeight;
    } else if (element instanceof HTMLImageElement) {
      width = element.naturalWidth;
      height = element.naturalHeight;
    } else if (element instanceof HTMLCanvasElement) {
      width = element.width;
      height = element.height;
    } else {
      return;
    }
    if (!width || !height) {
      return;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width < containerWidth / 2 || !rect.height) {
      return;
    }
    const area = rect.width * rect.height;
    if (!best || area > best.area) {
      best = { area, aspect: height / width };
    }
  });
  return (best as { area: number; aspect: number } | null)?.aspect ?? null;
};

/**
 * The live and clip carousels cap their own height at the height of their
 * media, and only re-measure when media loads, so they do not grow into extra
 * room (the video then sits off-center). Lifting the cap lets them grow; the
 * card's own resize handling then measures and caps them again at the new
 * size.
 */
export const releaseMediaCarouselHeights = (roots: Element[]): number => {
  let released = 0;
  walkComposedTree(roots, (element) => {
    if (
      MEDIA_CAROUSEL_TAGS.has(element.tagName) &&
      element instanceof HTMLElement &&
      element.style.maxHeight
    ) {
      element.style.maxHeight = '';
      released++;
    }
  });
  return released;
};
