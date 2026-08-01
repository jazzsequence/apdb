#!/usr/bin/env tsx
/**
 * Find actual-play shows on YouTube without being told which ones exist.
 *
 * Search surfaces candidate channels; each channel's playlists are then scored
 * for whether they look like a campaign; and a sample of each playlist's
 * descriptions is parsed for a cast. A playlist whose descriptions yield no
 * cast is reported, not imported — the point is to find what is readable, not
 * to manufacture entries.
 *
 * Nothing here writes data. It prints a plan for a human to check, and the
 * import is a separate, explicit step per playlist.
 *
 *   npm run discover:youtube
 *   npm run discover:youtube -- --channel UC3qtZRMtWNaD2Q96STxgOrA
 *   npm run discover:youtube -- --query "call of cthulhu actual play"
 */
import { creditsFromDescription, MissingKeyError, playlistVideos } from '../src/lib/sources/youtube.js';

const API = 'https://www.googleapis.com/youtube/v3';

const args = process.argv.slice(2);
const flag = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};

/** Searches worth spending quota on. Each search costs 100 units of 10,000. */
const QUERIES = [
  'actual play dnd campaign',
  'call of cthulhu actual play',
  'pathfinder actual play',
  'ttrpg actual play campaign',
  'blades in the dark actual play',
  'daggerheart actual play',
];

/** A playlist that looks like a campaign rather than clips or shorts. */
const CAMPAIGN_LIKE = /(campaign|chapter|season|arc|adventure|episode|one[- ]shot|series)/i;
const NOT_CAMPAIGN = /(short|clip|highlight|trailer|promo|recap|behind the scenes|announcement|q&a|interview|member|unboxing|review|how to|tutorial)/i;

function key(): string {
  const v = process.env.YOUTUBE_API_KEY;
  if (!v) throw new MissingKeyError();
  return v;
}

async function get(path: string, params: Record<string, string>): Promise<any> {
  const q = new URLSearchParams({ ...params, key: key() });
  const r = await fetch(`${API}/${path}?${q}`);
  if (!r.ok) throw new Error(`YouTube ${r.status}: ${(await r.text()).slice(0, 160)}`);
  return r.json();
}

async function findChannels(query: string, limit = 5) {
  const data = await get('search', {
    part: 'snippet',
    q: query,
    type: 'channel',
    maxResults: String(limit),
  });
  return (data.items ?? []).map((i: any) => ({
    id: i.snippet.channelId as string,
    title: i.snippet.channelTitle as string,
  }));
}

async function channelPlaylists(channelId: string) {
  const data = await get('playlists', {
    part: 'snippet,contentDetails',
    channelId,
    maxResults: '50',
  });
  return (data.items ?? []).map((p: any) => ({
    id: p.id as string,
    title: p.snippet.title as string,
    count: p.contentDetails.itemCount as number,
  }));
}

/** Read a few descriptions and see whether a cast is actually readable. */
async function sampleCast(playlistId: string) {
  const videos = await playlistVideos(playlistId, 3);
  for (const video of videos) {
    const credits = creditsFromDescription(video.description);
    if (credits.length >= 2) return { credits, from: video.url };
  }
  return undefined;
}

async function main() {
  const channels: { id: string; title: string }[] = [];
  const single = flag('channel');

  if (single) {
    channels.push({ id: single, title: single });
  } else {
    const queries = flag('query') ? [flag('query')!] : QUERIES;
    const seen = new Set<string>();
    for (const q of queries) {
      for (const c of await findChannels(q)) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        channels.push(c);
      }
    }
  }

  console.log(`\n${channels.length} candidate channel(s).\n`);

  for (const channel of channels) {
    let playlists: { id: string; title: string; count: number }[];
    try {
      playlists = await channelPlaylists(channel.id);
    } catch {
      continue;
    }

    const campaigns = playlists
      .filter((p) => p.count >= 4)
      .filter((p) => CAMPAIGN_LIKE.test(p.title) && !NOT_CAMPAIGN.test(p.title))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    if (campaigns.length === 0) continue;

    console.log(`\n${channel.title}  (${channel.id})`);
    for (const playlist of campaigns) {
      let cast;
      try {
        cast = await sampleCast(playlist.id);
      } catch {
        continue;
      }
      const readable = cast ? `${cast.credits.length} credits readable` : 'no cast in descriptions';
      console.log(`   ${String(playlist.count).padStart(4)} eps  ${playlist.title.slice(0, 52).padEnd(52)} ${readable}`);
      if (cast) {
        console.log(`         ${playlist.id}`);
        for (const c of cast.credits.slice(0, 6)) {
          console.log(`           ${c.role.padEnd(12)} ${c.name}${c.character ? ` as ${c.character}` : ''}`);
        }
      }
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  console.log('\nImport a playlist with:');
  console.log('  npm run collect -- --youtube --playlist <ID> --show <show-id> --season <n> --dry-run\n');
}

main().catch((error: unknown) => {
  console.error(`\n${(error as Error).message}\n`);
  process.exit(1);
});
