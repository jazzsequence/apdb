/**
 * Images for people and shows.
 *
 * Lives in lib rather than a script because fetching images has to be part of
 * every import, not a separate pass someone remembers to run — the separate
 * pass left ~160 people and ~230 shows with no image at all.
 *
 * Two sources, two licences, deliberately kept apart:
 *
 *  - Portraits: Wikimedia Commons, and only under a licence that genuinely
 *    permits reuse. Anything else is skipped.
 *  - Series art: the show's own YouTube playlist thumbnail, under the fair-use
 *    claim in POLICY.md — thumbnail scale, one per show, attributed, linked
 *    back, identification only.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { DATA_ROOT } from './load.js';
import { searchPeople, wikidataImage } from './sources/wikidata.js';

/** Portraits for every person that has none. Safe to re-run. */
export async function fetchPortraits(quiet = false): Promise<number> {
  let added = 0;
  for (const file of (await readdir(join(DATA_ROOT, 'people'))).filter((f) => f.endsWith('.yml'))) {
    const path = join(DATA_ROOT, 'people', file);
    const person = parse(await readFile(path, 'utf8'));
    if (person.image) continue;

    try {
      let qid: string | undefined = person.wikidata_qid;
      if (!qid) {
        const hits = await searchPeople(person.canonical_name, 1);
        // Exact label match only — a fuzzy one once put a gymnast's photo on
        // Matthew Mercer.
        if (hits[0] && hits[0].label.toLowerCase() === person.canonical_name.toLowerCase()) {
          qid = hits[0].id;
        }
      }
      if (!qid) continue;

      const image = await wikidataImage(qid);
      if (!image) continue;

      person.wikidata_qid = qid;
      person.image = image;
      await writeFile(path, stringify(person), 'utf8');
      added += 1;
      if (!quiet) console.log(`     portrait: ${person.canonical_name} (${image.licence})`);
    } catch {
      // a missing entity is not worth stopping for
    }
    await new Promise((r) => setTimeout(r, 110));
  }
  return added;
}

/** Series art from each show's own playlist thumbnail. Safe to re-run. */
export async function fetchSeriesArt(): Promise<number> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return 0;

  const wanted: { path: string; show: any; playlistId: string }[] = [];
  for (const file of (await readdir(join(DATA_ROOT, 'shows'))).filter((f) => f.endsWith('.yml'))) {
    const path = join(DATA_ROOT, 'shows', file);
    const show = parse(await readFile(path, 'utf8'));
    if (show.image) continue;
    const listId = String(show.links?.website ?? '').match(/[?&]list=([\w-]+)/)?.[1];
    if (listId) wanted.push({ path, show, playlistId: listId });
  }

  let added = 0;
  for (let i = 0; i < wanted.length; i += 50) {
    const batch = wanted.slice(i, i + 50);
    const q = new URLSearchParams({ part: 'snippet', id: batch.map((b) => b.playlistId).join(','), key });
    const r = await fetch(`https://www.googleapis.com/youtube/v3/playlists?${q}`);
    if (!r.ok) break;
    const data: any = await r.json();

    const thumbs = new Map<string, string>();
    for (const item of data.items ?? []) {
      const t = item.snippet?.thumbnails;
      const url = t?.high?.url ?? t?.medium?.url ?? t?.default?.url;
      if (url) thumbs.set(item.id, url);
    }

    for (const b of batch) {
      const url = thumbs.get(b.playlistId);
      if (!url) continue;
      b.show.image = {
        url,
        licence: 'fair use',
        attribution: `${b.show.title} series art, \u00a9 its producers. Via YouTube.`,
        source: `https://www.youtube.com/playlist?list=${b.playlistId}`,
        depicts: `Series art for ${b.show.title}`,
        rationale:
          'Low-resolution thumbnail used solely to identify the show in an index of its ' +
          'credits. Non-commercial, does not substitute for the original, and links back ' +
          'to the source. Removed on request by the rights holder \u2014 see POLICY.md.',
      };
      await writeFile(b.path, stringify(b.show), 'utf8');
      added += 1;
    }
  }
  return added;
}

/** Both passes. Called at the end of every import. */
export async function fetchAllImages(): Promise<void> {
  const art = await fetchSeriesArt();
  const portraits = await fetchPortraits(true);
  if (art || portraits) {
    console.log(`  images: ${art} series, ${portraits} portrait(s).`);
  }
}
