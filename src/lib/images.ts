/**
 * Images for people and shows.
 *
 * Lives in lib rather than a script because fetching images has to be part of
 * every import, not a separate pass someone remembers to run — the separate
 * pass left ~160 people and ~230 shows with no image at all.
 *
 * Two sources, two licences, deliberately kept apart:
 *
 *  - Portraits: Wikimedia Commons (see also fan wikis below), and only under a licence that genuinely
 *    permits reuse. Anything else is skipped.
 *  - Series art: the show's own YouTube playlist thumbnail, under the fair-use
 *    claim in POLICY.md — thumbnail scale, one per show, attributed, linked
 *    back, identification only.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { DATA_ROOT } from './load.js';
import { wikidataImage } from './sources/wikidata.js';

/** Portraits for every person that has none. Safe to re-run. */
export async function fetchPortraits(quiet = false): Promise<number> {
  let added = 0;
  for (const file of (await readdir(join(DATA_ROOT, 'people'))).filter((f) => f.endsWith('.yml'))) {
    const path = join(DATA_ROOT, 'people', file);
    const person = parse(await readFile(path, 'utf8'));
    if (person.image || person.no_auto_image) continue;

    // Only a curated QID. Resolving by name gave an actual-play GM the photo
    // of a singer who shares it.
    if (!person.wikidata_qid) continue;

    try {
      const image = await wikidataImage(person.wikidata_qid);
      if (!image) continue;

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
    // Art is optional: a dropped connection skips the batch, not the run.
    let data: any;
    try {
      const r = await fetch(`https://www.googleapis.com/youtube/v3/playlists?${q}`);
      if (!r.ok) throw new Error(`YouTube ${r.status}`);
      data = await r.json();
    } catch (error) {
      console.error(`  series art request failed: ${(error as Error).message}`);
      continue;
    }

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

export async function fetchArchiveArt(only?: Set<string>): Promise<number> {
  let added = 0;

  for (const file of (await readdir(join(DATA_ROOT, 'shows'))).filter((f) => f.endsWith('.yml'))) {
    const path = join(DATA_ROOT, 'shows', file);
    const show = parse(await readFile(path, 'utf8'));
    if (show.image) continue;
    if (only && !only.has(show.id)) continue;

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
  // Free licences first — a stated licence is stronger provenance than a
  // fair-use claim — then the wikis for everyone they do not cover.
  const portraits = (await fetchPortraits(true)) + (await fetchWikiPortraits(true));
  if (art || portraits) {
    console.log(`  images: ${art} series, ${portraits} portrait(s).`);
  }
}

/**
 * Portraits from the fan wikis that already document these people.
 *
 * The free-licence source, Wikidata, covers only a small part of
 * this database, and essentially none of the indie long tail that is the whole
 * point of the project. Skid Maher has 42 credits and no Wikidata entry; nor
 * do most of the Glass Cannon, Avantris and Saving Throw casts.
 *
 * Those people do have portraits, on the wikis their credits already cite. Wiki
 * *text* is CC-BY-SA but the images usually are not, so these are taken under
 * the same fair-use claim POLICY.md already makes for show art, and under the
 * same constraints: thumbnail scale, one per person, attributed, linked back,
 * used solely to identify the subject, removed on request.
 *
 * A person is only looked up on a wiki their own credits cite, so a name is
 * never resolved against a wiki that has nothing to do with them.
 */
const UA_WIKI =
  'ActualPlayDatabase/0.1 (community actual-play credit index; contact via repository issues)';

/** The lead image of a wiki page, at thumbnail scale. */
async function wikiPageImage(
  host: string,
  title: string,
): Promise<{ url: string; page: string; file: string } | undefined> {
  const q = new URLSearchParams({
    action: 'query',
    prop: 'pageimages|info',
    inprop: 'url',
    piprop: 'thumbnail|name',
    pithumbsize: '400',
    titles: title,
    redirects: '1',
    format: 'json',
    formatversion: '2',
  });
  try {
    const r = await fetch(`https://${host}/api.php?${q}`, {
      headers: { 'User-Agent': UA_WIKI },
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) return undefined;
    const data = await r.json();
    const page = data?.query?.pages?.[0];
    if (!page || page.missing || !page.thumbnail?.source) return undefined;
    return { url: page.thumbnail.source, page: page.fullurl, file: String(page.pageimage ?? '') };
  } catch {
    return undefined;
  }
}

/** Words a filename may add to a name without changing whose picture it is. */
const PORTRAIT_WORDS = new Set(['portrait', 'headshot', 'photo', 'profile', 'cropped', 'crop', 'avatar', 'pfp']);

/**
 * A page's lead image is often character art. Only a file named after the
 * person is taken as a picture of them: the name and nothing else, apart from
 * numbers and a few words like "portrait". Anything more may be a group shot, a
 * logo, a character or another person whose name contains this one.
 */
export function fileNamesPerson(file: string, names: string[]): boolean {
  const norm = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const split = (v: string) => norm(v).split(/[^a-z0-9]+/).filter(Boolean);
  const bare = split(file.replace(/\.[a-z0-9]{2,4}$/i, ''))
    .filter((w) => !/^\d+$/.test(w) && !PORTRAIT_WORDS.has(w))
    .join('');
  return bare !== '' && names.some((name) => split(name).join('') === bare);
}

/** Wikis this person's own credits cite, most-cited first. */
function wikisFor(person: any): string[] {
  const counts = new Map<string, number>();
  for (const credit of person.credits ?? []) {
    for (const source of credit.sources ?? []) {
      const url = String(source.url ?? '');
      const host = url.match(/^https?:\/\/([^/]+)/)?.[1];
      if (!host || !/fandom\.com|miraheze\.org|wikia\./i.test(host)) continue;
      counts.set(host, (counts.get(host) ?? 0) + 1);
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1]).map(([host]) => host);
}

export async function fetchWikiPortraits(quiet = false): Promise<number> {
  let added = 0;
  for (const file of (await readdir(join(DATA_ROOT, 'people'))).filter((f) => f.endsWith('.yml'))) {
    const path = join(DATA_ROOT, 'people', file);
    const person = parse(await readFile(path, 'utf8'));
    if (person.image || person.no_auto_image) continue;

    // A one-word name is normally too ambiguous to resolve against a page
    // title — but not when every credit this person has points at a single
    // wiki. Legends of Avantris bills its whole cast by first name, and those
    // six are among the most credited people here.
    const wikis = wikisFor(person);
    const allNames: string[] = [
      person.canonical_name,
      ...(person.aliases ?? []).map((a: any) => a.name),
    ].filter(Boolean);
    const names =
      wikis.length === 1 ? allNames : allNames.filter((n: string) => n.trim().includes(' '));
    if (names.length === 0) continue;

    let found: Awaited<ReturnType<typeof wikiPageImage>>;
    let host = '';
    outer: for (const h of wikis) {
      for (const name of [...new Set(names)]) {
        found = await wikiPageImage(h, name);
        await new Promise((r) => setTimeout(r, 120));
        if (found && !fileNamesPerson(found.file, names)) found = undefined;
        if (found) { host = h; break outer; }
      }
    }
    if (!found) continue;

    person.image = {
      url: found.url,
      licence: 'fair use',
      attribution: `Portrait of ${person.canonical_name}, © its owner. Via ${host}.`,
      source: found.page,
      depicts: person.canonical_name,
      rationale:
        'Low-resolution thumbnail used solely to identify this person in an index of ' +
        'their credits. Non-commercial, does not substitute for the original, and links ' +
        'back to the source. Removed on request by the rights holder — see POLICY.md.',
    };
    await writeFile(path, stringify(person), 'utf8');
    added += 1;
    if (!quiet) console.log(`     portrait: ${person.canonical_name} (via ${host})`);
  }
  return added;
}
