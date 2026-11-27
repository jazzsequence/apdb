/**
 * Is this "new" show one we already hold under another name?
 *
 * The importers used to compare only the slug of an upload's title, so a
 * production catalogued under its real name was imported again under its
 * uploader's.
 */
import { loadDataset } from './load.js';
import { titleKey } from './sources/imdb.js';

export async function knownCatalogue() {
  const { dataset } = await loadDataset();
  const text = JSON.stringify([dataset.shows, dataset.people]);
  const capture = (re: RegExp) => new Set([...text.matchAll(re)].map((m) => m[1]!.toLowerCase()));
  return {
    archiveItems: capture(/archive\.org\/details\/([^"\\/?# ]+)/g),
    playlists: capture(/[?&]list=([\w-]+)/g),
    titles: new Set(
      dataset.shows.flatMap((s) => [s.title, ...s.seasons.map((x) => x.title ?? '')]).filter(Boolean).map(titleKey),
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
