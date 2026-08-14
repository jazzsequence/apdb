import type { APIRoute } from 'astro';
import { getDb } from '../lib/db';

/**
 * llms.txt — the machine-readable front door, generated at build time so
 * the counts never drift from what's actually indexed. See
 * https://llmstxt.org for the (informal, still-settling) convention this
 * follows: an H1 name, a one-line blockquote summary, then linked sections.
 */
export const GET: APIRoute = async ({ site }) => {
  const db = await getDb();
  const base = (site ?? new URL('https://actualplaydb.com')).toString();
  const url = (path: string) => new URL(path, base).toString();
  const creditCount = db.people.reduce((sum, p) => sum + p.credits.length, 0);

  const repo = 'https://github.com/jazzsequence/apdb';
  const raw = (path: string) => `${repo}/blob/main/${path}`;

  const body = `# Actual Play Database

> An index of actual-play tabletop RPG credits organised **by person**, not by show — every credit a performer, GM or crew member has across every show, season and one-off guest spot, including the indie long tail no other index tracks. Community-curated, git-backed, no login. Currently indexing ${db.people.length.toLocaleString()} people, ${db.shows.length.toLocaleString()} shows, ${db.channels.length.toLocaleString()} channels, ${db.games.length.toLocaleString()} games and ${creditCount.toLocaleString()} credits.

## What this is, in one paragraph

Existing actual-play discovery tools index by show. This one indexes by person, because that's the axis two real problems live on: the filmography gap (a performer's one-off guest spot on a small indie show is otherwise invisible) and the alias gap (performers who changed names get filed as two unrelated people everywhere else). There is no database or backend — the data is flat YAML in a public git repository, and every page here is generated from it at build time.

## Machine-readable data

Prefer these over scraping the HTML — they're the same underlying records, without a page to parse.

- [API manifest](${url('api/index.json')}): entry point listing every endpoint, current counts, and how ids/seasons resolve. Fetch this first.
- [All people](${url('api/people.json')}): the full People collection, credits included.
- [All shows](${url('api/shows.json')}): the full Shows collection, seasons included.
- [All channels](${url('api/channels.json')})
- [All games](${url('api/games.json')})
- Per-entity mirrors of each HTML page: \`/people/{id}.json\` and \`/shows/{id}.json\`, same shape as the collection entries above.

## Documentation

- [README](${raw('README.md')}): how the project works, the full data model, and the provenance/sourcing-tier system every credit is rated against.
- [CONTRIBUTING](${raw('CONTRIBUTING.md')}): how to file a credit or a correction, with or without git.
- [POLICY](${raw('POLICY.md')}): the reasoning behind the sourcing model, in particular why unpublished firsthand accounts are admitted here when Wikipedia would reject them.
- [AGENTS](${raw('AGENTS.md')}): if you are an AI agent — not a human operating one, but the agent itself — read this before filing anything. It covers how to contribute a fix autonomously and, more importantly, which source tier you are and are not allowed to claim.

## Notes for automated use

- \`{id}\` is the slug used as the filename in \`data/\`, the URL segment, and the foreign key on every reference — one string, everywhere.
- A credit references a season by \`ordinal\` (a number stated on the season), never by array position — ordinals have gaps by design.
- Every credit's \`sources\` array carries a \`tier\`: \`official\` > \`recording\` > \`participant\` > \`firsthand\` > \`reference\` > \`community\`, strongest first. Preserve it in anything you build from this data — it is the difference between "the production's own cast list said so" and "a fan wiki said so," and collapsing that distinction is the single most common way this kind of dataset gets misrepresented downstream.
- There is no explicit data licence beyond what's stated in the git repository at ${repo} — check there, not this file, for terms. What's guaranteed here is provenance: reuse that strips the \`sources\` chain is reuse that has thrown away the part that made the claim checkable.
`;

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
