/**
 * Adding a credit to a person, without throwing away evidence.
 *
 * The rule every importer has to follow, and which two of them did not:
 *
 *   A credit that already exists is not a duplicate to discard. It is a
 *   second source for the same fact, and merging it is precisely how
 *   corroboration accumulates.
 *
 * `collect.ts` got this right and said so in a comment. The website and IMDb
 * importers were written later and both did `continue` on a match, which meant
 * that every time IMDb independently confirmed something a fan wiki had
 * already told us — the single most valuable thing a second source can do —
 * the confirmation was silently dropped. 2,299 of 2,307 credits ended up
 * carrying exactly one source, and the corroborated count sat at 8, not
 * because the facts were unsupported but because the support was binned.
 */
import type { Credit, Source } from './schema.js';

export interface UpsertResult {
  /** 'added' — new credit. 'corroborated' — existing credit gained a source. */
  outcome: 'added' | 'corroborated' | 'already-cited';
  credits: Credit[];
}

/** Two credits describe the same fact when show, season, role and episode match. */
function sameFact(a: Partial<Credit>, b: Partial<Credit>): boolean {
  return (
    a.show === b.show &&
    (a.season ?? null) === (b.season ?? null) &&
    a.role === b.role &&
    (a.episode ?? null) === (b.episode ?? null)
  );
}

/** Is this source already on the credit? Same url, or same person attesting. */
function alreadyCited(credit: Credit, source: Source): boolean {
  return credit.sources.some((s) => {
    if (source.url && s.url) return s.url === source.url;
    if (source.attested_by && s.attested_by) return s.attested_by === source.attested_by;
    return false;
  });
}

/**
 * Merge a credit into a person's existing credits.
 *
 * Where the fact is already recorded, the new source is appended rather than
 * the credit being skipped. Fields the existing record lacks — a character
 * name, an episode locator — are filled in, but never overwritten: the first
 * importer to record something specific keeps it.
 */
export function upsertCredit(existing: Credit[], incoming: Credit): UpsertResult {
  const match = existing.find((c) => sameFact(c, incoming));
  if (!match) {
    return { outcome: 'added', credits: [...existing, incoming] };
  }

  const newSources = incoming.sources.filter((s) => !alreadyCited(match, s));
  if (newSources.length === 0) {
    return { outcome: 'already-cited', credits: existing };
  }

  const merged: Credit = {
    ...match,
    character: match.character ?? incoming.character,
    note: match.note ?? incoming.note,
    sources: [...match.sources, ...newSources],
  };
  if (merged.character === undefined) delete (merged as Partial<Credit>).character;
  if (merged.note === undefined) delete (merged as Partial<Credit>).note;

  return {
    outcome: 'corroborated',
    credits: existing.map((c) => (c === match ? merged : c)),
  };
}
