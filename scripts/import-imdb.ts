#!/usr/bin/env tsx
/**
 * Match our shows against IMDb's bulk datasets and import the credits.
 *
 *   npm run fetch:imdb                 # download / refresh the dumps
 *   npm run import:imdb -- --dry-run
 *   npm run import:imdb
 *
 * Matching is the risky part, so it is deliberately strict. A show is matched
 * only on an exact normalised-title hit, and where we already hold credits for
 * that show the IMDb cast must overlap them — a title that matches but whose
 * cast shares nobody is a different production with the same name. Shows with
 * no credits at all cannot be checked that way, so those matches are reported
 * separately and imported at a lower confidence.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { DATA_ROOT } from '../src/lib/load.js';
import { rows, val, titleKey, SERIES_TYPES, creditFrom, type ImdbCredit } from '../src/lib/sources/imdb.js';

const CACHE = '.cache/imdb';
const args = process.argv.slice(2);
const has = (n: string) => args.includes(`--${n}`);
const flag = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const DRY = has('dry-run');

for (const f of ['title.basics', 'title.episode', 'title.principals', 'name.basics']) {
  if (!existsSync(join(CACHE, `${f}.tsv.gz`))) {
    console.error(`Missing ${CACHE}/${f}.tsv.gz — run \`npm run fetch:imdb\` first.`);
    process.exit(1);
  }
}

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 55).replace(/-+$/, '');
const sortName = (n: string) => {
  const p = n.trim().split(/\s+/); if (p.length < 2) return n;
  const l = p.pop()!; return `${l}, ${p.join(' ')}`;
};

// ---------------------------------------------------------------------------
// What we already know
// ---------------------------------------------------------------------------
interface Local { id: string; title: string; seasons: number; }
const wanted = new Map<string, Local[]>();   // titleKey -> our shows
const showById = new Map<string, Local>();
for (const f of (await readdir(join(DATA_ROOT, 'shows'))).filter((f) => f.endsWith('.yml'))) {
  const s = parse(await readFile(join(DATA_ROOT, 'shows', f), 'utf8'));
  const local: Local = { id: s.id, title: s.title, seasons: (s.seasons ?? []).length };
  showById.set(s.id, local);
  const k = titleKey(s.title);
  if (!wanted.has(k)) wanted.set(k, []);
  wanted.get(k)!.push(local);
}

// Existing cast per show, for the overlap check; and every person we hold.
const existingCast = new Map<string, Set<string>>();
const personByName = new Map<string, string>();
for (const f of (await readdir(join(DATA_ROOT, 'people'))).filter((f) => f.endsWith('.yml'))) {
  const p = parse(await readFile(join(DATA_ROOT, 'people', f), 'utf8'));
  for (const a of p.aliases ?? []) personByName.set(a.name.toLowerCase(), p.id);
  personByName.set(p.canonical_name.toLowerCase(), p.id);
  for (const c of p.credits ?? []) {
    if (!existingCast.has(c.show)) existingCast.set(c.show, new Set());
    existingCast.get(c.show)!.add(p.canonical_name.toLowerCase());
  }
}

console.log(`\n${wanted.size} distinct show titles to look for.\n`);

// ---------------------------------------------------------------------------
// Pass 1 — title.basics: find candidate tconsts
// ---------------------------------------------------------------------------
interface Cand { tconst: string; type: string; title: string; year?: string; local: Local }
const candidates: Cand[] = [];
let scanned = 0;
for await (const r of rows(join(CACHE, 'title.basics.tsv.gz'))) {
  scanned++;
  const [tconst, titleType, primary, original, _adult, startYear] = r;
  if (!SERIES_TYPES.has(titleType!)) continue;
  for (const t of new Set([primary, original])) {
    if (!t) continue;
    const locals = wanted.get(titleKey(t));
    if (!locals) continue;
    for (const local of locals) {
      candidates.push({ tconst: tconst!, type: titleType!, title: t, year: val(startYear), local });
    }
    break;
  }
}
console.log(`Pass 1: ${scanned.toLocaleString()} titles scanned, ${candidates.length} candidate match(es).`);

const candByTconst = new Map(candidates.map((c) => [c.tconst, c]));

// ---------------------------------------------------------------------------
// Pass 2 — title.episode: episodes belonging to candidate series
// ---------------------------------------------------------------------------
const episodeOf = new Map<string, { parent: string; season?: string; ep?: string }>();
for await (const [tconst, parent, season, ep] of rows(join(CACHE, 'title.episode.tsv.gz'))) {
  if (!candByTconst.has(parent!)) continue;
  episodeOf.set(tconst!, { parent: parent!, season: val(season), ep: val(ep) });
}
console.log(`Pass 2: ${episodeOf.size} episode(s) belong to candidate series.`);

// ---------------------------------------------------------------------------
// Pass 3 — title.principals: credits on those titles
// ---------------------------------------------------------------------------
const keep = new Set<string>([...candByTconst.keys(), ...episodeOf.keys()]);

// Bucket by IMDb title, NOT by our show. A title like "Tempting Fate" matches
// both the Saving Throw stream and a 1998 film; bucketing by our show id
// merged both casts into one, and the merged cast then passed the overlap
// check on the strength of the real half. That put Alyssa Milano in a Fate
// Core actual play. Each candidate title is now assessed on its own.
const perTitle = new Map<string, Map<string, ImdbCredit>>();   // tconst -> nconst|role -> credit
const namesNeeded = new Set<string>();
for await (const [tconst, _ord, nconst, category, _job, characters] of rows(join(CACHE, 'title.principals.tsv.gz'))) {
  if (!keep.has(tconst!)) continue;
  const parentT = episodeOf.get(tconst!)?.parent ?? tconst!;
  if (!candByTconst.has(parentT)) continue;
  const made = creditFrom(category!, val(characters));
  if (!made) continue;
  if (!perTitle.has(parentT)) perTitle.set(parentT, new Map());
  const bucket = perTitle.get(parentT)!;
  const k = `${nconst}|${made.role}`;
  // Prefer the row that names a character.
  if (!bucket.has(k) || (made.character && !bucket.get(k)!.character)) {
    bucket.set(k, { nconst: nconst!, ...made });
  }
  namesNeeded.add(nconst!);
}
console.log(`Pass 3: credits found for ${perTitle.size} IMDb title(s); ${namesNeeded.size} names to resolve.`);

// ---------------------------------------------------------------------------
// Pass 4 — name.basics
// ---------------------------------------------------------------------------
const nameOf = new Map<string, string>();
for await (const [nconst, primaryName] of rows(join(CACHE, 'name.basics.tsv.gz'))) {
  if (namesNeeded.has(nconst!)) nameOf.set(nconst!, primaryName!);
}
console.log(`Pass 4: ${nameOf.size} name(s) resolved.\n`);

// ---------------------------------------------------------------------------
// Verify, then write
// ---------------------------------------------------------------------------
const limit = Number.parseInt(flag('limit') ?? '9999', 10);
let written = 0, createdPeople = 0, confirmed = 0, unverifiable = 0, rejected = 0;
const review: { show: string; tconst: string; imdbTitle: string; year?: string;
                reason: string; had: number; cast: string[] }[] = [];

// Group the candidate titles by which of our shows they matched.
const candsForShow = new Map<string, Cand[]>();
for (const c of candidates) {
  if (!perTitle.has(c.tconst)) continue;
  if (!candsForShow.has(c.local.id)) candsForShow.set(c.local.id, []);
  candsForShow.get(c.local.id)!.push(c);
}

for (const [showId, cands] of [...candsForShow].slice(0, limit)) {
  const local = showById.get(showId)!;
  const known = existingCast.get(showId);

  // Score every candidate title separately, then take at most one. Where two
  // IMDb titles share a name, only one of them is our show.
  const scored = cands.map((cand) => {
    const bucket = perTitle.get(cand.tconst)!;
    const imdbNames = [...bucket.values()]
      .map((c) => nameOf.get(c.nconst)?.toLowerCase()).filter(Boolean) as string[];
    const overlap = known ? imdbNames.filter((n) => known.has(n)).length : 0;
    // Anyone in this cast we already hold, on any show at all. A weaker signal
    // than same-show overlap, but actual play is a small world: a real indie AP
    // cast almost always contains someone already in here, and Omnibus (1952)
    // does not.
    const familiar = imdbNames.filter((n) => personByName.has(n)).length;
    return { cand, bucket, imdbNames, overlap, familiar };
  }).sort((a, b) => b.overlap - a.overlap || b.familiar - a.familiar);

  const best = scored[0]!;
  const { cand, bucket, imdbNames, overlap, familiar } = best;

  let confidence: 'confirmed' | 'title-only';
  if (overlap > 0) {
    confidence = 'confirmed';
    confirmed++;
  } else {
    // Title-only matching on its own is worthless: it matched our "Legacy" to
    // a 1902 title with 1,902 credits, and "Guardians of the Galaxy" to the
    // Marvel series. Three guards, all of which a real indie AP passes easily.
    const year = Number.parseInt(cand.year ?? '0', 10);
    const why: string[] = [];
    if (year && year < 2005) why.push(`dated ${year}, before actual play existed as a published format`);
    if (bucket.size > 40) why.push(`${bucket.size} principals — far larger than any actual play cast`);
    if (familiar < 2) why.push(`only ${familiar} of its cast appear anywhere in this database`);

    if (why.length > 0) {
      review.push({ show: local.title, tconst: cand.tconst, imdbTitle: cand.title, year: cand.year,
        reason: why.join('; '), had: known?.size ?? 0, cast: imdbNames.slice(0, 8) });
      rejected++;
      continue;
    }
    confidence = 'title-only';
    unverifiable++;
  }

  if (scored.length > 1) {
    console.log(`  (${local.title}: ${scored.length} IMDb titles share this name; took ${cand.tconst}, ` +
      `overlap ${overlap} vs ${scored.slice(1).map((s) => s.overlap).join('/')})`);
  }

  const url = `https://www.imdb.com/title/${cand.tconst}/fullcredits/`;
  console.log(`${confidence === 'confirmed' ? '✓' : '?'} ${local.title.slice(0, 40).padEnd(40)} ${cand.tconst}  ${bucket.size} credit(s)`);
  if (DRY) {
    for (const c of bucket.values()) {
      console.log(`      ${c.role.padEnd(10)} ${nameOf.get(c.nconst) ?? c.nconst}${c.character ? ` as ${c.character}` : ''}`);
    }
    continue;
  }

  for (const c of bucket.values()) {
    const name = nameOf.get(c.nconst);
    if (!name) continue;
    const id = personByName.get(name.toLowerCase()) ?? slug(name);
    if (!id) continue;
    const path = join(DATA_ROOT, 'people', `${id}.yml`);
    let person: any;
    try { person = parse(await readFile(path, 'utf8')); }
    catch {
      person = { id, canonical_name: name, sort_name: sortName(name),
        aliases: [{ id: 'default', name, alias_type: name.includes(' ') ? 'legal' : 'handle' }], credits: [] };
      createdPeople++;
    }
    if ((person.credits ??= []).some((x: any) => x.show === showId && x.role === c.role)) continue;

    // Only claim a season when there is only one it could be. IMDb's season
    // numbers are its own and do not track ours — Acquisitions Incorporated's
    // ordinal 14 is its "Season Twelve", because two interludes sit in
    // between — so mapping IMDb season N onto ordinal N would invent data in
    // exactly the way `game: dnd-5e` once did across 67 shows.
    const credit: any = { show: showId, role: c.role };
    if (local.seasons === 1) credit.season = 1;
    // IMDb records someone appearing as themselves by putting their own name
    // in the characters array. Carried through verbatim that reads as "Marisha
    // Ray as Marisha Ray", and trips the audit rule for inverted pairings.
    if (c.character && c.character.toLowerCase() !== name.toLowerCase()) credit.character = c.character;

    const notes: string[] = [];
    if (confidence === 'title-only') {
      notes.push('Matched to IMDb on title alone; no existing credit here to cross-check against.');
    }
    if (local.seasons > 1) {
      notes.push("IMDb credits this at series level; which of this show's seasons it covers is not established.");
    }
    if (notes.length) credit.note = notes.join(' ');
    if (person.aliases?.length === 1) credit.alias = person.aliases[0].id;
    credit.sources = [{
      tier: 'reference',
      url,
      note: `IMDb full cast and crew for "${cand.title}"${cand.year ? ` (${cand.year})` : ''}, via the official datasets.`,
    }];
    person.credits.push(credit);
    await writeFile(path, stringify(person), 'utf8');
    written++;
    personByName.set(name.toLowerCase(), id);
  }
}

// A rejection is a judgement call, not a fact, so it gets written down rather
// than dropped. Several of these are probably right and simply have a cast
// recorded here under different names.
if (review.length) {
  const lines = ['# IMDb matches this import declined to make', '',
    'Each row is a show whose title matched an IMDb entry that could not be verified.',
    'Some are genuine mismatches; others are likely correct and just need a human eye.', ''];
  for (const r of review) {
    lines.push(`## ${r.show}`);
    lines.push(`- IMDb: [${r.imdbTitle}${r.year ? ` (${r.year})` : ''}](https://www.imdb.com/title/${r.tconst}/)`);
    lines.push(`- Declined because: ${r.reason}`);
    lines.push(`- We already hold ${r.had} credit(s) for this show`);
    lines.push(`- IMDb cast: ${r.cast.join(', ')}`);
    lines.push('');
  }
  await writeFile('IMDB-REVIEW.md', lines.join('\n'), 'utf8');
  console.log(`\n${review.length} declined match(es) written to IMDB-REVIEW.md for a human to adjudicate.`);
}

console.log(`\n${confirmed} show(s) confirmed by cast overlap, ${unverifiable} matched on title only, ${rejected} declined.`);
console.log(DRY ? 'Dry run — nothing written.' : `${written} credit(s) written, ${createdPeople} new people.\n`);
