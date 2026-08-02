/**
 * IMDb, via its official bulk datasets.
 *
 * The obvious source for a project whose whole pitch is "IMDb for actual
 * plays", and it was missing from the adapter set until someone pointed out
 * that CelebriD&D's cast was one search away. It is the third time a whole
 * category of source turned out to be unexplored rather than exhausted.
 *
 * IMDb's HTML blocks automated requests, so this reads the TSV dumps at
 * https://datasets.imdbws.com/ instead. Those are published for personal and
 * non-commercial use, which matches this index's existing posture — see
 * POLICY.md on the NC obligations the image policy already accepts.
 *
 * The files are large (~1.4GB compressed) and must be streamed, never loaded.
 * Everything here is written as a single pass with an explicit keep-set.
 */
import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import type { CreditRole } from '../schema.js';
import { realCharacter } from '../credits.js';

export const DATASETS = ['title.basics', 'title.episode', 'title.principals', 'name.basics'] as const;

/** Stream a .tsv.gz, yielding each row already split on tabs. */
export async function* rows(path: string): AsyncGenerator<string[]> {
  const stream = createReadStream(path).pipe(createGunzip());
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let first = true;
  for await (const line of lines) {
    if (first) { first = false; continue; }   // header
    yield line.split('\t');
  }
}

/** IMDb writes \N for null. */
export const val = (s: string | undefined): string | undefined =>
  s === undefined || s === '\\N' || s === '' ? undefined : s;

/**
 * Title match key. Deliberately lossy on punctuation and articles, because
 * "CelebriD&D" and "Celebri D&D" are the same show, but never lossy on words:
 * two shows differing by a real word must not collide.
 */
export function titleKey(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^(the|a|an) /, '')
    .trim();
}

/** Title types that can plausibly be an actual play. */
export const SERIES_TYPES = new Set([
  'tvSeries', 'tvMiniSeries', 'tvSpecial', 'tvMovie', 'video', 'movie', 'short', 'tvShort',
]);

/**
 * IMDb records a game master as a *character* named "Dungeon Master", not as a
 * distinct job. Reading only `category` would file every GM as a player.
 */
const GM_CHARACTER =
  /\b(dungeon|game|dungeon\s*&?\s*dragons)\s*master\b|\b(gm|dm)\b|\bkeeper\b|\bstoryteller\b|\bnarrator\b|\bfacilitator\b|\bmc\b/i;

const CATEGORY_ROLES: Record<string, CreditRole> = {
  actor: 'player',
  actress: 'player',
  self: 'player',
  director: 'director',
  producer: 'producer',
  writer: 'writer',
  composer: 'composer',
  editor: 'editor',
};

export interface ImdbCredit {
  nconst: string;
  role: CreditRole;
  character?: string;
}

/** Turn a principals row into a credit, or nothing if the job is irrelevant. */
export function creditFrom(category: string, charactersJson?: string): Omit<ImdbCredit, 'nconst'> | undefined {
  const base = CATEGORY_ROLES[category];
  if (!base) return undefined;                       // self-archive footage, cinematographer, …

  let characters: string[] = [];
  if (charactersJson) {
    try {
      const parsed = JSON.parse(charactersJson);
      if (Array.isArray(parsed)) characters = parsed.filter((c): c is string => typeof c === 'string');
    } catch { /* IMDb occasionally writes malformed json; a missing character is not fatal */ }
  }

  // "Self" with no character is a talking head, not a player. Only keep it
  // when something else says they were at the table.
  const named = characters.map(realCharacter).filter((c): c is string => Boolean(c));

  if (base === 'player') {
    if (named.some((c) => GM_CHARACTER.test(c))) return { role: 'GM/DM' };
    if (named.length === 0 && category === 'self') return undefined;
    return { role: 'player', ...(named.length ? { character: named.join(' / ') } : {}) };
  }
  return { role: base };
}
