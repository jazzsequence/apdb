/**
 * Wikidata adapter — the identity backbone.
 *
 * Wikidata is CC0 and already models person↔work with stable QIDs, which makes
 * it the right anchor for canonical names and, crucially, for *alternate*
 * names: birth names (P1477), birth surnames (P8017) and altLabels are exactly
 * the signal the alias gap needs.
 *
 * It is deliberately NOT used for credits. Its actual-play coverage is thin and
 * the indie long tail — the entire point of this project — is not in it.
 */
import type { Alias } from '../schema.js';

const ENTITY_DATA = 'https://www.wikidata.org/wiki/Special:EntityData';
const API = 'https://www.wikidata.org/w/api.php';

const USER_AGENT =
  'ActualPlayDatabase/0.1 (https://github.com/; community actual-play credit index) node-fetch';

/** What the adapter can establish about a person. Credits are never included. */
export interface WikidataPerson {
  qid: string;
  canonical_name: string;
  sort_name: string;
  aliases: Alias[];
  description?: string;
  wikipedia?: string;
  website?: string;
  /** Human-readable trail of which Wikidata properties produced each alias. */
  provenance: string[];
}

interface SearchHit {
  id: string;
  label: string;
  description?: string;
}

async function getJson(url: string): Promise<any> {
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`);
  }
  return response.json();
}

/** Free-text name -> candidate QIDs. */
export async function searchPeople(name: string, limit = 5): Promise<SearchHit[]> {
  const url = `${API}?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&type=item&limit=${limit}&format=json&origin=*`;
  const data = await getJson(url);
  return (data.search ?? []).map((hit: any) => ({
    id: hit.id,
    label: hit.label,
    description: hit.description,
  }));
}

function claimStrings(entity: any, property: string): string[] {
  const claims = entity.claims?.[property] ?? [];
  return claims
    .map((claim: any) => claim.mainsnak?.datavalue?.value)
    .map((value: any) => (typeof value === 'string' ? value : value?.text))
    .filter((value: unknown): value is string => typeof value === 'string' && value.length > 0);
}

function slugifyAliasId(name: string, fallback: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

/** "Aabria Iyengar" -> "Iyengar, Aabria". Best-effort; a curator can correct it. */
function deriveSortName(name: string, familyName?: string): string {
  if (familyName && name.endsWith(familyName)) {
    const given = name.slice(0, name.length - familyName.length).trim();
    return given ? `${familyName}, ${given}` : name;
  }
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  const last = parts.pop()!;
  return `${last}, ${parts.join(' ')}`;
}

export async function fetchPerson(qid: string): Promise<WikidataPerson> {
  const data = await getJson(`${ENTITY_DATA}/${encodeURIComponent(qid)}.json`);
  const entity = data.entities?.[qid];
  if (!entity) throw new Error(`Wikidata returned no entity for ${qid}`);

  const canonical_name: string = entity.labels?.en?.value ?? qid;
  const description: string | undefined = entity.descriptions?.en?.value;

  // P734 = family name (an item, so we resolve its label lazily only if cheap).
  const familyNameQid = entity.claims?.P734?.[0]?.mainsnak?.datavalue?.value?.id as
    | string
    | undefined;
  let familyName: string | undefined;
  if (familyNameQid) {
    try {
      const fam = await getJson(`${ENTITY_DATA}/${familyNameQid}.json`);
      familyName = fam.entities?.[familyNameQid]?.labels?.en?.value;
    } catch {
      // Non-fatal: sort_name falls back to the naive split.
    }
  }

  const provenance: string[] = [];
  const aliases: Alias[] = [];
  const seen = new Set<string>();

  const push = (name: string, alias_type: Alias['alias_type'], note: string) => {
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    let id = slugifyAliasId(name, `alias-${aliases.length + 1}`);
    while (aliases.some((a) => a.id === id)) id = `${id}-2`;
    aliases.push({ id, name, alias_type, note });
    provenance.push(note);
  };

  push(canonical_name, 'legal', 'Wikidata English label (P:label).');

  // The alias-gap signals, in descending order of reliability.
  for (const birthName of claimStrings(entity, 'P1477')) {
    push(birthName, 'birth', 'Wikidata birth name (P1477).');
  }
  for (const birthSurname of claimStrings(entity, 'P8017')) {
    push(birthSurname, 'birth', 'Wikidata birth surname (P8017) — surname only, needs a full name.');
  }
  for (const pseudonym of claimStrings(entity, 'P742')) {
    push(pseudonym, 'stage', 'Wikidata pseudonym (P742).');
  }
  for (const altLabel of (entity.aliases?.en ?? []).map((a: any) => a.value)) {
    push(altLabel, 'stage', 'Wikidata English altLabel — type is a guess, curator should confirm.');
  }

  const enwiki: string | undefined = entity.sitelinks?.enwiki?.title;

  return {
    qid,
    canonical_name,
    sort_name: deriveSortName(canonical_name, familyName),
    aliases,
    description,
    wikipedia: enwiki
      ? `https://en.wikipedia.org/wiki/${encodeURIComponent(enwiki.replace(/ /g, '_'))}`
      : undefined,
    website: claimStrings(entity, 'P856')[0],
    provenance,
  };
}

// ---------------------------------------------------------------------------
// Images.
//
// Only Wikimedia Commons. Fan wikis host show artwork under fair-use claims,
// not under the CC-BY-SA that covers their text, so those files cannot be
// copied into this dataset however convenient they are. Commons files carry a
// machine-readable licence, which is checked here rather than assumed.
// ---------------------------------------------------------------------------

const FREE_LICENCES: Record<string, string> = {
  cc0: 'CC0',
  'cc0 1.0': 'CC0',
  'cc by 2.0': 'CC-BY-2.0',
  'cc by 3.0': 'CC-BY-3.0',
  'cc by 4.0': 'CC-BY-4.0',
  'cc by-sa 2.0': 'CC-BY-SA-2.0',
  'cc by-sa 3.0': 'CC-BY-SA-3.0',
  'cc by-sa 4.0': 'CC-BY-SA-4.0',
  'public domain': 'public domain',
  pd: 'public domain',
};

export interface FreeImage {
  url: string;
  licence: string;
  attribution: string;
  source: string;
}

/** Resolve a Commons filename to a URL plus its verified licence. */
export async function commonsImage(filename: string): Promise<FreeImage | undefined> {
  const params = new URLSearchParams({
    action: 'query',
    titles: `File:${filename}`,
    prop: 'imageinfo',
    iiprop: 'url|extmetadata',
    format: 'json',
    formatversion: '2',
  });
  const data = await getJson(`https://commons.wikimedia.org/w/api.php?${params}`);
  const page = data?.query?.pages?.[0];
  const info = page?.imageinfo?.[0];
  if (!info) return undefined;

  const raw = String(info.extmetadata?.LicenseShortName?.value ?? '').toLowerCase().trim();
  const licence = FREE_LICENCES[raw];
  // Unrecognised licence means unknown terms, which means don't use it.
  if (!licence) return undefined;

  const artist = String(info.extmetadata?.Artist?.value ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    url: info.url,
    licence,
    attribution: artist || 'Wikimedia Commons contributor',
    source: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(filename.replace(/ /g, '_'))}`,
  };
}

/** The Commons filename Wikidata records for a person (P18), if any. */
export async function wikidataImage(qid: string): Promise<FreeImage | undefined> {
  const data = await getJson(`${ENTITY_DATA}/${encodeURIComponent(qid)}.json`);
  const claims = data.entities?.[qid]?.claims;
  const filename = claims?.P18?.[0]?.mainsnak?.datavalue?.value;
  if (typeof filename !== 'string') return undefined;
  return commonsImage(filename);
}

// ---------------------------------------------------------------------------
// Works.
//
// The header of this file says Wikidata is not used for credits, and that is
// still true: nothing below emits a credit. What it does is answer the
// question no show-first adapter can — "what else was this person in?" — and
// hand back candidates for a person-first discovery pass to check.
//
// The distinction matters. Wikidata's actual-play coverage really is thin, so
// this will never be the source a credit rests on. But thin coverage of a
// show that is missing from the catalogue entirely is still the only pointer
// anyone has to it, and "known for: NY by Night" sitting unread on a QID we
// already store is a gap with no excuse.
// ---------------------------------------------------------------------------

const SPARQL = 'https://query.wikidata.org/sparql';

export interface WikidataWork {
  qid: string;
  title: string;
  description?: string;
  /** enwiki article title, when the work has one — the handle Wikipedia needs. */
  wikipedia?: string;
  /** How Wikidata connects the person to the work, for the report. */
  via: string;
  /** instance-of / genre labels, used by the actual-play classifier. */
  types: string[];
}

/**
 * Works this person is attached to.
 *
 * Two directions, because Wikidata models them separately:
 *   - P800 "notable work", stored on the person;
 *   - P161 "cast member" / P725 "voice actor" / P3092 "film crew member",
 *     stored on the *work*, which needs a reverse query.
 *
 * The reverse half is a SPARQL query. That endpoint is rate-limited and asks
 * for a descriptive User-Agent; a person-first sweep over hundreds of people
 * must pace itself accordingly (the discovery script does).
 */
export async function fetchWorks(qid: string): Promise<WikidataWork[]> {
  const query = `
    SELECT ?work ?workLabel ?workDescription ?article ?via ?typeLabel WHERE {
      {
        wd:${qid} wdt:P800 ?work .
        BIND("P800 notable work" AS ?via)
      } UNION {
        ?work wdt:P161 wd:${qid} .
        BIND("P161 cast member" AS ?via)
      } UNION {
        ?work wdt:P725 wd:${qid} .
        BIND("P725 voice actor" AS ?via)
      }
      OPTIONAL { ?work wdt:P31 ?type . }
      OPTIONAL {
        ?article schema:about ?work ; schema:isPartOf <https://en.wikipedia.org/> .
      }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    LIMIT 200`;

  const response = await fetch(`${SPARQL}?query=${encodeURIComponent(query)}`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/sparql-results+json' },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} from the Wikidata query service`);
  }
  const data = await response.json();

  // One work comes back once per instance-of value; fold them into one record.
  const works = new Map<string, WikidataWork>();
  for (const row of data.results?.bindings ?? []) {
    const uri: string = row.work?.value ?? '';
    const workQid = uri.split('/').pop() ?? '';
    if (!/^Q\d+$/.test(workQid)) continue;

    const existing = works.get(workQid);
    const type = row.typeLabel?.value;
    if (existing) {
      if (type && !existing.types.includes(type)) existing.types.push(type);
      if (row.via?.value && !existing.via.includes(row.via.value)) existing.via += `, ${row.via.value}`;
      continue;
    }
    works.set(workQid, {
      qid: workQid,
      title: row.workLabel?.value ?? workQid,
      description: row.workDescription?.value,
      wikipedia: row.article?.value
        ? decodeURIComponent(row.article.value.split('/wiki/')[1] ?? '').replace(/_/g, ' ')
        : undefined,
      via: row.via?.value ?? 'unknown',
      types: type ? [type] : [],
    });
  }
  return [...works.values()];
}
