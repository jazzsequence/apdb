# Contributing

The most valuable contribution to this project is an obscure credit. Marquee
shows are already well covered everywhere; a one-off guest spot on a small indie
campaign is the thing no other index has.

## Without git

Open an issue using one of the forms:

- **[Add a credit](.github/ISSUE_TEMPLATE/add-credit.yml)** — someone appeared in
  something we don't list.
- **[Report a name change](.github/ISSUE_TEMPLATE/name-change.yml)** — two
  entries are the same person, or someone was billed under a name we don't have.

A maintainer transcribes it into a data file. You do not need to know YAML.

## With git

1. Edit the YAML under `data/`.
2. Run `npm run validate`.
3. Open a PR.

CI runs the same validator. If it passes locally it will pass there.

## Adding a credit

Credits live in the **person's** file, not the show's. Show cast lists are
derived from them at build time — never edit a cast list directly, it doesn't
exist as data.

```yaml
credits:
  # A main-cast credit references the season.
  - show: pirates-of-salt-bay
    season: 2
    role: GM/DM
    alias: iyengar
    year: '2020'
    source:
      url: https://example.com/episode

  # A one-off guest spot adds an episode locator. This is the case that makes
  # long-tail appearances show up on a performer's page.
  - show: wildcards-east-texas-university
    season: 1
    episode: 'S1E4: The Seekers'
    role: guest player
    character: Renee Billings
    alias: lipscomb
    year: '2019'
    source:
      url: https://example.com/episode
      needs_verification: true
```

Every id (`show`, `alias`) must resolve to something that exists, or CI fails.

### Sources

Every credit needs a `source` with at least a `url` or a `note`, plus a `tier`
saying what kind of evidence it is. Strongest first:

| `tier` | What it is |
| --- | --- |
| `official` | The production's own record — cast list, title card, announcement |
| `recording` | The episode itself, cited with a locator |
| `participant` | A statement by someone who was at the table |
| `reference` | Wikipedia, Wikidata, a published database |
| `community` | A fan wiki, forum thread, third-party post |
| `testimony` | You saw or heard it, but there's nothing to link to |
| `inferred` | Reasoned from other data rather than observed |

`tier` defaults to `reference`. CI enforces the tiers that make claims about
their own evidence: `testimony` and `participant` need `attested_by`,
`recording` needs a `locator` or `url`, and `inferred` needs its reasoning in
`note`.

**Testimony is a real source here, not a fallback.** Unlike Wikipedia, this
project admits unpublished first-hand accounts — small shows often keep no cast
list at all, and boilerplate show notes can't register a mid-season arrival. For
much of the long tail, someone who was listening is the only source that will
ever exist. See [POLICY.md](POLICY.md) for the full reasoning.

A low tier means a claim is hard to check independently, **not** that it's
doubtful. Don't apologise for a testimony credit, and don't inflate one either.

Separately, set `needs_verification: true` when nothing independent corroborates
the claim yet. That's orthogonal to tier — a first-hand account can be entirely
trustworthy and still uncorroborated.

If you've already searched for corroboration and come up empty, say where you
looked in `note` — it stops the next person repeating the work, and it
distinguishes "nobody checked" from "checked, nothing there". There's a worked
example on the Carefree High credit in `data/people/aabria-iyengar.yml`.

## Adding a person

```yaml
id: some-person            # must match the filename
canonical_name: Some Person
sort_name: Person, Some
aliases:
  - id: default
    name: Some Person      # canonical_name must appear among the aliases
    alias_type: legal
credits: []
```

To anchor them to Wikidata and pull in alternate names automatically:

```bash
npm run collect -- --search "Some Person"
npm run collect -- --qid Q12345
```

This stages a file in `data/_incoming/` — it never overwrites curated data.

## Aliases and names

Record names **as they appeared in credits**. That's the whole mechanism: each
credit points at the alias that was on screen at the time, which is what makes
early work findable under a name the performer no longer uses.

Don't speculate about anyone's personal life. If you can't source which name was
on a given credit, attribute it to the name you can verify and leave a note —
don't guess. There's a working example of exactly this ambiguity in
`data/people/aabria-iyengar.yml`.

Alias types: `birth`, `maiden`, `stage`, `handle`, `legal`.

## Episodes

Episodes are **not** entities. Reference them with a free-text locator on the
credit. Don't add per-episode files — the curation burden isn't worth it, and
the locator is enough to make a guest spot findable.

## Style

- One entity per file. Never a monolithic data file.
- Slugs: lowercase, digits, single hyphens. Filename must equal `id`.
- `edition` on a game is required — PF2e and PF1e are different search results.
