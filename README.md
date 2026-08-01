# Actual Play Database

An index of actual-play TTRPG credits organised **by person**.

Existing AP discovery tools index by show, game and channel. None index by
performer. This one does, and it is built around the two things that omission
breaks:

1. **The filmography gap.** Pull up a performer and see every credit across every
   show, season and episode — including one-off guest spots on small indie
   campaigns, not just the marquee work.
2. **The alias gap.** Performers change names. Other aggregators file the two
   names as unrelated people, which makes pre-name-change indie credits
   structurally invisible. Here, searching *either* name resolves to one person,
   and every credit records the name they were billed under at the time.

## How it works

There is no database, no CMS and no auth backend. The data is flat YAML in git.

- **Contribution is a pull request.** Review is moderation, merge history is
  provenance.
- **One file per entity** — `data/people/<slug>.yml`, `data/shows/<slug>.yml`,
  and so on. Never a monolith: sharded files keep PRs atomic and diffs readable.
- **IDs are human-readable slugs** used as foreign keys, so the file path, the
  URL and the reference are all the same string.
- **Credits live in the person file.** That makes the filmography the literal
  source of truth, and makes the most common contribution — "I saw X in Y" — a
  single-file edit. Show cast lists are derived by inverting credits at build
  time.

Pages are statically generated, one real route per person and per show, because
the discovery premise dies without individually indexable pages.

## The CI gate

Flat files give you no referential integrity for free — a typo'd show id is a
broken link that nothing catches. `npm run validate` is the replacement for
every constraint a database would have enforced, and it runs on every PR:

- **Schema validation** on every file: types, required fields, enum values.
- **Referential integrity**: every `show` / `season` / `channel` / `game` /
  `alias` id referenced by a credit resolves to something that exists.
- **ID uniqueness and slug format**, and filename-must-equal-id.
- **Duplicate-person heuristic**: the same name on two people with no alias
  linking them gets flagged for maintainer review (advisory, not blocking).

`npm run build` runs the validator first and refuses to render a site from
invalid data, so a broken reference can never reach the published pages.

## Commands

```bash
npm install
npm run validate                              # the CI gate
npm run dev                                   # local site
npm run build                                 # validate, build, index for search
npm run filmography -- "Aabria Lipscomb"      # print a filmography to the terminal
npm run audit                                 # spot-check imports for bad data
npm run collect -- --sources                  # import sources + licence status
```

## Data model

| Entity | Lives in | Notes |
| --- | --- | --- |
| **Person** | `data/people/` | Canonical identity. Holds its aliases and credits inline. |
| **Alias** | inside Person | `name`, `alias_type`, optional active range. The alias-gap fix. |
| **Credit** | inside Person | The polymorphic join. References a show, optionally a season and a free-text episode locator. |
| **Show** | `data/shows/` | Series under one or more channels. Holds its seasons. |
| **Season** | inside Show | `ordinal`, `game` reference, date range. |
| **Channel** | `data/channels/` | Producing entity: network, indie studio or solo creator — all first class. |
| **Game** | `data/games/` | `edition` is required; PF2e vs PF1e is a real discovery filter. |

**Episodes are not entities.** A credit references an episode by a free-text
locator (`"S2E14"`) plus the show and season ids. This is what lets a single
indie guest appearance surface on a performer's page without anyone having to
catalogue an entire show episode by episode.

Main-cast credits reference the season. One-off guest credits additionally carry
an episode locator — that distinction is the long-tail feature.

## Provenance

Every credit carries a `source` declaring its **tier**, ranked by how close the
source was to the thing happening: `official` → `recording` → `participant` →
`firsthand` → `reference` → `community`. The tier renders next to the credit,
and CI enforces the tiers that make claims about their own evidence:
`recording` must carry a locator, `firsthand` must name who attested it.

There is deliberately no `inferred` tier, and no inference status anywhere.
Nobody files a credit without having observed something — streams are watched —
so inference never explains how a credit came to exist. And if a value was
derived from sources, those sources *are* the account, so cite them; if it was
derived from nothing, it isn't knowledge and shouldn't be a value. Fields nobody
established are simply omitted: `alias` is optional, and such credits render as
"billed name not established" rather than carrying a guess.

Note that `firsthand` — someone who watched the episode — outranks published
reference works. It is closer to the fact. Wikipedia's filmography table lists
Aabria Iyengar as a player on Pirates of Salt Bay when she ran it; anyone who
watched would have got that right.

**Corroboration is derived, never asserted.** Each credit carries a *list* of
sources and its status falls out of them: `corroborated` when two or more
independent sources agree, `single-source` otherwise. Independence is checked by
who attested a source or which page it cites, so one person filing twice does
not count.

That list is what makes community verification work. A second listener who
watched the same stream and files their own account moves a credit from
single-source to corroborated — with no publisher involved anywhere.

The sourcing model is adapted from Wikipedia's, with one deliberate divergence:
**unpublished first-hand accounts are admissible here.** Wikipedia's No Original
Research rule assumes published sources reliably exist, which is false for the
indie long tail — applying it would delete exactly the data no other index has.
Testimony is admitted, labelled and ranked, never disguised as something
stronger. The full reasoning is in [POLICY.md](POLICY.md).

Git history covers the rest.

## Importing

`npm run collect` has two modes.

**Fan wikis (`--wiki`)** are where the credits actually are. Fandom and Miraheze
expose a real MediaWiki API with template-structured infoboxes, so this reads
data rather than scraping prose:

```bash
npm run collect -- --wiki dimension20.fandom.com --page "Fantasy High" --show dimension-20 --season 1
npm run collect -- --wiki criticalrole.fandom.com --page "Campaign 1" --show critical-role --season 1
```

Crucially, these wikis mark guest players as their own infobox field, so
**one-off guest spots arrive already distinguished from main cast** — the long
tail, machine-readable. Field names differ per wiki (`players`/`guest_players`
on Dimension 20, `starring`/`sguests` on Critical Role), so the field→role
mapping is data in `src/lib/sources/mediawiki.ts`; add a row for a new wiki.

Cast fields interleave performers and characters, and every wiki formats that
differently — so the parser doesn't read formatting at all. It resolves each
linked page against **the wiki's own categories** (`Cast` / `Voice Actors` vs
`Characters` vs `Companies`) in one batched API call, then walks the links in
order: a person opens an entry, a character attaches to the entry before it, an
organisation is dropped.

That one rule handles every layout encountered without knowing anything about
any of them, and it is what stops a character being filed as a performer or a
production company being filed as a person.

**Show discovery (`--discover`)** builds the show catalogue. A wiki already
knows which of its pages are campaigns, so ask it — this enumerates pages
transcluding the campaign infobox, no page names typed by hand:

```bash
npm run collect -- --wiki dimension20.fandom.com --discover --dry-run
npm run collect -- --wiki dimension20.fandom.com --discover --channel dropout
```

That finds 30 campaigns on the Dimension 20 wiki and 61 on the Critical Role
wiki. Staged shows carry deliberately invalid placeholder ids for `channel` and
`game`, so CI blocks a merge until a curator sets real ones — mapping a system
string onto a game id needs a judgement about edition, which is required here.

**YouTube (`--youtube`)** reads a production's own video descriptions, which
for shows with no fan wiki is often the only place a cast is written down — and
is a *better* source than a wiki, because it's the producer describing their own
episode. Credits from here are `official` tier.

```bash
export YOUTUBE_API_KEY=...   # free: console.cloud.google.com, YouTube Data API v3
npm run collect -- --youtube --playlist <PLAYLIST_ID> --show <show-id> --season 1 --dry-run
```

It reads only lines that name a role (`DM:`, `Starring`, `Cast:`, `Produced by`)
and understands both `X as Y` and `X (Y)`. A description with no cast line yields
nothing rather than a guess. Episode credits roll up to the season — an index of
who was in a show doesn't need a row per episode.

There is no keyless fallback: YouTube blocks unauthenticated access, and scraping
around that would breach their terms.

**Wikidata (`--qid`, `--search`)** is the identity backbone: stable QIDs,
canonical names and, usefully, birth names. It carries almost no AP credits, so
it is not used for them.

### Sources that don't work

- **dungeonsanddragons.com** — serves an error page to non-browser clients;
  fully client-rendered with no structured data.
- **dndbeyond.com** — `robots.txt` disallows `/api/`, and the public pages carry
  no ld+json or embedded state. Their actual-play posts are prose.
- **actualplay.world** — no public API, and its sitemap lists only top-level
  pages, so there is no crawlable show index. Content renders client-side from
  React Server Component streams. Would need the operators' cooperation.
- **Podchaser** — has real creator credits, but the API needs a key issued
  under its terms; an adapter can't be built or tested without one.
- **Fandom's cross-wiki search API** — returns 403; wiki hosts have to be named
  explicitly rather than discovered.

Imports land in `data/_incoming/` for review and become a PR like any other
contribution. Curated data always wins: an import never overwrites an existing
bio, links, credits or alias notes.

Sources that are not licence-cleared are refused by the collector until someone
deliberately clears them in `src/lib/sources/registry.ts`.

## Contributing

You do not need git, or YAML. The site has a **/submit** page: pick the person,
show and season from what's already indexed, say how you know, and it writes the
data file for you and deep-links a pre-filled GitHub issue. If you saw a
different name on screen, it also writes the alias stanza.

Failing that, the [add a credit](.github/ISSUE_TEMPLATE/add-credit.yml) and
[name change](.github/ISSUE_TEMPLATE/name-change.yml) issue forms work too.

If you do use git, edit the YAML directly, run `npm run validate`, and open a PR.
See [CONTRIBUTING.md](CONTRIBUTING.md).

## Stack

Astro, static output, deployed to GitHub Pages. The data layer
(`src/lib/`) is deliberately framework-agnostic — plain TypeScript, Zod and
YAML, with no Astro imports — so validation and the entity model survive a move
to Next.js or anything else. Only the rendering layer is Astro-specific.
