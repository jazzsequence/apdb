#!/usr/bin/env tsx
/**
 * Find the playlist for each individual season.
 *
 *   YOUTUBE_API_KEY=… npm run link:seasons -- --dry-run
 *   YOUTUBE_API_KEY=… npm run link:seasons
 *
 * A show-level link answers "where is this show"; a season page is asked
 * "where is *this campaign*", and until now it could only answer with the
 * show's link. 233 seasons across 28 shows had nothing of their own.
 *
 * This is title matching, which is exactly what put a 1998 film's cast into a
 * Fate Core actual play, so it is not done on titles alone. Three pieces of
 * evidence are already in the database and all three have to agree:
 *
 *   1. The playlist belongs to a channel this show is actually on — resolved
 *      from the channel's own YouTube link, or from the show's existing
 *      playlist, never from a search.
 *   2. The playlist title contains the season's title (or the season title
 *      contains the playlist's), after normalising punctuation and dropping
 *      the show name, which most playlists repeat.
 *   3. The playlist's video count is close to the season's recorded
 *      episode_count, where we have one.
 *
 * A season with two equally good candidates takes neither.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { DATA_ROOT } from '../src/lib/load.js';
import { MissingKeyError } from '../src/lib/sources/youtube.js';

const API = 'https://www.googleapis.com/youtube/v3';
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const only = (() => { const i = args.indexOf('--only'); return i >= 0 ? args[i + 1] : undefined; })();

function key(): string {
  const v = process.env.YOUTUBE_API_KEY;
  if (!v) throw new MissingKeyError();
  return v;
}
async function get(path: string, params: Record<string, string>): Promise<any> {
  const q = new URLSearchParams({ ...params, key: key() });
  const r = await fetch(`${API}/${path}?${q}`);
  if (!r.ok) throw new Error(`YouTube ${r.status}: ${(await r.text()).slice(0, 140)}`);
  return r.json();
}

/** Every playlist on a channel, paging until exhausted. */
async function channelPlaylists(channelId: string) {
  const out: { id: string; title: string; count: number }[] = [];
  let pageToken: string | undefined;
  do {
    const data = await get('playlists', {
      part: 'snippet,contentDetails',
      channelId,
      maxResults: '50',
      ...(pageToken ? { pageToken } : {}),
    });
    for (const p of data.items ?? []) {
      out.push({ id: p.id, title: p.snippet.title, count: p.contentDetails.itemCount });
    }
    pageToken = data.nextPageToken;
  } while (pageToken && out.length < 400);
  return out;
}

/** The channel a playlist belongs to — used when we only know a playlist. */
async function channelOfPlaylist(playlistId: string): Promise<string | undefined> {
  try {
    const data = await get('playlists', { part: 'snippet', id: playlistId });
    return data.items?.[0]?.snippet?.channelId;
  } catch {
    return undefined;
  }
}

async function channelOfHandle(handle: string): Promise<{ id: string; title: string } | undefined> {
  try {
    const data = await get('channels', { part: 'id,snippet', forHandle: handle });
    const item = data.items?.[0];
    return item ? { id: item.id, title: item.snippet?.title ?? '' } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A channel we hold but have no YouTube link for.
 *
 * Guesses handles from the channel's own name and accepts one only when
 * YouTube's answer names the same channel back — @criticalrole returns
 * "Critical Role", so the guess is confirmed rather than assumed. Anything
 * that comes back under a different name is discarded, which is what stops
 * this from being the title-matching that has burned this project before.
 *
 * A confirmed link is written to the channel record, because it is useful on
 * its own and it means the next run costs nothing.
 */
async function resolveChannelYouTube(channel: any): Promise<{ id: string; url: string } | undefined> {
  const base = String(channel.name)
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '');
  const candidates = [...new Set([base, base.replace(/network$|productions$|show$|tv$/, '')])].filter(
    (c) => c.length >= 3,
  );
  const want = canonical(channel.name);
  for (const handle of candidates) {
    const hit = await channelOfHandle(handle);
    await new Promise((r) => setTimeout(r, 120));
    if (!hit) continue;
    const got = canonical(hit.title);
    // The names have to agree — one containing the other is enough, since
    // "Critical Role" and "Critical Role Productions" are the same channel.
    if (!got.includes(want) && !want.includes(got)) continue;
    return { id: hit.id, url: `https://www.youtube.com/@${handle}` };
  }
  return undefined;
}

const norm = (s: string) =>
  s.toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(season|campaign|part|series|chapter|arc|full|complete|playlist|episodes?)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Roman and written numerals both appear in season titles. */
const NUMBER_WORDS: Record<string, string> = {
  one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7',
  eight: '8', nine: '9', ten: '10', i: '1', ii: '2', iii: '3', iv: '4', v: '5',
  vi: '6', vii: '7', viii: '8', ix: '9', x: '10',
};
const canonical = (s: string) =>
  norm(s).split(' ').map((w) => NUMBER_WORDS[w] ?? w).filter(Boolean).join(' ');

// ---------------------------------------------------------------------------

/**
 * Season titles that are only the name of a game system.
 *
 * Anthologies label seasons by what they played — "Call of Cthulhu",
 * "Traveller" — and matching on that finds any playlist that mentions the
 * system. It paired New Game, Who Dis?'s Call of Cthulhu season with the Glass
 * Cannon Network's "Time For Chaos | Call of Cthulhu 7e", a different show on
 * the same channel. A system name is not a title, so those seasons are skipped.
 */
const gameNames = new Set<string>();
for (const f of (await readdir(join(DATA_ROOT, 'games'))).filter((f) => f.endsWith('.yml'))) {
  const g = parse(await readFile(join(DATA_ROOT, 'games', f), 'utf8'));
  gameNames.add(canonical(g.name));
  gameNames.add(canonical(`${g.name} ${g.edition}`));
}

const showFiles = (await readdir(join(DATA_ROOT, 'shows'))).filter((f) => f.endsWith('.yml'));
const channels = new Map<string, any>();
for (const f of (await readdir(join(DATA_ROOT, 'channels'))).filter((f) => f.endsWith('.yml'))) {
  const c = parse(await readFile(join(DATA_ROOT, 'channels', f), 'utf8'));
  channels.set(c.id, c);
}

let linked = 0, ambiguous = 0, noChannel = 0, noMatch = 0, showsDone = 0;

for (const f of showFiles) {
  const path = join(DATA_ROOT, 'shows', f);
  const show = parse(await readFile(path, 'utf8'));
  if (only && show.id !== only) continue;
  const seasons: any[] = show.seasons ?? [];
  if (seasons.length < 2) continue;
  const wanted = seasons.filter((s) => !s.links?.website);
  if (wanted.length === 0) continue;

  // Which YouTube channel is this show on? Never a search — only what we hold.
  let channelId: string | undefined;
  for (const id of show.channels ?? []) {
    const channel = channels.get(id);
    if (!channel) continue;
    const yt = String(channel.links?.youtube ?? '');
    const direct = yt.match(/youtube\.com\/channel\/([\w-]+)/i)?.[1];
    if (direct) { channelId = direct; break; }
    const handle = yt.match(/youtube\.com\/@([\w.-]+)/i)?.[1];
    if (handle) {
      const hit = await channelOfHandle(handle);
      if (hit) { channelId = hit.id; break; }
    }
    // No YouTube link recorded — try to establish one, and keep it.
    const found = await resolveChannelYouTube(channel);
    if (found) {
      channelId = found.id;
      if (!DRY) {
        channel.links = { ...(channel.links ?? {}), youtube: found.url };
        await writeFile(join(DATA_ROOT, 'channels', `${channel.id}.yml`), stringify(channel), 'utf8');
      }
      console.log(`  + channel ${channel.name} → ${found.url}`);
      break;
    }
  }
  if (!channelId) {
    const list = String(show.links?.website ?? '').match(/[?&]list=([\w-]+)/)?.[1];
    if (list) channelId = await channelOfPlaylist(list);
  }
  if (!channelId) { noChannel++; continue; }

  let playlists: Awaited<ReturnType<typeof channelPlaylists>>;
  try { playlists = await channelPlaylists(channelId); }
  catch (e) { console.log(`  ! ${show.title}: ${(e as Error).message.slice(0, 60)}`); continue; }
  if (playlists.length === 0) { noChannel++; continue; }

  const showKey = canonical(show.title);
  let wrote = false;
  // A playlist is one season. Two seasons landing on the same one means the
  // titles could not tell them apart, and both should be left alone.
  const taken = new Map<string, number>();
  for (const s of seasons) {
    const id = String(s.links?.website ?? '').match(/[?&]list=([\w-]+)/)?.[1];
    if (id) taken.set(id, s.ordinal);
  }

  for (const season of wanted) {
    const title = season.title;
    if (!title) continue;                       // "Season 3" alone is not evidence
    const seasonKey = canonical(title).replace(showKey, '').trim();
    if (seasonKey.length < 3) continue;         // too generic to match on
    if (gameNames.has(seasonKey)) { noMatch++; continue; }   // a system, not a title

    const scored = playlists
      .map((p) => {
        const pKey = canonical(p.title).replace(showKey, '').trim();
        const titleHit = pKey.includes(seasonKey) || seasonKey.includes(pKey);
        if (!titleHit || pKey.length < 3) return undefined;
        // Episode counts rarely match exactly — playlists carry trailers and
        // two-parters — but an order-of-magnitude gap means it is not this.
        const expected = season.episode_count;
        let countOk = true;
        let closeness = 0;
        if (expected) {
          const ratio = p.count / expected;
          countOk = ratio >= 0.5 && ratio <= 2.2;
          closeness = -Math.abs(p.count - expected);
        }
        if (!countOk) return undefined;
        // With no recorded episode count there is nothing to sanity-check a
        // large playlist against, so only an exact title stands up. "Neon
        // Odyssey One-Shot" matched a 43-video playlist on title alone.
        if (!expected && p.count > 20 && pKey !== seasonKey) return undefined;
        // Closeness, not length. Scoring by playlist-title length rewarded the
        // most specific title rather than the nearest one, so Fantasy High's
        // first season matched "Fantasy High: Extra Credit" — a later season of
        // the same show. An exact title beats everything.
        const exact = pKey === seasonKey ? 1000 : 0;
        return { p, score: exact - Math.abs(pKey.length - seasonKey.length) + closeness / 100 };
      })
      .filter(Boolean)
      .sort((a, b) => b!.score - a!.score) as { p: { id: string; title: string; count: number }; score: number }[];

    if (scored.length === 0) { noMatch++; continue; }
    // Two candidates that fit equally well means we cannot tell them apart.
    if (scored.length > 1 && Math.abs(scored[0]!.score - scored[1]!.score) < 0.5) {
      console.log(`  ? ${show.title} S${season.ordinal} — ambiguous: "${scored[0]!.p.title}" vs "${scored[1]!.p.title}"`);
      ambiguous++;
      continue;
    }

    const best = scored[0]!.p;
    if (taken.has(best.id)) {
      console.log(`  ? ${show.title} S${season.ordinal} — "${best.title.slice(0, 34)}" already taken by S${taken.get(best.id)}`);
      ambiguous++;
      continue;
    }
    taken.set(best.id, season.ordinal);
    console.log(
      `  ✓ ${show.title.slice(0, 26).padEnd(26)} S${String(season.ordinal).padEnd(2)} ${String(title).slice(0, 30).padEnd(30)} → "${best.title.slice(0, 34)}" (${best.count} vids${season.episode_count ? ` / ${season.episode_count} recorded` : ''})`,
    );
    if (!DRY) {
      season.links = { ...(season.links ?? {}), website: `https://www.youtube.com/playlist?list=${best.id}` };
      wrote = true;
    }
    linked++;
  }

  if (wrote) await writeFile(path, stringify(show), 'utf8');
  showsDone++;
  await new Promise((r) => setTimeout(r, 200));
}

console.log(
  `\n${showsDone} multi-season show(s) checked. ${linked} season link(s) found, ` +
    `${ambiguous} too ambiguous to call, ${noMatch} with no candidate, ` +
    `${noChannel} show(s) whose channel could not be resolved.`,
);
console.log(DRY ? 'Dry run — nothing written.\n' : '');
