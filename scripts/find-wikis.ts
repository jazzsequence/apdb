#!/usr/bin/env tsx
/**
 * Find fan wikis for shows that have no credits.
 *
 * Working the audit's gap queue by hand kept turning up the same answer:
 * somebody already built a wiki, and once found the existing adapter reads it.
 * That question — "does a wiki exist for this?" — is the automatable part, so
 * this asks it for every credit-less show instead of waiting for someone to
 * search one at a time.
 *
 * Probes likely Fandom and Miraheze hosts derived from the show and channel
 * names, checks each for a real MediaWiki API and a campaign template, and
 * reports what to import. Writes nothing on its own.
 *
 *   npm run find:wikis
 *   npm run find:wikis -- --limit 40
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { DATA_ROOT } from '../src/lib/load.js';
import { CAMPAIGN_TEMPLATES } from '../src/lib/sources/mediawiki.js';

const UA = 'ActualPlayDatabase/0.1 (community actual-play credit index)';
const args = process.argv.slice(2);
const flag = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};

/** Candidate hostnames for a name: fandom and miraheze, with and without spaces. */
function candidateHosts(name: string): string[] {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9\s]/g, '')
    .trim();
  if (!base) return [];

  const squashed = base.replace(/\s+/g, '');
  const hyphenated = base.replace(/\s+/g, '-');
  const noArticles = base.replace(/^(the|a)\s+/, '').replace(/\s+/g, '');

  return [...new Set([squashed, hyphenated, noArticles])]
    .filter((s) => s.length >= 4 && s.length <= 40)
    .flatMap((s) => [`${s}.fandom.com`, `${s}.miraheze.org`]);
}

async function apiOk(host: string): Promise<{ name: string; articles: number } | undefined> {
  for (const path of ['/api.php', '/w/api.php']) {
    try {
      const r = await fetch(
        `https://${host}${path}?action=query&meta=siteinfo&siprop=general|statistics&format=json&formatversion=2`,
        { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(9000) },
      );
      if (!r.ok) continue;
      const d: any = await r.json();
      const g = d?.query?.general;
      if (g?.sitename) {
        return { name: g.sitename, articles: d?.query?.statistics?.articles ?? 0 };
      }
    } catch {
      // unreachable host; try the next path
    }
  }
  return undefined;
}

/** Any campaign template with pages behind it. */
async function campaignTemplate(host: string): Promise<{ template: string; pages: number } | undefined> {
  for (const t of CAMPAIGN_TEMPLATES) {
    try {
      const r = await fetch(
        `https://${host}/api.php?action=query&list=embeddedin&eititle=${encodeURIComponent(t)}&einamespace=0&eilimit=500&format=json&formatversion=2`,
        { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(9000) },
      );
      if (!r.ok) continue;
      const d: any = await r.json();
      const n = d?.query?.embeddedin?.length ?? 0;
      if (n > 0) return { template: t, pages: n };
    } catch {
      // try the next template
    }
  }
  return undefined;
}

const limit = Number.parseInt(flag('limit') ?? '60', 10);

// Which shows have no credits at all, and which channels do they belong to?
const credited = new Set<string>();
for (const f of (await readdir(join(DATA_ROOT, 'people'))).filter((f) => f.endsWith('.yml'))) {
  const p = parse(await readFile(join(DATA_ROOT, 'people', f), 'utf8'));
  for (const c of p.credits ?? []) credited.add(c.show);
}

const gaps: { title: string; channel: string; episodes: number }[] = [];
const channelNames = new Map<string, string>();
for (const f of (await readdir(join(DATA_ROOT, 'channels'))).filter((f) => f.endsWith('.yml'))) {
  const c = parse(await readFile(join(DATA_ROOT, 'channels', f), 'utf8'));
  channelNames.set(c.id, c.name);
}
for (const f of (await readdir(join(DATA_ROOT, 'shows'))).filter((f) => f.endsWith('.yml'))) {
  const s = parse(await readFile(join(DATA_ROOT, 'shows', f), 'utf8'));
  if (credited.has(s.id)) continue;
  gaps.push({
    title: s.title,
    channel: (s.channels ?? [])[0] ?? '',
    episodes: (s.seasons ?? []).reduce((n: number, x: any) => n + (x.episode_count ?? 0), 0),
  });
}
gaps.sort((a, b) => b.episodes - a.episodes);

// Probe by channel first — one wiki usually covers a whole channel's output.
const names = new Map<string, number>();
for (const g of gaps.slice(0, limit * 3)) {
  const channel = channelNames.get(g.channel);
  if (channel) names.set(channel, (names.get(channel) ?? 0) + g.episodes);
  names.set(g.title, (names.get(g.title) ?? 0) + g.episodes);
}

const ranked = [...names.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
console.log(`\n${gaps.length} credit-less shows. Probing ${ranked.length} names for a wiki.\n`);

const seen = new Set<string>();
let found = 0;

for (const [name] of ranked) {
  for (const host of candidateHosts(name)) {
    if (seen.has(host)) continue;
    seen.add(host);

    const site = await apiOk(host);
    if (!site || site.articles < 20) continue;

    const tpl = await campaignTemplate(host);
    console.log(
      `✓ ${host.padEnd(38)} ${String(site.articles).padStart(6)} articles  ${site.name.slice(0, 34)}` +
        (tpl ? `\n     ${tpl.template} = ${tpl.pages} pages` : '\n     (no campaign template found)'),
    );
    if (tpl) found += 1;
    break;
  }
}

console.log(`\n${found} wiki(s) with a campaign template. Import with:`);
console.log('  npm run collect -- --wiki <host> --discover --dry-run\n');
