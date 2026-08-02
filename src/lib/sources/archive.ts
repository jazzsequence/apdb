/**
 * Internet Archive adapter.
 *
 * Where shows go when they stop. Archive holds actual-play audio from
 * productions whose sites are gone and whose feeds are dead — the purest form
 * of the long tail, because there is no live source left for any other index
 * to have found them.
 *
 * The public search and metadata APIs are keyless. Items are per-episode
 * uploads rather than show records, so the shape of the work is grouping:
 * `creator` is the producer, and a common title prefix across their items is a
 * series.
 *
 * Many items carry an explicit `licenseurl`, which is better provenance than
 * anything else in this project — the uploader stating their own terms.
 */

const SEARCH = 'https://archive.org/advancedsearch.php';
const METADATA = 'https://archive.org/metadata';
const UA = 'ActualPlayDatabase/0.1 (community actual-play credit index)';

export interface ArchiveItem {
  identifier: string;
  title: string;
  creator: string;
  description?: string;
  subjects: string[];
  date?: string;
  licenseUrl?: string;
}

export interface ArchiveSeries {
  creator: string;
  /** Common prefix across the group's titles, or the creator's name. */
  title: string;
  items: ArchiveItem[];
  subjects: string[];
  licenseUrl?: string;
  earliest?: string;
  latest?: string;
}

async function json(url: string): Promise<any> {
  const response = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!response.ok) throw new Error(`archive.org ${response.status}`);
  return response.json();
}

/** Search actual-play audio. Paged; Archive caps rows per request. */
export async function searchActualPlay(rows = 200, page = 1): Promise<ArchiveItem[]> {
  const params = new URLSearchParams({
    q: 'subject:("actual play") AND mediatype:(audio)',
    rows: String(rows),
    page: String(page),
    output: 'json',
  });
  for (const f of ['identifier', 'title', 'creator', 'description', 'subject', 'date', 'licenseurl']) {
    params.append('fl[]', f);
  }

  const data = await json(`${SEARCH}?${params}`);
  return (data?.response?.docs ?? []).map((d: any) => ({
    identifier: d.identifier,
    title: String(d.title ?? d.identifier),
    creator: String(Array.isArray(d.creator) ? d.creator[0] : (d.creator ?? '')).trim(),
    description: Array.isArray(d.description) ? d.description[0] : d.description,
    subjects: (Array.isArray(d.subject) ? d.subject : d.subject ? [d.subject] : []).map((s: string) =>
      String(s).toLowerCase(),
    ),
    date: d.date,
    licenseUrl: d.licenseurl,
  }));
}

/** Longest leading run of whole words shared by every title in the group. */
function commonPrefix(titles: string[]): string {
  if (titles.length < 2) return '';
  const split = titles.map((t) => t.split(/\s+/));
  const out: string[] = [];

  for (let i = 0; i < split[0]!.length; i++) {
    const word = split[0]![i]!;
    // Stop at anything that looks like an episode number.
    if (/^\d+[a-z]?$/i.test(word) || /^(ep|episode|part|s\d|e\d)$/i.test(word)) break;
    if (!split.every((s) => s[i]?.toLowerCase() === word.toLowerCase())) break;
    out.push(word);
  }
  return out.join(' ').replace(/[-–—:|]+$/, '').trim();
}

/**
 * Group loose episode uploads into series.
 *
 * A creator with a shared title prefix is one series; a creator whose titles
 * have nothing in common is catalogued under their own name, because a
 * production with one archived show is still a production.
 */
export function groupIntoSeries(items: ArchiveItem[], minEpisodes = 3): ArchiveSeries[] {
  const byCreator = new Map<string, ArchiveItem[]>();
  for (const item of items) {
    if (!item.creator) continue;
    const key = item.creator.toLowerCase();
    byCreator.set(key, [...(byCreator.get(key) ?? []), item]);
  }

  const series: ArchiveSeries[] = [];
  for (const group of byCreator.values()) {
    if (group.length < minEpisodes) continue;

    const prefix = commonPrefix(group.map((i) => i.title));
    const dates = group.map((i) => i.date).filter(Boolean).sort() as string[];

    series.push({
      creator: group[0]!.creator,
      title: prefix.length > 3 ? prefix : group[0]!.creator,
      items: group,
      subjects: [...new Set(group.flatMap((i) => i.subjects))],
      licenseUrl: group.find((i) => i.licenseUrl)?.licenseUrl,
      earliest: dates[0]?.slice(0, 10),
      latest: dates[dates.length - 1]?.slice(0, 10),
    });
  }

  return series.sort((a, b) => b.items.length - a.items.length);
}

/** Full metadata for one item, when the search fields aren't enough. */
export async function itemMetadata(identifier: string): Promise<Record<string, any> | undefined> {
  try {
    const data = await json(`${METADATA}/${encodeURIComponent(identifier)}`);
    return data?.metadata;
  } catch {
    return undefined;
  }
}
