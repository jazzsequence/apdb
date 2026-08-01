/**
 * MediaWiki adapter — where actual-play credits actually live.
 *
 * Wikidata is the identity backbone but carries almost no AP credits. The fan
 * wikis do, and on Fandom and Miraheze they are behind a real MediaWiki API
 * with template-structured infoboxes, so this does not involve scraping HTML.
 *
 * The Dimension 20 wiki's campaign infobox, for instance, separates
 * `guest_players` from `players` — meaning one-off guest appearances, the
 * long tail this project exists for, are machine-readable rather than buried
 * in prose.
 *
 * Licence: Fandom and Miraheze content is CC-BY-SA. Every credit this adapter
 * produces carries the source page URL, which is the attribution requirement.
 */

import type { CreditRole } from '../schema.js';

const USER_AGENT =
  'ActualPlayDatabase/0.1 (community actual-play credit index; contact via repository issues)';

export interface WikiPerson {
  name: string;
  character?: string;
  /** Set when the field itself marks this person as running the game. */
  roleOverride?: CreditRole;
}

export interface WikiCreditGroup {
  /** The infobox field this came from, so a wrong mapping is traceable. */
  field: string;
  role: CreditRole;
  people: WikiPerson[];
}

export interface WikiCampaign {
  host: string;
  page: string;
  url: string;
  title?: string;
  season?: number;
  system?: string;
  airDates?: string;
  episodes?: string;
  credits: WikiCreditGroup[];
  /** Linked pages the wiki classifies as organisations, excluded from people. */
  dropped: string[];
  /** Infobox params we found but did not map, so gaps are visible not silent. */
  unmapped: string[];
}

/**
 * Infobox field name -> credit role.
 *
 * Every wiki names these differently — Dimension 20 uses `players` and
 * `guest_players`, the Critical Role wiki uses `starring` and `sguests` — so
 * the mapping is data rather than hardcoded to whichever wiki was tried first.
 * Add a row when a new wiki turns up; unmapped fields are reported, never
 * silently dropped.
 */
export const FIELD_ROLES: Record<string, CreditRole> = {
  gm: 'GM/DM',
  dm: 'GM/DM',
  game_master: 'GM/DM',
  dungeon_master: 'GM/DM',
  guest_gm: 'guest GM',
  guest_dm: 'guest GM',
  players: 'player',
  starring: 'player',
  cast: 'player',
  guest_players: 'guest player',
  guests: 'guest player',
  sguests: 'guest player',
  special_guests: 'guest player',
  host: 'host',
  hostp: 'host',
  producer: 'producer',
  editor: 'editor',
  writer: 'writer',
  composer: 'composer',
  theme: 'composer',
};

async function fetchWikitext(host: string, page: string): Promise<string> {
  // Fandom serves the API at /api.php, Miraheze and most others at /w/api.php.
  const paths = ['/api.php', '/w/api.php'];
  let lastError = '';

  for (const path of paths) {
    // redirects=1 matters: wikis are full of them ("Campaign 1" ->
    // "Campaign One: Vox Machina"), and without it every alias 404s.
    const url = `https://${host}${path}?action=parse&page=${encodeURIComponent(page)}&prop=wikitext&redirects=1&format=json&formatversion=2`;
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!response.ok) {
      lastError = `${response.status} ${response.statusText}`;
      continue;
    }
    const data: any = await response.json();
    if (data.error) {
      // A real API that simply lacks the page — don't try the other path.
      if (data.error.code === 'missingtitle') {
        throw new Error(`"${page}" does not exist on ${host}`);
      }
      lastError = data.error.info ?? data.error.code;
      continue;
    }
    const text = data.parse?.wikitext;
    if (typeof text === 'string') return text;
    lastError = 'no wikitext in response';
  }

  throw new Error(`could not read "${page}" from ${host}: ${lastError}`);
}

/** Pull one `{{Template ...}}` out of wikitext, brace-matched so nesting works. */
export function extractTemplate(wikitext: string, namePrefix: string): string | undefined {
  const start = wikitext.search(new RegExp(`\\{\\{\\s*${namePrefix}`, 'i'));
  if (start < 0) return undefined;

  let depth = 0;
  let i = start;
  while (i < wikitext.length) {
    if (wikitext.startsWith('{{', i)) {
      depth += 1;
      i += 2;
    } else if (wikitext.startsWith('}}', i)) {
      depth -= 1;
      i += 2;
      if (depth === 0) return wikitext.slice(start, i);
    } else {
      i += 1;
    }
  }
  return undefined;
}

/** Split a template body on top-level pipes only, ignoring nested templates/links. */
export function parseParams(template: string): Record<string, string> {
  const body = template.slice(2, -2);
  const parts: string[] = [];
  let depth = 0;
  let current = '';

  for (let i = 0; i < body.length; i++) {
    if (body.startsWith('{{', i) || body.startsWith('[[', i)) {
      depth += 1;
      current += body.slice(i, i + 2);
      i += 1;
      continue;
    }
    if (body.startsWith('}}', i) || body.startsWith(']]', i)) {
      depth -= 1;
      current += body.slice(i, i + 2);
      i += 1;
      continue;
    }
    if (body[i] === '|' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += body[i];
  }
  parts.push(current);

  const params: Record<string, string> = {};
  for (const part of parts.slice(1)) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    params[part.slice(0, eq).trim().toLowerCase()] = part.slice(eq + 1).trim();
  }
  return params;
}

/**
 * Pull people out of an infobox field.
 *
 * The wikis format these as a bolded wikilink for the performer, optionally
 * followed by "as [[Character]]":
 *
 *   '''[[Emily Axford]]'''<br><p ...><small>as [[Fig Faeth]]</small></p>
 *
 * Falls back to plain wikilinks for fields like `gm` that aren't bolded.
 */
const LINK = String.raw`\[\[\s*([^\]|]+?)\s*(?:\|[^\]]*?)?\]\]`;

const GM_MARKERS = /\b(dm|gm|dungeon master|game master)\b/i;

// ---------------------------------------------------------------------------
// Entity resolution.
//
// Wiki cast fields interleave performers and their characters, and every wiki
// formats that differently. Guessing from formatting is how you end up filing
// a character as a performer.
//
// So don't guess: the wiki already classifies its own pages. Ask it. Categories
// separate `Cast`/`Voice Actors` from `Characters` from `Companies` on every
// wiki checked, which turns an ambiguous parse into a lookup.
// ---------------------------------------------------------------------------

export type EntityKind = 'person' | 'character' | 'organisation' | 'unknown';

const CATEGORY_SIGNALS: { kind: EntityKind; pattern: RegExp }[] = [
  { kind: 'character', pattern: /\b(characters?|npcs?|player characters?|creatures?|monsters?)\b/i },
  {
    kind: 'person',
    pattern:
      /\b(cast|crew|voice actors?|actors?|dungeon masters?|game masters?|guests?|players?|people|writers?|producers?|editors?|authors?|composers?|hosts?)\b/i,
  },
  { kind: 'organisation', pattern: /\b(compan(y|ies)|networks?|studios?|publishers?|organisations?|organizations?)\b/i },
];

/**
 * Classify wiki pages by their categories, batched (the API takes 50 titles a
 * call). Character categories are checked before person ones: a character page
 * often sits in "Emily Axford Characters", which would otherwise read as a
 * person signal.
 */
export async function classifyTitles(
  host: string,
  titles: string[],
): Promise<Map<string, EntityKind>> {
  const result = new Map<string, EntityKind>();
  const unique = [...new Set(titles)];

  for (let i = 0; i < unique.length; i += 50) {
    const batch = unique.slice(i, i + 50);
    const params = new URLSearchParams({
      action: 'query',
      titles: batch.join('|'),
      prop: 'categories',
      cllimit: '500',
      redirects: '1',
      format: 'json',
      formatversion: '2',
    });

    let pages: any[] = [];
    for (const path of ['/api.php', '/w/api.php']) {
      try {
        const response = await fetch(`https://${host}${path}?${params}`, {
          headers: { 'User-Agent': USER_AGENT },
        });
        if (!response.ok) continue;
        const data: any = await response.json();
        if (data?.query?.pages) {
          pages = data.query.pages;
          break;
        }
      } catch {
        // try the next path
      }
    }

    for (const page of pages) {
      const categories: string[] = (page.categories ?? []).map((c: any) =>
        String(c.title).replace(/^Category:/, ''),
      );
      let kind: EntityKind = 'unknown';
      for (const signal of CATEGORY_SIGNALS) {
        if (categories.some((category) => signal.pattern.test(category))) {
          kind = signal.kind;
          break;
        }
      }
      result.set(page.title, kind);
    }

    // Preserve the caller's spelling as well as the wiki's canonical title, so
    // redirect targets still resolve.
    for (const title of batch) if (!result.has(title)) result.set(title, result.get(title) ?? 'unknown');
  }

  return result;
}

/** Every wikilink in a value, in document order, with its position. */
function linksInOrder(value: string): { title: string; start: number; end: number }[] {
  return [...value.matchAll(new RegExp(LINK, 'g'))]
    .map((m) => ({ title: m[1]!.trim(), start: m.index!, end: m.index! + m[0].length }))
    .filter((l) => !/^(File|Image|Category):/i.test(l.title));
}

/**
 * Turn one infobox field into credited people, using the wiki's own
 * classification of each linked page rather than the field's formatting.
 *
 * Walk the links in order: a person opens a new entry, a character attaches to
 * the entry before it, an organisation is dropped. That single rule handles
 * every layout encountered — Dimension 20's bolded "X as Y", the Critical Role
 * wiki's alternating positional template, and plain lists — without knowing
 * anything about any of them.
 */
export function assemblePeople(
  value: string | undefined,
  kinds: Map<string, EntityKind>,
): { people: WikiPerson[]; dropped: string[] } {
  if (!value) return { people: [], dropped: [] };

  const links = linksInOrder(value);
  const people: WikiPerson[] = [];
  const dropped: string[] = [];

  for (let i = 0; i < links.length; i++) {
    const link = links[i]!;
    let kind = kinds.get(link.title) ?? 'unknown';

    // An unclassified link straight after a performer who has no character yet
    // is, in every observed layout, that performer's character.
    if (kind === 'unknown') {
      const current = people[people.length - 1];
      kind = current && !current.character ? 'character' : 'person';
    }

    if (kind === 'organisation') {
      dropped.push(link.title);
      continue;
    }

    if (kind === 'character') {
      const current = people[people.length - 1];
      if (!current) continue;
      current.character = current.character
        ? `${current.character} / ${link.title}`
        : link.title;
      continue;
    }

    people.push({ name: link.title });
  }

  // A role marker in the text after a performer overrides the field's role —
  // the Critical Role wiki writes "[[Matthew Mercer]] | DM" inside `starring`.
  for (let i = 0; i < people.length; i++) {
    const link = links.find((l) => l.title === people[i]!.name);
    if (!link) continue;
    const nextLink = links.find((l) => l.start > link.end);
    const between = value.slice(link.end, nextLink ? nextLink.start : value.length);
    if (GM_MARKERS.test(between.replace(/\[\[|\]\]/g, ''))) {
      people[i]!.roleOverride = 'GM/DM' as CreditRole;
    }
  }

  return { people, dropped };
}

/** Strip footnotes, markup and bare URLs out of a display value. */
function cleanValue(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return (
    value
      .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
      .replace(/<ref[^>]*\/>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\[(?:https?:\/\/\S+)\s*([^\]]*)\]/g, '$1')
      .replace(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, '$1')
      .replace(/'''?/g, '')
      .replace(/\s+/g, ' ')
      .trim() || undefined
  );
}

/** Non-credit fields we read deliberately, so they aren't reported as gaps. */
const METADATA_FIELDS = new Set([
  'system',
  'game_system',
  'season',
  'air_dates',
  'first_aired',
  'last_aired',
  'episodes',
  'num_episodes',
  'title1',
  'name',
  'campaign',
]);

/** Read one campaign/season page and pull out everyone credited on it. */
export async function fetchCampaign(host: string, page: string): Promise<WikiCampaign> {
  const wikitext = await fetchWikitext(host, page);
  const template =
    extractTemplate(wikitext, 'InfoboxCampaign') ??
    extractTemplate(wikitext, 'Infobox campaign') ??
    extractTemplate(wikitext, 'Infobox');

  if (!template) {
    throw new Error(
      `no campaign infobox found on ${host}/wiki/${page} — this adapter reads template-structured pages, not prose`,
    );
  }

  const params = parseParams(template);
  const season = Number.parseInt(params.season ?? '', 10);

  const creditFields = Object.entries(params).filter(([field]) => FIELD_ROLES[field]);

  // Resolve every linked page against the wiki's own categories first, in one
  // batched call, so assembly is a lookup rather than a guess about formatting.
  const kinds = await classifyTitles(
    host,
    creditFields.flatMap(([, value]) => linksInOrder(value).map((l) => l.title)),
  );

  const credits: WikiCreditGroup[] = [];
  const dropped: string[] = [];

  for (const [field, value] of creditFields) {
    const role = FIELD_ROLES[field]!;
    const assembled = assemblePeople(value, kinds);
    dropped.push(...assembled.dropped);
    if (assembled.people.length === 0) continue;

    // A field can carry its own role marker — the CR wiki hides the DM inside
    // the starring list — so split the group rather than mislabel anyone.
    for (const override of new Set(assembled.people.map((p) => p.roleOverride))) {
      const subset = assembled.people.filter((p) => p.roleOverride === override);
      credits.push({ field, role: override ?? role, people: subset });
    }
  }

  return {
    host,
    page,
    url: `https://${host}/wiki/${encodeURIComponent(page.replace(/ /g, '_'))}`,
    title: cleanValue(params.title1 ?? params.name ?? params.campaign),
    season: Number.isFinite(season) ? season : undefined,
    system: cleanValue(params.system ?? params.game_system),
    airDates: cleanValue(params.air_dates ?? params.first_aired),
    episodes: cleanValue(params.episodes ?? params.num_episodes),
    credits,
    dropped: [...new Set(dropped)],
    unmapped: Object.keys(params).filter(
      (key) => !FIELD_ROLES[key] && !METADATA_FIELDS.has(key),
    ),
  };
}
