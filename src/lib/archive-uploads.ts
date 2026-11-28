/**
 * Which uploads in a partly catalogued Archive group are news?
 *
 * A show records one of its items and the date its run reached, so the other
 * episodes of an imported show are unknown by identifier without being new.
 */
export function newUploads(
  items: Array<{ identifier: string; date?: string }>,
  /** Catalogued identifier (lower case) -> the latest date recorded for its show. */
  catalogued: Map<string, string | undefined>,
): number {
  const dates = items
    .map((i) => catalogued.get(i.identifier.toLowerCase()))
    .filter((d): d is string => Boolean(d))
    .sort();
  const latest = dates[dates.length - 1];
  return items.filter((i) => {
    if (catalogued.has(i.identifier.toLowerCase())) return false;
    // With no date to compare, say so rather than assume it is old. A recorded
    // "2019" covers the whole year.
    return !latest || !i.date || i.date.slice(0, latest.length) > latest;
  }).length;
}
