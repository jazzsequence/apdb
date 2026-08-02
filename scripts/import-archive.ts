#!/usr/bin/env tsx
/**
 * Import actual-play series from the Internet Archive.
 *
 * Archive is where shows go when they stop — productions whose sites are gone
 * and whose feeds are dead. No other index has them because there is no live
 * source left to find.
 *
 *   npm run import:archive -- --dry-run
 *   npm run import:archive -- --min-episodes 5
 */
import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { fetchAllImages } from '../src/lib/images.js';
import { DATA_ROOT } from '../src/lib/load.js';
import { groupIntoSeries, searchActualPlay, type ArchiveSeries } from '../src/lib/sources/archive.js';

const args = process.argv.slice(2);
const flag = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (n: string) => args.includes(`--${n}`);

/** Subject tags map to systems — the uploader's own tagging, not a guess. */
const SYSTEMS: [RegExp, { id: string; name: string; edition: string; publisher: string }][] = [
  [/red markets/i, { id: 'red-markets', name: 'Red Markets', edition: '1st Edition', publisher: 'Hebanon Games' }],
  [/13th age/i, { id: '13th-age', name: '13th Age', edition: '1st Edition', publisher: 'Pelgrane Press' }],
  [/shadowrun/i, { id: 'shadowrun', name: 'Shadowrun', edition: '5th Edition', publisher: 'Catalyst Game Labs' }],
  [/call of cthulhu/i, { id: 'call-of-cthulhu', name: 'Call of Cthulhu', edition: '7th Edition', publisher: 'Chaosium' }],
  [/pathfinder/i, { id: 'pathfinder-1e', name: 'Pathfinder', edition: '1st Edition', publisher: 'Paizo' }],
  [/savage worlds/i, { id: 'savage-worlds-deluxe', name: 'Savage Worlds', edition: 'Deluxe Edition', publisher: 'Pinnacle Entertainment Group' }],
  [/fate/i, { id: 'fate-core', name: 'Fate', edition: 'Core', publisher: 'Evil Hat Productions' }],
  [/gurps/i, { id: 'gurps', name: 'GURPS', edition: '4th Edition', publisher: 'Steve Jackson Games' }],
  [/vampire|masquerade/i, { id: 'vampire-the-masquerade-v5', name: 'Vampire: The Masquerade', edition: '5th Edition', publisher: 'Renegade Game Studios' }],
  [/traveller/i, { id: 'traveller', name: 'Traveller', edition: 'Mongoose 2nd Edition', publisher: 'Mongoose Publishing' }],
  [/apocalypse world|pbta/i, { id: 'powered-by-the-apocalypse', name: 'Powered by the Apocalypse', edition: 'N/A', publisher: 'Various' }],
  [/dungeon world/i, { id: 'dungeon-world', name: 'Dungeon World', edition: '1st Edition', publisher: 'Sage Kobold Productions' }],
  [/d&d|dungeons and dragons|5e|pathfinder/i, { id: 'dnd-5e', name: 'Dungeons & Dragons', edition: '5th Edition (2014)', publisher: 'Wizards of the Coast' }],
];

function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 55)
    .replace(/-+$/, '');
}

function systemFor(series: ArchiveSeries) {
  const haystack = [...series.subjects, series.title].join(' ');
  for (const [re, game] of SYSTEMS) if (re.test(haystack)) return game;
  return undefined;
}

async function main() {
  const minEpisodes = Number.parseInt(flag('min-episodes') ?? '4', 10);

  // Archive caps rows per request; two pages is plenty for this subject.
  const items = [...(await searchActualPlay(500, 1)), ...(await searchActualPlay(500, 2))];
  const series = groupIntoSeries(items, minEpisodes);

  console.log(`\n${items.length} archived episodes -> ${series.length} series (>= ${minEpisodes} episodes).\n`);

  const existingShows = new Set(
    (await readdir(join(DATA_ROOT, 'shows'))).map((f) => f.replace('.yml', '')),
  );
  const existingChannels = new Set(
    (await readdir(join(DATA_ROOT, 'channels'))).map((f) => f.replace('.yml', '')),
  );
  const existingGames = new Set(
    (await readdir(join(DATA_ROOT, 'games'))).map((f) => f.replace('.yml', '')),
  );

  let newShows = 0;
  let newChannels = 0;
  const noSystem: string[] = [];

  for (const s of series) {
    const game = systemFor(s);
    if (!game) {
      noSystem.push(`${s.creator}: ${s.title.slice(0, 44)} (${s.items.length} eps)`);
      continue;
    }

    const showId = slugify(s.title);
    const channelId = slugify(s.creator);
    if (!showId || !channelId) continue;

    if (has('dry-run')) {
      console.log(
        `  ${String(s.items.length).padStart(4)} eps  ${s.title.slice(0, 42).padEnd(42)} ${game.name.slice(0, 22).padEnd(22)} ${s.creator.slice(0, 24)}`,
      );
      continue;
    }

    if (!existingGames.has(game.id)) {
      await writeFile(join(DATA_ROOT, 'games', `${game.id}.yml`), stringify(game), 'utf8');
      existingGames.add(game.id);
    }

    if (!existingChannels.has(channelId)) {
      await writeFile(
        join(DATA_ROOT, 'channels', `${channelId}.yml`),
        stringify({
          id: channelId,
          name: s.creator.slice(0, 80),
          type: 'indie studio',
          description: 'Independent producer; episodes preserved on the Internet Archive.',
          links: { website: `https://archive.org/search?query=creator%3A%22${encodeURIComponent(s.creator)}%22` },
        }),
        'utf8',
      );
      existingChannels.add(channelId);
      newChannels += 1;
    }

    if (existingShows.has(showId)) continue;

    await writeFile(
      join(DATA_ROOT, 'shows', `${showId}.yml`),
      stringify({
        id: showId,
        title: s.title.slice(0, 80),
        channels: [channelId],
        format: 'podcast',
        status: 'unknown',
        description:
          `Preserved on the Internet Archive. System per the uploader's own tags: ${game.name}.` +
          (s.licenseUrl ? ` Uploader licence: ${s.licenseUrl}.` : ''),
        links: { website: `https://archive.org/details/${s.items[0]!.identifier}` },
        seasons: [
          {
            ordinal: 1,
            game: game.id,
            episode_count: s.items.length,
            ...(s.earliest ? { started: s.earliest } : {}),
            ...(s.latest && s.latest !== s.earliest ? { ended: s.latest } : {}),
          },
        ],
      }),
      'utf8',
    );
    existingShows.add(showId);
    newShows += 1;
    console.log(`  + ${s.title.slice(0, 42).padEnd(42)} ${game.name.slice(0, 20).padEnd(20)} ${s.items.length} eps`);
  }

  if (!has('dry-run')) {
    await fetchAllImages();
    console.log(`\n${newChannels} channel(s), ${newShows} show(s) added from the Internet Archive.`);
  }

  if (noSystem.length) {
    console.log(`\n${noSystem.length} series skipped — tags name no system, so none was assumed:`);
    for (const n of noSystem.slice(0, 10)) console.log(`   ${n}`);
  }
  console.log('');
}

main().catch((e: unknown) => {
  console.error(`\n${(e as Error).message}\n`);
  process.exit(1);
});
