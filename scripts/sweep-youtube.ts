#!/usr/bin/env tsx
/**
 * Broad discovery sweep: find actual-play channels across the medium, not just
 * the ones somebody already named.
 *
 * Searches by system and by format rather than by show, collects the channels
 * that come back, and catalogues each one's campaign playlists as shows —
 * importing a cast where the descriptions state one and leaving it empty where
 * they do not.
 *
 * Quota: each search costs 100 units of a 10,000/day budget; playlist and
 * video reads cost 1. The default sweep is ~30 searches, so about a third of a
 * day's quota.
 *
 *   npm run sweep:youtube -- --dry-run
 *   npm run sweep:youtube -- --min-subs 5000
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { DATA_ROOT } from '../src/lib/load.js';
import { creditsFromDescription, playlistVideos } from '../src/lib/sources/youtube.js';

const API = 'https://www.googleapis.com/youtube/v3';
const args = process.argv.slice(2);
const flag = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (n: string) => args.includes(`--${n}`);

/** Searched by system and format — deliberately not by show name. */
const QUERIES = [
  'actual play campaign',
  'ttrpg actual play',
  'dnd 5e actual play campaign',
  'pathfinder 2e actual play',
  'call of cthulhu actual play campaign',
  'vampire the masquerade actual play',
  'blades in the dark actual play',
  'delta green actual play',
  'monster of the week actual play',
  'mothership rpg actual play',
  'alien rpg actual play',
  'warhammer fantasy roleplay actual play',
  'shadowrun actual play',
  'star wars ttrpg actual play',
  'cyberpunk red actual play',
  'traveller rpg actual play',
  'savage worlds actual play',
  'fate rpg actual play',
  'daggerheart actual play campaign',
  'lancer rpg actual play',
  'dungeon world actual play',
  'apocalypse world actual play',
  'monsterhearts actual play',
  'kids on bikes actual play',
  'avatar legends actual play',
  'brindlewood bay actual play',
  'ten candles actual play',
  'wanderhome actual play',
  'osr actual play campaign',
  'indie ttrpg actual play',
];

const NOISE =
  /(clip|short|highlight|trailer|promo|recap|behind the scenes|announce|q&a|interview|unboxing|review|how to|tutorial|tips|member|vlog|news|preview|reaction|compilation|best of|soundtrack|music|advice|discussion|talk|podcast$|stream vod|full vod|character creation|session zero|one page|rules)/i;

const CAMPAIGN_LIKE = /(campaign|chapter|season|arc|adventure|episode|one[- ]shot|series|play)/i;

/**
 * Derive the system from the playlist title where it says so.
 *
 * Defaulting everything to dnd-5e is how 67 Saving Throw shows ended up
 * claiming a system nobody had checked. Titles usually name the game
 * ("Pathfinder 2E Horror Campaign", "Original Blades in the Dark Adventure"),
 * and where they do not, the show is flagged rather than assigned one.
 */
const SYSTEM_HINTS: [RegExp, { id: string; name: string; edition: string; publisher: string }][] = [
  [/pathfinder\s*2/i, { id: 'pathfinder-2e', name: 'Pathfinder', edition: '2nd Edition', publisher: 'Paizo' }],
  [/pathfinder/i, { id: 'pathfinder-1e', name: 'Pathfinder', edition: '1st Edition', publisher: 'Paizo' }],
  [/starfinder/i, { id: 'starfinder', name: 'Starfinder', edition: '1st Edition', publisher: 'Paizo' }],
  [/blades in the dark/i, { id: 'blades-in-the-dark', name: 'Blades in the Dark', edition: '1st Edition', publisher: 'Evil Hat Productions' }],
  [/call of cthulhu/i, { id: 'call-of-cthulhu', name: 'Call of Cthulhu', edition: '7th Edition', publisher: 'Chaosium' }],
  [/delta green/i, { id: 'delta-green', name: 'Delta Green', edition: 'The Role-Playing Game', publisher: 'Arc Dream Publishing' }],
  [/vampire|masquerade/i, { id: 'vampire-the-masquerade-v5', name: 'Vampire: The Masquerade', edition: '5th Edition', publisher: 'Renegade Game Studios' }],
  [/deadlands/i, { id: 'deadlands', name: 'Deadlands', edition: 'Reloaded', publisher: 'Pinnacle Entertainment Group' }],
  [/traveller/i, { id: 'traveller', name: 'Traveller', edition: 'Mongoose 2nd Edition', publisher: 'Mongoose Publishing' }],
  [/daggerheart/i, { id: 'daggerheart', name: 'Daggerheart', edition: '1st Edition', publisher: 'Darrington Press' }],
  [/cyberpunk\s*red/i, { id: 'cyberpunk-red', name: 'Cyberpunk', edition: 'Red', publisher: 'R. Talsorian Games' }],
  [/cyberpunk/i, { id: 'cyberpunk-2020', name: 'Cyberpunk', edition: '2020', publisher: 'R. Talsorian Games' }],
  [/shadowrun/i, { id: 'shadowrun', name: 'Shadowrun', edition: '5th Edition', publisher: 'Catalyst Game Labs' }],
  [/lancer/i, { id: 'lancer', name: 'Lancer', edition: '1st Edition', publisher: 'Massif Press' }],
  [/mothership/i, { id: 'mothership', name: 'Mothership', edition: '1st Edition', publisher: 'Tuesday Knight Games' }],
  [/avatar legends/i, { id: 'avatar-legends', name: 'Avatar Legends', edition: '1st Edition', publisher: 'Magpie Games' }],
  [/warhammer/i, { id: 'warhammer-frp', name: 'Warhammer Fantasy Roleplay', edition: '4th Edition', publisher: 'Cubicle 7' }],
  [/monster of the week/i, { id: 'monster-of-the-week', name: 'Monster of the Week', edition: 'Revised', publisher: 'Evil Hat Productions' }],
  [/dune/i, { id: 'dune-rpg', name: 'Dune: Adventures in the Imperium', edition: '1st Edition', publisher: 'Modiphius' }],
  [/star wars/i, { id: 'star-wars-ffg', name: 'Star Wars Roleplaying', edition: 'FFG Edition', publisher: 'Fantasy Flight Games' }],
  [/d&d|dungeons\s*&?\s*dragons|5e\b/i, { id: 'dnd-5e', name: 'Dungeons & Dragons', edition: '5th Edition (2014)', publisher: 'Wizards of the Coast' }],
];

function systemFor(title: string) {
  for (const [re, game] of SYSTEM_HINTS) if (re.test(title)) return game;
  return undefined;
}

function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\|.*$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 55);
}

async function api(path: string, params: Record<string, string>): Promise<any> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error('YOUTUBE_API_KEY not set');
  const r = await fetch(`${API}/${path}?${new URLSearchParams({ ...params, key })}`);
  if (!r.ok) throw new Error(`YouTube ${r.status}: ${(await r.text()).slice(0, 120)}`);
  return r.json();
}

async function main() {
  const minSubs = Number.parseInt(flag('min-subs') ?? '2000', 10);
  const dryRun = has('dry-run');

  // 1. Collect candidate channels.
  const channels = new Map<string, string>();
  for (const q of QUERIES) {
    try {
      const d = await api('search', { part: 'snippet', q, type: 'channel', maxResults: '8' });
      for (const i of d.items ?? []) channels.set(i.snippet.channelId, i.snippet.channelTitle);
    } catch (e) {
      console.error(`  search failed for "${q}": ${(e as Error).message}`);
    }
  }
  console.log(`\n${channels.size} candidate channels from ${QUERIES.length} searches.`);

  // 2. Filter by size — a channel with 200 subscribers is not yet an index entry.
  const ids = [...channels.keys()];
  const kept: { id: string; title: string; subs: number; desc: string }[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const d = await api('channels', {
      part: 'snippet,statistics',
      id: ids.slice(i, i + 50).join(','),
    });
    for (const c of d.items ?? []) {
      const subs = Number.parseInt(c.statistics?.subscriberCount ?? '0', 10);
      if (subs >= minSubs) {
        kept.push({ id: c.id, title: c.snippet.title, subs, desc: c.snippet.description ?? '' });
      }
    }
  }
  kept.sort((a, b) => b.subs - a.subs);
  console.log(`${kept.length} channels with >= ${minSubs} subscribers.\n`);

  const existingShows = new Set(
    (await readdir(join(DATA_ROOT, 'shows'))).map((f) => f.replace('.yml', '')),
  );
  const existingChannels = new Set(
    (await readdir(join(DATA_ROOT, 'channels'))).map((f) => f.replace('.yml', '')),
  );

  const existingGames = new Set(
    (await readdir(join(DATA_ROOT, 'games'))).map((f) => f.replace('.yml', '')),
  );
  const unknownSystem: string[] = [];
  let newChannels = 0;
  let newShows = 0;
  const castable: string[] = [];

  for (const ch of kept) {
    let playlists: any[] = [];
    try {
      const d = await api('playlists', {
        part: 'snippet,contentDetails',
        channelId: ch.id,
        maxResults: '50',
      });
      playlists = d.items ?? [];
    } catch {
      continue;
    }

    const campaigns = playlists
      .map((p) => ({ id: p.id, title: p.snippet.title as string, count: p.contentDetails.itemCount as number }))
      .filter((p) => p.count >= 4 && CAMPAIGN_LIKE.test(p.title) && !NOISE.test(p.title));

    if (campaigns.length === 0) continue;

    const channelId = slugify(ch.title);
    if (!channelId) continue;

    console.log(`${ch.title}  (${ch.subs.toLocaleString()} subs) — ${campaigns.length} series`);
    if (dryRun) {
      for (const c of campaigns.slice(0, 5)) console.log(`     ${String(c.count).padStart(4)}  ${c.title.slice(0, 60)}`);
      continue;
    }

    if (!existingChannels.has(channelId)) {
      await writeFile(
        join(DATA_ROOT, 'channels', `${channelId}.yml`),
        stringify({
          id: channelId,
          name: ch.title,
          type: ch.subs > 200_000 ? 'network' : 'indie studio',
          ...(ch.desc ? { description: ch.desc.slice(0, 280) } : {}),
          links: { youtube: `https://www.youtube.com/channel/${ch.id}` },
        }),
        'utf8',
      );
      existingChannels.add(channelId);
      newChannels += 1;
    }

    for (const c of campaigns) {
      const id = slugify(c.title);
      if (!id || existingShows.has(id)) continue;

      let cast: ReturnType<typeof creditsFromDescription> = [];
      try {
        for (const v of await playlistVideos(c.id, 2)) {
          const found = creditsFromDescription(v.description);
          if (found.length > cast.length) cast = found;
        }
      } catch {
        // private/empty playlist
      }

      // Only catalogue a show whose system the title actually states.
      const game = systemFor(c.title) ?? systemFor(ch.title);
      if (!game) { unknownSystem.push(`${ch.title}: ${c.title.slice(0, 50)}`); continue; }
      if (!existingGames.has(game.id)) {
        await writeFile(join(DATA_ROOT, 'games', `${game.id}.yml`), stringify(game), 'utf8');
        existingGames.add(game.id);
      }

      await writeFile(
        join(DATA_ROOT, 'shows', `${id}.yml`),
        stringify({
          id,
          title: c.title.replace(/\s*\|.*$/, '').trim().slice(0, 80),
          channels: [channelId],
          format: 'video',
          status: 'unknown',
          description: `System per source: ${game.name} ${game.edition} (per the series title).`,
          links: { website: `https://www.youtube.com/playlist?list=${c.id}` },
          seasons: [{ ordinal: 1, game: game.id, episode_count: c.count }],
        }),
        'utf8',
      );
      existingShows.add(id);
      newShows += 1;
      if (cast.length > 1) castable.push(`${id}  ${c.id}  (${cast.length} cast)`);
    }
  }

  if (!dryRun) {
    console.log(`\n${newChannels} channels, ${newShows} shows added.`);
    if (castable.length) {
      console.log(`\n${castable.length} have a readable cast — import with --youtube --playlist:`);
      for (const c of castable.slice(0, 25)) console.log(`   ${c}`);
    }
    if (unknownSystem.length) {
      console.log(`\n${unknownSystem.length} series skipped — title states no system, so none was assumed:`);
      for (const u of unknownSystem.slice(0, 12)) console.log(`   ${u}`);
    }
    console.log('');
  }
}

main().catch((e: unknown) => {
  console.error(`\n${(e as Error).message}\n`);
  process.exit(1);
});
