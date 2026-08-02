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

/**
 * Roles that describe the same activity at different confidence. Sources
 * routinely disagree about whether an appearance was a regular or a guest
 * slot, and that disagreement should not fork one appearance into two credits.
 */
function sameKindOfRole(a: string, b: string): boolean {
  if (a === b) return true;
  const kind = (r: string) => (r.includes('GM') || r.includes('DM') ? 'gm' : r.includes('player') ? 'player' : r);
  return kind(a) === kind(b);
}

/**
 * Does a show-level credit describe an appearance already recorded against a
 * specific season?
 *
 * Catalogues credit at series level; wikis credit per season. Left alone, both
 * get stored and the person's page shows the same appearance twice — Deborah
 * Ann Woll's Critical Role credit as Twiggy appeared once from IMDb with no
 * season and once from the wiki against Campaign 2. The season-level record is
 * strictly more informative, so the vaguer one is folded into it rather than
 * kept alongside.
 */
export function subsumedBy(vague: Partial<Credit>, specific: Partial<Credit>): boolean {
  return (
    vague.show === specific.show &&
    vague.season === undefined &&
    vague.episode === undefined &&
    specific.season !== undefined &&
    (vague.character ?? '').toLowerCase() === (specific.character ?? '').toLowerCase() &&
    sameKindOfRole(vague.role ?? '', specific.role ?? '')
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
  // A vague incoming credit that an existing specific one already covers is
  // corroboration for that one, not a new row.
  if (incoming.season === undefined) {
    const covered = existing.filter((c) => subsumedBy(incoming, c));
    if (covered.length > 0) {
      let credits = existing;
      let changed = false;
      for (const target of covered) {
        const fresh = incoming.sources.filter((s) => !alreadyCited(target, s));
        if (fresh.length === 0) continue;
        changed = true;
        const merged = { ...target, sources: [...target.sources, ...fresh] };
        credits = credits.map((c) => (c === target ? merged : c));
      }
      return changed
        ? { outcome: 'corroborated', credits }
        : { outcome: 'already-cited', credits: existing };
    }
  }

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
