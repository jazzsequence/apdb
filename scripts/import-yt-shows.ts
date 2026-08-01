#!/usr/bin/env tsx
/**
 * Catalogue a YouTube channel's campaigns as shows.
 *
 * A show whose descriptions carry no cast is still a show. Skipping those left
 * whole channels missing from the index — the cast can be filled in later by
 * hand or by a contributor, but only if the show exists to hang it on.
 *
 * Casts are imported where they are readable, and left empty where they are
 * not, rather than guessed.
 *
 *   npm run import:yt-shows -- --channel UC... --channel-id happy-jacks --dry-run
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stringify, parse } from 'yaml';
import { DATA_ROOT } from '../src/lib/load.js';
import { creditsFromDescription, playlistVideos } from '../src/lib/sources/youtube.js';
import { fetchAllImages } from '../src/lib/images.js';

const API = 'https://www.googleapis.com/youtube/v3';
const args = process.argv.slice(2);
const flag = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (n: string) => args.includes(`--${n}`);

const NOISE =
  /(clip|short|highlight|trailer|promo|recap|behind the scenes|announce|q&a|interview|unboxing|review|how to|tutorial|tips|member|vlog|podcast episode|news|preview|reaction|compilation|best of|soundtrack|music|stream vod|full vod)/i;

function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\|.*$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 55)
    // Truncating can leave a trailing hyphen, which is not a valid slug.
    .replace(/-+$/, '');
}

async function api(path: string, params: Record<string, string>): Promise<any> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error('YOUTUBE_API_KEY not set');
  const r = await fetch(`${API}/${path}?${new URLSearchParams({ ...params, key })}`);
  if (!r.ok) throw new Error(`YouTube ${r.status}`);
  return r.json();
}

/**
 * Resolve a channel id, an @handle, or a channel URL.
 *
 * `forHandle` costs 1 unit; falling back to search costs 100 and draws on a
 * separate daily cap that a broad sweep exhausts quickly. Always try the cheap
 * exact lookup first — it is also more accurate, since search guesses.
 */
async function resolveChannel(input: string): Promise<{ id: string; title: string } | undefined> {
  const fromUrl = input.match(/youtube\.com\/(?:@([\w.-]+)|channel\/(UC[\w-]+))/i);
  const id = fromUrl?.[2] ?? (/^UC[\w-]{20,}$/.test(input) ? input : undefined);
  const handle = fromUrl?.[1] ?? (input.startsWith('@') ? input.slice(1) : undefined);

  if (id) {
    const d = await api('channels', { part: 'snippet', id });
    const c = d.items?.[0];
    if (c) return { id, title: c.snippet.title };
  }

  if (handle) {
    const d = await api('channels', { part: 'snippet', forHandle: handle });
    const c = d.items?.[0];
    if (c) return { id: c.id, title: c.snippet.title };
  }

  // Last resort only — expensive, and subject to its own daily quota.
  const d = await api('search', {
    part: 'snippet',
    q: input.replace(/^@/, ''),
    type: 'channel',
    maxResults: '3',
  });
  const c = d.items?.[0];
  return c ? { id: c.snippet.channelId, title: c.snippet.channelTitle } : undefined;
}

async function allPlaylists(channelId: string) {
  const out: { id: string; title: string; count: number; description: string }[] = [];
  let token: string | undefined;
  do {
    const d = await api('playlists', {
      part: 'snippet,contentDetails',
      channelId,
      maxResults: '50',
      ...(token ? { pageToken: token } : {}),
    });
    for (const p of d.items ?? []) {
      out.push({
        id: p.id,
        title: p.snippet.title,
        count: p.contentDetails.itemCount,
        description: p.snippet.description ?? '',
      });
    }
    token = d.nextPageToken;
  } while (token);
  return out;
}

async function main() {
  const input = flag('channel');
  const channelId = flag('channel-id');
  if (!input || !channelId) {
    console.error('Need --channel <UC…|@handle> and --channel-id <existing-channel-slug>.');
    process.exit(1);
  }

  const channel = await resolveChannel(input);
  if (!channel) {
    console.error(`Could not resolve ${input}`);
    process.exit(1);
  }

  const min = Number.parseInt(flag('min') ?? '3', 10);
  const playlists = (await allPlaylists(channel.id))
    .filter((p) => p.count >= min && !NOISE.test(p.title))
    .sort((a, b) => b.count - a.count);

  console.log(`\n${channel.title} — ${playlists.length} candidate series (>= ${min} episodes)\n`);

  const existing = new Set((await readdir(join(DATA_ROOT, 'shows'))).map((f) => f.replace('.yml', '')));
  const game = flag('game') ?? 'dnd-5e';
  let made = 0;
  let withCast = 0;

  for (const p of playlists) {
    const id = slugify(p.title);
    if (!id || existing.has(id)) continue;

    // Read a couple of descriptions: import a cast if one is stated, otherwise
    // still create the show.
    let cast: ReturnType<typeof creditsFromDescription> = [];
    try {
      for (const v of await playlistVideos(p.id, 2)) {
        const c = creditsFromDescription(v.description);
        if (c.length > cast.length) cast = c;
      }
    } catch {
      // a private or empty playlist still yields a usable title
    }

    if (has('dry-run')) {
      console.log(`  ${String(p.count).padStart(4)} eps  ${p.title.slice(0, 58).padEnd(58)} ${cast.length ? `${cast.length} cast` : '—'}`);
      continue;
    }

    await writeFile(
      join(DATA_ROOT, 'shows', `${id}.yml`),
      stringify({
        id,
        title: p.title.replace(/\s*\|.*$/, '').trim().slice(0, 80),
        channels: [channelId],
        format: 'video',
        status: 'unknown',
        ...(p.description ? { description: p.description.slice(0, 300) } : {}),
        links: { website: `https://www.youtube.com/playlist?list=${p.id}` },
        seasons: [{ ordinal: 1, game, episode_count: p.count }],
      }),
      'utf8',
    );
    existing.add(id);
    made += 1;
    if (cast.length) withCast += 1;
    console.log(`  + ${p.title.slice(0, 58).padEnd(58)} ${cast.length ? `(${cast.length} cast readable)` : ''}`);
  }

  if (!has('dry-run')) {
    // Images are part of the import, not a pass to remember later.
    await fetchAllImages();
    console.log(`\n${made} show(s) added; ${withCast} have a readable cast to import next.`);
    console.log('Import a cast with: npm run collect -- --youtube --playlist <ID> --show <id> --season 1 --dry-run\n');
  }
}

main().catch((e: unknown) => {
  console.error(`\n${(e as Error).message}\n`);
  process.exit(1);
});
