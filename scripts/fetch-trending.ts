#!/usr/bin/env tsx
/**
 * Rank campaigns by recent YouTube performance and write a snapshot for the
 * home page.
 *
 *   YOUTUBE_API_KEY=… npm run fetch:trending
 *
 * "Trending" is honestly a stretch: the public Data API exposes lifetime view
 * counts per video, not view velocity or a real trend signal, and analytics
 * for that would need each channel's own dashboard. What follows is the
 * closest honest approximation available without that access, and it went
 * through two designs that were each wrong in their own way before this one.
 *
 * v1 summed every video in one arbitrarily-chosen playlist per show, capped
 * at 100 videos. That hid Critical Role (3 playlists) and Dimension 20 (29,
 * one per season) almost entirely: only whichever playlist was found first
 * ever got counted, so a show with one small playlist had its whole
 * catalogue read while a show spread across dozens had a sliver of it read
 * and the rest silently dropped.
 *
 * v2 fixed the coverage problem — rank campaigns, sum every playlist a
 * season or show actually links — but that surfaced a worse problem: raw
 * SUM rewards video count over popularity. A campaign with 400 episodes at
 * 50K views each would outrank one with 10 episodes at 2M views each, which
 * is backwards, and fully paginating hundreds of videos per campaign burns
 * quota for no good reason — the run that tried it exhausted a day's quota
 * partway through.
 *
 * v3 fixed both by only ever looking at a campaign's most recent ~15 videos
 * and using the AVERAGE view count across that sample, not the sum. Average
 * removes the video-count bias entirely, and "recent" is a much closer
 * approximation of current audience than a lifetime total anyway — an old
 * campaign's early views from years ago say nothing about whether anyone is
 * watching it now.
 *
 * v3's flaw showed up the first time it ran against live data: "recent" was
 * recent *within a campaign's own catalogue*, not recent on the calendar. A
 * short, complete mini-series has no tail to dilute it — its 15 most recent
 * videos are its entire run, premiere included — so Exandria Unlimited:
 * Calamity (5 total videos, all from a heavily-promoted 2022 crossover event)
 * out-ranked Critical Role Campaign 1's *finale arc*, years-old evergreen
 * content by any reasonable definition of "trending."
 *
 * This version ranks by average VIEWS PER DAY SINCE PUBLISHED instead of raw
 * average views. A video's lifetime view count no longer counts on its own —
 * it's divided by how long it's had to accumulate them, so a campaign whose
 * "recent" videos are actually old keeps degrading the longer they sit, while
 * a campaign that just posted something genuinely new and being watched right
 * now scores high regardless of its lifetime total. Very fresh uploads (same
 * day) have their age floored at one day so an upload from an hour ago with a
 * few hundred views can't produce an absurd rate. The API cost per campaign
 * is unchanged at two calls regardless of episode count: one `playlistItems`
 * page, one `videos` batch (now pulling `snippet.publishedAt` alongside
 * `statistics`).
 *
 * None of this fixes a campaign having no playlist linked at all, which
 * cannot be ranked no matter the metric — Critical Role's then-current
 * Campaign Four and Dimension 20's Fantasy High: Sophomore Year were both
 * missing their link entirely until a separate pass added them. A campaign
 * absent from this list is worth checking for that before assuming it lost
 * on the numbers.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { DATA_ROOT } from '../src/lib/load.js';
import { MissingKeyError } from '../src/lib/sources/youtube.js';

const RECENT_SAMPLE = 15;
const MIN_SAMPLE = 3;   // a campaign with fewer videos than this is too thin to rank fairly

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

/**
 * The most recent videos in a playlist. `playlistItems` lists in playlist
 * order, which for an actual play is almost always upload order — oldest
 * first — so this reads from the end rather than the start. One call gets
 * the last page's token cheaply via the playlist's item count; simpler and
 * just as cheap is to walk forward but stop as soon as enough are collected
 * from the point where fewer than RECENT_SAMPLE remain. In practice a single
 * page (up to 50) is enough to find the tail without walking the whole list.
 */
async function recentVideoIds(playlistId: string, want: number): Promise<string[]> {
  const all: string[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  do {
    const data = await get('playlistItems', {
      part: 'contentDetails',
      playlistId,
      maxResults: '50',
      ...(pageToken ? { pageToken } : {}),
    });
    for (const item of data.items ?? []) {
      const id = item.contentDetails?.videoId;
      if (id) all.push(id);
    }
    pageToken = data.nextPageToken;
    pages++;
    // Stop once there cannot possibly be more than `want` videos left to see
    // — i.e. once this page came back under-full (the last page) — rather
    // than reading a long-running show's entire history to reach the end.
    if ((data.items ?? []).length < 50) break;
  } while (pageToken && pages < 20);   // hard stop: never read more than ~1000 ids
  return all.slice(-want);
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Average views, and average views-per-day-since-published, across a set of
 * video ids (one batched call). The former is shown to readers as a
 * recognisable number; the latter is what ranking is actually sorted by —
 * it's what makes a two-day-old video with real momentum outrank a
 * three-year-old video with a bigger lifetime total sitting in the same
 * "recent 15" sample.
 */
async function averageViews(
  videoIds: string[],
): Promise<{ avg: number; avgPerDay: number; sampled: number }> {
  if (videoIds.length === 0) return { avg: 0, avgPerDay: 0, sampled: 0 };
  const data = await get('videos', { part: 'statistics,snippet', id: videoIds.slice(0, 50).join(',') });
  const items = data.items ?? [];
  const now = Date.now();
  let totalViews = 0;
  let totalPerDay = 0;
  for (const v of items) {
    const views = Number(v.statistics?.viewCount ?? 0);
    const publishedAt = v.snippet?.publishedAt ? Date.parse(v.snippet.publishedAt) : NaN;
    const ageDays = Number.isNaN(publishedAt) ? 1 : Math.max(1, (now - publishedAt) / MS_PER_DAY);
    totalViews += views;
    totalPerDay += views / ageDays;
  }
  return {
    avg: items.length ? Math.round(totalViews / items.length) : 0,
    avgPerDay: items.length ? totalPerDay / items.length : 0,
    sampled: items.length,
  };
}

const playlistId = (url: unknown) => String(url ?? '').match(/[?&]list=([\w-]+)/)?.[1];

// ---------------------------------------------------------------------------

interface Target {
  key: string;
  showId: string;
  seasonOrdinal?: number;
  label: string;
  playlistId: string;
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
    // One entry per season that has its own playlist — this is what makes
    // the ranking "campaigns", the level actually asked for.
    for (const { season, id } of seasonPlaylists) {
      const label = season.title ? `${s.title} — ${season.title}` : `${s.title} — Season ${season.ordinal}`;
      targets.push({ key: `${s.id}#${season.ordinal}`, showId: s.id, seasonOrdinal: season.ordinal, label, playlistId: id });
    }
  } else {
    const id = playlistId(s.links?.website) ?? seasons.map((x) => playlistId(x.links?.website)).find(Boolean);
    if (id) targets.push({ key: s.id, showId: s.id, label: s.title, playlistId: id });
  }
}

console.log(`\n${targets.length} campaign(s) have a YouTube playlist to sample.\n`);

const ranked: {
  key: string;
  showId: string;
  seasonOrdinal?: number;
  label: string;
  avgViews: number;
  viewsPerDay: number;
  sampled: number;
}[] = [];
for (const t of targets) {
  try {
    const ids = await recentVideoIds(t.playlistId, RECENT_SAMPLE);
    if (ids.length < MIN_SAMPLE) {
      console.log(`  – ${t.label.slice(0, 50)} — only ${ids.length} video(s), too thin to rank`);
      continue;
    }
    const { avg, avgPerDay, sampled } = await averageViews(ids);
    ranked.push({
      key: t.key,
      showId: t.showId,
      seasonOrdinal: t.seasonOrdinal,
      label: t.label,
      avgViews: avg,
      viewsPerDay: Math.round(avgPerDay),
      sampled,
    });
    console.log(
      `  ${Math.round(avgPerDay).toLocaleString().padStart(9)}/day  (${avg.toLocaleString()} avg, ${sampled} recent videos)  ${t.label}`,
    );
  } catch (e) {
    console.log(`  ! ${t.label.slice(0, 50)} — ${(e as Error).message.slice(0, 60)}`);
  }
}

ranked.sort((a, b) => b.viewsPerDay - a.viewsPerDay);

const out = {
  generatedAt: new Date().toISOString(),
  method: `Ranked by average views-per-day-since-published across each campaign's most recent ` +
    `${RECENT_SAMPLE} videos (or fewer, on a shorter playlist — campaigns under ${MIN_SAMPLE} videos ` +
    'are excluded as too thin to rank fairly), not raw average views. A video\'s lifetime view count ' +
    'is divided by its age in days, so old evergreen content keeps degrading the longer it sits, and a ' +
    'campaign whose "recent" videos are actually years old (a short, complete series has no newer tail ' +
    'to replace them) no longer outranks a campaign that just posted something people are watching right ' +
    'now. The "avg views" figure shown to readers is informational only; ranking is by the per-day rate. ' +
    'Limited to campaigns with a YouTube playlist link — a campaign missing from this list may simply ' +
    'have no playlist recorded yet, not low viewership.',
  eligibleCampaigns: targets.length,
  totalShows: showFiles.length,
  campaigns: ranked.slice(0, 24),
};
await writeFile('src/data/trending.json', JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log(`\nWrote src/data/trending.json (${out.campaigns.length} campaigns).\n`);
