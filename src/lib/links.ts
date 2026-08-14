/**
 * Turning a stored URL into something a reader can act on.
 *
 * Every show and channel here has a link, but the pages never showed them, so
 * an index of what exists gave you no way to go and watch any of it. A bare
 * URL is not much better: "https://www.youtube.com/playlist?list=PL7atu…"
 * tells you nothing that "Watch on YouTube" doesn't say faster.
 */

export type LinkKind =
  | 'watch'      // you can view the show itself here
  | 'listen'     // audio
  | 'read'       // a wiki or reference page
  | 'home';      // the production's or channel's own site

export interface DescribedLink {
  url: string;
  label: string;
  kind: LinkKind;
  /** Shown as a small hint next to the label. */
  host: string;
}

/**
 * Order matters: the first match wins, so the more specific patterns come
 * first. A YouTube *playlist* is a watchable show; a YouTube *channel* is a
 * home page that happens to be on YouTube, and calling both "Watch on YouTube"
 * would promise an episode and deliver a channel listing.
 */
const PATTERNS: [RegExp, string, LinkKind][] = [
  [/youtube\.com\/playlist\?|[?&]list=/i, 'Watch the playlist', 'watch'],
  [/youtube\.com\/watch\?|youtu\.be\//i, 'Watch on YouTube', 'watch'],
  [/youtube\.com\/(@|c\/|channel\/|user\/)/i, 'YouTube channel', 'home'],
  [/youtube\.com/i, 'YouTube', 'home'],
  [/twitch\.tv/i, 'Watch on Twitch', 'watch'],
  [/archive\.org\/details/i, 'Watch on the Internet Archive', 'watch'],
  [/archive\.org/i, 'Internet Archive', 'watch'],
  [/podcasts\.apple\.com/i, 'Listen on Apple Podcasts', 'listen'],
  [/open\.spotify\.com|spotify\.com/i, 'Listen on Spotify', 'listen'],
  [/podbean\.com|libsyn\.com|buzzsprout\.com|simplecast\.com|megaphone\.fm|anchor\.fm|creators\.spotify\.com|acast\.com|art19\.com/i,
    'Listen to the podcast', 'listen'],
  [/en\.wikipedia\.org/i, 'Wikipedia', 'read'],
  [/wikidata\.org/i, 'Wikidata', 'read'],
  [/fandom\.com|miraheze\.org|wikia\./i, 'Read the wiki', 'read'],
  [/beacon\.tv/i, 'Watch on Beacon', 'watch'],
  [/dropout\.tv/i, 'Watch on Dropout', 'watch'],
];

export function describeLink(url: string): DescribedLink | undefined {
  if (!/^https?:\/\//i.test(url)) return undefined;
  let host = '';
  try {
    host = new URL(url).host.replace(/^www\./, '');
  } catch {
    return undefined;
  }
  for (const [re, label, kind] of PATTERNS) {
    if (re.test(url)) return { url, label, kind, host };
  }
  return { url, label: 'Official site', kind: 'home', host };
}

/**
 * Every link an entity has, described and de-duplicated, watchable first.
 *
 * A reader who wants to watch something should not have to scan past three
 * social accounts to find the playlist.
 */
const ORDER: Record<LinkKind, number> = { watch: 0, listen: 1, home: 2, read: 3 };

export function describedLinks(links: Record<string, string | undefined> | undefined): DescribedLink[] {
  const out: DescribedLink[] = [];
  const seen = new Set<string>();
  for (const url of Object.values(links ?? {})) {
    if (!url) continue;
    const described = describeLink(url);
    if (!described || seen.has(described.url)) continue;
    seen.add(described.url);
    out.push(described);
  }
  return out.sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
}

/** The single best link — what a "watch this" button should point at. */
export function primaryLink(links: Record<string, string | undefined> | undefined): DescribedLink | undefined {
  return describedLinks(links)[0];
}
