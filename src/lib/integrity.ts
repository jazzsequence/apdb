/**
 * Referential integrity — every constraint a database would have enforced for
 * free, and which flat files give you none of.
 *
 * A typo'd show id is a broken link that nothing else catches. This is the
 * check that keeps curated YAML from rotting.
 */
import type { Dataset, Problem } from './load.js';
import type { Person } from './schema.js';
import { seasonGameIds } from './schema.js';

/** Normalise a name for duplicate detection: casefold, strip punctuation/accents. */
function normaliseName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function checkIntegrity(dataset: Dataset): Problem[] {
  const problems: Problem[] = [];
  const { people, shows, channels, games } = dataset;

  const showsById = new Map(shows.map((s) => [s.id, s]));
  const channelIds = new Set(channels.map((c) => c.id));
  const gameIds = new Set(games.map((g) => g.id));

  // --- ID uniqueness across each collection -------------------------------
  for (const [label, records] of [
    ['people', people],
    ['shows', shows],
    ['channels', channels],
    ['games', games],
  ] as const) {
    const seen = new Set<string>();
    for (const record of records) {
      if (seen.has(record.id)) {
        problems.push({
          file: `data/${label}/${record.id}.yml`,
          path: 'id',
          message: `duplicate id "${record.id}" in ${label}`,
        });
      }
      seen.add(record.id);
    }
  }

  // --- Shows: channel and game references ---------------------------------
  for (const show of shows) {
    const file = `data/shows/${show.id}.yml`;

    show.channels.forEach((channelId, index) => {
      if (!channelIds.has(channelId)) {
        problems.push({
          file,
          path: `channels[${index}]`,
          message: `references channel "${channelId}", which does not exist in data/channels/`,
        });
      }
    });

    show.seasons.forEach((season, index) => {
      for (const id of seasonGameIds(season)) {
        if (!gameIds.has(id)) {
          problems.push({
            file,
            path: `seasons[${index}].game`,
            message: `season ${season.ordinal} references game "${id}", which does not exist in data/games/`,
          });
        }
      }
    });
  }

  // --- Credits: the ones that actually matter ------------------------------
  for (const person of people) {
    const file = `data/people/${person.id}.yml`;
    const aliasIds = new Set(person.aliases.map((a) => a.id));

    person.credits.forEach((credit, index) => {
      const at = `credits[${index}]`;

      const show = showsById.get(credit.show);
      if (!show) {
        problems.push({
          file,
          path: `${at}.show`,
          message: `references show "${credit.show}", which does not exist in data/shows/`,
        });
      } else if (credit.season !== undefined) {
        const season = show.seasons.find((s) => s.ordinal === credit.season);
        if (!season) {
          const available = show.seasons.map((s) => s.ordinal).join(', ');
          problems.push({
            file,
            path: `${at}.season`,
            message: `references season ${credit.season} of "${credit.show}", which has no such season (available: ${available})`,
          });
        }
      }

      // An absent alias means the billing was never established — legitimate.
      // A present one still has to resolve.
      if (credit.alias !== undefined && !aliasIds.has(credit.alias)) {
        const available = [...aliasIds].join(', ');
        problems.push({
          file,
          path: `${at}.alias`,
          message: `credited under alias "${credit.alias}", which is not one of this person's aliases (available: ${available})`,
        });
      }
    });
  }

  return problems;
}

/**
 * Duplicate-person heuristic. Two people sharing a name, with no alias
 * connecting them, is the exact shape of the bug this project exists to fix —
 * so it gets flagged for a maintainer rather than silently merged or ignored.
 *
 * Advisory only: real distinct people do share names.
 */
export function findPossibleDuplicatePeople(people: Person[]): Problem[] {
  const byName = new Map<string, { person: Person; alias: string }[]>();

  for (const person of people) {
    for (const alias of person.aliases) {
      const key = normaliseName(alias.name);
      const bucket = byName.get(key) ?? [];
      bucket.push({ person, alias: alias.name });
      byName.set(key, bucket);
    }
  }

  const problems: Problem[] = [];
  for (const [, matches] of byName) {
    const distinct = new Map(matches.map((m) => [m.person.id, m]));
    if (distinct.size < 2) continue;

    const ids = [...distinct.keys()].sort();
    const name = [...distinct.values()][0]!.alias;
    problems.push({
      file: `data/people/${ids[0]}.yml`,
      message: `the name "${name}" is used by ${ids.length} separate people (${ids.join(', ')}) with no alias linking them — if these are the same person, merge them; if not, a maintainer should confirm`,
    });
  }

  return problems;
}
