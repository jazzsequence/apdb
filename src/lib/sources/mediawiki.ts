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
  /** Recognised credit fields whose format we could not safely read. */
  unparsed: string[];
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

const GM_MARKERS = /^(dm|gm|dungeon master|game master)$/i;

/** Split a template body into its positional (unnamed) arguments. */
function positionalArgs(template: string): string[] {
  const body = template.replace(/^\{\{[^|]*/, '').replace(/\}\}$/, '');
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
  return parts.map((p) => p.trim()).filter((p) => p.length > 0 && !p.includes('='));
}

/**
 * Some wikis pair performer and character as alternating positional arguments
 * of a nested template, e.g. the Critical Role wiki's
 * `{{Starring | [[Laura Bailey]] | [[Vex'ahlia]] | ... }}`.
 *
 * Reading those links flatly would file every character as a person, which is
 * how you end up with a database of real performers containing "Arkhan".
 */
function parsePairedTemplate(value: string): WikiPerson[] | undefined {
  const nested = extractTemplate(value, '[A-Za-z]');
  if (!nested) return undefined;

  const args = positionalArgs(nested);
  if (args.length < 2) return undefined;

  // Only treat it as paired if the odd slots are consistently links (people).
  const people: WikiPerson[] = [];
  for (let i = 0; i < args.length; i += 2) {
    const nameMatch = args[i]!.match(new RegExp(`^${LINK}$`));
    if (!nameMatch) return undefined;

    const slot = args[i + 1] ?? '';
    const characters = [...slot.matchAll(new RegExp(LINK, 'g'))].map((m) => m[1]!.trim());
    const bare = slot.replace(/\[\[|\]\]/g, '').trim();

    people.push({
      name: nameMatch[1]!.trim(),
      ...(characters.length > 0 ? { character: characters.join(' / ') } : {}),
      ...(GM_MARKERS.test(bare) ? { roleOverride: 'GM/DM' as CreditRole } : {}),
    });
  }
  return people.length > 0 ? people : undefined;
}

/**
 * Pull people out of an infobox field.
 *
 * `expectCharacters` guards the dangerous case. For cast fields, a bare list of
 * wikilinks is ambiguous — the links could be performers, or performers
 * interleaved with their characters. Rather than guess and invent people, this
 * returns nothing and lets the caller report the field as unparsed.
 */
export function parsePeople(value: string | undefined, expectCharacters = false): WikiPerson[] {
  if (!value) return [];

  const paired = parsePairedTemplate(value);
  if (paired) return paired;

  const bolded = new RegExp(`'''\\s*${LINK}\\s*'''`, 'g');
  const matches = [...value.matchAll(bolded)];

  if (matches.length > 0) {
    const people: WikiPerson[] = [];
    for (let i = 0; i < matches.length; i++) {
      const from = matches[i]!.index! + matches[i]![0].length;
      const to = i + 1 < matches.length ? matches[i + 1]!.index! : value.length;
      const asMatch = value
        .slice(from, to)
        .match(new RegExp(`\\bas\\s+${LINK}`, 'i'));
      people.push({
        name: matches[i]![1]!.trim(),
        ...(asMatch ? { character: asMatch[1]!.trim() } : {}),
      });
    }
    return people;
  }

  const bare = [...value.matchAll(new RegExp(LINK, 'g'))]
    .map((m) => m[1]!.trim())
    .filter((name) => !name.startsWith('File:') && !name.startsWith('Image:'));

  // A single link in a cast field is unambiguous; several are not.
  if (expectCharacters && bare.length > 1) return [];

  return bare.map((name) => ({ name }));
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

  const CAST_ROLES = new Set<CreditRole>(['player', 'guest player', 'GM/DM', 'guest GM']);

  const credits: WikiCreditGroup[] = [];
  const unparsed: string[] = [];

  for (const [field, value] of Object.entries(params)) {
    const role = FIELD_ROLES[field];
    if (!role) continue;

    const people = parsePeople(value, CAST_ROLES.has(role));
    if (people.length === 0) {
      if (value.includes('[[')) unparsed.push(field);
      continue;
    }

    // A field can carry its own role marker — the CR wiki hides the DM inside
    // the starring list — so split the group rather than mislabel anyone.
    for (const override of new Set(people.map((p) => p.roleOverride))) {
      const subset = people.filter((p) => p.roleOverride === override);
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
    unparsed,
    unmapped: Object.keys(params).filter(
      (key) => !FIELD_ROLES[key] && !METADATA_FIELDS.has(key),
    ),
  };
}
