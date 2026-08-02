/**
 * A show's own website — the most authoritative source, and the one every
 * other adapter here skipped.
 *
 * Everything else in this project reads third parties: wikis, Wikidata, Apple,
 * YouTube, Archive. Meanwhile productions publish their own cast pages, which
 * is the production describing itself. That makes anything found here
 * `official` tier.
 *
 * Websites are prose, so the parsing is deliberately conservative: a cast
 * section has to be identifiable, names have to look like names, and a page
 * that yields nothing yields nothing rather than a guess. Under-reading a site
 * is cheap; inventing a performer is not.
 */
import type { CreditRole } from '../schema.js';

const UA =
  'ActualPlayDatabase/0.1 (community actual-play credit index; contact via repository issues)';

/** Paths productions commonly put a cast on. */
export const CAST_PATHS = [
  '',
  '/cast',
  '/the-cast',
  '/meet-the-cast',
  '/about',
  '/about-us',
  '/crew',
  '/team',
  '/players',
  '/who-we-are',
];

export interface WebsiteCredit {
  name: string;
  role: CreditRole;
  character?: string;
  /** The line it came from, so a wrong read is traceable. */
  line: string;
}

/** Sites we already have better adapters for. */
const HANDLED_ELSEWHERE = /(fandom\.com|miraheze\.org|youtube\.com|youtu\.be|archive\.org|podcasts\.apple\.com|wikipedia\.org)/i;

export function isOwnWebsite(url: string): boolean {
  return /^https?:\/\//i.test(url) && !HANDLED_ELSEWHERE.test(url);
}

function textOf(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|li|h[1-6]|div|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#8217;|&rsquo;|&#39;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .join('\n');
}

const ROLE_WORDS: [RegExp, CreditRole][] = [
  [/\b(game ?master|dungeon ?master|keeper|storyteller|\bgm\b|\bdm\b|\bmc\b)\b/i, 'GM/DM'],
  [/\b(producer|produced by)\b/i, 'producer'],
  [/\b(editor|edited by|sound design)\b/i, 'editor'],
  [/\b(composer|music by)\b/i, 'composer'],
  [/\b(writer|written by)\b/i, 'writer'],
  [/\b(host|hosted by)\b/i, 'host'],
];

/** A person's name, not a sentence or a nav label. */
function looksLikeName(value: string): boolean {
  const v = value.trim().replace(/^[-–—*•\s]+|[\s.,;:]+$/g, '');
  if (v.length < 2 || v.length > 42) return false;
  if (/[@()[\]|/\\<>]|https?:/i.test(v)) return false;
  if (v.split(/\s+/).length > 4) return false;
  if (/\b(the|and|with|for|from|our|your|this|that|all|new|more|home|about|contact|episode|season|patreon|subscribe|support)\b/i.test(v)) {
    return false;
  }
  // Capitalised words, or a single lowercase handle.
  return /^[\p{Lu}][\p{L}.'-]*(?:\s+[\p{Lu}][\p{L}.'-]*){0,3}$/u.test(v) || /^[\p{Ll}][\p{L}\d._-]{2,20}$/u.test(v);
}

/**
 * Read credits from a page's text.
 *
 * Only lines inside something that looks like a cast section are considered,
 * and only lines that either name a role or use an explicit "X as Y".
 */
export function creditsFromPage(html: string): WebsiteCredit[] {
  const text = textOf(html);
  const lines = text.split('\n');
  const credits: WebsiteCredit[] = [];

  // Where does a cast section start? Anywhere a heading-ish line says so.
  const castStart = lines.findIndex((l) =>
    /^(the )?(cast|players|meet the cast|cast (&|and) crew|who we are|the team|crew)\b/i.test(l),
  );
  const window =
    castStart >= 0 ? lines.slice(castStart, castStart + 60) : lines.slice(0, 120);

  for (const line of window) {
    if (!line || line.length > 160) continue;

    // "Name as Character" / "Name (Character)"
    const as = line.match(/^([^,|]{2,42}?)\s+(?:as|plays)\s+(.{2,50})$/i);
    if (as && looksLikeName(as[1]!)) {
      const character = as[2]!.split(/,|\(|—|–| - /)[0]!.trim();
      const roleWord = ROLE_WORDS.find(([re]) => re.test(character));
      credits.push({
        name: as[1]!.trim(),
        role: roleWord ? roleWord[1] : 'player',
        ...(roleWord ? {} : { character }),
        line,
      });
      continue;
    }

    // "GM: Name" / "Keeper — Name" / "Name, Game Master"
    for (const [re, role] of ROLE_WORDS) {
      if (!re.test(line)) continue;
      const after = line.split(/[:—–-]/).slice(1).join(' ').trim();
      const before = line.split(/[,—–-]/)[0]!.trim();
      const candidate = looksLikeName(after) ? after : looksLikeName(before) ? before : '';
      if (candidate) credits.push({ name: candidate, role, line });
      break;
    }
  }

  // One person, one role, one credit.
  const seen = new Set<string>();
  return credits.filter((c) => {
    const k = `${c.name.toLowerCase()}|${c.role}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Try a site's likely cast pages and return the best read. */
export async function castFromWebsite(
  baseUrl: string,
): Promise<{ credits: WebsiteCredit[]; url: string } | undefined> {
  let origin: string;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return undefined;
  }

  let best: { credits: WebsiteCredit[]; url: string } | undefined;

  for (const path of CAST_PATHS) {
    const url = `${origin}${path}`;
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(12000),
        redirect: 'follow',
      });
      if (!r.ok) continue;
      const credits = creditsFromPage(await r.text());
      // Two or more is a cast; one is usually a stray match.
      if (credits.length >= 2 && credits.length > (best?.credits.length ?? 1)) {
        best = { credits, url };
      }
    } catch {
      // unreachable or slow page — try the next
    }
    await new Promise((res) => setTimeout(res, 150));
  }

  return best;
}
