#!/usr/bin/env tsx
/**
 * Post-import spot check.
 *
 * Every data error found in this project so far came from trusting a bulk
 * import and moving on: characters filed as performers, interwiki strings as
 * names, a whole campaign's cast silently lost, `dnd-5e` invented for 67 shows.
 * None of it was subtle — all of it was invisible because nobody looked.
 *
 * This looks. It is heuristic on purpose: it flags things worth a human
 * glance rather than asserting they are wrong, so run it after every import.
 *
 *   npm run audit
 */
import { Db } from '../src/lib/derive.js';
import { loadDataset } from '../src/lib/load.js';

interface Finding {
  severity: 'high' | 'medium' | 'low';
  what: string;
  detail: string;
}

const { dataset, problems } = await loadDataset();
if (problems.length > 0) {
  console.error('Data does not parse — run `npm run validate` first.');
  process.exit(1);
}
const db = new Db(dataset);
const findings: Finding[] = [];

// --- People who might be characters ---------------------------------------
// A character imported as a performer almost always has exactly one credit, on
// one show, and no free portrait or Wikidata id.
const characterish = db.people.filter((p) => {
  if (p.credits.length !== 1) return false;
  if (p.wikidata_qid || p.image) return false;

  const name = p.canonical_name;
  // Ordinary person-name shapes that the old rule kept flagging: apostrophe
  // surnames (O'Brien, D'Angelo), middle initials, and generational suffixes.
  if (/^[\p{Lu}][\p{L}'’-]*(?:\s+(?:[\p{Lu}]\.?|[\p{Lu}][\p{L}'’-]*))*(?:\s+(?:Jr\.?|Sr\.?|I{2,3}|IV))?$/u.test(name)) {
    // Still suspicious if it is unusually long for a name.
    return name.split(/\s+/).length > 4;
  }
  return /["()]|^The |^A /.test(name);
});
for (const p of characterish) {
  findings.push({
    severity: 'high',
    what: 'possible character imported as a person',
    detail: `${p.canonical_name} — 1 credit, no Wikidata id, name reads like a character`,
  });
}

// --- A performer's "character" that is another performer's name ------------
// Only full names count. Shows that credit by first name or handle create
// real collisions — "Orla" is a Kingdom Sleeps player and an Avantris
// character, and flagging that as an inverted pairing is noise.
const personNames = new Set(
  db.people
    .filter((p) => p.canonical_name.trim().includes(' '))
    .map((p) => p.canonical_name.toLowerCase()),
);
for (const person of db.people) {
  for (const credit of person.credits) {
    for (const part of (credit.character ?? '').split(' / ')) {
      if (part && personNames.has(part.trim().toLowerCase())) {
        findings.push({
          severity: 'high',
          what: 'character is another person in the database',
          detail: `${person.canonical_name} credited "as ${part}" on ${credit.show} — pairing is probably inverted`,
        });
      }
    }
  }
}

// --- Suspiciously thin casts ----------------------------------------------
for (const show of db.shows) {
  const cast = db.castFor(show);
  const bySeason = new Map<number | 'show', number>();
  for (const c of cast) {
    const k = c.credit.season ?? ('show' as const);
    bySeason.set(k, (bySeason.get(k) ?? 0) + 1);
  }
  const empty = show.seasons.filter((s) => !bySeason.has(s.ordinal));
  if (empty.length > 0) {
    findings.push({
      severity: empty.length === show.seasons.length ? 'medium' : 'low',
      what: 'seasons with no credits',
      detail: `${show.title} — ${empty.length}/${show.seasons.length} seasons empty (${empty
        .slice(0, 3)
        .map((s) => s.title ?? `S${s.ordinal}`)
        .join(', ')}${empty.length > 3 ? ', …' : ''})`,
    });
  }
  for (const [season, n] of bySeason) {
    if (n === 1 && season !== 'show') {
      const title = show.seasons.find((s) => s.ordinal === season)?.title ?? `S${season}`;
      findings.push({
        severity: 'medium',
        what: 'season with exactly one credit',
        detail: `${show.title} — ${title}. A real season has a table; one name usually means the import found nothing.`,
      });
    }
  }
}

// --- A GM-less season -------------------------------------------------------
for (const show of db.shows) {
  for (const season of show.seasons) {
    const cast = db.castFor(show).filter((c) => c.credit.season === season.ordinal);
    if (cast.length >= 3 && !cast.some((c) => c.credit.role.includes('GM'))) {
      findings.push({
        severity: 'low',
        what: 'season with players but no GM',
        detail: `${show.title} — ${season.title ?? `S${season.ordinal}`} (${cast.length} credits, none GMing)`,
      });
    }
  }
}

// --- Unverified system ------------------------------------------------------
const unverified = db.shows.filter(
  (s) => !s.description?.startsWith('System per source') && s.seasons.every((x) => x.game === 'dnd-5e'),
);
if (unverified.length > 5) {
  findings.push({
    severity: 'medium',
    what: 'shows defaulted to D&D 5e',
    detail: `${unverified.length} shows are all-5e with no sourced system line — check they were not defaulted`,
  });
}

// --- Report -----------------------------------------------------------------
const order = { high: 0, medium: 1, low: 2 } as const;
findings.sort((a, b) => order[a.severity] - order[b.severity]);

const counts = { high: 0, medium: 0, low: 0 };
for (const f of findings) counts[f.severity] += 1;

if (findings.length === 0) {
  console.log('✓ Spot check found nothing worth a look.');
} else {
  console.log(
    `\nSpot check: ${counts.high} high, ${counts.medium} medium, ${counts.low} low.\n`,
  );
  let lastWhat = '';
  for (const f of findings.slice(0, 60)) {
    if (f.what !== lastWhat) {
      console.log(`\n[${f.severity}] ${f.what}`);
      lastWhat = f.what;
    }
    console.log(`   ${f.detail}`);
  }
  if (findings.length > 60) console.log(`\n… and ${findings.length - 60} more.`);
}

// High-severity findings are import bugs, not curation gaps.
process.exit(counts.high > 0 ? 1 : 0);
