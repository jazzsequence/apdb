/**
 * Who does a cast line name?
 *
 * A production writes its own cast as it likes, often by first name or handle,
 * and filing such a name against whoever else goes by it puts an `official`
 * credit on a stranger. Importers resolve names here so they hold the same
 * cases back.
 */
import type { Person } from './schema.js';

export type PersonMatch =
  | { kind: 'existing'; person: Person }
  | { kind: 'new'; id: string }
  | { kind: 'held'; reason: string };

export function personMatcher(
  people: Person[],
  shows: Array<{ id: string; channels: string[] }>,
) {
  const byId = new Map<string, Person>();
  const byName = new Map<string, Set<string>>();

  /** Index a person, or re-index one an import has just written. */
  function add(person: Person): void {
    byId.set(person.id, person);
    for (const name of [person.canonical_name, ...person.aliases.map((a) => a.name)]) {
      const key = name.toLowerCase();
      byName.set(key, (byName.get(key) ?? new Set()).add(person.id));
    }
  }
  people.forEach(add);

  /** `slugId` is the id a new record for this name would take. */
  function match(name: string, slugId: string, showId: string): PersonMatch {
    const ids = new Set(byName.get(name.toLowerCase()));
    let matches = [...ids].map((id) => byId.get(id)!);
    const slugged = byId.get(slugId);

    // A first name or handle is recognisable only on this show, or on another
    // from the same channel.
    if (!name.trim().includes(' ')) {
      if (slugged && !ids.has(slugged.id)) matches.push(slugged);
      const channels = new Set(shows.find((s) => s.id === showId)?.channels ?? []);
      const related = new Set([
        showId,
        ...shows.filter((s) => s.channels.some((c) => channels.has(c))).map((s) => s.id),
      ]);
      const known = matches.filter((p) => p.credits.some((c) => related.has(c.show)));
      if (matches.length > 0 && known.length === 0) {
        return { kind: 'held', reason: 'someone goes by that name, but not on this show or channel' };
      }
      matches = known;
    }
    if (matches.length > 1) return { kind: 'held', reason: 'more than one person goes by that name' };

    const person = matches[0] ?? slugged;
    return person ? { kind: 'existing', person } : { kind: 'new', id: slugId };
  }

  return { add, match };
}
