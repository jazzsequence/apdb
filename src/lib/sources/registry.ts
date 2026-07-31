/**
 * Source registry and licence gate.
 *
 * Every import adapter must declare its licence and its clearance status. The
 * collector refuses to run an adapter that is not `cleared`, so a source with
 * ambiguous terms cannot be ingested by accident — clearing one is a
 * deliberate, reviewable edit to this file.
 */

export type Clearance = 'cleared' | 'needs-review' | 'blocked';

export interface SourceInfo {
  id: string;
  name: string;
  licence: string;
  clearance: Clearance;
  /** Attribution string written into every record this source produces. */
  attribution: string;
  notes: string;
}

export const SOURCES: Record<string, SourceInfo> = {
  wikidata: {
    id: 'wikidata',
    name: 'Wikidata',
    licence: 'CC0 1.0 (public domain dedication)',
    clearance: 'cleared',
    attribution: 'Identity data from Wikidata (CC0).',
    notes:
      'CC0 means no attribution is legally required; we record it anyway for provenance. ' +
      'Uses the public Special:EntityData and wbsearchentities endpoints. Be polite: ' +
      'identify with a User-Agent and do not hammer it.',
  },

  // --- Not cleared. Declared so the gate has something concrete to refuse. ---
  fandom: {
    id: 'fandom',
    name: 'Fandom / fan wikis',
    licence: 'CC-BY-SA 3.0 (varies by wiki)',
    clearance: 'needs-review',
    attribution: 'Content from <wiki>, CC-BY-SA 3.0.',
    notes:
      'Usable with attribution and share-alike, but share-alike may affect how the ' +
      'derived dataset can be licensed. Confirm with the project owner before enabling, ' +
      'and check each individual wiki — licences are per-wiki, not uniform.',
  },
  podchaser: {
    id: 'podchaser',
    name: 'Podchaser',
    licence: 'Proprietary — API terms apply',
    clearance: 'needs-review',
    attribution: 'Credit data from Podchaser.',
    notes:
      'Has real creator-credit data, which is exactly what this project wants. ' +
      'Requires an API key and acceptance of their terms; redistribution rights are ' +
      'the open question. Do not scrape the site as a substitute.',
  },
};

export function assertCleared(sourceId: string): SourceInfo {
  const source = SOURCES[sourceId];
  if (!source) {
    const known = Object.keys(SOURCES).join(', ');
    throw new Error(`Unknown source "${sourceId}". Known sources: ${known}`);
  }
  if (source.clearance !== 'cleared') {
    throw new Error(
      `Source "${source.name}" is not cleared for ingest (status: ${source.clearance}).\n` +
        `  Licence: ${source.licence}\n` +
        `  ${source.notes}\n` +
        `Clear it deliberately in src/lib/sources/registry.ts once the terms are confirmed.`,
    );
  }
  return source;
}
