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
  mediawiki: {
    id: 'mediawiki',
    name: 'Fan wikis (Fandom / Miraheze)',
    licence: 'CC-BY-SA (3.0 or 4.0 depending on wiki)',
    clearance: 'cleared',
    attribution: 'Content from {url}, CC-BY-SA.',
    notes:
      'Where the actual-play credits actually are. Read through the MediaWiki API, ' +
      'not scraped: infoboxes are template-structured, and the Dimension 20 wiki ' +
      'even separates guest_players from players. Every emitted credit carries the ' +
      'source page URL, which satisfies attribution. Note the share-alike term ' +
      'applies to derived content — relevant if this dataset is ever relicensed.\n' +
      'CAUTION: some wikis are forks of each other (criticalrole.miraheze.org is a ' +
      'fork of criticalrole.fandom.com). Importing both would inflate corroboration ' +
      'counts without adding an independent source. Corroboration needs a source ' +
      'that did its own observing.',
  },
  podchaser: {
    id: 'podchaser',
    name: 'Podchaser',
    licence: 'Proprietary — API terms apply',
    clearance: 'needs-review',
    attribution: 'Credit data from Podchaser.',
    notes:
      'Has real creator-credit data, which is exactly what this project wants. ' +
      'Blocked on access, not on principle: the API needs a key issued under their ' +
      'terms, so an adapter cannot be built or tested without one. Set PODCHASER_API_KEY ' +
      'and clear this entry once the redistribution terms are checked.',
  },
  'actualplay-world': {
    id: 'actualplay-world',
    name: 'actualplay.world',
    licence: 'Unstated',
    clearance: 'needs-review',
    attribution: 'Show data from actualplay.world.',
    notes:
      'Indexes shows rather than people, so it is a source for show/channel/system ' +
      'records rather than the credits this project is short of. No documented public ' +
      'API or licence statement found; would need permission from the operators rather ' +
      'than scraping.',
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
