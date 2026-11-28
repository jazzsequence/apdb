/**
 * Where a time-limited weekly run starts.
 *
 * A run that stops on time reads only the front of the list, so each week
 * starts a quarter further along: four runs that each cover a quarter reach
 * everyone.
 */
export function rotateForWeek<T>(items: T[], week: number): T[] {
  const start = (week % 4) * Math.ceil(items.length / 4);
  return [...items.slice(start), ...items.slice(0, start)];
}
