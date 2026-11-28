/**
 * What happens to portraits when one person record is folded into another.
 */
import type { Person } from './schema.js';

type PortraitFields = Pick<Person, 'image' | 'no_auto_image'>;

/**
 * The surviving record keeps its own image. A rejection on either record
 * stands, and a rejected record's image never moves across.
 */
export function mergePortrait(into: PortraitFields, from: PortraitFields): void {
  if (!into.image && from.image && !into.no_auto_image && !from.no_auto_image) {
    into.image = from.image;
  }
  if (from.no_auto_image) into.no_auto_image = true;
}
