import { PRODUCT_MARKER_PATTERN } from '../prompt-builder/promptBuilder.service.js';

/**
 * Reading the product markers back out of a generated draft.
 *
 * The author wrote `[[product:12]]` on its own line where a product belongs.
 * This finds those lines, works out which heading each fell under, and
 * discards anything that is not a product the editor actually attached.
 *
 * That last rule matters: a model that invents `[[product:999]]` must not
 * cause a card for a product that does not exist, and a model that repeats a
 * marker must not produce the same card twice. Both are handled by dropping
 * the marker, never by inventing a product to match it.
 */

export interface FoundPlacement {
  productId: number;
  /** The nearest heading above the marker, which is where the product ended up. */
  section: string | null;
  /** 0-based line index in the body. */
  line: number;
}

export interface PlacementScan {
  placements: FoundPlacement[];
  /** Markers naming a product not attached to this article, or repeating one already placed. */
  discarded: { productId: number; reason: string }[];
}

/**
 * Finds every valid product marker in a generated body.
 *
 * `allowedProductIds` is the set the prompt offered. Anything outside it is
 * discarded and reported rather than silently ignored, so a model that
 * hallucinates an id is visible instead of merely ineffective.
 */
export function scanProductPlacements(body: string, allowedProductIds: Iterable<number>): PlacementScan {
  const allowed = new Set(allowedProductIds);
  const placements: FoundPlacement[] = [];
  const discarded: { productId: number; reason: string }[] = [];
  const placed = new Set<number>();

  let currentHeading: string | null = null;

  body.replace(/\r\n/g, '\n').split('\n').forEach((line, index) => {
    const heading = /^\s*(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      currentHeading = heading[2].trim() || null;
      return;
    }

    const marker = PRODUCT_MARKER_PATTERN.exec(line);
    if (!marker) return;

    const productId = Number(marker[1]);
    if (!allowed.has(productId)) {
      discarded.push({ productId, reason: 'Not a product attached to this article.' });
      return;
    }
    if (placed.has(productId)) {
      discarded.push({ productId, reason: 'Already placed earlier in the article.' });
      return;
    }

    placed.add(productId);
    placements.push({ productId, section: currentHeading, line: index });
  });

  return { placements, discarded };
}

/**
 * Removes markers that will never render — the invented ids and the repeats.
 *
 * Valid markers are left exactly where the author put them, because they are
 * what the renderer turns into cards. Only the discarded ones are stripped, so
 * a reader never sees `[[product:999]]` in a draft.
 */
export function stripInvalidMarkers(body: string, allowedProductIds: Iterable<number>): string {
  const allowed = new Set(allowedProductIds);
  const seen = new Set<number>();

  return body
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => {
      const marker = PRODUCT_MARKER_PATTERN.exec(line);
      if (!marker) return true;

      const productId = Number(marker[1]);
      if (!allowed.has(productId) || seen.has(productId)) return false;

      seen.add(productId);
      return true;
    })
    .join('\n');
}
