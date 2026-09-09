#!/usr/bin/env tsx
/**
 * Person-first discovery: what is this person in that we don't have?
 *
 * Every other discovery pass in this repo is show-first — take a show, find
 * its cast. That is the wrong direction for the gap this project exists to
 * close, and it is structurally blind in a specific way: a show missing from
 * `data/shows` contributes nothing to anybody's filmography, so the people
 * with the *most* credits are exactly the people whose gaps are hardest to
 * see. Aabria Iyengar had 42 credits here and four missing series, all four
 * named on a Wikipedia article this repo already linked to and never read.
 *
 * So: start from a person, read what the reference works say they were in,
 * throw away everything that isn't an actual play, and diff the rest against
 * the catalogue.
 *
 *   npm run discover:person -- --person aabria-iyengar
 *   npm run discover:person -- --limit 25
 *   npm run discover:person -- --all --json out/person-sweep.json
 *   npm run discover:person -- --all --apply          # file what needs no guessing
 *   npm run discover:person -- --fixture article.wikitext   # parser only, offline
 *
 * Reports by default. `--apply` files the subset that can be filed without
 * guessing, and the shape of that subset is the whole point: Wikipedia is
 * ADDITIVE here, never authoritative. It is a `reference` tier source and a
 * demonstrably fallible one — POLICY.md's worked example is its filmography
 * table calling Aabria Iyengar a player on a show she ran — so it may add a
 * credit the catalogue lacks, or add itself as a second source to one already
 * recorded, and nothing else. It never overwrites a field a closer source
 * established, never invents a show, and never creates a person. See the
 * gates on the --apply block below.
 */
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parse, stringify } from 'yaml';
import { DATA_ROOT } from '../src/lib/load.js';
import { titleKey } from '../src/lib/sources/imdb.js';
import { fetchPerson, fetchWorks } from '../src/lib/sources/wikidata.js';
import { fetchPersonWorks, fetchWorkFacts, parseWorks, type WikiWork } from '../src/lib/sources/wikipedia.js';
import { classify, type Verdict } from '../src/lib/sources/actual-play.js';
import { assertCleared } from '../src/lib/sources/registry.js';
import { upsertCredit } from '../src/lib/credits.js';
import type { Credit, Person, Show } from '../src/lib/schema.js';

const args = process.argv.slice(2);
const has = (n: string) => args.includes(`--${n}`);
const flag = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};

// ---------------------------------------------------------------------------
// Offline parser check. The fetch half needs the network; the parse half is
// where the bugs live, and a fixture makes it testable without one.
// ---------------------------------------------------------------------------
const fixture = flag('fixture');
if (fixture) {
  const works = parseWorks(await readFile(fixture, 'utf8'));
  console.log(`\n${works.length} candidate work(s) parsed from ${fixture}:\n`);
  for (const work of works) {
    const bits = [
      work.year && `(${work.year})`,
      work.role && `role: ${work.role}`,
      work.character && `as ${work.character}`,
      `[${work.origin}, ${work.section}]`,
    ].filter(Boolean);
    console.log(`  ${work.title}${work.link && work.link !== work.title ? ` -> ${work.link}` : ''}`);
    console.log(`      ${bits.join('  ')}`);
    if (work.evidence) console.log(`      "${work.evidence.slice(0, 160)}"`);
  }
  process.exit(0);
}

assertCleared('wikipedia');
assertCleared('wikidata');

// ---------------------------------------------------------------------------
// What we already hold
// ---------------------------------------------------------------------------
async function loadAll<T>(dir: string): Promise<T[]> {
  const files = (await readdir(join(DATA_ROOT, dir))).filter((f) => f.endsWith('.yml'));
  return Promise.all(files.map(async (f) => parse(await readFile(join(DATA_ROOT, dir, f), 'utf8')) as T));
}

const shows = await loadAll<Show>('shows');
const people = await loadAll<Person>('people');

/**
 * Title -> show id, including season titles.
 *
 * A reference work's "series" is very often a season here: Dimension 20's
 * thirty-odd campaigns are one show, and matching on show titles alone would
 * report every one of them as missing.
 */
const byTitle = new Map<string, { show: string; season?: number }>();
for (const show of shows) {
  byTitle.set(titleKey(show.title), { show: show.id });
  for (const season of show.seasons ?? []) {
    if (season.title) byTitle.set(titleKey(season.title), { show: show.id, season: season.ordinal });
  }
}

/**
 * Wikipedia writes "Vampire: The Masquerade – NY by Night"; we write
 * "NY by Night".
 *
 * Takes the link target as well as the display text, and tries it first. A
 * piped link says "[[Critical Role|Critical Role main cast]]", and matching
 * on the display alone missed a show this project has indexed since the
 * beginning — reporting it as absent, which is the one thing a gap report
 * must never do.
 */
function lookup(title: string, link?: string): { show: string; season?: number } | undefined {
  for (const raw of [link, title]) {
    if (!raw) continue;
    // Wikipedia splits long-running shows into per-campaign articles and
    // sections: "Critical Role campaign four", "Critical Role (campaign
    // three)". Both are the show this project already indexes, with the
    // campaign as a season — so strip the qualifier before giving up, or the
    // sweep reports Critical Role as a show we have never heard of.
    const variants = [
      raw,
      raw.replace(/\s*\([^)]*\)\s*$/, ''),
      raw.replace(/\s+(campaign|season|series|part|chapter)\s+\S+$/i, ''),
    ];
    for (const candidate of variants) {
      const direct = byTitle.get(titleKey(candidate));
      if (direct) return direct;
      const tail = candidate.split(/\s+[–—:-]\s+/).pop();
      const byTail = tail && tail !== candidate ? byTitle.get(titleKey(tail)) : undefined;
      if (byTail) return byTail;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Who to sweep
// ---------------------------------------------------------------------------
interface Target {
  person: Person;
  wikipedia?: string;
  qid?: string;
}

const wanted = flag('person');
const targets: Target[] = people
  .filter((p) => (wanted ? p.id === wanted : p.links?.wikipedia || p.wikidata_qid))
  .map((p) => ({ person: p, wikipedia: p.links?.wikipedia, qid: p.wikidata_qid }));

if (targets.length === 0) {
  console.error(wanted ? `No person with id "${wanted}".` : 'No people carry a Wikipedia link or a QID.');
  process.exit(1);
}

const limit = Number(flag('limit') ?? (has('all') || wanted ? targets.length : 25));
const queue = targets.slice(0, limit);

const noHandle = people.length - targets.length;
console.log(`\nPerson-first sweep: ${queue.length} of ${targets.length} people with a reference handle.`);
if (!wanted) {
  console.log(
    `${noHandle} of ${people.length} people carry neither a Wikipedia link nor a QID — ` +
      `unreachable by this pass, and the reason it is not the whole answer.\n`,
  );
}

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------
interface Candidate {
  title: string;
  link?: string;
  year?: string;
  role?: string;
  character?: string;
  origin: string;
  evidence?: string;
  verdict: Verdict;
  reasons: string[];
  /** Catalogue state: what we already have for this work, if anything. */
  status: 'missing-show' | 'missing-credit' | 'have-it';
  show?: string;
  season?: number;
}

interface PersonReport {
  person: string;
  wikipedia?: string;
  qid?: string;
  error?: string;
  candidates: Candidate[];
}

/** Does this person already have a credit on that show (any season)? */
function alreadyCredited(credits: Credit[], showId: string, season?: number): boolean {
  return credits.some((c) => c.show === showId && (season === undefined || c.season === undefined || c.season === season));
}

const reports: PersonReport[] = [];

for (const target of queue) {
  const report: PersonReport = {
    person: target.person.id,
    wikipedia: target.wikipedia,
    qid: target.qid,
    candidates: [],
  };
  reports.push(report);

  try {
    // A QID with no stored Wikipedia link still has a sitelink; 123 of the 126
    // people here with a QID never had it written down, which is its own bug.
    let article = target.wikipedia;
    let wikidataWorks: Awaited<ReturnType<typeof fetchWorks>> = [];
    if (target.qid) {
      if (!article) article = (await fetchPerson(target.qid)).wikipedia;
      wikidataWorks = await fetchWorks(target.qid);
      report.qid = target.qid;
    }

    const works: WikiWork[] = [];
    if (article) {
      const parsed = await fetchPersonWorks(article);
      report.wikipedia = parsed.url;
      works.push(...parsed.works);
    }
    // Wikidata works the article never mentions still count — "known for" is
    // exactly where a series the prose skipped turns up.
    for (const work of wikidataWorks) {
      if (works.some((w) => (w.link ?? w.title).toLowerCase() === (work.wikipedia ?? work.title).toLowerCase())) continue;
      works.push({
        title: work.title,
        link: work.wikipedia,
        role: undefined,
        section: `Wikidata ${work.via}`,
        origin: 'table',
        evidence: work.description,
      });
    }

    // One batched call for every linked work's categories and lead.
    const links = [...new Set(works.map((w) => w.link).filter((l): l is string => Boolean(l)))];
    const facts = links.length > 0 ? await fetchWorkFacts(links) : new Map();

    for (const work of works) {
      const fact = work.link ? facts.get(work.link) : undefined;
      const classification = classify(work.title, {
        categories: fact?.categories,
        extract: fact?.extract,
        missing: fact?.missing ?? !work.link,
        section: work.section,
        role: work.role,
      });

      const match = lookup(work.title) ?? (work.link ? lookup(work.link) : undefined);
      const status: Candidate['status'] = !match
        ? 'missing-show'
        : alreadyCredited(target.person.credits ?? [], match.show, match.season)
          ? 'have-it'
          : 'missing-credit';

      report.candidates.push({
        title: work.title,
        link: work.link,
        year: work.year,
        role: work.role,
        character: work.character,
        origin: work.origin,
        evidence: work.evidence,
        verdict: classification.verdict,
        reasons: classification.reasons,
        status,
        show: match?.show,
        season: match?.season,
      });
    }
  } catch (error) {
    report.error = (error as Error).message;
  }

  // Be a good citizen: the query service and the API are both shared.
  if (queue.length > 1) await new Promise((r) => setTimeout(r, 500));
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const totals = { show: 0, credit: 0, excluded: 0, unclear: 0 };

for (const report of reports) {
  const interesting = report.candidates.filter((c) => c.status !== 'have-it' && c.verdict !== 'excluded');
  if (report.error) {
    console.log(`\n${report.person}\n  ✗ ${report.error}`);
    continue;
  }
  if (interesting.length === 0) {
    console.log(`\n${report.person}\n  nothing new (${report.candidates.length} works read)`);
    continue;
  }

  console.log(`\n${report.person}  ${report.wikipedia ?? ''}`);
  for (const candidate of interesting) {
    const mark = candidate.verdict === 'actual-play' ? '+' : '?';
    const where =
      candidate.status === 'missing-show'
        ? 'NO SHOW RECORD'
        : `have show "${candidate.show}"${candidate.season ? ` s${candidate.season}` : ''}, no credit`;
    console.log(`  ${mark} ${candidate.title}${candidate.year ? ` (${candidate.year})` : ''} — ${where}`);
    console.log(
      `      ${candidate.role ?? 'role unknown'}${candidate.character ? ` as ${candidate.character}` : ''}` +
        `  [${candidate.verdict}: ${candidate.reasons[0] ?? 'no reason recorded'}]`,
    );
    if (candidate.evidence) console.log(`      "${candidate.evidence.slice(0, 200)}"`);

    if (candidate.verdict === 'actual-play') {
      candidate.status === 'missing-show' ? totals.show++ : totals.credit++;
    } else {
      totals.unclear++;
    }
  }
  totals.excluded += report.candidates.filter((c) => c.verdict === 'excluded').length;
}

console.log(
  `\n${totals.show} show(s) with no record, ${totals.credit} missing credit(s) on shows we have, ` +
    `${totals.unclear} unclear, ${totals.excluded} excluded as not actual play.`,
);

// ---------------------------------------------------------------------------
// --apply: write the credits that need no guessing.
//
// Wikipedia is additive here, never authoritative. It is a `reference` tier
// source and a fallible one — POLICY.md's worked example of a source being
// wrong about this project's subject is a Wikipedia filmography table — so
// what it may do is add a credit the catalogue lacks, or add itself as a
// second source to one already recorded. What it may never do is overwrite
// something a closer source established, or invent a record it cannot fully
// support. Four gates enforce that:
//
//   1. The show must already exist here. A person's article names a series
//      but not its channel, system or season structure, so a show built from
//      it would be a stub competing with the real importers — which read the
//      production's own playlist or the archive item and get those fields
//      right. Missing shows stay in the report.
//   2. The role must be stated. A credit whose role was guessed is worse than
//      no credit; "appeared on" without a role is not a role.
//   3. Writes go through upsertCredit, the same merge every importer uses. An
//      existing credit keeps its own character, note and role — Wikipedia's
//      version is only ever appended as another source.
//   4. Nothing creates a person. Someone absent here is absent from the sweep
//      too; this only ever adds to the 968 already indexed.
// ---------------------------------------------------------------------------
if (!has('apply')) {
  console.log('Nothing was written. Re-run with --apply to file the credits that need no guessing.\n');
} else {
  let added = 0;
  let corroborated = 0;
  let skippedNoRole = 0;
  let skippedNoShow = 0;

  for (const report of reports) {
    const target = targets.find((t) => t.person.id === report.person);
    if (!target || !report.wikipedia) continue;

    const path = join(DATA_ROOT, 'people', `${report.person}.yml`);
    const record = parse(await readFile(path, 'utf8'));
    let credits: Credit[] = record.credits ?? [];
    let touched = false;

    for (const candidate of report.candidates) {
      if (candidate.verdict !== 'actual-play') continue;
      if (!candidate.show) { skippedNoShow++; continue; }
      if (!candidate.role) { skippedNoRole++; continue; }

      const incoming = {
        show: candidate.show,
        ...(candidate.season !== undefined ? { season: candidate.season } : {}),
        role: candidate.role,
        ...(candidate.character ? { character: candidate.character } : {}),
        ...(candidate.year ? { year: candidate.year } : {}),
        sources: [
          {
            tier: 'reference' as const,
            url: report.wikipedia,
            note:
              `Wikipedia's article on ${record.canonical_name}` +
              (candidate.evidence ? `: "${candidate.evidence.slice(0, 220)}"` : '.'),
          },
        ],
      } as Credit;

      const result = upsertCredit(credits, incoming);
      if (result.outcome === 'already-cited') continue;
      credits = result.credits;
      touched = true;
      result.outcome === 'added' ? added++ : corroborated++;
    }

    if (touched) {
      record.credits = credits;
      await writeFile(path, stringify(record), 'utf8');
    }
  }

  console.log(
    `\n${added} credit(s) added, ${corroborated} existing credit(s) gained Wikipedia as a ` +
      `second source.\n${skippedNoShow} skipped — no show record here; ` +
      `${skippedNoRole} skipped — the sentence states no role.`,
  );
  console.log('Run `npm run validate` before committing.\n');
}

const jsonPath = flag('json');
if (jsonPath) {
  await mkdir(dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify({ generated: new Date().toISOString(), reports }, null, 2)}\n`);
  console.log(`Wrote ${jsonPath}\n`);
}
