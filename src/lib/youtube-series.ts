/**
 * Choosing which of a channel's playlists are series worth cataloguing.
 */
import { creditsFromDescription, type YouTubeVideo } from './sources/youtube.js';

/** "All Episodes" gathers other series; it is not one. */
export const AGGREGATE_TITLE =
  /\b(all (the )?(episodes|videos|campaigns|streams)|every episode|(full|complete) archive)\b|^(all )?uploads$/i;

/**
 * How many people the best single description puts at the table.
 *
 * Only game masters and players count: an editor and a composer are credited on
 * anything, played or not. Every video is read, because a campaign often opens
 * on an introduction that lists nobody.
 */
export function tableSize(videos: YouTubeVideo[]): number {
  return Math.max(
    0,
    ...videos.map(
      (v) =>
        new Set(
          creditsFromDescription(v.description)
            .filter((c) => /GM|player/.test(c.role))
            .map((c) => c.name.toLowerCase()),
        ).size,
    ),
  );
}

export interface ReadPlaylist {
  videos: YouTubeVideo[];
  /** Why this one cannot become a show whatever it contains. */
  blocked?: string;
}

/**
 * Split a channel's playlists into series and ones to hold, with the reason.
 *
 * They are taken smallest first, so a series is met before any playlist that
 * gathers it up, whatever order the API lists them in. Every playlist counts as
 * seen, including held ones: a gathering of them is no more a series than they
 * are. `seen` carries across channels.
 */
export function selectSeries<T extends ReadPlaylist>(
  playlists: T[],
  seen: Set<string>,
): { series: Array<T & { cast: number }>; held: Array<{ playlist: T; reason: string }> } {
  const series: Array<T & { cast: number }> = [];
  const held: Array<{ playlist: T; reason: string }> = [];

  for (const playlist of [...playlists].sort((a, b) => a.videos.length - b.videos.length)) {
    const repeats = playlist.videos.filter((v) => seen.has(v.id)).length > playlist.videos.length / 2;
    for (const v of playlist.videos) seen.add(v.id);

    const cast = tableSize(playlist.videos);
    if (playlist.blocked) held.push({ playlist, reason: playlist.blocked });
    else if (repeats) held.push({ playlist, reason: 'mostly repeats other playlists' });
    // A system in a title also matches video games and rules videos. A table
    // in the descriptions is the evidence that people played it.
    else if (cast < 2) held.push({ playlist, reason: 'no players or game master in the descriptions' });
    else series.push({ ...playlist, cast });
  }
  return { series, held };
}
