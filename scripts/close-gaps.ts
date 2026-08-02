#!/usr/bin/env tsx
/**
 * Close the audit's credit gaps end to end.
 *
 * find:wikis answered "does a wiki exist?" and then handed the work back. This
 * does the whole loop: for every show with no credits, look for a wiki, and
 * where one exists with a campaign template, match its pages to the shows we
 * hold and import the casts.
 *
 * Matching is on normalised titles, so a wiki page only imports into a show it
 * actually names. Nothing is created speculatively — a wiki page with no
 * corresponding show is reported, not invented.
 *
 *   npm run close:gaps -- --dry-run
 *   npm run close:gaps -- --limit 40
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse } from 'yaml';
import { DATA_ROOT } from '../src/lib/load.js';
import { CAMPAIGN_TEMPLATES, discoverCampaignPages } from '../src/lib/sources/mediawiki.js';

const UA = 'ActualPlayDatabase/0.1 (community actual-play credit index)';
const args = process.argv.slice(2);
const flag = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (n: string) => args.includes(`--${n}`);

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/\b(season|campaign|chapter|arc|part)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

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

async function liveWiki(host: string): Promise<boolean> {
  for (const path of ['/api.php', '/w/api.php']) {
    try {
      const r = await fetch(
        `https://${host}${path}?action=query&meta=siteinfo&siprop=statistics&format=json&formatversion=2`,
        { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(9000) },
      );
      if (!r.ok) continue;
      const d: any = await r.json();
      if ((d?.query?.statistics?.articles ?? 0) >= 20) return true;
    } catch {
      // next path
    }
  }
  return false;
}

const limit = Number.parseInt(flag('limit') ?? '50', 10);

// Shows with no credits, and every show title we hold, for matching.
const credited = new Set<string>();
for (const f of (await readdir(join(DATA_ROOT, 'people'))).filter((f) => f.endsWith('.yml'))) {
  const p = parse(await readFile(join(DATA_ROOT, 'people', f), 'utf8'));
  for (const c of p.credits ?? []) credited.add(c.show);
}

const channelNames = new Map<string, string>();
for (const f of (await readdir(join(DATA_ROOT, 'channels'))).filter((f) => f.endsWith('.yml'))) {
  const c = parse(await readFile(join(DATA_ROOT, 'channels', f), 'utf8'));
  channelNames.set(c.id, c.name);
}

const shows: { id: string; title: string; channel: string; episodes: number; hasCredits: boolean }[] = [];
for (const f of (await readdir(join(DATA_ROOT, 'shows'))).filter((f) => f.endsWith('.yml'))) {
  const s = parse(await readFile(join(DATA_ROOT, 'shows', f), 'utf8'));
  shows.push({
    id: s.id,
    title: s.title,
    channel: (s.channels ?? [])[0] ?? '',
    episodes: (s.seasons ?? []).reduce((n: number, x: any) => n + (x.episode_count ?? 0), 0),
    hasCredits: credited.has(s.id),
  });
}

const byNormTitle = new Map(shows.map((s) => [norm(s.title), s.id]));
const gaps = shows.filter((s) => !s.hasCredits).sort((a, b) => b.episodes - a.episodes);
console.log(`\n${gaps.length} shows with no credits.\n`);

// Probe channel names first: one wiki usually covers a channel's whole output.
const names: string[] = [];
for (const g of gaps) {
  const ch = channelNames.get(g.channel);
  if (ch && !names.includes(ch)) names.push(ch);
  if (!names.includes(g.title)) names.push(g.title);
}

const triedHosts = new Set<string>();
let imported = 0;
let wikisUsed = 0;

for (const name of names.slice(0, limit * 4)) {
  if (wikisUsed >= limit) break;

  for (const host of candidateHosts(name)) {
    if (triedHosts.has(host)) continue;
    triedHosts.add(host);
    if (!(await liveWiki(host))) continue;

    let pages: string[] = [];
    let template = '';
    try {
      ({ pages, template } = await discoverCampaignPages(host, CAMPAIGN_TEMPLATES));
    } catch {
      break;
    }
    if (pages.length === 0) break;

    // Only import into shows this wiki actually names.
    const matches = pages
      .map((page) => ({ page, showId: byNormTitle.get(norm(page)) }))
      .filter((m): m is { page: string; showId: string } => Boolean(m.showId))
      .filter((m) => !credited.has(m.showId));

    console.log(`${host}  (${template}, ${pages.length} pages) — ${matches.length} match our gaps`);
    wikisUsed += 1;

    for (const m of matches) {
      if (has('dry-run')) {
        console.log(`     would import: ${m.page.slice(0, 50)} -> ${m.showId}`);
        continue;
      }
      try {
        const out = execFileSync(
          'npx',
          ['tsx', 'scripts/collect.ts', '--wiki', host, '--page', m.page,
           '--show', m.showId, '--season', '1', '--apply'],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
        );
        const n = Number.parseInt((out.match(/(\d+) file\(s\) written/) ?? [])[1] ?? '0', 10);
        if (n > 0) {
          imported += n;
          credited.add(m.showId);
          console.log(`     ${m.page.slice(0, 46).padEnd(46)} ${n} credits`);
        }
      } catch {
        // a page that will not parse is not worth failing the run over
      }
    }
    break;
  }
}

console.log(`\n${wikisUsed} wiki(s) used, ${imported} credit(s) imported.\n`);
