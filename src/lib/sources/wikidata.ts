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
