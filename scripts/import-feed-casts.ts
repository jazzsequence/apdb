#!/usr/bin/env tsx
/**
 * Read casts out of a podcast feed's episode notes.
 *
 *   npm run import:feed -- https://feed.podbean.com/enrpg/feed.xml --dry-run
 *   npm run import:feed -- https://feed.podbean.com/enrpg/feed.xml
 *
 * A production's own feed is the production describing itself, so anything
 * found here is `official` tier — the same standing as its YouTube
 * description, and better than any wiki.
 *
 * This exists because EN Publishing's feed carries full casts for shows this
 * database had listed with none, and nothing was reading podcast notes at all.
 * The YouTube importer only ever looked at YouTube.
 *
 * Feeds carry several shows at once, so episodes are grouped by the series
 * name in their title and each group is matched to a show we already hold. No
 * show is created from a feed: a title in a feed is not evidence that
 * something belongs in this index.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { DATA_ROOT } from '../src/lib/load.js';
import { upsertCredit, realCharacter } from '../src/lib/credits.js';
import type { CreditRole } from '../src/lib/schema.js';

const args = process.argv.slice(2);
const feedUrl = args.find((a) => /^https?:\/\//.test(a));
const DRY = args.includes('--dry-run');
/*
 * Create shows the feed carries that we do not hold.
 *
 * Off by default, and deliberately narrower than it sounds: POLICY.md allows
 * discovery from sources that only cover this medium, and a publisher's own
 * actual-play feed is exactly that — unlike IMDb, nothing lands in it by
 * accident. It still needs a channel to attach to, given on the command line.
 */
const CREATE = args.includes('--create');
const channelId = (() => { const i = args.indexOf('--channel'); return i >= 0 ? args[i + 1] : undefined; })();
const gameId = (() => { const i = args.indexOf('--game'); return i >= 0 ? args[i + 1] : undefined; })();
if (!feedUrl) {
  console.error('Usage: npm run import:feed -- <feed-url> [--dry-run]');
  process.exit(1);
}

const UA = 'ActualPlayDatabase/0.1 (community actual-play credit index; contact via repository issues)';
const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 55).replace(/-+$/, '');
const sortName = (n: string) => { const p = n.trim().split(/\s+/); if (p.length < 2) return n; const l = p.pop()!; return `${l}, ${p.join(' ')}`; };
const norm = (s: string) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ')
  .replace(/\b(a|an|the|actual play|an? a5e|level up advanced 5th edition|5e|podcast|series)\b/g, ' ')
  .replace(/\s+/g, ' ').trim();

const decode = (s: string) =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#x27;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

const stripTags = (s: string) =>
  decode(s).replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, '\n').replace(/<[^>]+>/g, '')
    .split('\n').map((l) => l.trim()).join('\n');

/** GM by any of the names productions actually use for the job. */
const GM_TITLE = /^(the\s+)?(narrator|game ?master|gamemaster|dungeon ?master|dm|gm|keeper|storyteller|marshal|judge|referee)$/i;

interface FeedCredit { name: string; role: CreditRole; character?: string }

/**
 * Both shapes that appear in these notes, often in the same feed:
 *
 *   Lexi McQueen as The Narrator          performer first
 *   Narrator: Russ Morrissey <url>        character first
 *
 * The second is indistinguishable from a heading without knowing which side is
 * a person, so it is only read when the left-hand side is a plausible
 * character label and the right-hand side is a plausible name.
 */
function castFromNotes(text: string): FeedCredit[] {
  const out: FeedCredit[] = [];
  // "Join us as we journey through the Dragonlance adventure" matches the
  // "X as Y" shape perfectly, so a name has to also not be a sentence.
  const PROSE = /\b(join|us|we|our|you|your|tune|watch|listen|subscribe|this|that|these|with|and|the|for|from|all|new|every|live|available)\b/i;
  const looksLikeName = (v: string) => {
    const t = v.trim();
    if (t.length > 42 || PROSE.test(t)) return false;
    return /^[\p{L}][\p{L}.'’-]*(?:\s+[\p{L}][\p{L}.'’-]*){0,3}$/u.test(t);
  };

  for (const raw of text.split('\n')) {
    const line = raw.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
    if (!line || line.length > 120) continue;
    if (/^-{3,}$/.test(line)) continue;

    const guest = /^guest\s+star(ring|s)?\s+/i.test(line);
    const body = line.replace(/^guest\s+star(ring|s)?\s+/i, '').trim();

    // "Lexi McQueen as The Narrator"
    const asMatch = body.match(/^(.+?)\s+(?:as|playing)\s+(.+)$/i);
    if (asMatch && looksLikeName(asMatch[1]!)) {
      const name = asMatch[1]!.trim();
      const character = asMatch[2]!.trim().replace(/[.,;]+$/, '');
      out.push(
        GM_TITLE.test(character)
          ? { name, role: guest ? 'guest GM' : 'GM/DM' }
          : { name, role: guest ? 'guest player' : 'player', ...(realCharacter(character) ? { character } : {}) },
      );
      continue;
    }

    // Some notes give only social handles: "GM: @tookiguess" and
    // "Players: @lochlovesya, @krisfire98, @mendarii and @dndvoices". A handle
    // is who the production credited, so it is recorded as one.
    const handleList = body.match(/^(gm|dm|game ?master|dungeon ?master|narrator|keeper|players?|cast)\s*:\s*(@.+)$/i);
    if (handleList) {
      const isGm = !/^(players?|cast)$/i.test(handleList[1]!);
      for (const h of handleList[2]!.split(/\s*(?:,|\band\b)\s*/)) {
        const handle = h.trim().replace(/^@/, '').replace(/[.!?]+$/, '');
        if (!handle || !/^[\w.-]{2,30}$/.test(handle)) continue;
        out.push({ name: handle, role: isGm ? 'GM/DM' : 'player' });
      }
      continue;
    }

    // "Royce: Dare Hickman"
    const colon = body.match(/^([^:]{2,40}):\s*(.+)$/);
    if (colon && looksLikeName(colon[2]!)) {
      const character = colon[1]!.trim();
      const name = colon[2]!.trim();
      if (/^\d/.test(character)) continue;
      out.push(
        GM_TITLE.test(character)
          ? { name, role: guest ? 'guest GM' : 'GM/DM' }
          : { name, role: guest ? 'guest player' : 'player', ...(realCharacter(character) ? { character } : {}) },
      );
    }
  }

  // One credit per person; keep the first, which is where the cast block is.
  const seen = new Set<string>();
  return out.filter((c) => {
    const k = c.name.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---------------------------------------------------------------------------

const res = await fetch(feedUrl, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
if (!res.ok) { console.error(`Feed returned ${res.status}`); process.exit(1); }
const xml = await res.text();

const episodes: { title: string; notes: string; link: string }[] = [];
for (const item of xml.match(/<item>[\s\S]*?<\/item>/g) ?? []) {
  const title = decode(item.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '').trim();
  const link = decode(item.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? '').trim();
  const body =
    item.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/)?.[1] ??
    item.match(/<description>([\s\S]*?)<\/description>/)?.[1] ??
    '';
  if (title) episodes.push({ title, notes: stripTags(body), link });
}
console.log(`\n${episodes.length} episode(s) in the feed.`);

// Group by the series name in the episode title.
const groups = new Map<string, { title: string; notes: string; link: string }[]>();
for (const ep of episodes) {
  const base = ep.title.split(/\s*[-–—:]\s*(episode|ep\.?|part|session)\b/i)[0]!
    .replace(/\s*[-–—:]\s*\d+\s*$/, '').trim();
  groups.set(base, [...(groups.get(base) ?? []), ep]);
}

// Shows we already hold, and who is already credited on them.
const shows: { id: string; title: string; seasons: number }[] = [];
for (const f of (await readdir(join(DATA_ROOT, 'shows'))).filter((f) => f.endsWith('.yml'))) {
  const s = parse(await readFile(join(DATA_ROOT, 'shows', f), 'utf8'));
  shows.push({ id: s.id, title: s.title, seasons: (s.seasons ?? []).length });
}
const personByName = new Map<string, string>();
for (const f of (await readdir(join(DATA_ROOT, 'people'))).filter((f) => f.endsWith('.yml'))) {
  const p = parse(await readFile(join(DATA_ROOT, 'people', f), 'utf8'));
  for (const a of p.aliases ?? []) personByName.set(a.name.toLowerCase(), p.id);
  personByName.set(p.canonical_name.toLowerCase(), p.id);
}

let added = 0, corroborated = 0, created = 0, matched = 0, unmatched = 0, createdShows = 0;

for (const [series, eps] of groups) {
  const key = norm(series);
  if (!key) continue;
  /** Levenshtein, capped — only used to catch typo variants of a real title. */
  const close = (a: string, b: string) => {
    if (Math.abs(a.length - b.length) > 3) return false;
    const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 0; j <= b.length; j++) d[0]![j] = j;
    for (let i = 1; i <= a.length; i++)
      for (let j = 1; j <= b.length; j++)
        d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length]![b.length]! <= 2;
  };
  const show = shows.find((s) => {
    const t = norm(s.title);
    // "The Star-Cross Seaway" is how one episode spells "The Star-Crossed
    // Seaway". Without this it becomes a second show for the same run.
    return t === key || t.includes(key) || key.includes(t) || close(t, key);
  });
  let target = show;
  if (!target) {
    const cast = eps.map((e) => castFromNotes(e.notes)).sort((a, b) => b.length - a.length)[0] ?? [];
    if (!CREATE || !channelId || cast.length < 2) {
      unmatched++;
      console.log(`  – ${series.slice(0, 46).padEnd(46)} no show in the database${cast.length >= 2 ? ` (${cast.length} names available)` : ''}`);
      continue;
    }
    const id = slug(series);
    if (!id) { unmatched++; continue; }
    target = { id, title: series, seasons: 1 };
    if (!DRY) {
      await writeFile(join(DATA_ROOT, 'shows', `${id}.yml`), stringify({
        id,
        title: series,
        channels: [channelId],
        format: 'podcast',
        status: 'unknown',
        links: { podcast: feedUrl },
        seasons: [{ ordinal: 1, game: gameId ?? 'tba', episode_count: eps.length }],
        description: `Discovered in ${channelId}'s own podcast feed.`,
      }), 'utf8');
    }
    shows.push(target);
    createdShows++;
    console.log(`  + created show ${series.slice(0, 44)}`);
  }
  const showRec = target;

  // Take the episode whose notes name the most people.
  let best: FeedCredit[] = [];
  let from = eps[0]!;
  for (const ep of eps) {
    const c = castFromNotes(ep.notes);
    if (c.length > best.length) { best = c; from = ep; }
  }
  if (best.length < 2) { console.log(`  – ${series.slice(0, 46).padEnd(46)} → ${showRec.title}: no cast in the notes`); continue; }

  matched++;
  console.log(`  ✓ ${series.slice(0, 46).padEnd(46)} → ${showRec.title} (${best.length})`);
  if (DRY) {
    for (const c of best) console.log(`        ${c.role.padEnd(12)} ${c.name}${c.character ? ` as ${c.character}` : ''}`);
    continue;
  }

  const source = {
    tier: 'official' as const,
    url: from.link || feedUrl,
    note: `Cast listed in the show's own episode notes for "${from.title}".`,
  };
  for (const c of best) {
    const id = personByName.get(c.name.toLowerCase()) ?? slug(c.name);
    if (!id) continue;
    const path = join(DATA_ROOT, 'people', `${id}.yml`);
    let person: any;
    try { person = parse(await readFile(path, 'utf8')); }
    catch {
      person = { id, canonical_name: c.name, sort_name: sortName(c.name),
        aliases: [{ id: 'default', name: c.name, alias_type: c.name.includes(' ') ? 'legal' : 'handle' }], credits: [] };
      created++;
    }
    const credit: any = { show: showRec.id, role: c.role, sources: [source] };
    if (showRec.seasons === 1) credit.season = 1;
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

console.log(`\n${matched} series matched, ${createdShows} show(s) created, ${unmatched} not in the database.`);
console.log(DRY ? 'Dry run — nothing written.\n' : `${added} credit(s) added, ${corroborated} corroborated, ${created} new people.\n`);
