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

/**
 * A performer name, not a sentence that happens to contain one.
 *
 * "Reuben Bresler (@moxreuby) takes players Riley Silverman" matched an
 * "X as Y" shape and produced three bogus GM credits. Handles, brackets and
 * anything past four words mean the line is prose, not a credit.
 */
export function looksLikeName(value: string): boolean {
  const v = value.trim();
  if (!v || v.length > 45) return false;
  if (/[@()\[\]|/\\]|https?:/i.test(v)) return false;
  if (v.split(/\s+/).length > 4) return false;
  if (/\b(takes|plays|joins|presents|with|and|the|for|from)\b/i.test(v)) return false;
  return /^[\p{L}"'][\p{L}\s."'-]*$/u.test(v);
}

/** A character name: anything short and prose-free, "the" included. */
function looksLikeCharacter(value: string): boolean {
  const v = value.trim();
  if (!v || v.length > 60) return false;
  if (/[@|]|https?:|\bwww\./i.test(v)) return false;
  return v.split(/\s+/).length <= 8;
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
      if (looksLikeName(name)) { credits.push({ name, role: 'GM/DM', line: rawLine.trim() }); seenGm = true; }
      continue;
    }

    if (!seenGm) continue;

    const row = line.match(/^([^:]{2,40}):\s*(.+)$/);
    if (!row) continue;
    const character = row[1]!.trim();
    const name = row[2]!.trim();
    // A performer name, not a timestamp or a sentence.
    if (!looksLikeName(name)) continue;
    if (/^\d/.test(character)) continue;
    credits.push({ name, role: 'player', character, line: rawLine.trim() });
  }

  return credits.length > 1 ? credits : [];
}

/**
 * A role header on its own line, with the cast on the lines beneath it:
 *
 *   Cast:
 *   Jasmine Bhullar as The Dungeon Master
 *   Christian Navarro as Eloin Emberleaf, a Winter Walker Ranger
 *
 * This is how the official D&D channel writes it. "as The Dungeon Master" is a
 * role, not a character, so it is promoted; the trailing class descriptor
 * ("a Winter Walker Ranger") is dropped from the character name.
 */
/** A line that is only a social or streaming link, not a credit. */
const SOCIAL_LINE =
  /^(twitch|twitter|x|fb|facebook|ig|insta(gram)?|youtube|yt|bluesky|bsky|tiktok|patreon|discord|website|web|email|mastodon|threads)\s*[:@]/i;

/**
 * A `Cast` / `Gamemaster` heading followed by entries.
 *
 * Written against how descriptions are actually laid out rather than an ideal:
 * headings often have no colon, entries are separated by blank lines, each
 * name is followed by several lines of social links, and the separator between
 * performer and character is as often a dash as the word "as". OSRPG's Blades
 * in the Dark lists its whole table this way and the earlier version of this
 * function returned nothing for it, because it stopped at the first blank line
 * and required "X as Y".
 */
function headedBlock(description: string): YouTubeCredit[] {
  const lines = description.split(/\r?\n/).map((l) => l.trim());
  const credits: YouTubeCredit[] = [];

  const CAST_HEAD = /^(cast|starring|players?|featuring|the (cast|party))\s*:?\s*$/i;
  const GM_HEAD = /^(game\s?master|gamemaster|dungeon\s?master|storyteller|keeper|gm|dm)\s*:?\s*$/i;

  for (let i = 0; i < lines.length; i++) {
    const head = lines[i]!;
    const isGmHead = GM_HEAD.test(head);
    if (!CAST_HEAD.test(head) && !isGmHead) continue;

    // Run to the next heading or the end, skipping blanks and link lines.
    let misses = 0;
    for (let j = i + 1; j < lines.length && misses < 6; j++) {
      const line = lines[j]!;
      if (!line) continue;                                   // blank between entries
      if (SOCIAL_LINE.test(line) || /^https?:\/\//i.test(line)) continue;
      if (CAST_HEAD.test(line) || GM_HEAD.test(line)) break;  // next section
      if (line.length > 140) { misses++; continue; }

      // A game-master heading is followed by a bare name.
      if (isGmHead && looksLikeName(line)) {
        credits.push({ name: line, role: 'GM/DM', line });
        break;
      }

      // "Angela - Reaper", "Angela as Reaper", "Angela: Reaper"
      const m = line.match(/^(.+?)\s*(?:\s-\s|\s[–—]\s|\sas\s|:)\s*(.+)$/i);
      if (!m) { misses++; continue; }

      const name = m[1]!.replace(/^[\s\-–—*•]+/, '').trim();
      const character = m[2]!.split(/,\s*(?:an?\b|the\b)/i)[0]!.trim();
      if (!looksLikeName(name)) { misses++; continue; }

      const isGm = /^(the\s+)?(dungeon master|game master|gamemaster|dm|gm|storyteller|keeper)$/i.test(character);
      credits.push(
        isGm ? { name, role: 'GM/DM', line } : { name, role: 'player', character, line },
      );
    }
  }
  return credits.length > 1 ? credits : [];
}

/**
 * Final gate on everything emitted, whichever parser produced it. Applying the
 * name check per-branch left holes — a prose sentence still came through as
 * three GM credits. One filter at the exit is harder to get wrong.
 */
/**
 * The name a credit should be filed under, ignoring billing decoration.
 * `Mark "Sherlock" Hulmes` and `Mark Hulmes` are one person, and descriptions
 * routinely use both forms within a single block.
 */
function nameKey(name: string): string {
  return name
    .replace(/["'“”‘’(][^"'“”‘’)]*["'“”‘’)]/g, ' ')   // drop a quoted or bracketed nickname
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Job titles that appear in a cast block as though they were names. OSRPG's
 * descriptions list "Artist" and "Editor" among the performers, and both were
 * imported as people.
 */
const JOB_TITLE =
  /^(artist|editor|producer|director|writer|composer|music|sound|art|graphics|design(er)?|animator|host|moderator|mod|crew|staff|team|cast|gamemaster|game ?master|dungeon ?master|storyteller|keeper|gm|dm|player|guest)$/i;

function keepOnlyNames(credits: YouTubeCredit[]): YouTubeCredit[] {
  const cleaned = credits
    .filter((c) => looksLikeName(c.name) && !JOB_TITLE.test(c.name.trim()))
    // A social handle or a URL is not a character. "Ashlen Rose as @AshlenRose"
    // is a credit line being read out of a promo sentence, and "Kevin MacLeod
    // as incompetech.com" is a music attribution.
    .filter(
      (c) =>
        !c.character ||
        !/^@|^https?:|^www\.|\.(com|net|org|io|tv|co\.uk)\b/i.test(c.character.trim()),
    )
    // A character is not held to the performer-name test. `looksLikeName`
    // rejects anything containing "the", which is fine for a person and wrong
    // for "Knox the Unexpected" or "Grog Strongjaw".
    .map((c) => (c.character && !looksLikeCharacter(c.character) ? { ...c, character: undefined } : c));

  // One credit per person per role. Prefer the plainest spelling of the name,
  // and keep a character if any spelling supplied one.
  const best = new Map<string, YouTubeCredit>();
  for (const c of cleaned) {
    const key = `${nameKey(c.name)}|${c.role}`;
    const held = best.get(key);
    if (!held) { best.set(key, c); continue; }
    best.set(key, {
      ...held,
      name: c.name.length < held.name.length ? c.name : held.name,
      character: held.character ?? c.character,
    });
  }
  return [...best.values()];
}

/**
 * A cast introduced mid-sentence rather than under a heading:
 *
 *   You can find more about our players, here:
 *   George (Knox the Unexpected):
 *   IMdB: https://www.imdb.com/name/nm0833971/
 *
 *   Hobbs (Elanion Elandin):
 *   Twitch: Twitch.tv/hobbs665
 *
 * Dungeon Musings writes every episode this way, and no heading-based parser
 * finds it: the introduction is a sentence, the entries are "Name (Character):"
 * rather than "Name as Character", and each is followed by several lines of
 * links. The block ends at the music credits, which are not cast.
 */
function playersBlock(description: string): YouTubeCredit[] {
  const lines = description.split(/\r?\n/).map((l) => l.trim());
  const start = lines.findIndex((l) => /\b(about our|meet the|our) (players|cast|party)\b/i.test(l));
  if (start < 0) return [];

  const credits: YouTubeCredit[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line) continue;
    // Music and licensing sit directly below the cast in these descriptions.
    if (/^(all )?(music|licen[cs]|credits|sound|editing)\b/i.test(line)) break;
    if (SOCIAL_LINE.test(line) || /^https?:\/\//i.test(line)) continue;

    const m = line.match(/^(.+?)\s*\(([^)]+)\)\s*:?\s*$/);
    if (!m) continue;
    const name = m[1]!.trim();
    const character = m[2]!.trim();
    if (!looksLikeName(name)) continue;
    const isGm = /^(the\s+)?(dungeon master|game master|gamemaster|dm|gm|storyteller|keeper|marshal)$/i.test(character);
    credits.push(isGm ? { name, role: 'GM/DM', line } : { name, role: 'player', character, line });
  }
  return credits.length > 1 ? credits : [];
}

export function creditsFromDescription(description: string): YouTubeCredit[] {
  const players = keepOnlyNames(playersBlock(description));
  if (players.length > 1) return players;

  const headed = keepOnlyNames(headedBlock(description));
  if (headed.length > 1) return headed;

  const characterFirst = keepOnlyNames(characterFirstBlock(description));
  if (characterFirst.length > 1) return characterFirst;

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
  return keepOnlyNames(credits).filter((c) => {
    const k = `${c.name.toLowerCase()}|${c.role}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
