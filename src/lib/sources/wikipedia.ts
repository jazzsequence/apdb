/**
 * Wikipedia adapter — the person-first source.
 *
 * Every other adapter in this directory starts from a show and reads its cast
 * down. That is backwards for the one question this project exists to answer,
 * and it left a hole you could drive a career through: a show nobody has
 * catalogued yet contributes nothing to anyone in it, however well documented
 * it is elsewhere. Aabria Iyengar's article names four series — NY by Night,
 * Kollok 1991, Into the Mother Lands, Private Nightmares — that no show-first
 * sweep could ever have surfaced, because the shows themselves were missing.
 *
 * So this reads the *person's* article and asks what they were in. Two places
 * carry that:
 *
 *   - the filmography wikitables, which are structured enough to parse
 *     (year / title / role / notes, with the section heading saying what kind
 *     of work the table holds);
 *   - the prose, which is where a credit lives when nobody has built a table
 *     row for it yet. Kollok is prose-only on her article.
 *
 * Read through the MediaWiki API rather than scraped: same reason the fan-wiki
 * adapter does it, plus `action=parse` hands back wikitext with the link
 * targets intact, and link targets are what let a candidate be resolved
 * against the catalogue instead of string-matched at it.
 *
 * Everything here is REPORT-ONLY input. Wikipedia is a `reference` tier source
 * and a demonstrably fallible one — its filmography table has Aabria as a
 * player on Pirates of Salt Bay, a show she ran (POLICY.md). Nothing in this
 * file decides a credit; it produces candidates for a human or a curator pass
 * to check against something closer to the fact.
 */

const API = 'https://en.wikipedia.org/w/api.php';

const USER_AGENT =
  'ActualPlayDatabase/0.1 (https://github.com/; community actual-play credit index) node-fetch';

/** One work a person's article says they were in. Not yet a credit. */
export interface WikiWork {
  /** Title as written on the page, italics and refs stripped. */
  title: string;
  /** The article this links to, when it links to one. The resolvable handle. */
  link?: string;
  year?: string;
  /** Raw role cell / prose fragment: "Dungeon Master", "Laura Bennett", "Herself". */
  role?: string;
  character?: string;
  /** Section the row or sentence sat under: "Actual play", "Filmography — Film". */
  section: string;
  origin: 'table' | 'prose';
  /** The sentence a prose candidate came from, so a reviewer can judge it. */
  evidence?: string;
}

export interface WikipediaPerson {
  /** Article title, normalised by the API. */
  page: string;
  url: string;
  /** The article's own categories — the strongest AP signal available. */
  categories: string[];
  works: WikiWork[];
}

async function api(params: Record<string, string>): Promise<any> {
  const query = new URLSearchParams({ format: 'json', formatversion: '2', origin: '*', ...params });
  const response = await fetch(`${API}?${query}`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} from ${API}`);
  return response.json();
}

/** "https://en.wikipedia.org/wiki/Aabria_Iyengar" -> "Aabria Iyengar". */
export function pageTitleFromUrl(url: string): string | undefined {
  const match = url.match(/\/wiki\/([^?#]+)/);
  if (!match) return undefined;
  return decodeURIComponent(match[1]).replace(/_/g, ' ');
}

// ---------------------------------------------------------------------------
// Wikitext cleanup
// ---------------------------------------------------------------------------

/** Strip refs, comments and the templates that only carry styling. */
function stripMarkup(text: string): string {
  return text
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\{\{\s*(?:sfn|efn|cite[^}]*|r|ref)[^{}]*\}\}/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/'''?/g, '')
    .trim();
}

/**
 * Pull the link target out of a cell, then the display text.
 *
 * The target is the valuable half: two articles can display the same title,
 * and a redirect resolves on the target where it will not on the words.
 */
function readLink(cell: string): { title: string; link?: string } {
  const link = cell.match(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/);
  const text = stripMarkup(
    cell
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
      .replace(/\[\[([^\]]+)\]\]/g, '$1')
      .replace(/\[(?:https?:)\S+\s+([^\]]+)\]/g, '$1'),
  )
    .replace(/\s+/g, ' ')
    .trim();
  return { title: text, link: link ? link[1].trim() : undefined };
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

interface Section {
  heading: string;
  /** "Filmography — Television": the trail, because the parent says the kind. */
  path: string;
  body: string;
}

function splitSections(wikitext: string): Section[] {
  const sections: Section[] = [];
  const pattern = /^(={2,6})\s*(.+?)\s*\1\s*$/gm;
  const trail: string[] = [];
  let match: RegExpExecArray | null;
  let previous: { heading: string; path: string; start: number } | undefined = {
    heading: '(lead)',
    path: '(lead)',
    start: 0,
  };

  while ((match = pattern.exec(wikitext))) {
    if (previous) {
      sections.push({
        heading: previous.heading,
        path: previous.path,
        body: wikitext.slice(previous.start, match.index),
      });
    }
    const depth = match[1].length - 2;
    const heading = stripMarkup(match[2]);
    trail.length = depth;
    trail[depth] = heading;
    previous = {
      heading,
      path: trail.filter(Boolean).join(' — '),
      start: pattern.lastIndex,
    };
  }
  if (previous) {
    sections.push({ heading: previous.heading, path: previous.path, body: wikitext.slice(previous.start) });
  }
  return sections;
}

// ---------------------------------------------------------------------------
// Filmography tables
// ---------------------------------------------------------------------------

const COLUMN_ALIASES: Record<string, 'year' | 'title' | 'role' | 'notes'> = {
  year: 'year',
  years: 'year',
  date: 'year',
  title: 'title',
  show: 'title',
  series: 'title',
  work: 'title',
  production: 'title',
  role: 'role',
  roles: 'role',
  character: 'role',
  'character(s)': 'role',
  as: 'role',
  notes: 'notes',
  note: 'notes',
};

/** Split a wikitable row into cells, respecting `||` and leading-`|` forms. */
function rowCells(row: string): string[] {
  const cells: string[] = [];
  for (const line of row.split(/\n(?=[|!])/)) {
    const trimmed = line.trim();
    if (!trimmed || /^[|!]-/.test(trimmed)) continue;
    const marker = trimmed[0];
    const body = trimmed.slice(1);
    for (const piece of body.split(marker === '!' ? /!!/ : /\|\|/)) {
      // Strip a cell's attribute prefix ("colspan=2 | Text"), never a link's pipe.
      const cleaned = piece.replace(/^\s*[a-z-]+\s*=\s*"?[^"|]*"?\s*(?:\|(?!\|))/i, '');
      cells.push(cleaned.trim());
    }
  }
  return cells;
}

function parseTables(section: Section): WikiWork[] {
  const works: WikiWork[] = [];
  const tables = section.body.match(/\{\|[\s\S]*?\n\|\}/g) ?? [];

  for (const table of tables) {
    const rows = table.split(/\n\|-+[^\n]*/);
    if (rows.length < 2) continue;

    const headers = rowCells(rows[0].replace(/^\{\|[^\n]*\n?/, ''))
      .map((cell) => stripMarkup(cell).toLowerCase().replace(/\s+/g, ' ').trim());
    const columns = headers.map((header) => COLUMN_ALIASES[header]);
    const titleAt = columns.indexOf('title');
    if (titleAt < 0) continue; // Not a filmography table. A discography isn't either.

    for (const row of rows.slice(1)) {
      const cells = rowCells(row);
      if (cells.length === 0) continue;
      // A rowspan'd year shifts every later cell left; read from the right for
      // title when the count is short rather than misreading the columns.
      const offset = cells.length < columns.length ? columns.length - cells.length : 0;
      const at = (kind: 'year' | 'title' | 'role' | 'notes'): string | undefined => {
        const index = columns.indexOf(kind);
        if (index < 0) return undefined;
        const shifted = index - offset;
        return shifted >= 0 ? cells[shifted] : undefined;
      };

      const { title, link } = readLink(at('title') ?? '');
      if (!title || /^(title|show|series)$/i.test(title)) continue;

      const role = stripMarkup(at('role') ?? '') || undefined;
      works.push({
        title,
        link,
        year: (stripMarkup(at('year') ?? '').match(/\d{4}(?:[–-]\s*(?:\d{4}|present))?/) ?? [])[0],
        role,
        character: characterFromRole(role),
        section: section.path,
        origin: 'table',
      });
    }
  }
  return works;
}

/**
 * A filmography role cell is a character name about as often as it is a job.
 * "Herself", "Dungeon Master" and "Voice" are jobs; everything else is
 * probably who they played — but only probably, so this stays advisory and
 * the raw cell is kept alongside it.
 */
function characterFromRole(role: string | undefined): string | undefined {
  const value = (role ?? '').trim();
  if (!value) return undefined;
  if (/^(herself|himself|themselves|self|voice|narrator|host|various|guest|dungeon master|game master|dm|gm|storyteller|keeper|player|writer|producer|director)\b/i.test(value)) {
    return undefined;
  }
  return value.replace(/\s*\(.*?\)\s*$/, '').trim() || undefined;
}

// ---------------------------------------------------------------------------
// Prose
// ---------------------------------------------------------------------------

/**
 * Sentences that assert an appearance.
 *
 * Deliberately narrow. A person's article says plenty about shows they did not
 * appear in — who founded what, who a series is a spin-off of — and a loose
 * match here turns into a candidate list nobody trusts.
 */
const APPEARANCE = /\b(played|plays|playing|portrayed|starred|stars|starring|appeared|guest|joined the (?:main )?cast|cast member|main cast|as a player|game ?master|dungeon ?master|storyteller|ran|runs|dm(?:ed|s)?\b|gm(?:ed|s)?\b)\b/i;

function parseProse(section: Section): WikiWork[] {
  const works: WikiWork[] = [];
  const prose = section.body
    .replace(/\{\|[\s\S]*?\n\|\}/g, '')       // tables handled elsewhere
    .replace(/\{\{[^{}]*\}\}/g, '')
    // Refs go before the sentence split, not after: a citation sits between
    // the full stop and the next capital, and leaving it in silently welds two
    // sentences together — which reads as one appearance with the wrong
    // character attached to it.
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^\s*[*#:].*$/gm, '');

  for (const raw of prose.split(/(?<=[.!?])\s+(?=[A-Z"'\[])/)) {
    const sentence = raw.replace(/\s+/g, ' ').trim();
    if (!sentence || !APPEARANCE.test(sentence)) continue;

    const links = [...sentence.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g)];
    if (links.length === 0) continue;

    const clean = stripMarkup(
      sentence.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1'),
    );

    for (const link of links) {
      const target = link[1].trim();
      const display = (link[2] ?? target).trim();
      // People, channels and games get linked in these sentences too. Only a
      // work can be a candidate, and the classifier is what decides that —
      // but skip the obvious non-works here to keep the list readable.
      if (/^(Category|File|Image|Template|Wikipedia|Help):/i.test(target)) continue;

      // A common noun is never a work. One sentence about a Dimension 20
      // season linked "game master", "tabletop role-playing game", "improv"
      // and "immersive theater"; all four arrived as candidate series and
      // pushed the real ones down the report. Titles are proper nouns — even
      // a stylised one capitalises something — so a link whose target has no
      // capital anywhere is prose furniture, not a series.
      //
      // Tested on the target rather than the display text: the display is
      // frequently a lowercase inflection of a properly-capitalised article
      // ("[[Gamemaster|game master]]"), and dropping on display alone would
      // also discard the genuine link behind it.
      if (!/[A-Z]/.test(target)) continue;

      // Sentence-fragment links: "the [[Critical Role|fourth campaign]]".
      // The target is the work; the display is a phrase from the sentence,
      // and reporting it as a title asks a reviewer to go and add a show
      // called "fourth campaign".
      const ordinalPhrase = /^(the )?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|final|latest|next|main|current)\b/i;
      const title = ordinalPhrase.test(display) ? target : display;

      works.push({
        title: stripMarkup(title),
        link: target,
        role: roleFromSentence(clean),
        character: characterFromSentence(clean),
        section: section.path,
        origin: 'prose',
        evidence: clean,
      });
    }
  }
  return works;
}

function roleFromSentence(sentence: string): string | undefined {
  if (/\b(game ?master|dungeon ?master|storyteller|\bDM\b|\bGM\b|ran the|runs the)\b/i.test(sentence)) {
    return /\bguest\b/i.test(sentence) ? 'guest GM' : 'GM/DM';
  }
  if (/\b(guest player|as a guest|guest star|originally a guest)\b/i.test(sentence)) return 'guest player';
  if (/\b(played|plays|playing|portrayed|starred|stars|joined the (?:main )?cast|main cast)\b/i.test(sentence)) {
    return 'player';
  }
  return undefined;
}

/** "playing as Margot "Fuego" Walker" / "acting as Laura Bennett". */
function characterFromSentence(sentence: string): string | undefined {
  const match = sentence.match(
    /\b(?:playing|played|plays|portraying|portrayed|acting|appearing)\s+(?:as\s+)?([A-Z][^.,;:]{1,60}?)(?=[.,;:]|\s+(?:in|on|for|before|since|during|and)\b)/,
  );
  const value = match?.[1]?.trim();
  if (!value || /^(a|an|the|as|herself|himself|themselves)\b/i.test(value)) return undefined;
  return value;
}

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

/** Everything the article says this person was in. Candidates, not credits. */
export async function fetchPersonWorks(pageOrUrl: string): Promise<WikipediaPerson> {
  const title = pageOrUrl.startsWith('http') ? pageTitleFromUrl(pageOrUrl) : pageOrUrl;
  if (!title) throw new Error(`Not a Wikipedia article URL: ${pageOrUrl}`);

  const data = await api({
    action: 'parse',
    page: title,
    prop: 'wikitext|categories',
    redirects: '1',
  });
  if (data.error) throw new Error(`${title}: ${data.error.info}`);

  const wikitext: string = data.parse?.wikitext ?? '';
  return {
    page: data.parse?.title ?? title,
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent((data.parse?.title ?? title).replace(/ /g, '_'))}`,
    categories: (data.parse?.categories ?? []).map((c: any) => String(c.category ?? c['*']).replace(/_/g, ' ')),
    works: parseWorks(wikitext),
  };
}

/** Exposed for offline testing: the parse is the part worth having a fixture for. */
export function parseWorks(wikitext: string): WikiWork[] {
  const works: WikiWork[] = [];
  for (const section of splitSections(wikitext)) {
    works.push(...parseTables(section), ...parseProse(section));
  }
  return dedupe(works);
}

/**
 * One work named in a table and again in prose is one candidate, and the table
 * row is the better-structured half — but the prose sentence is the evidence a
 * reviewer reads, so it is kept rather than dropped.
 */
function dedupe(works: WikiWork[]): WikiWork[] {
  const byKey = new Map<string, WikiWork>();
  for (const work of works) {
    const key = (work.link ?? work.title).toLowerCase();
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, work);
      continue;
    }
    const [table, prose] = existing.origin === 'table' ? [existing, work] : [work, existing];
    byKey.set(key, {
      ...table,
      role: table.role ?? prose.role,
      character: table.character ?? prose.character,
      evidence: table.evidence ?? prose.evidence,
    });
  }
  return [...byKey.values()];
}

/**
 * Categories and lead extract for many articles at once.
 *
 * The classifier needs the *work's* own page to tell an actual play from a
 * voice role, and a person's article names dozens of works — so this batches,
 * 50 titles a call, the API's limit.
 */
export async function fetchWorkFacts(
  titles: string[],
): Promise<Map<string, { categories: string[]; extract: string; missing: boolean }>> {
  const facts = new Map<string, { categories: string[]; extract: string; missing: boolean }>();
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50);
    const data = await api({
      action: 'query',
      titles: batch.join('|'),
      prop: 'categories|extracts',
      cllimit: 'max',
      exintro: '1',
      explaintext: '1',
      redirects: '1',
    });
    const normalised = new Map<string, string>();
    for (const entry of data.query?.normalized ?? []) normalised.set(entry.from, entry.to);
    for (const entry of data.query?.redirects ?? []) normalised.set(entry.from, entry.to);

    for (const page of data.query?.pages ?? []) {
      const fact = {
        categories: (page.categories ?? []).map((c: any) => String(c.title).replace(/^Category:/, '')),
        extract: String(page.extract ?? ''),
        missing: Boolean(page.missing),
      };
      facts.set(page.title, fact);
      for (const [from, to] of normalised) if (to === page.title) facts.set(from, fact);
    }
    if (i + 50 < titles.length) await new Promise((r) => setTimeout(r, 250));
  }
  return facts;
}
