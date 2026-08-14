import type { APIRoute } from 'astro';
import { getDb } from '../../lib/db';

/**
 * Machine-readable entry point. A crawler or agent that fetches this one URL
 * learns the whole shape of the site without guessing at routes.
 *
 * No licence is declared for this data beyond what's in the git repository
 * itself (jazzsequence/apdb) — consult that, not this file, for terms. What
 * this file documents is provenance: every record traces back to sources
 * recorded on the entity itself (see the `sources` list on each credit),
 * and reuse should preserve that chain rather than presenting the data as
 * uncredited fact.
 */
export const GET: APIRoute = async ({ site }) => {
  const db = await getDb();
  const base = (site ?? new URL('https://actualplaydb.com')).toString();
  const url = (path: string) => new URL(path, base).toString();

  const manifest = {
    name: 'Actual Play Database',
    description:
      'An index of actual-play TTRPG credits organised by person — every show, season and guest spot, including the indie long tail.',
    repository: 'https://github.com/jazzsequence/apdb',
    counts: {
      people: db.people.length,
      shows: db.shows.length,
      channels: db.channels.length,
      games: db.games.length,
      credits: db.people.reduce((sum, p) => sum + p.credits.length, 0),
    },
    endpoints: {
      people: {
        collection: url('api/people.json'),
        entity: url('people/{id}.json'),
        html: url('people/{id}/'),
      },
      shows: {
        collection: url('api/shows.json'),
        entity: url('shows/{id}.json'),
        html: url('shows/{id}/'),
      },
      channels: {
        collection: url('api/channels.json'),
        html: url('channels/{id}/'),
      },
      games: {
        collection: url('api/games.json'),
      },
    },
    docs: {
      llms_txt: url('llms.txt'),
      agents_md: 'https://github.com/jazzsequence/apdb/blob/main/AGENTS.md',
      contributing: 'https://github.com/jazzsequence/apdb/blob/main/CONTRIBUTING.md',
      data_model: 'https://github.com/jazzsequence/apdb/blob/main/README.md#data-model',
      provenance: 'https://github.com/jazzsequence/apdb/blob/main/README.md#provenance',
    },
    notes: [
      '{id} is the slug used as both the filename in data/ and the URL segment — the same string everywhere.',
      'A credit references its show by id and, where it applies, a season by ordinal number (not array index — ordinals can have gaps).',
      'Every credit carries a sources list with a tier (official > recording > participant > firsthand > reference > community). Treat the tier as part of the fact, not metadata to discard.',
    ],
  };

  return new Response(JSON.stringify(manifest, null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
