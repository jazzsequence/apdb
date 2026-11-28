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
