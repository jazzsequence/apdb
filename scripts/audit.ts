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

// --- The same person catalogued twice --------------------------------------
// Whole batches of these got through: Matt/Matthew Mercer, Brian W./Brian Wayne
// Foster, Amy Vorpahl/Vorphal, two Brennan Lee Mulligans differing by one
// letter. Nothing was watching for it.
function nameKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|wwe superstar|dr|mr|ms|mrs)\b/g, ' ')
    .replace(/[^a-z ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "matt mercer" vs "matthew mercer": same surname, one forename a prefix. */
function likelySamePerson(a: string, b: string): boolean {
  const [x, y] = [nameKey(a).split(' '), nameKey(b).split(' ')];
  if (x.length < 2 || y.length < 2) return false;
  if (x.at(-1) !== y.at(-1)) return false;             // surnames must match
  const [fx, fy] = [x[0]!, y[0]!];
  if (fx === fy) return true;                          // differs only in middle names
  return fx.length >= 3 && fy.length >= 3 && (fx.startsWith(fy) || fy.startsWith(fx));
}

const seenPairs = new Set<string>();
for (const a of db.people) {
  for (const b of db.people) {
    if (a.id >= b.id) continue;
    const key = `${a.id}|${b.id}`;
    if (seenPairs.has(key)) continue;
    if (!likelySamePerson(a.canonical_name, b.canonical_name)) continue;
    seenPairs.add(key);
    findings.push({
      severity: 'high',
      what: 'possibly the same person twice',
      detail: `"${a.canonical_name}" (${a.credits.length}) and "${b.canonical_name}" (${b.credits.length}) — merge if they are one person`,
    });
  }
}

// --- Entries that are not people at all -------------------------------------
// Companies and studios get swept in from crew fields; markup gets swept in
// from wiki values that were never plain text.
const NOT_A_PERSON =
  /\b(studios?|sound|productions?|publishing|entertainment|media|records|llc|ltd|inc|network|games|press)\b/i;
for (const p of db.people) {
  if (NOT_A_PERSON.test(p.canonical_name)) {
    findings.push({
      severity: 'high',
      what: 'looks like a company, not a person',
      detail: `${p.canonical_name} — ${p.credits.length} credit(s)`,
    });
  }
  if (/<[^>]+>|&[a-z]+;|\/{2,}/.test(p.canonical_name)) {
    findings.push({
      severity: 'high',
      what: 'markup left in a person name',
      detail: `${p.canonical_name} — parse artefact, not a name`,
    });
  }
}

// --- A "show" that is really an uploader ------------------------------------
// The Archive.org importer takes the item's creator field as a show title, so
// a personal upload of someone's home game becomes a show named after them:
// Bill White, Edward DuBois, Liam Gallagher, Mel White. They have no cast and
// never will, because they are not productions.
const PERSON_SHAPED = /^[\p{Lu}][\p{Ll}'’-]+(?:\s+[\p{Lu}]\.)?\s+[\p{Lu}][\p{Ll}'’-]+$/u;
for (const show of db.shows) {
  if (db.castFor(show).length > 0) continue;
  if (!PERSON_SHAPED.test(show.title)) continue;
  findings.push({
    severity: 'medium',
    what: 'show title looks like a person, not a production',
    detail: `${show.title} — no credits, and the title is a personal name. Probably an uploader taken as a show title; check before keeping.`,
  });
}

// --- Suspiciously thin casts ----------------------------------------------
for (const show of db.shows) {
  // A solo show has no cast to be missing.
  if (show.solo) continue;
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

// --- An anthology where every season claims the same system -----------------
// Anthologies mix systems by definition. Critical Role Specials & One-Shots
// had nine differently-titled seasons all recorded as dnd-5e, which hid that
// UnDeadwood is Deadlands and both Age of Umbra runs are Daggerheart. Every
// one of those came from the same `game: dnd-5e` default that once mislabelled
// 67 shows.
for (const show of db.shows) {
  const titled = show.seasons.filter((s) => s.title && s.title !== `Season ${s.ordinal}`);
  if (titled.length < 4) continue;
  const systems = new Set(show.seasons.map((s) => s.game));
  if (systems.size > 1) continue;
  findings.push({
    // Advisory: plenty of multi-season shows really are one system throughout.
    severity: 'low',
    what: 'anthology with one system across every season',
    detail: `${show.title} — ${titled.length} separately titled seasons, all ${[...systems][0]}. Anthologies mix systems; check this was not defaulted.`,
  });
}

// --- One person GMing and playing the same season ---------------------------
// Sometimes true — Cat Blackard runs The Call of Cthulhu Mystery Program and
// plays The Announcer. Often not: catalogues file game masters as actors, and
// a DM voicing a returning character is DMing, not playing. Either way a
// reader sees the same person twice and needs the credit to say which.
for (const person of db.people) {
  for (const a of person.credits) {
    if (!a.role.includes('GM') && !a.role.includes('DM')) continue;
    for (const b of person.credits) {
      if (b === a || b.show !== a.show) continue;
      if ((b.season ?? null) !== (a.season ?? null) || !b.role.includes('player')) continue;
      if (b.episode || b.note) continue;      // already explained
      findings.push({
        severity: 'medium',
        what: 'same person GMing and playing one season',
        detail: `${person.canonical_name} — ${a.show} S${a.season ?? '-'}: "${a.role}" and "${b.role}"${b.character ? ` as ${b.character}` : ''}. If real it needs an episode locator or a note; if not, one of them is wrong.`,
      });
    }
  }
}

// --- Two people credited as the same character ------------------------------
// Found by the GM/player rule: The Ironkeep Chronicles had both Tom Lommel and
// Havana Mahoney playing Avril Birdsong. One of them is wrong, and the
// existing "character is another person" rule cannot see it because Avril
// Birdsong is a character, not someone in the database.
{
  const byCharacter = new Map<string, Set<string>>();
  for (const person of db.people) {
    for (const credit of person.credits) {
      if (!credit.character) continue;
      // Keyed on the episode too. A character recast partway through is real
      // — Sgt. Elijah Clay was played by Eric Reichert in Twilight Protocol's
      // first part and Gaurav Gulati in its second — and once both credits
      // carry a locator they are no longer in conflict.
      const key = `${credit.show}|${credit.season ?? '-'}|${credit.episode ?? '-'}|${credit.character.toLowerCase()}`;
      if (!byCharacter.has(key)) byCharacter.set(key, new Set());
      byCharacter.get(key)!.add(person.canonical_name);
    }
  }
  for (const [key, people] of byCharacter) {
    if (people.size < 2) continue;
    const [show, season, , character] = key.split('|');
    findings.push({
      severity: 'high',
      what: 'two people credited as the same character',
      detail: `${character} on ${show} S${season} is credited to ${[...people].join(' and ')} — one of them is wrong`,
    });
  }
}

// --- A show whose own title contradicts its recorded system -----------------
// The `game: dnd-5e` default has been found wrong three separate times now, so
// this checks the cheapest available evidence: what the show calls itself.
// It found 20 at once, including "VtM: Dark City Season 1" filed as D&D.
const SYSTEM_HINTS: [RegExp, string][] = [
  [/\bvtm\b|vampire[:\s]|masquerade/i, 'vampire-the'],
  [/\bcall of cthulhu\b/i, 'call-of-cthulhu'],
  [/\bshadowrun\b/i, 'shadowrun'],
  [/\bblades in the dark\b/i, 'blades-in-the-dark'],
  [/\bcyberpunk red\b/i, 'cyberpunk-red'],
  [/\bcyberpunk 2020\b/i, 'cyberpunk-2020'],
  [/\bpathfinder\b/i, 'pathfinder-'],
  [/\bstarfinder\b/i, 'starfinder'],
  [/\bdaggerheart\b/i, 'daggerheart'],
  [/\bshadowdark\b/i, 'shadowdark'],
  [/\bm(ö|o)rk borg\b/i, 'mork-borg'],
  [/\btraveller\b/i, 'traveller'],
  [/\bundeadwood\b/i, 'deadlands'],
  [/\bstar trek\b/i, 'star-trek'],
  [/\bforbidden lands\b/i, 'forbidden-lands'],
  [/\bavatar legends\b/i, 'avatar-legends'],
  [/\bmonsterhearts\b/i, 'monsterhearts'],
  [/\bcoriolis\b/i, 'coriolis'],
  [/\bwarhammer\b/i, 'warhammer'],
  [/\bcity of mist\b/i, 'city-of-mist'],
  [/\bdraw steel\b/i, 'draw-steel'],
  [/\b13th age\b/i, '13th-age'],
  [/\bkids on bikes\b/i, 'kids-on-bikes'],
  [/\bvaesen\b/i, 'vaesen'],
];
for (const show of db.shows) {
  for (const [re, prefix] of SYSTEM_HINTS) {
    if (!re.test(show.title)) continue;
    const games = [...new Set(show.seasons.map((s) => s.game))];
    if (games.every((g) => g.startsWith(prefix))) break;
    findings.push({
      severity: 'high',
      what: 'system contradicts the show title',
      detail: `${show.title} — recorded as ${games.join(', ')} but its own title says ${prefix.replace(/-$/, '')}`,
    });
    break;
  }
}

// --- Two shows with the same title ------------------------------------------
// Season splits keep reappearing: L.A. by Night was three shows, and the Glass
// Cannon arcs were 63. A near-identical pair of titles is the signature.
{
  const byTitle = new Map<string, string[]>();
  for (const show of db.shows) {
    const key = show.title.toLowerCase().replace(/\bseason\s*\d+\b|\bs\d+\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    if (!key) continue;
    byTitle.set(key, [...(byTitle.get(key) ?? []), show.title]);
  }
  for (const [, titles] of byTitle) {
    if (titles.length < 2) continue;
    findings.push({
      severity: 'medium',
      what: 'two shows that may be one show split by season',
      detail: `${titles.join('  |  ')} — if these are one show, the seasons belong in one record`,
    });
  }
}

// --- The show's own description says it is not an actual play ---------------
// This class was found entirely by hand: the project owner hit Random, landed
// on Geek & Sundry entries, read the descriptions, and filed fifteen
// corrections. Ten of those were things that were never actual plays. The
// evidence was sitting in the description field the whole time.
//
// Validated against those ten before being added: it catches Thrashtopia
// ("talk show"), Game Masters Hall ("share tips"), Omnibus ("hosted by our"),
// and TBD RPG ("programming block"). It misses ones whose descriptions are
// merely bland, which is the honest limit of reading a tagline.
const NOT_AN_ACTUAL_PLAY = new RegExp(
  [
    'talk ?show', 'chat show', 'news show', 'review show', '\\breviews\\b', '\\binterviews?\\b',
    'discussion show', 'post-?show discussion', '\\brecaps?\\b', 'behind the scenes',
    '\\bscripted\\b', 'sketch comedy', 'animated series', '\\bcartoon\\b', 'documentary',
    'card game', 'board game', 'video game', 'unboxing', 'highlights', 'tutorial',
    'how[- ]to', 'streaming platform', 'programming block', 'tips,? (and )?tricks',
    '\\bexperts\\b', 'hosted by our', 'share tips',
  ].join('|'),
  'i',
);
for (const show of db.shows) {
  const hit = show.description?.match(NOT_AN_ACTUAL_PLAY);
  if (!hit) continue;
  findings.push({
    severity: 'high',
    what: 'description says this is not an actual play',
    detail: `${show.title} — its own description contains "${hit[0]}". Check it is a recording of play at all.`,
  });
}

// --- A title that promises instruction rather than play ---------------------
// Two of these were reported by hand: "5E D&D Adventure Walkthroughs" and
// "Build An Epic Cyberpunk Red Campaign". Channel sweeps take every playlist,
// and a channel that plays games also teaches them.
const INSTRUCTIONAL =
  /\b(how to|build (an?|your)\b|building (an?|your)\b|walkthroughs?|guide to|tips|prep|worldbuilding|character creation|session zero|for beginners|tutorial|explained|rules (explained|breakdown))\b/i;
for (const show of db.shows) {
  if (!INSTRUCTIONAL.test(show.title)) continue;
  findings.push({
    severity: 'high',
    what: 'title reads as instructional, not a recording of play',
    detail: `${show.title} — a how-to or campaign-building series is not an actual play. Check the playlist.`,
  });
}

// --- The description names a different system than the one recorded ---------
// Same origin: "Listed as D&D but the description says Overlight RPG". Short
// or ambiguous game names are excluded, because "Spire" matched three shows
// set near an Obsidian Spire and "Cyberpunk" matched a genre.
// Families rather than games. Night Witches, Monsterhearts and Dungeon World
// are all Powered by the Apocalypse, so naming the family says nothing about
// which of them was played.
const AMBIGUOUS_GAME =
  /^(spire|cyberpunk|various|various systems|homebrewed system|powered by the apocalypse|tba|tutorial|product reviews)$/i;
for (const show of db.shows) {
  if (!show.description) continue;
  const recorded = new Set(show.seasons.map((s) => s.game));
  // By name, not id. `dnd-4e` and `dnd-5e` are both called "Dungeons &
  // Dragons", so comparing ids flagged every D&D show in the database.
  const recordedNames = new Set(
    [...recorded].map((id) => db.games.find((g) => g.id === id)?.name.toLowerCase()).filter(Boolean),
  );
  for (const game of db.games) {
    if (AMBIGUOUS_GAME.test(game.name) || game.name.length < 6) continue;
    if (recordedNames.has(game.name.toLowerCase())) continue;
    // A game line whose id extends a recorded one is the same family:
    // `chronicles-of-darkness-hunter` is Chronicles of Darkness.
    if ([...recorded].some((id) => id.startsWith(game.id) || game.id.startsWith(id))) continue;
    if (!new RegExp(`\\b${game.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(show.description)) continue;
    findings.push({
      severity: 'high',
      what: 'description names a different system',
      detail: `${show.title} — recorded as ${[...recorded].join(', ')} but its description says "${game.name}"`,
    });
    break;
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

// The console output is capped, which hides whole categories once the list is
// long. `--report` writes every finding grouped by kind, as a worklist.
if (process.argv.includes('--report')) {
  const { writeFile } = await import('node:fs/promises');
  const byKind = new Map<string, Finding[]>();
  for (const f of findings) byKind.set(f.what, [...(byKind.get(f.what) ?? []), f]);

  const lines = [
    '# Audit',
    '',
    `Generated by \`npm run audit -- --report\` against ${db.people.length} people, ` +
      `${db.shows.length} shows and ${db.people.reduce((n, p) => n + p.credits.length, 0)} credits.`,
    '',
    `**${counts.high} high · ${counts.medium} medium · ${counts.low} low**`,
    '',
    'High findings are import bugs — something is wrong in the data. Medium and',
    'low are curation gaps: the data is not wrong, it is missing or unverified.',
    '',
    '## Contents',
    '',
  ];
  const ordered = [...byKind.entries()].sort((a, b) => {
    const sev = (x: Finding[]) => order[x[0]!.severity];
    return sev(a[1]) - sev(b[1]) || b[1].length - a[1].length;
  });
  for (const [what, items] of ordered) {
    const anchor = what.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    lines.push(`- [${what}](#${anchor}) — ${items.length} (${items[0]!.severity})`);
  }
  for (const [what, items] of ordered) {
    lines.push('', `## ${what}`, '', `${items.length} finding(s), severity **${items[0]!.severity}**.`, '');
    for (const f of items) lines.push(`- ${f.detail}`);
  }
  await writeFile('AUDIT.md', lines.join('\n') + '\n', 'utf8');
  console.log(`\nFull worklist written to AUDIT.md (${findings.length} findings in ${byKind.size} categories).`);
}

// High-severity findings are import bugs, not curation gaps.
process.exit(counts.high > 0 ? 1 : 0);
