#!/usr/bin/env tsx
/**
 * Read casts from shows' own websites.
 *
 * The route every other adapter skipped. Productions publish cast pages; this
 * finds them for shows that still have no credits, and imports at `official`
 * tier because it is the production describing itself.
 *
 *   npm run import:websites -- --dry-run
 *   npm run import:websites -- --limit 40
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { DATA_ROOT } from '../src/lib/load.js';
import { castFromWebsite, isOwnWebsite } from '../src/lib/sources/website.js';
import { upsertCredit } from '../src/lib/credits.js';

const args = process.argv.slice(2);
const flag = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (n: string) => args.includes(`--${n}`);

function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function sortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  const last = parts.pop()!;
  return `${last}, ${parts.join(' ')}`;
}

const limit = Number.parseInt(flag('limit') ?? '40', 10);

// Which shows still have no credits, and do they have their own site?
const credited = new Set<string>();
for (const f of (await readdir(join(DATA_ROOT, 'people'))).filter((f) => f.endsWith('.yml'))) {
  const p = parse(await readFile(join(DATA_ROOT, 'people', f), 'utf8'));
  for (const c of p.credits ?? []) credited.add(c.show);
}

// Most shows' links point at a YouTube playlist or a wiki, not the
// production's own site. The channel usually knows the real one, so fall back
// to it — one site often covers a whole channel's output anyway.
const channelSite = new Map<string, string>();
for (const f of (await readdir(join(DATA_ROOT, 'channels'))).filter((f) => f.endsWith('.yml'))) {
  const c = parse(await readFile(join(DATA_ROOT, 'channels', f), 'utf8'));
  const url = String(c.links?.website ?? '');
  if (url && isOwnWebsite(url)) channelSite.set(c.id, url);
}

const targets: { id: string; title: string; url: string; episodes: number }[] = [];
for (const f of (await readdir(join(DATA_ROOT, 'shows'))).filter((f) => f.endsWith('.yml'))) {
  const s = parse(await readFile(join(DATA_ROOT, 'shows', f), 'utf8'));
  if (credited.has(s.id)) continue;
  const own = String(s.links?.website ?? '');
  const url =
    own && isOwnWebsite(own) ? own : (channelSite.get((s.channels ?? [])[0]) ?? '');
  if (!url) continue;
  targets.push({
    id: s.id,
    title: s.title,
    url,
    episodes: (s.seasons ?? []).reduce((n: number, x: any) => n + (x.episode_count ?? 0), 0),
  });
}
targets.sort((a, b) => b.episodes - a.episodes);

console.log(`\n${targets.length} credit-less shows have their own website. Trying ${Math.min(limit, targets.length)}.\n`);

let imported = 0;
let shows = 0;

const readSites = new Map<string, Awaited<ReturnType<typeof castFromWebsite>>>();

for (const t of targets.slice(0, limit)) {
  if (!readSites.has(t.url)) readSites.set(t.url, await castFromWebsite(t.url));
  const found = readSites.get(t.url);
  if (!found) continue;

  console.log(`${t.title.slice(0, 44).padEnd(44)} ${found.url}`);
  for (const c of found.credits) {
    console.log(`     ${c.role.padEnd(11)} ${c.name}${c.character ? ` as ${c.character}` : ''}`);
  }
  shows += 1;
  if (has('dry-run')) continue;

  const source = {
    tier: 'official' as const,
    url: found.url,
    note: "Cast per the show's own website.",
  };

  for (const c of found.credits) {
    const id = slugify(c.name);
    if (!id) continue;
    const path = join(DATA_ROOT, 'people', `${id}.yml`);

    let person: any;
    try {
      person = parse(await readFile(path, 'utf8'));
    } catch {
      person = {
        id,
        canonical_name: c.name,
        sort_name: sortName(c.name),
        aliases: [
          { id: 'default', name: c.name, alias_type: c.name.includes(' ') ? 'legal' : 'handle' },
        ],
        credits: [],
      };
    }

    const credit: any = {
      show: t.id,
      season: 1,
      role: c.role,
      ...(c.character ? { character: c.character } : {}),
      sources: [source],
    };
    if (person.aliases.length === 1) credit.alias = person.aliases[0].id;

    // An existing credit is the show's own site confirming what another
    // source already said — corroboration, not a duplicate.
    const result = upsertCredit(person.credits ??= [], credit);
    if (result.outcome === 'already-cited') continue;
    person.credits = result.credits;
    await writeFile(path, stringify(person), 'utf8');
    imported += 1;
  }
}

console.log(`\n${shows} site(s) read, ${imported} credit(s) imported.\n`);
