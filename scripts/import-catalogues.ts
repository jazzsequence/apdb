#!/usr/bin/env tsx
/**
 * Fill in cast lists from TMDB and TheTVDB.
 *
 *   npm run import:catalogues -- --dry-run
 *   npm run import:catalogues -- --limit 40
 *
 * These are cast-filling sources, not discovery sources. Every show processed
 * is one already in the database, and a catalogue entry is only trusted when
 * it either overlaps the cast we already hold or names at least two people who
 * appear somewhere in this database. A general film and TV catalogue indexes
 * everything, so a bare title match inside one is close to no evidence.
 *
 * Where a credit already exists, the catalogue's source is appended rather
 * than the credit skipped — that is the whole point of running a second
 * source over data a first source already covered.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { DATA_ROOT } from '../src/lib/load.js';
import { tmdbFind, tmdbCast, tvdbCast, type CatalogueResult } from '../src/lib/sources/catalogues.js';
import { upsertCredit } from '../src/lib/credits.js';

const args = process.argv.slice(2);
const has = (n: string) => args.includes(`--${n}`);
const flag = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const DRY = has('dry-run');
const limit = Number.parseInt(flag('limit') ?? '9999', 10);
const only = flag('only');

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 55).replace(/-+$/, '');
const sortName = (n: string) => {
  const p = n.trim().split(/\s+/); if (p.length < 2) return n;
  const l = p.pop()!; return `${l}, ${p.join(' ')}`;
};

interface Local { id: string; title: string; seasons: number }
const shows: Local[] = [];
for (const f of (await readdir(join(DATA_ROOT, 'shows'))).filter((f) => f.endsWith('.yml'))) {
  const s = parse(await readFile(join(DATA_ROOT, 'shows', f), 'utf8'));
  shows.push({ id: s.id, title: s.title, seasons: (s.seasons ?? []).length });
}

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

// Work the thinnest shows first — that is where a second catalogue helps most.
const targets = shows
  .filter((s) => (only ? s.id === only : true))
  .sort((a, b) => (existingCast.get(a.id)?.size ?? 0) - (existingCast.get(b.id)?.size ?? 0))
  .slice(0, limit);

console.log(`\nChecking ${targets.length} show(s) against TMDB and TheTVDB.\n`);

let added = 0, corroborated = 0, created = 0, matched = 0, declined = 0;

for (const show of targets) {
  const known = existingCast.get(show.id) ?? new Set<string>();

  const found: { origin: 'TMDB' | 'TheTVDB'; result: CatalogueResult }[] = [];
  const tmdbPath = await tmdbFind(show.title);
  if (tmdbPath) {
    const r = await tmdbCast(tmdbPath);
    if (r) found.push({ origin: 'TMDB', result: r });
  }
  const tvdb = await tvdbCast(slug(show.title), show.title);
  if (tvdb) found.push({ origin: 'TheTVDB', result: tvdb });

  for (const { origin, result } of found) {
    const names = result.credits.map((c) => c.name.toLowerCase());
    const overlap = names.filter((n) => known.has(n)).length;
    const familiar = names.filter((n) => personByName.has(n)).length;

    // Same guard as the IMDb importer: a title match alone is not evidence.
    if (overlap === 0 && familiar < 2) {
      console.log(`  ✗ ${show.title.slice(0, 38).padEnd(38)} ${origin} — shares nobody with us; not our show.`);
      declined++;
      continue;
    }
    matched++;
    console.log(`  ✓ ${show.title.slice(0, 38).padEnd(38)} ${origin} ${result.credits.length} name(s), overlap ${overlap}`);
    if (DRY) {
      for (const c of result.credits.slice(0, 6)) {
        console.log(`        ${c.role.padEnd(8)} ${c.name}${c.character ? ` as ${c.character}` : ''}`);
      }
      continue;
    }

    for (const c of result.credits) {
      const id = personByName.get(c.name.toLowerCase()) ?? slug(c.name);
      if (!id) continue;
      const path = join(DATA_ROOT, 'people', `${id}.yml`);
      let person: any;
      try { person = parse(await readFile(path, 'utf8')); }
      catch {
        person = { id, canonical_name: c.name, sort_name: sortName(c.name),
          aliases: [{ id: 'default', name: c.name, alias_type: c.name.includes(' ') ? 'legal' : 'handle' }],
          credits: [] };
        created++;
      }
      const credit: any = { show: show.id, role: c.role };
      if (show.seasons === 1) credit.season = 1;
      if (c.character) credit.character = c.character;
      if (show.seasons > 1) {
        credit.note = `${origin} credits this at series level; which season it covers is not established.`;
      }
      if (person.aliases?.length === 1) credit.alias = person.aliases[0].id;
      credit.sources = [{
        tier: 'reference',
        url: result.url,
        note: `Cast for "${show.title}" per ${origin}.`,
      }];

      const out = upsertCredit(person.credits ??= [], credit);
      if (out.outcome === 'already-cited') continue;
      person.credits = out.credits;
      await writeFile(path, stringify(person), 'utf8');
      out.outcome === 'corroborated' ? corroborated++ : added++;
      personByName.set(c.name.toLowerCase(), id);
    }
  }
  await new Promise((r) => setTimeout(r, 400));   // be polite to both sites
}

console.log(`\n${matched} catalogue page(s) accepted, ${declined} declined.`);
console.log(DRY ? 'Dry run — nothing written.' : `${added} new credit(s), ${corroborated} corroborated, ${created} new people.\n`);
