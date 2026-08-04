#!/usr/bin/env tsx
/**
 * Rank campaigns by YouTube view count and write a snapshot for the home page.
 *
 *   YOUTUBE_API_KEY=… npm run fetch:trending
 *
 * "Trending" is honestly a stretch: the public Data API exposes lifetime view
 * counts per video, not view velocity or a real trend signal, and analytics
 * for that would need each channel's own dashboard. What is measurable — total
 * views across a playlist — is what this computes, and the home page names it
 * accordingly rather than implying something the data cannot support.
 *
 * Two bugs shaped the first version of this, both found by the numbers not
 * making sense: Adventures of Azerim was outranking Critical Role and
 * Dimension 20 by a wide margin, which nobody who follows this space would
 * believe. The cause was structural, not a close call:
 *
 *   1. Only one playlist was read per show, picked arbitrarily as the first
 *      link found. Critical Role has 3 playlists on record and Dimension 20
 *      has 29 — one per season — and only one of them, whichever happened to
 *      be first, was ever counted. A show with a single small playlist (Viva
 *      La Dirt League's Azerim) had its whole total captured; a show whose
 *      catalogue is spread across dozens of playlists had a few percent of
 *      it counted and the rest silently dropped.
 *   2. Each playlist was capped at its first 100 videos. Campaigns that run
 *      to hundreds of episodes were truncated before the cap even mattered.
 *
 * Fixed by ranking at the level the request actually asked for — campaigns,
 * not shows — and by summing every video in every playlist a season or show
 * holds, fully paginated. A season with its own playlist becomes its own
 * entry; a show without per-season playlists still ranks as a whole. Either
 * way, everything the season or show links is now counted, not a sample of
 * whichever playlist loaded first.
 *
 * Only campaigns with at least one YouTube playlist link are eligible.
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

/** Every video id in a playlist, paginated to completion — no sampling cap. */
async function playlistVideoIds(playlistId: string): Promise<string[]> {
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
  } while (pageToken);
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

const playlistId = (url: unknown) => String(url ?? '').match(/[?&]list=([\w-]+)/)?.[1];

// ---------------------------------------------------------------------------

interface Target {
  key: string;                 // unique per campaign, for de-duplicating snapshot rows
  showId: string;
  seasonOrdinal?: number;      // set when this is one season's own playlist
  label: string;                // display title
  playlistIds: string[];        // every distinct playlist this campaign links
}

const targets: Target[] = [];
const showFiles = (await readdir(join(DATA_ROOT, 'shows'))).filter((f) => f.endsWith('.yml'));

for (const f of showFiles) {
  const s = parse(await readFile(join(DATA_ROOT, 'shows', f), 'utf8'));
  const seasons: any[] = s.seasons ?? [];
  const seasonPlaylists = seasons
    .map((season) => ({ season, id: playlistId(season.links?.website) }))
    .filter((x): x is { season: any; id: string } => Boolean(x.id));

  if (seasonPlaylists.length > 0) {
    // Each season with its own playlist is its own campaign entry.
    for (const { season, id } of seasonPlaylists) {
      const label = season.title ? `${s.title} — ${season.title}` : `${s.title} — Season ${season.ordinal}`;
      targets.push({
        key: `${s.id}#${season.ordinal}`,
        showId: s.id,
        seasonOrdinal: season.ordinal,
        label,
        playlistIds: [id],
      });
    }
  } else {
    // No per-season playlists — rank the show as a whole, summing every
    // distinct playlist it links (show-level and any season-level ones that
    // are not one-per-season).
    const ids = new Set<string>();
    const showId = playlistId(s.links?.website);
    if (showId) ids.add(showId);
    for (const season of seasons) {
      const id = playlistId(season.links?.website);
      if (id) ids.add(id);
    }
    if (ids.size > 0) {
      targets.push({ key: s.id, showId: s.id, label: s.title, playlistIds: [...ids] });
    }
  }
}

console.log(`\n${targets.length} campaign(s) have at least one YouTube playlist to rank.\n`);

const ranked: { key: string; showId: string; seasonOrdinal?: number; label: string; views: number; videoCount: number }[] = [];
for (const t of targets) {
  try {
    let views = 0;
    let videoCount = 0;
    for (const pid of t.playlistIds) {
      const ids = await playlistVideoIds(pid);
      videoCount += ids.length;
      views += await totalViews(ids);
    }
    ranked.push({ key: t.key, showId: t.showId, seasonOrdinal: t.seasonOrdinal, label: t.label, views, videoCount });
    console.log(`  ${views.toLocaleString().padStart(12)}  (${String(videoCount).padStart(3)} videos)  ${t.label}`);
  } catch (e) {
    console.log(`  ! ${t.label.slice(0, 50)} — ${(e as Error).message.slice(0, 60)}`);
  }
}

ranked.sort((a, b) => b.views - a.views);

const out = {
  generatedAt: new Date().toISOString(),
  method: 'Sum of lifetime YouTube view counts across every video in every playlist a ' +
    'campaign (season, or show where seasons share no per-season playlist) links — fully ' +
    'paginated, no sampling. Not a trend or velocity measure, and limited to campaigns with ' +
    'at least one YouTube playlist.',
  eligibleCampaigns: targets.length,
  totalShows: showFiles.length,
  campaigns: ranked.slice(0, 24),
};
await writeFile('src/data/trending.json', JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log(`\nWrote src/data/trending.json (${out.campaigns.length} campaigns).\n`);
