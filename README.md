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

`npm run collect` pulls identity data from external sources. Wikidata (CC0) is
the only cleared source: it already models person↔work with stable QIDs and is
the right anchor for canonical names and alternate names.

It is deliberately **not** used for credits — its actual-play coverage is thin,
and the indie long tail this project exists to index simply is not in it. Those
come from contributors.

Imports land in `data/_incoming/` for review and become a PR like any other
contribution. Curated data always wins: an import never overwrites an existing
bio, links, credits or alias notes.

Sources that are not licence-cleared are refused by the collector until someone
deliberately clears them in `src/lib/sources/registry.ts`.

## Contributing

You do not need git. Open an issue with the
[add a credit](.github/ISSUE_TEMPLATE/add-credit.yml) or
[name change](.github/ISSUE_TEMPLATE/name-change.yml) form and a maintainer will
transcribe it.

If you do use git, edit the YAML directly, run `npm run validate`, and open a PR.
See [CONTRIBUTING.md](CONTRIBUTING.md).

## Stack

Astro, static output, deployed to GitHub Pages. The data layer
(`src/lib/`) is deliberately framework-agnostic — plain TypeScript, Zod and
YAML, with no Astro imports — so validation and the entity model survive a move
to Next.js or anything else. Only the rendering layer is Astro-specific.
