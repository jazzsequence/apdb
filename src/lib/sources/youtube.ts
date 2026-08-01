/**
 * YouTube adapter — the official channels' own cast lists.
 *
 * For shows with no fan wiki, the production's own video descriptions are
 * often the only place a cast is written down, and they are a stronger source
 * than any wiki: it is the producer describing their own episode. That makes
 * these `official` tier, not `community`.
 *
 * Requires YOUTUBE_API_KEY. The Data API is free (10,000 units/day, and a
 * playlist sweep costs a handful), but the key has to be yours — unauthenticated
 * scraping is blocked by YouTube and would breach their terms besides.
 *
 *   https://console.cloud.google.com/apis/library/youtube.googleapis.com
 */
import type { CreditRole } from '../schema.js';

const API = 'https://www.googleapis.com/youtube/v3';

export interface YouTubeVideo {
  id: string;
  title: string;
  description: string;
  publishedAt: string;
  url: string;
}

export interface YouTubeCredit {
  name: string;
  role: CreditRole;
  character?: string;
  /** The line it was read from, so a wrong parse is traceable to its source. */
  line: string;
}

export class MissingKeyError extends Error {
  constructor() {
    super(
      'YOUTUBE_API_KEY is not set. Create one at ' +
        'https://console.cloud.google.com/apis/library/youtube.googleapis.com and export it. ' +
        'Unauthenticated access is blocked by YouTube, so there is no keyless fallback.',
    );
  }
}

function key(): string {
  const value = process.env.YOUTUBE_API_KEY;
  if (!value) throw new MissingKeyError();
  return value;
}

async function get(path: string, params: Record<string, string>): Promise<any> {
  const query = new URLSearchParams({ ...params, key: key() });
  const response = await fetch(`${API}/${path}?${query}`);
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`YouTube ${response.status}: ${body.slice(0, 200)}`);
  }
  return response.json();
}

/** Every video in a playlist, with its full description. */
export async function playlistVideos(playlistId: string, max = 200): Promise<YouTubeVideo[]> {
  const videos: YouTubeVideo[] = [];
  let pageToken: string | undefined;

  do {
    const data = await get('playlistItems', {
      part: 'snippet',
      playlistId,
      maxResults: '50',
      ...(pageToken ? { pageToken } : {}),
    });
    for (const item of data.items ?? []) {
      const s = item.snippet;
      const id = s?.resourceId?.videoId;
      if (!id) continue;
      videos.push({
        id,
        title: s.title ?? '',
        description: s.description ?? '',
        publishedAt: s.publishedAt ?? '',
        url: `https://www.youtube.com/watch?v=${id}`,
      });
    }
    pageToken = data.nextPageToken;
  } while (pageToken && videos.length < max);

  return videos.slice(0, max);
}

/**
 * Credits written into a video description.
 *
 * Productions write these a handful of ways, all of them explicit:
 *
 *   DM: Chris Perkins
 *   Dungeon Master - Chris Perkins
 *   Starring Anna Prosser as Evelyn, Holly Conrad as Strix
 *   Cast: Emily Axford (Fig), Zac Oyama (Gorgug)
 *
 * Only lines that name a role are read. Prose is not guessed at — an
 * unmatched description yields nothing rather than something invented.
 */
const ROLE_LABELS: [RegExp, CreditRole][] = [
  [/^(?:dungeon master|game master|dm|gm)\b/i, 'GM/DM'],
  [/^(?:guest (?:dm|gm|dungeon master|game master))\b/i, 'guest GM'],
  [/^(?:guest (?:player|star))s?\b/i, 'guest player'],
  [/^(?:starring|cast|players|featuring|with)\b/i, 'player'],
  [/^(?:produced by|producer)s?\b/i, 'producer'],
  [/^(?:edited by|editor)s?\b/i, 'editor'],
  [/^(?:music by|composer)s?\b/i, 'composer'],
];

/** "Emily Axford as Fig Faeth" / "Emily Axford (Fig Faeth)" -> both parts. */
function splitPerson(chunk: string): { name: string; character?: string } | undefined {
  const text = chunk.replace(/^[\s\-–—*•]+|[\s.,;]+$/g, '').trim();
  if (!text || text.length > 80) return undefined;

  const asMatch = text.match(/^(.+?)\s+as\s+(.+)$/i);
  if (asMatch) return { name: asMatch[1]!.trim(), character: asMatch[2]!.trim() };

  const parenMatch = text.match(/^(.+?)\s*\(([^)]+)\)$/);
  if (parenMatch) return { name: parenMatch[1]!.trim(), character: parenMatch[2]!.trim() };

  // A bare name: two to four capitalised words. Anything else is prose.
  if (!/^[\p{Lu}][\p{L}.'-]*(?:\s+[\p{Lu}][\p{L}.'-]*){1,3}$/u.test(text)) return undefined;
  return { name: text };
}

/**
 * Some productions write the cast character-first, one per line, with a link:
 *
 *   DM: Mark "Sherlock" Hulmes - https://twitter.com/sherlock_hulmes
 *   Daisy: Katie Morrison - https://twitter.com/LittleNommer
 *   Rowan: Chris Trott - https://twitter.com/trottimus
 *
 * That is the reverse of every other source here, and the trailing URL means a
 * naive "skip lines with links" rule discards the entire cast. The DM line is
 * the anchor: once seen, subsequent "Label: Name" lines are character: performer.
 */
function characterFirstBlock(description: string): YouTubeCredit[] {
  const credits: YouTubeCredit[] = [];
  let seenGm = false;

  for (const rawLine of description.split(/\r?\n/)) {
    // Drop a trailing link so the name is readable, but keep the line.
    const line = rawLine.replace(/[\s\-–—]*https?:\/\/\S+\s*$/i, '').trim();
    if (!line || line.length > 120) continue;

    const gm = line.match(/^(?:DM|GM|Dungeon Master|Game Master)\s*[:\-]\s*(.+)$/i);
    if (gm) {
      const name = gm[1]!.trim();
      if (name) { credits.push({ name, role: 'GM/DM', line: rawLine.trim() }); seenGm = true; }
      continue;
    }

    if (!seenGm) continue;

    const row = line.match(/^([^:]{2,40}):\s*(.+)$/);
    if (!row) continue;
    const character = row[1]!.trim();
    const name = row[2]!.trim();
    // A performer name, not a timestamp or a sentence.
    if (!/^[\p{L}"'][\p{L}\s."'-]{2,45}$/u.test(name)) continue;
    if (/^\d/.test(character)) continue;
    credits.push({ name, role: 'player', character, line: rawLine.trim() });
  }

  return credits.length > 1 ? credits : [];
}

export function creditsFromDescription(description: string): YouTubeCredit[] {
  const characterFirst = characterFirstBlock(description);
  if (characterFirst.length > 0) return characterFirst;

  const credits: YouTubeCredit[] = [];

  for (const rawLine of description.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.length > 300) continue;
    if (/https?:\/\//i.test(line)) continue;

    for (const [pattern, role] of ROLE_LABELS) {
      if (!pattern.test(line)) continue;
      const after = line.replace(pattern, '').replace(/^[\s:–—-]+/, '');
      if (!after) break;

      for (const chunk of after.split(/,|\band\b|\|/i)) {
        const person = splitPerson(chunk);
        if (person) credits.push({ ...person, role, line });
      }
      break;
    }
  }

  // Same name twice in one description is one credit.
  const seen = new Set<string>();
  return credits.filter((c) => {
    const k = `${c.name.toLowerCase()}|${c.role}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
