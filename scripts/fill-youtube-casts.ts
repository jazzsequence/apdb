#!/usr/bin/env tsx
/**
 * Read casts from the YouTube descriptions of shows that have none.
 *
 * The gap this closes: `import-yt-shows` creates a show and looks for a cast
 * in the same pass, but it skips any show that already exists and only reads
 * the first two videos of a playlist. So a show whose cast is stated in, say,
 * episode nine was created empty and never looked at again. 84 of the shows
 * with no credits came from YouTube.
 *
 * A production's own episode description is the production describing itself,
 * so anything found here is `official` tier.
 *
 *   YOUTUBE_API_KEY=… npm run fill:youtube -- --dry-run
 *   YOUTUBE_API_KEY=… npm run fill:youtube -- --videos 12
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { DATA_ROOT } from '../src/lib/load.js';
import { creditsFromDescription, playlistVideos } from '../src/lib/sources/youtube.js';
import { upsertCredit } from '../src/lib/credits.js';

const args = process.argv.slice(2);
const has = (n: string) => args.includes(`--${n}`);
const flag = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const DRY = has('dry-run');
const perShow = Number.parseInt(flag('videos') ?? '10', 10);
const limit = Number.parseInt(flag('limit') ?? '9999', 10);

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 55).replace(/-+$/, '');
const sortName = (n: string) => { const p = n.trim().split(/\s+/); if (p.length < 2) return n; const l = p.pop()!; return `${l}, ${p.join(' ')}`; };

const credited = new Set<string>();
const personByName = new Map<string, string>();
for (const f of (await readdir(join(DATA_ROOT, 'people'))).filter((x) => x.endsWith('.yml'))) {
  const p = parse(await readFile(join(DATA_ROOT, 'people', f), 'utf8'));
  for (const a of p.aliases ?? []) personByName.set(a.name.toLowerCase(), p.id);
  personByName.set(p.canonical_name.toLowerCase(), p.id);
  for (const c of p.credits ?? []) credited.add(c.show);
}

/** Credit-less shows whose link is a YouTube playlist we can read. */
const targets: { id: string; title: string; playlist: string; seasons: number }[] = [];
for (const f of (await readdir(join(DATA_ROOT, 'shows'))).filter((x) => x.endsWith('.yml'))) {
  const s = parse(await readFile(join(DATA_ROOT, 'shows', f), 'utf8'));
  if (credited.has(s.id)) continue;
  const url = String(s.links?.website ?? s.links?.youtube ?? '');
  const list = url.match(/[?&]list=([\w-]+)/)?.[1];
  if (!list) continue;
  targets.push({ id: s.id, title: s.title, playlist: list, seasons: (s.seasons ?? []).length });
}

console.log(`\n${targets.length} credit-less show(s) have a readable YouTube playlist. Reading up to ${perShow} descriptions each.\n`);

let filled = 0, added = 0, corroborated = 0, created = 0, none = 0;

for (const t of targets.slice(0, limit)) {
  let best: ReturnType<typeof creditsFromDescription> = [];
  let bestVideo: { id: string; title: string } | undefined;
  try {
    // Read further into the playlist than the two-video peek the show-importer
    // did. Casts are routinely stated in a later episode, or in none at all.
    for (const v of await playlistVideos(t.playlist, perShow)) {
      const found = creditsFromDescription(v.description);
      if (found.length > best.length) { best = found; bestVideo = { id: v.id, title: v.title }; }
    }
  } catch (err) {
    console.log(`  ! ${t.title.slice(0, 40)} — ${(err as Error).message.slice(0, 60)}`);
    continue;
  }

  if (best.length < 2 || !bestVideo) { none++; continue; }
  filled++;
  console.log(`✓ ${t.title.slice(0, 42).padEnd(42)} ${best.length} name(s) from "${bestVideo.title.slice(0, 30)}"`);
  if (DRY) {
    for (const c of best) console.log(`      ${c.role.padEnd(10)} ${c.name}${c.character ? ` as ${c.character}` : ''}`);
    continue;
  }

  const source = {
    tier: 'official' as const,
    url: `https://www.youtube.com/watch?v=${bestVideo.id}`,
    note: `Cast stated in the show's own description for "${bestVideo.title}".`,
  };

  for (const c of best) {
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
    const credit: any = { show: t.id, role: c.role, sources: [source] };
    if (t.seasons === 1) credit.season = 1;
    if (c.character) credit.character = c.character;
    if (person.aliases?.length === 1) credit.alias = person.aliases[0].id;

    const r = upsertCredit(person.credits ??= [], credit);
    if (r.outcome === 'already-cited') continue;
    person.credits = r.credits;
    await writeFile(path, stringify(person), 'utf8');
    r.outcome === 'corroborated' ? corroborated++ : added++;
    personByName.set(c.name.toLowerCase(), id);
  }
}

console.log(`\n${filled} show(s) had a cast in their descriptions, ${none} did not.`);
console.log(DRY ? 'Dry run — nothing written.' : `${added} credit(s) added, ${corroborated} corroborated, ${created} new people.\n`);
