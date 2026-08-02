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

/**
 * Openverse indexes freely-licensed images across Flickr, Commons and others,
 * keyless. It is the fallback for the many indie performers who have no
 * Wikidata entry at all — Commons alone covers about a quarter of them.
 *
 * The licence comes back machine-readable, so only genuinely reusable ones are
 * taken, and the title must actually contain the person's name: a search for a
 * name returns *something* regardless, and an unrelated photo of a stranger is
 * worse than no photo.
 */
const OPENVERSE_LICENCES: Record<string, string> = {
  'cc0-1.0': 'CC0',
  'pdm-1.0': 'public domain',
  'by-2.0': 'CC-BY-2.0',
  'by-3.0': 'CC-BY-3.0',
  'by-4.0': 'CC-BY-4.0',
  'by-sa-2.0': 'CC-BY-SA-2.0',
  'by-sa-3.0': 'CC-BY-SA-3.0',
  'by-sa-4.0': 'CC-BY-SA-4.0',
};

async function openverseImage(name: string) {
  const q = new URLSearchParams({
    q: name,
    license: 'cc0,pdm,by,by-sa',
    page_size: '5',
    mature: 'false',
  });
  const r = await fetch(`https://api.openverse.org/v1/images/?${q}`, {
    headers: { 'User-Agent': 'ActualPlayDatabase/0.1 (community actual-play credit index)' },
  });
  if (!r.ok) return undefined;
  const data: any = await r.json();

  const surname = name.split(/\s+/).slice(-1)[0]!.toLowerCase();
  for (const hit of data.results ?? []) {
    const licence = OPENVERSE_LICENCES[`${hit.license}-${hit.license_version}`];
    if (!licence) continue;
    // Must plausibly depict this person, not merely match a search.
    const title = String(hit.title ?? '').toLowerCase();
    if (!title.includes(name.toLowerCase()) && !title.includes(surname)) continue;
    if (!hit.url) continue;
    return {
      url: hit.url as string,
      licence,
      attribution: String(hit.creator ?? 'Unknown').slice(0, 80),
      source: String(hit.foreign_landing_url ?? hit.url),
    };
  }
  return undefined;
}

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
      const image = qid ? await wikidataImage(qid) : await openverseImage(person.canonical_name);
      if (!image) continue;
      if (qid) person.wikidata_qid = qid;

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

/**
 * Series art for shows that came from a fan wiki or a podcast feed rather than
 * YouTube. Same fair-use claim as the YouTube thumbnails — thumbnail scale,
 * one per show, attributed, linked back, identification only.
 */
export async function fetchOtherSeriesArt(): Promise<number> {
  let added = 0;

  for (const file of (await readdir(join(DATA_ROOT, 'shows'))).filter((f) => f.endsWith('.yml'))) {
    const path = join(DATA_ROOT, 'shows', file);
    const show = parse(await readFile(path, 'utf8'));
    if (show.image) continue;

    const website = String(show.links?.website ?? '');
    let found: { url: string; source: string; via: string } | undefined;

    // Fan wiki: the campaign infobox names an image file.
    const wiki = website.match(/^https:\/\/([\w.-]+(?:fandom\.com|miraheze\.org))\/wiki\/(.+)$/);
    if (wiki) {
      try {
        const { campaignImage } = await import('./sources/mediawiki.js');
        const img = await campaignImage(wiki[1]!, decodeURIComponent(wiki[2]!).replace(/_/g, ' '));
        if (img) found = { url: img.url, source: img.descriptionUrl, via: wiki[1]! };
      } catch {
        // page gone or no infobox image
      }
    }

    // Podcast: Apple carries the show's own cover art.
    if (!found && /podcasts\.apple\.com/.test(website)) {
      const id = website.match(/id(\d+)/)?.[1];
      if (id) {
        try {
          const r = await fetch(`https://itunes.apple.com/lookup?id=${id}&entity=podcast`, {
            headers: { 'User-Agent': 'ActualPlayDatabase/0.1' },
          });
          const data: any = await r.json();
          const art = data?.results?.[0]?.artworkUrl600 ?? data?.results?.[0]?.artworkUrl100;
          if (art) found = { url: art, source: website, via: 'Apple Podcasts' };
        } catch {
          // fall through
        }
      }
    }

    if (!found) continue;

    show.image = {
      url: found.url,
      licence: 'fair use',
      attribution: `${show.title} series art, \u00a9 its producers. Via ${found.via}.`,
      source: found.source,
      depicts: `Series art for ${show.title}`,
      rationale:
        'Low-resolution image used solely to identify the show in an index of its credits. ' +
        'Non-commercial, does not substitute for the original, and links back to the source. ' +
        'Removed on request by the rights holder \u2014 see POLICY.md.',
    };
    await writeFile(path, stringify(show), 'utf8');
    added += 1;
    await new Promise((r) => setTimeout(r, 120));
  }
  return added;
}

/**
 * Cover art for shows preserved on the Internet Archive.
 *
 * Archive exposes a public thumbnail per item, and many uploaders state an
 * explicit licence — which is better provenance than a fair-use claim, so it
 * is recorded as itself. Where nothing is stated, the fair-use claim applies.
 */
const CC_URL_LICENCES: [RegExp, string][] = [
  [/publicdomain\/(zero|mark)/i, 'public domain'],
  [/licenses\/by-nc-nd\/4/i, 'CC-BY-NC-ND-4.0'],
  [/licenses\/by-nc-nd\/3/i, 'CC-BY-NC-ND-3.0'],
  [/licenses\/by-nc-sa\/4/i, 'CC-BY-NC-SA-4.0'],
  [/licenses\/by-nc-sa\/3/i, 'CC-BY-NC-SA-3.0'],
  [/licenses\/by-nc\/4/i, 'CC-BY-NC-4.0'],
  [/licenses\/by-nc\/3/i, 'CC-BY-NC-3.0'],
  [/licenses\/by-nd\/4/i, 'CC-BY-ND-4.0'],
  [/licenses\/by-nd\/3/i, 'CC-BY-ND-3.0'],
  [/licenses\/by-sa\/4/i, 'CC-BY-SA-4.0'],
  [/licenses\/by-sa\/3/i, 'CC-BY-SA-3.0'],
  [/licenses\/by\/4/i, 'CC-BY-4.0'],
  [/licenses\/by\/3/i, 'CC-BY-3.0'],
];

export async function fetchArchiveArt(): Promise<number> {
  let added = 0;

  for (const file of (await readdir(join(DATA_ROOT, 'shows'))).filter((f) => f.endsWith('.yml'))) {
    const path = join(DATA_ROOT, 'shows', file);
    const show = parse(await readFile(path, 'utf8'));
    if (show.image) continue;

    const identifier = String(show.links?.website ?? '').match(
      /archive\.org\/details\/([^/?#]+)/,
    )?.[1];
    if (!identifier) continue;

    let licenceUrl: string | undefined;
    let creator: string | undefined;
    try {
      const r = await fetch(`https://archive.org/metadata/${encodeURIComponent(identifier)}`, {
        headers: { 'User-Agent': 'ActualPlayDatabase/0.1' },
      });
      const meta: any = (await r.json())?.metadata;
      licenceUrl = meta?.licenseurl;
      creator = Array.isArray(meta?.creator) ? meta.creator[0] : meta?.creator;
    } catch {
      // metadata unavailable — fall back to the claim
    }

    const stated = licenceUrl
      ? CC_URL_LICENCES.find(([re]) => re.test(licenceUrl!))?.[1]
      : undefined;

    show.image = {
      url: `https://archive.org/services/img/${identifier}`,
      licence: stated ?? 'fair use',
      attribution: stated
        ? `${creator ?? show.title}, ${stated}. Via the Internet Archive.`
        : `${show.title} cover art, © its producers. Via the Internet Archive.`,
      source: `https://archive.org/details/${identifier}`,
      depicts: `Cover art for ${show.title}`,
      ...(stated
        ? {}
        : {
            rationale:
              'Low-resolution thumbnail used solely to identify the show in an index of its ' +
              'credits. The uploader states no licence. Non-commercial, does not substitute ' +
              'for the original, links back to the source, removed on request — see POLICY.md.',
          }),
    };
    await writeFile(path, stringify(show), 'utf8');
    added += 1;
    await new Promise((r) => setTimeout(r, 130));
  }
  return added;
}

/** Both passes. Called at the end of every import. */
export async function fetchAllImages(): Promise<void> {
  const art =
    (await fetchSeriesArt()) + (await fetchOtherSeriesArt()) + (await fetchArchiveArt());
  const portraits = await fetchPortraits(true);
  if (art || portraits) {
    console.log(`  images: ${art} series, ${portraits} portrait(s).`);
  }
}
