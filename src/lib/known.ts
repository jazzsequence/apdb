/**
 * Is this "new" show one we already hold under another name?
 *
 * The importers used to compare only the slug of an upload's title, so a
 * production catalogued under its real name was imported again under its
 * uploader's.
 */
import { loadDataset } from './load.js';
import { titleKey } from './sources/imdb.js';

/** "Season 1" or "Campaign Two" names no particular show. */
const GENERIC_TITLE =
  /^((season|campaign|series|chapter|arc|part|book|volume) (\d+|[ivx]+|one|two|three|four|five|six|seven|eight|nine|ten)|one shots?)$/;

/**
 * Only single-season shows carrying the sweep's own description: the follow-up
 * import files a cast under season 1, which is wrong for anything else.
 */
export function showsAwaitingCast(dataset: {
  shows: Array<{ id: string; description?: string; links?: { website?: string }; seasons: unknown[] }>;
  people: Array<{ credits: Array<{ show: string }> }>;
}): Array<{ show: string; playlist: string }> {
  const credited = new Set(dataset.people.flatMap((p) => p.credits.map((c) => c.show)));
  return dataset.shows.flatMap((s) => {
    const playlist = s.links?.website?.match(/youtube\.com\/playlist\?list=([\w-]+)/)?.[1];
    const swept = s.description?.endsWith('(per the series title).');
    return playlist && swept && s.seasons.length === 1 && !credited.has(s.id) ? [{ show: s.id, playlist }] : [];
  });
}

export async function knownCatalogue() {
  const { dataset } = await loadDataset();
  const text = JSON.stringify([dataset.shows, dataset.people]);
  const capture = (re: RegExp) => new Set([...text.matchAll(re)].map((m) => m[1]!.toLowerCase()));
  return {
    archiveItems: capture(/archive\.org\/details\/([^"\\/?# ]+)/g),
    /** Each of those, with the latest date recorded for a show linking to it. */
    get archiveDates(): Map<string, string | undefined> {
      const dates = new Map<string, string | undefined>([...this.archiveItems].map((i) => [i, undefined]));
      for (const show of dataset.shows) {
        const item = String(show.links?.website ?? '').match(/archive\.org\/details\/([^/?#]+)/)?.[1]?.toLowerCase();
        if (!item) continue;
        const latest = show.seasons.map((s) => s.ended ?? s.started).filter(Boolean).sort().pop();
        dates.set(item, [dates.get(item), latest].filter(Boolean).sort().pop());
      }
      return dates;
    },
    playlists: capture(/[?&]list=([\w-]+)/g),
    people: dataset.people,
    /** Shows the YouTube sweep wrote that still have nobody credited. */
    awaitingCast: () => showsAwaitingCast(dataset),
    titles: new Set(
      [
        ...dataset.shows.map((s) => titleKey(s.title)),
        ...dataset.shows
          .flatMap((s) => s.seasons.map((x) => titleKey(x.title ?? '')))
          .filter((t) => t && !GENERIC_TITLE.test(t)),
      ],
    ),
    /** The existing channel with this id, name or YouTube channel id. */
    channelId(id: string, name: string, youtubeId?: string): string | undefined {
      return dataset.channels.find(
        (c) =>
          c.id === id ||
          titleKey(c.name) === titleKey(name) ||
          (youtubeId !== undefined && String(c.links?.youtube ?? '').split(/[/?#]/).includes(youtubeId)),
      )?.id;
    },
    channelHasShows: (id: string) => dataset.shows.some((s) => s.channels.includes(id)),
  };
}
