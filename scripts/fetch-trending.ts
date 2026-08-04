#!/usr/bin/env tsx
/**
 * Rank shows by YouTube view count and write a snapshot for the home page.
 *
 *   YOUTUBE_API_KEY=… npm run fetch:trending
 *
 * "Trending" is honestly a stretch: the public Data API exposes lifetime view
 * counts per video, not view velocity or a real trend signal, and analytics
 * for that would need each channel's own dashboard. What is measurable —
 * total views across a show's linked playlist — is what this computes, and
 * the home page names it accordingly rather than implying something the data
 * cannot support.
 *
 * Only shows with a YouTube playlist link are eligible — 122 of 284 at time
 * of writing — so this is a ranking within what YouTube can see, not across
 * every show here. A show hosted only on Twitch, Apple Podcasts or Archive.org
 * cannot appear, and that limit is recorded in the output rather than hidden.
 *
 * This does not run in CI: it needs YOUTUBE_API_KEY, which is not currently a
 * repository secret. Run it by hand and commit the refreshed snapshot; see
 * README for how to add the key to CI if this should update automatically.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { DATA_ROOT } from '../src/lib/load.js';
import { MissingKeyError } from '../src/lib/sources/youtube.js';

const API = 'https://www.googleapis.com/youtube/v3';
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

/** Every video id in a playlist, paged. */
async function playlistVideoIds(playlistId: string, max = 300): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const data = await get('playlistItems', {
      part: 'contentDetails',
      playlistId,
      maxResults: '50',
      ...(pageToken ? { pageToken } : {}),
    });
    for (const item of data.items ?? []) {
      const id = item.contentDetails?.videoId;
      if (id) ids.push(id);
    }
    pageToken = data.nextPageToken;
  } while (pageToken && ids.length < max);
  return ids;
}

/** Total view count across a set of video ids, batched 50 at a time. */
async function totalViews(videoIds: string[]): Promise<number> {
  let total = 0;
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const data = await get('videos', { part: 'statistics', id: batch.join(',') });
    for (const v of data.items ?? []) total += Number(v.statistics?.viewCount ?? 0);
  }
  return total;
}

// ---------------------------------------------------------------------------

interface Target { id: string; title: string; playlistId: string }
const targets: Target[] = [];
for (const f of (await readdir(join(DATA_ROOT, 'shows'))).filter((f) => f.endsWith('.yml'))) {
  const s = parse(await readFile(join(DATA_ROOT, 'shows', f), 'utf8'));
  // Prefer a season-level playlist if the show has several; otherwise the
  // show-level link. Only the first match is used — this ranks shows, not
  // seasons, so one playlist id per show is enough.
  const links = [s.links?.website, ...(s.seasons ?? []).map((x: any) => x.links?.website)];
  const playlistId = links.map((l) => String(l ?? '').match(/[?&]list=([\w-]+)/)?.[1]).find(Boolean);
  if (playlistId) targets.push({ id: s.id, title: s.title, playlistId });
}

console.log(`\n${targets.length} show(s) have a YouTube playlist to rank.\n`);

const ranked: { id: string; title: string; views: number }[] = [];
for (const t of targets) {
  try {
    const ids = await playlistVideoIds(t.playlistId, 100);   // a sample is enough to rank by
    const views = await totalViews(ids);
    ranked.push({ id: t.id, title: t.title, views });
    console.log(`  ${views.toLocaleString().padStart(10)}  ${t.title}`);
  } catch (e) {
    console.log(`  ! ${t.title.slice(0, 40)} — ${(e as Error).message.slice(0, 60)}`);
  }
}

ranked.sort((a, b) => b.views - a.views);

const out = {
  generatedAt: new Date().toISOString(),
  method: 'Sum of lifetime YouTube view counts across each show\'s linked playlist ' +
    '(sampled up to 100 videos). Not a trend or velocity measure, and limited to shows ' +
    'with a YouTube playlist link.',
  eligibleShows: targets.length,
  totalShows: (await readdir(join(DATA_ROOT, 'shows'))).filter((f) => f.endsWith('.yml')).length,
  shows: ranked.slice(0, 24),
};
await writeFile('src/data/trending.json', JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log(`\nWrote src/data/trending.json (${out.shows.length} shows).\n`);
