/**
 * TMDB and TheTVDB — cast lists for shows we already hold.
 *
 * Both are used strictly to fill in casts, never to discover shows. Discovery
 * from a general film/TV catalogue is what produced the "Legacy" match against
 * a 1902 title and "Guardians of the Galaxy" against the Marvel series: these
 * databases index everything, so a title match inside them carries almost no
 * evidence that the thing found is an actual play.
 *
 * Neither has a usable keyless API — TMDB's returns 401 without one and
 * TheTVDB's requires registration — so both are read from their public HTML.
 * That makes the parsing brittle by nature, which is why every credit is
 * checked against the existing cast before anything is written.
 */
import type { CreditRole } from '../schema.js';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export interface CatalogueCredit {
  name: string;
  role: CreditRole;
  character?: string;
}

export interface CatalogueResult {
  url: string;
  credits: CatalogueCredit[];
}

async function get(url: string): Promise<string | undefined> {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en' },
      signal: AbortSignal.timeout(15000),
      redirect: 'follow',
    });
    return r.ok ? await r.text() : undefined;
  } catch {
    return undefined;
  }
}

const strip = (html: string) =>
  html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ').trim();

/** Both catalogues record a GM as a character rather than a job. */
const GM = /\b(dungeon|game)\s*master\b|\b(gm|dm)\b|\bkeeper\b|\bstoryteller\b|\bnarrator\b/i;

/** "Self, Dungeon Master" and "Self" are not characters. */
function readCharacter(raw: string): { role: CreditRole; character?: string } {
  const value = raw.replace(/\*\s*needs role-specific image/i, '').trim();
  if (GM.test(value)) return { role: 'GM/DM' };
  const cleaned = value.replace(/^self\s*[,/-]\s*/i, '').trim();
  if (!cleaned || /^self$/i.test(cleaned)) return { role: 'player' };
  return { role: 'player', character: cleaned };
}

function looksLikeName(name: string): boolean {
  const v = name.trim();
  return v.length >= 2 && v.length <= 42 && v.split(/\s+/).length <= 5 && !/[<>@|]|https?:/i.test(v);
}

// --- TMDB ------------------------------------------------------------------

/** Find a TV entry by title. Returns the numeric id + slug path. */
export async function tmdbFind(title: string): Promise<string | undefined> {
  const html = await get(`https://www.themoviedb.org/search/tv?query=${encodeURIComponent(title)}`);
  if (!html) return undefined;
  const first = html.match(/href="\/tv\/(\d+-[a-z0-9-]+)"/i);
  return first?.[1];
}

export async function tmdbCast(path: string): Promise<CatalogueResult | undefined> {
  const url = `https://www.themoviedb.org/tv/${path}/cast`;
  const html = await get(url);
  if (!html) return undefined;

  // The cast list pairs a person link with the character in the next <p>. The
  // character itself is wrapped in a link to that person's episodes and
  // followed by an episode count, so it cannot be matched as bare text.
  const credits: CatalogueCredit[] = [];
  const re =
    /<p><a href="\/person\/[^"]*">([^<]+)<\/a><\/p>\s*<p class="character">([\s\S]*?)<\/p>/gi;
  for (const m of html.matchAll(re)) {
    const name = strip(m[1]!);
    if (!looksLikeName(name)) continue;
    const character = strip(m[2] ?? '').replace(/\(\s*\d+\s*Episodes?\s*\)/i, '').trim();
    credits.push({ name, ...readCharacter(character) });
  }
  return credits.length ? { url, credits } : undefined;
}

// --- TheTVDB ---------------------------------------------------------------

/**
 * TheTVDB's search page is rendered client-side, so it yields nothing to a
 * plain fetch. Its slugs are predictable enough to address directly, and the
 * page is then verified by title before anything is read from it.
 */
export async function tvdbCast(slug: string, expectTitle: string): Promise<CatalogueResult | undefined> {
  const url = `https://thetvdb.com/series/${slug}`;
  const html = await get(url);
  if (!html) return undefined;

  const heading = strip(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '');
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (heading && norm(heading) !== norm(expectTitle)) return undefined;

  const block = html.slice(html.indexOf('id="people-actor"'));
  if (block.length === 0) return undefined;

  const credits: CatalogueCredit[] = [];
  for (const m of block.slice(0, 20000).matchAll(/\/people\/\d+">([\s\S]*?)<\/a>/g)) {
    const text = strip(m[1]!);
    const split = text.match(/^(.+?)\s+as\s+(.+)$/i);
    const name = split ? split[1]!.trim() : text;
    if (!looksLikeName(name)) continue;
    credits.push({ name, ...readCharacter(split?.[2] ?? '') });
  }
  return credits.length ? { url, credits } : undefined;
}
