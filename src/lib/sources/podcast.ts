/**
 * Podcast adapter — Apple's lookup API plus the show's own RSS.
 *
 * The best-behaved source in this project. Apple's lookup/search endpoints are
 * public and keyless, and they hand back the show's real RSS feed — which the
 * production publishes and controls. That makes show metadata here `official`
 * tier: it is the producer describing their own show.
 *
 * Cast is a different matter. Podcast feeds reliably carry a title, a
 * description and an author; they rarely carry a structured cast. Hosts are
 * often named in prose ("Hosted by cuppycup and Scott Dorward"), which is worth
 * reading. Per-episode casts generally are not there, and are not guessed at.
 */

const LOOKUP = 'https://itunes.apple.com/lookup';
const SEARCH = 'https://itunes.apple.com/search';
const UA = 'ActualPlayDatabase/0.1 (community actual-play credit index)';

export interface PodcastShow {
  appleId: number;
  title: string;
  author: string;
  feedUrl?: string;
  genres: string[];
  artworkUrl?: string;
  appleUrl: string;
  description?: string;
  hosts: string[];
  episodeCount?: number;
}

async function json(url: string): Promise<any> {
  const response = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!response.ok) throw new Error(`${response.status} for ${url}`);
  return response.json();
}

/** Accepts an Apple podcast id, an Apple URL, or a title to search for. */
export async function findPodcast(query: string): Promise<PodcastShow | undefined> {
  const idMatch = query.match(/id(\d+)/) ?? query.match(/^(\d+)$/);

  const data = idMatch
    ? await json(`${LOOKUP}?id=${idMatch[1]}&entity=podcast`)
    : await json(`${SEARCH}?term=${encodeURIComponent(query)}&entity=podcast&limit=1`);

  const result = data?.results?.[0];
  if (!result) return undefined;

  const show: PodcastShow = {
    appleId: result.collectionId,
    title: result.collectionName ?? query,
    author: result.artistName ?? '',
    feedUrl: result.feedUrl,
    genres: result.genres ?? [],
    artworkUrl: result.artworkUrl600 ?? result.artworkUrl100,
    appleUrl: result.collectionViewUrl ?? `https://podcasts.apple.com/podcast/id${result.collectionId}`,
    hosts: [],
  };

  if (show.feedUrl) {
    try {
      Object.assign(show, await readFeed(show.feedUrl));
    } catch {
      // A dead feed still leaves usable Apple metadata.
    }
  }
  return show;
}

function unwrap(xml: string, tag: string): string | undefined {
  const match = xml.match(
    new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`, 'i'),
  );
  return match?.[1];
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Hosts named in prose. Deliberately narrow: only an explicit "hosted by"
 * style phrase counts, and only capitalised names or handles are taken from
 * it. A description that doesn't say who hosts yields nobody.
 */
export function hostsFromDescription(description: string): string[] {
  const match = description.match(
    /\b(?:hosted by|hosts?:|created by|presented by|starring)\s+([^.!?\n]{3,120})/i,
  );
  if (!match) return [];

  return match[1]!
    .split(/,|\band\b|&/i)
    .map((chunk) => chunk.replace(/^[\s\-–—]+|[\s.,;]+$/g, '').trim())
    .filter((name) => name.length > 1 && name.length < 40)
    // A name is capitalised ("Scott Dorward") or a single-token handle
    // ("cuppycup"). "rich sound design" is neither, and a sentence like
    // "hosted by X and Y, we run games with rich sound design" will otherwise
    // hand you the prose along with the hosts.
    .filter((name) => /^[\p{L}][\p{L}.'-]*(?:\s+[\p{L}][\p{L}.'-]*){0,3}$/u.test(name))
    .filter((name) => /^\p{Lu}/u.test(name) || !name.includes(' '))
    .filter((name) => !/^(the|a|an|our|us|we|they|his|her|their)$/i.test(name))
    .slice(0, 6);
}

async function readFeed(feedUrl: string): Promise<Partial<PodcastShow>> {
  const response = await fetch(feedUrl, { headers: { 'User-Agent': UA } });
  if (!response.ok) throw new Error(`${response.status} for feed`);
  const xml = await response.text();

  const channel = xml.split('<item')[0] ?? xml;
  const description = stripHtml(
    unwrap(channel, 'itunes:summary') ?? unwrap(channel, 'description') ?? '',
  );

  return {
    description: description || undefined,
    hosts: hostsFromDescription(description),
    episodeCount: (xml.match(/<item[\s>]/g) ?? []).length || undefined,
  };
}
