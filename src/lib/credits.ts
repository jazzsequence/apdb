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

/**
 * Two credits describe the same fact when show, season and episode match and
 * the roles are the same kind of job. Requiring the role *label* to match
 * exactly forked appearances where one source said "player" and another said
 * "guest player" — a disagreement about billing, not two appearances.
 */
function sameFact(a: Partial<Credit>, b: Partial<Credit>): boolean {
  return (
    a.show === b.show &&
    (a.season ?? null) === (b.season ?? null) &&
    sameKindOfRole(a.role ?? '', b.role ?? '') &&
    (a.episode ?? null) === (b.episode ?? null) &&
    compatibleCharacter(a.character, b.character)
  );
}

/**
 * Values that catalogues put in the character field which are not characters.
 *
 * TMDB and TheTVDB have one cast category — actor — so a game master is filed
 * as an actor whose "character" is the label the catalogue happened to use.
 * TheTVDB gave Brennan Lee Mulligan the character "Actor" on Worlds Beyond
 * Number, a show he runs.
 */
export const ROLE_LABEL =
  /^(actor|actress|self|host|guest|guest star|self\s*[-–—,]\s*\w+|narrator|announcer|storyteller|story teller|game ?master|dungeon ?master|gm|dm|keeper|marshal|judge|referee|crew|player|cast|various|additional voices)$/i;

/** A character field worth keeping, or nothing. */
export function realCharacter(value: string | undefined): string | undefined {
  const v = (value ?? '').trim();
  return !v || ROLE_LABEL.test(v) ? undefined : v;
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
    sameKindOfRole(vague.role ?? '', specific.role ?? '') &&
    compatibleCharacter(vague.character, specific.character)
  );
}

/**
 * Do two character fields describe the same casting?
 *
 * Requiring them to be equal was too strict and cost 220 merges. Sources
 * disagree about character names in three ordinary ways, none of which means
 * two different appearances:
 *
 *   - One simply does not record a character. Wikis often list a season's cast
 *     without characters while a catalogue names them, or the reverse.
 *   - One names a subset. "Deni$e / Opal" against "Deni$e Bembachula, Opal".
 *   - Spelling, punctuation and honorifics drift.
 *
 * Genuinely different characters — Abubakar Salim as Coru in campaign three
 * and as The Arch Heart elsewhere — share no name part, so they stay separate.
 */
function compatibleCharacter(a: string | undefined, b: string | undefined): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 /]/g, '').replace(/\s+/g, ' ').trim();
  const x = norm(a ?? '');
  const y = norm(b ?? '');
  if (!x || !y) return true;                       // one side is silent
  if (x === y) return true;
  if (x.includes(y) || y.includes(x)) return true; // one names a subset

  // Any shared character name across the "/" separated list counts.
  const parts = (s: string) => new Set(s.split(/\s*\/\s*/).map((p) => p.trim()).filter(Boolean));
  const [px, py] = [parts(x), parts(y)];
  for (const p of px) {
    if (py.has(p)) return true;
    // "opal" against "opal bembachula"
    for (const q of py) if (p.includes(q) || q.includes(p)) return true;
  }
  return false;
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
/**
 * Is this incoming credit merely "they were involved", against an existing
 * credit that says what they actually did?
 *
 * TMDB and TheTVDB file everybody as an actor, so their credit for a game
 * master arrives as a character-less `player`. Stored alongside the GM credit
 * it reads as one person both running and playing in the same season, which
 * is not what the catalogue meant — it has no way to express "GM" at all.
 * Twenty credits were forked this way.
 *
 * Only applies where the incoming credit names no character. Someone who
 * genuinely did both — Cat Blackard runs The Call of Cthulhu Mystery Program
 * and plays The Announcer in it — names a character, and keeps both credits.
 */
function isBareParticipation(incoming: Partial<Credit>, existing: Partial<Credit>): boolean {
  return (
    incoming.show === existing.show &&
    (incoming.season ?? null) === (existing.season ?? null) &&
    (incoming.episode ?? null) === (existing.episode ?? null) &&
    realCharacter(incoming.character) === undefined &&
    (incoming.role ?? '').includes('player') &&
    !(existing.role ?? '').includes('player')
  );
}

export function upsertCredit(existing: Credit[], incoming: Credit): UpsertResult {
  // A catalogue saying "they were in this" does not contradict a source saying
  // what they did. It corroborates it.
  const moreSpecific = existing.find((c) => isBareParticipation(incoming, c));
  if (moreSpecific) {
    const fresh = incoming.sources.filter((s) => !alreadyCited(moreSpecific, s));
    if (fresh.length === 0) return { outcome: 'already-cited', credits: existing };
    const merged = { ...moreSpecific, sources: [...moreSpecific.sources, ...fresh] };
    return {
      outcome: 'corroborated',
      credits: existing.map((c) => (c === moreSpecific ? merged : c)),
    };
  }

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
