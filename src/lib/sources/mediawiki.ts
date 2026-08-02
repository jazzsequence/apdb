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
  dungeon_mistress: 'GM/DM',
  game_mistress: 'GM/DM',
  gamemaster: 'GM/DM',
  game_master_s: 'GM/DM',
  guest_gm: 'guest GM',
  guest_dm: 'guest GM',
  players: 'player',
  starring: 'player',
  cast: 'player',
  guest_players: 'guest player',
  guests: 'guest player',
  sguests: 'guest player',
  special_guests: 'guest player',
  'special_guest(s)': 'guest player',
  'guest(s)': 'guest player',
  guest_player: 'guest player',
  host: 'host',
  hostp: 'host',
  producer: 'producer',
  produced_by: 'producer',
  editor: 'editor',
  edited_by: 'editor',
  intro_edited_by: 'editor',
  writer: 'writer',
  written_by: 'writer',
  composer: 'composer',
  intro_music_by: 'composer',
  hosted_by: 'host',
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
  // MediaWiki treats spaces and underscores in template names as equivalent
  // ({{LoA Campaign}} == {{LoA_Campaign}}), so the match has to as well.
  const flexible = namePrefix.replace(/[ _]/g, '[ _]');
  const start = wikitext.search(new RegExp(`\\{\\{\\s*${flexible}`, 'i'));
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
// Captures target (1) and optional display label (2). The label is the human
// name: the Adventure Zone wiki writes
// [[w:c:mbmbam:Justin McElroy|Justin McElroy]], where only the label is usable.
const LINK = String.raw`\[\[\s*([^\]|]+?)\s*(?:\|\s*([^\]]*?)\s*)?\]\]`;

/**
 * Some wikis put the GM in article prose rather than the infobox — High Rollers
 * writes "DMed by [[Mara Holmes]]". That is still reliable to read: the name is
 * a wikilink, so it can be category-checked like any other.
 */
const PROSE_GM = new RegExp(
  String.raw`(?:DM(?:ed|'d)?|GM(?:ed|'d)?|Dungeon[- ]Master(?:ed)?|Game[- ]Master(?:ed)?|run|hosted)\s+by\s+` +
    LINK,
  'gi',
);

/**
 * Cast listed in a prose section rather than an infobox.
 *
 * Dice, Camera, Action has no campaign infobox at all — its cast lives under
 * "== Cast ==" as "* [[Chris Perkins]] as the Dungeon Master". That is the same
 * explicit structure the infobox fields use, just in a different place, so it
 * is worth reading rather than declaring the page unparseable.
 */
export function proseCastSection(wikitext: string): string | undefined {
  const match = wikitext.match(/==+\s*(?:Cast|Players|Cast\s*&\s*Crew|Main cast)[^=]*==+([\s\S]*?)(?=\n==|$)/i);
  const body = match?.[1]?.trim();
  return body && body.includes('[[') ? body : undefined;
}

/** GM names mentioned in prose, outside any template. */
export function proseGMs(wikitext: string): string[] {
  const body = wikitext.replace(/\{\{[\s\S]*?\}\}/g, ' ');
  return [...new Set([...body.matchAll(PROSE_GM)].map((m) => m[1]!.trim()))];
}

const GM_MARKERS = /^(dm|gm|dungeon master|game master|dungeon mistress|game mistress)$/i;

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

/**
 * Templates that mark a page as a show or campaign, in the order worth trying.
 * Wikis name these differently; discovery tries each until one returns pages.
 */
export const CAMPAIGN_TEMPLATES = [
  'Template:InfoboxCampaign',
  'Template:Infobox campaign',
  'Template:Infobox show',
  'Template:Infobox season',
  'Template:Infobox series',
  // Wiki-specific names, found by surveying each wiki's most-transcluded
  // campaign-ish infobox rather than guessing. See survey output in the repo
  // history; add a row when a new wiki turns up.
  'Template:LoA Campaign',          // Legends of Avantris
  'Template:Show Page Infobox',     // Saving Throw
  'Template:Season Page Infobox',   // Saving Throw
  'Template:Campaign',              // High Rollers
  'Template:Seasoninfo',            // Dungeons and Daddies
  'Template:Infobox Twitch show',   // Geek & Sundry
  'Template:Infobox Season',        // Acquisitions Incorporated
  'Template:GCN Show Book Template', // Glass Cannon Network
  'Template:GCN Show Template',
];

/**
 * Enumerate a wiki's shows by asking which pages transclude its campaign
 * infobox. This is how the show catalogue gets built without anyone typing
 * page names: the wiki already knows which of its pages are campaigns.
 */
export async function discoverCampaignPages(
  host: string,
  templates: string[] = CAMPAIGN_TEMPLATES,
): Promise<{ template: string; pages: string[] }> {
  for (const template of templates) {
    const params = new URLSearchParams({
      action: 'query',
      list: 'embeddedin',
      eititle: template,
      einamespace: '0',
      eilimit: '500',
      format: 'json',
      formatversion: '2',
    });

    for (const path of ['/api.php', '/w/api.php']) {
      try {
        const response = await fetch(`https://${host}${path}?${params}`, {
          headers: { 'User-Agent': USER_AGENT },
        });
        if (!response.ok) continue;
        const data: any = await response.json();
        const pages: string[] = (data?.query?.embeddedin ?? []).map((p: any) => p.title);
        if (pages.length > 0) return { template, pages };
      } catch {
        // try the next path / template
      }
    }
  }
  return { template: '', pages: [] };
}

/**
 * Links that are not people-on-this-wiki: media, categories, and interwiki
 * links. The last one matters — the Adventure Zone wiki writes
 * `[[w:c:mbmbam:Clint McElroy]]` and `[[wikipedia:Sherlock (TV series)]]`, and
 * taking those at face value produced a performer literally named
 * "w:c:mbmbam:Clint McElroy" alongside the real one.
 */
const NOT_A_PERSON = /^(File|Image|Category|Template|Help|Special|wikipedia|wikt|commons|d|s):/i;

/** Strip an interwiki prefix: "w:c:mbmbam:Clint McElroy" -> "Clint McElroy". */
function stripInterwiki(title: string): string {
  return title.replace(/^(?:w:)?(?:c:)?[a-z0-9-]+:/i, '').trim();
}

/** Every wikilink in a value, in document order, with its position. */
function linksInOrder(value: string): { title: string; start: number; end: number }[] {
  return [...value.matchAll(new RegExp(LINK, 'g'))]
    .filter((m) => !NOT_A_PERSON.test(m[1]!.trim()))
    .map((m) => ({
      // Label first; it is the readable name. Fall back to the target with any
      // interwiki prefix removed.
      title: (m[2]?.trim() || stripInterwiki(m[1]!.trim())),
      start: m.index!,
      end: m.index! + m[0].length,
    }))
    .filter((l) => l.title.length > 0);
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

  // {{Starring}} has two incompatible usages and the difference is load-bearing:
  //
  //   paired:  | [[Laura Bailey]] | [[Vex'ahlia]]      <- person, character
  //   flat:    | [[Laura Bailey]] |                    <- person, nothing
  //
  // Reading a flat list as pairs marries each performer to the next one, which
  // is how "Laura Bailey as Matthew Mercer" got into this database. The tell is
  // whether the even slots carry content, so check before deciding.
  const nested = extractTemplate(value, '[A-Za-z]');
  if (nested) {
    const body = nested.replace(/^\{\{[^|]*/, '').replace(/\}\}$/, '');
    const slots: string[] = [];
    let depth = 0, cur = '';
    for (let i = 0; i < body.length; i++) {
      if (body.startsWith('{{', i) || body.startsWith('[[', i)) { depth++; cur += body.slice(i, i + 2); i++; continue; }
      if (body.startsWith('}}', i) || body.startsWith(']]', i)) { depth--; cur += body.slice(i, i + 2); i++; continue; }
      if (body[i] === '|' && depth === 0) { slots.push(cur); cur = ''; continue; }
      cur += body[i];
    }
    slots.push(cur);

    // Drop rule separators ("--------") used to divide groups.
    const cleaned = slots
      .map((s) => s.trim())
      .filter((s) => !/^-{2,}$/.test(s))
      .filter((s) => !s.includes('='));

    // The text before the first pipe is the template name's tail, not a slot.
    // Leaving it in shifts every pair by one and silently breaks pairing.
    while (cleaned.length > 0 && cleaned[0] === '') cleaned.shift();

    const nonEmpty = cleaned.filter((s) => s.length > 0);
    const evens = cleaned.filter((_, i) => i % 2 === 1);
    const evensHaveContent = evens.filter((s) => s.length > 0).length;

    // Flat list: the second slot of each row is consistently empty.
    if (nonEmpty.length > 0 && evensHaveContent <= nonEmpty.length / 4) {
      const flat: WikiPerson[] = [];
      for (const slot of nonEmpty) {
        const ls = linksInOrder(slot);
        if (ls.length === 1) flat.push({ name: ls[0]!.title });
        else if (ls.length === 0 && /^[A-Z][\w.'-]*(?:\s+[A-Z][\w.'-]*){1,3}$/.test(slot)) {
          flat.push({ name: slot });   // plain-text names, as the producer field uses
        }
      }
      if (flat.length > 0) return { people: flat, dropped: [] };
    }

    // Paired: odd slots are single links, even slots carry the characters.
    const paired: WikiPerson[] = [];
    let ok = cleaned.length >= 2 && evensHaveContent > 0;
    for (let i = 0; ok && i < cleaned.length; i += 2) {
      const nameLinks = linksInOrder(cleaned[i] ?? '');
      if (nameLinks.length !== 1) { ok = false; break; }
      const slot = cleaned[i + 1] ?? '';
      const chars = linksInOrder(slot).map((l) => l.title);
      const bare = slot.replace(/\[\[|\]\]/g, '').trim();
      paired.push({
        name: nameLinks[0]!.title,
        ...(chars.length ? { character: chars.join(' / ') } : {}),
        ...(GM_MARKERS.test(bare) ? { roleOverride: 'GM/DM' as CreditRole } : {}),
      });
    }
    if (ok && paired.length > 0) return { people: paired, dropped: [] };
  }

  // A bullet list is explicit structure: one entry per bullet. Without this,
  // "* [[Joe O'Brien]]\n* [[Skid Maher]]" reads as a person and their
  // character rather than as two performers.
  const bullets = value
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => /^\*/.test(l) && l.includes('[['));
  if (bullets.length > 1) {
    const listed: WikiPerson[] = [];
    for (const line of bullets) {
      const ls = linksInOrder(line);
      if (ls.length === 0) continue;
      // A bullet may still say "X as Y" within itself.
      const asAt = line.search(/\bas\b|\s[-–—]\s/i);
      const before = ls.filter((l) => asAt < 0 || l.start < asAt);
      const after = ls.filter((l) => asAt >= 0 && l.start > asAt);
      if (before.length !== 1) { listed.length = 0; break; }
      listed.push({
        name: before[0]!.title,
        ...(after.length ? { character: after.map((l) => l.title).join(' / ') } : {}),
      });
    }
    if (listed.length > 1) return { people: listed, dropped: [] };
  }

  // Explicit structure beats inferred classification. When a field spells out
  // "[[X]] as [[Y]]", the wiki is asserting that X is the performer and Y the
  // character, and that assertion is stronger than a category lookup — on the
  // Adventure Zone wiki the McElroys have character pages of their own, so
  // categories say "character" for the actual players.
  const SEPARATOR = /\bas\b|\s[-–—]\s/i;
  if (SEPARATOR.test(value) && links.length > 1) {
    const entries = value
      .split(/<br\s*\/?>|\n/i)
      .map((e) => e.trim())
      .filter((e) => e.includes('[['));
    const structural: WikiPerson[] = [];
    for (const entry of entries) {
      const entryLinks = linksInOrder(entry);
      if (entryLinks.length === 0) continue;
      const asAt = entry.search(SEPARATOR);
      const before = entryLinks.filter((l) => asAt < 0 || l.start < asAt);
      const after = entryLinks.filter((l) => asAt >= 0 && l.start > asAt);
      if (before.length !== 1) { structural.length = 0; break; }
      structural.push({
        name: before[0]!.title,
        ...(after.length ? { character: after.map((l) => l.title).join(' / ') } : {}),
      });
    }
    if (structural.length > 0) return { people: structural, dropped };
  }

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

/**
 * Fields listing CHARACTERS rather than performers.
 *
 * Some wikis put only the party in the campaign infobox — Acquisitions
 * Incorporated lists "Omin Dran, Binwin Bronzebottom, Jim Darkmagic". Importing
 * those as people would invent three performers. But each character's own page
 * carries a `played_by` field, so the performer is one lookup away: follow the
 * link rather than either guessing or giving up.
 */
const CHARACTER_FIELDS = ['player_characters', 'characters', 'pcs', 'party'];

const PLAYED_BY = /\|\s*(?:played_by|player|portrayed_by|played by)\s*=([^|\n}]{1,120})/i;

/** Resolve character pages to the performers who play them. */
export async function playersOfCharacters(
  host: string,
  characters: string[],
): Promise<WikiPerson[]> {
  const people: WikiPerson[] = [];
  for (const character of characters) {
    try {
      const wikitext = await fetchWikitext(host, character);
      const match = wikitext.match(PLAYED_BY);
      if (!match) continue;
      const name = match[1]!
        .replace(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, '$1')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+of\s+\w+$/i, '')   // "Scott Kurtz of PvP"
        .replace(/\s+/g, ' ')
        .trim();
      if (name) people.push({ name, character });
    } catch {
      // character page missing — skip rather than guess
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  return people;
}

/** Non-credit fields we read deliberately, so they aren't reported as gaps. */
const METADATA_FIELDS = new Set([
  'system',
  'game_system',
  'season',
  'air_dates',
  'first_aired',
  'last_aired',
  'start_date',
  'end_date',
  'setting',
  'status',
  'hosted_on',
  'running_time',
  'no_of_episodes',
  'player_level',
  'episodes',
  'num_episodes',
  'title1',
  'name',
  'campaign',
  ...CHARACTER_FIELDS,
]);

/** Read one campaign/season page and pull out everyone credited on it. */
export async function fetchCampaign(host: string, page: string): Promise<WikiCampaign> {
  const wikitext = await fetchWikitext(host, page);
  // Derived from CAMPAIGN_TEMPLATES rather than a second hardcoded list —
  // keeping the two in sync by hand meant a wiki could be discovered and then
  // yield nothing, which is exactly what happened when Avantris was added.
  const names = [
    ...CAMPAIGN_TEMPLATES.map((t) => t.replace(/^Template:/, '')),
    'Infobox',
  ];
  let template: string | undefined;
  for (const name of names) {
    // Escape regex metacharacters; template names contain spaces and parens.
    template = extractTemplate(wikitext, name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (template) break;
  }

  // An absent infobox is not fatal — some pages carry their cast only in a
  // prose section, which is read below. Only bail if there is nothing at all.
  if (!template && !proseCastSection(wikitext)) {
    throw new Error(
      `no campaign infobox and no cast section on ${host}/wiki/${page} — nothing here this adapter can read`,
    );
  }

  const params = template ? parseParams(template) : {};
  const season = Number.parseInt(params.season ?? '', 10);

  const creditFields = Object.entries(params).filter(([field]) => FIELD_ROLES[field]);

  // Fall back to prose for the GM when the infobox has no such field. High
  // Rollers and Saving Throw both name the GM only in the article text.
  const hasInfoboxGM = creditFields.some(([field]) => FIELD_ROLES[field] === 'GM/DM');
  const proseGmNames = hasInfoboxGM ? [] : proseGMs(wikitext);

  // Resolve every linked page against the wiki's own categories first, in one
  // batched call, so assembly is a lookup rather than a guess about formatting.
  const kinds = await classifyTitles(host, [
    ...creditFields.flatMap(([, value]) => linksInOrder(value).map((l) => l.title)),
    ...proseGmNames,
  ]);

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

  // Nothing in the infobox? Try a prose cast section before giving up.
  if (credits.length === 0) {
    const section = proseCastSection(wikitext);
    if (section) {
      const kinds2 = await classifyTitles(host, linksInOrder(section).map((l) => l.title));
      for (const line of section.split(/\n/)) {
        if (!line.includes('[[')) continue;
        const assembled = assemblePeople(line, kinds2);
        for (const person of assembled.people) {
          const isGm = /dungeon master|game master|\bDM\b|\bGM\b/i.test(line);
          credits.push({
            field: 'cast section',
            role: isGm ? 'GM/DM' : 'player',
            people: [isGm ? { name: person.name } : person],
          });
        }
      }
    }
  }

  // Characters listed in the infobox: follow each to its own page for the
  // performer, rather than importing the character as a person.
  for (const field of CHARACTER_FIELDS) {
    const value = params[field];
    if (!value) continue;
    const characters = linksInOrder(value).map((l) => l.title);
    if (characters.length === 0) continue;
    const resolved = await playersOfCharacters(host, characters);
    if (resolved.length > 0) credits.push({ field, role: 'player', people: resolved });
  }

  // Prose GMs only count if the wiki classifies them as people — that keeps a
  // stray "run by [[Some Guild]]" out of the person index.
  const proseGmPeople = proseGmNames
    .filter((name) => (kinds.get(name) ?? 'unknown') !== 'character')
    .filter((name) => (kinds.get(name) ?? 'unknown') !== 'organisation')
    .map((name) => ({ name }));
  if (proseGmPeople.length > 0) {
    credits.push({ field: 'prose', role: 'GM/DM', people: proseGmPeople });
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

/**
 * The key art a campaign page uses, as a thumbnail URL.
 *
 * This is the production's copyright — the wiki displays it under its own
 * fair-use rationale and cannot sublicense it. Anything imported through here
 * is stored as `licence: 'fair use'` with a rationale, never dressed up as
 * free. Thumbnail width is requested deliberately: a low-resolution image used
 * to identify the work is a far stronger claim than a full-size copy.
 */
export async function campaignImage(
  host: string,
  page: string,
  width = 400,
): Promise<{ url: string; file: string; descriptionUrl: string } | undefined> {
  const wikitext = await fetchWikitext(host, page).catch(() => undefined);
  if (!wikitext) return undefined;

  const names = [...CAMPAIGN_TEMPLATES.map((t) => t.replace(/^Template:/, '')), 'Infobox'];
  let template: string | undefined;
  for (const name of names) {
    template = extractTemplate(wikitext, name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (template) break;
  }
  if (!template) return undefined;

  const params = parseParams(template);
  const raw = params.image1 ?? params.image ?? params.imageone;
  if (!raw) return undefined;

  const file = raw
    .replace(/\[\[|\]\]/g, '')
    .replace(/^File:/i, '')
    .split('|')[0]!
    .trim();
  if (!file || !/\.(png|jpe?g|webp|gif)$/i.test(file)) return undefined;

  const query = new URLSearchParams({
    action: 'query',
    titles: `File:${file}`,
    prop: 'imageinfo',
    iiprop: 'url',
    iiurlwidth: String(width),
    format: 'json',
    formatversion: '2',
  });

  for (const path of ['/api.php', '/w/api.php']) {
    try {
      const response = await fetch(`https://${host}${path}?${query}`, {
        headers: { 'User-Agent': USER_AGENT },
      });
      if (!response.ok) continue;
      const data: any = await response.json();
      const info = data?.query?.pages?.[0]?.imageinfo?.[0];
      if (!info) continue;
      return {
        url: info.thumburl ?? info.url,
        file,
        descriptionUrl: info.descriptionurl ?? `https://${host}/wiki/File:${encodeURIComponent(file)}`,
      };
    } catch {
      // try the other path
    }
  }
  return undefined;
}
