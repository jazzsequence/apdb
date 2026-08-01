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
3. **If you imported anything in bulk, run `npm run audit` and read it.**
4. Open a PR.

### Always spot-check an import

Every data error this project has shipped came from trusting a bulk import
and moving on — characters filed as performers, wiki markup as names, a
campaign's whole cast silently lost, a game system invented for 67 shows at
once. None of it was subtle. All of it was invisible because nobody looked at
the output.

`npm run audit` looks. It flags characters that look like people, "characters"
that are actually another performer's name, seasons that came back empty or
with a single credit, seasons with players but no GM, and shows that may have
been defaulted to D&D 5e. It is heuristic — it raises things for a human
glance, and exits non-zero on the high-severity ones, which are import bugs
rather than curation gaps.

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
    sources:
      - tier: community
        url: https://example.com/episode

  # A one-off guest spot adds an episode locator. This is the case that makes
  # long-tail appearances show up on a performer's page.
  - show: wildcards-east-texas-university
    season: 1
    episode: 'S1E4: The Seekers'
    role: guest player
    character: Renee Billings
    year: '2019'   # `alias` omitted — nobody established the billed name
    sources:
      - tier: firsthand
        attested_by: Your name or handle
        note: Watched the episode.
```

Every id (`show`, and `alias` if you give one) must resolve to something that
exists, or CI fails.

### Sources

Every credit needs a `sources` list. Each source needs at least a `url` or a
`note`, plus a `tier` saying what kind of evidence it is. Strongest first:

| `tier` | What it is |
| --- | --- |
| `official` | The production's own record — cast list, title card, announcement |
| `recording` | The episode itself, cited with a locator |
| `participant` | A statement by someone who was at the table |
| `firsthand` | You watched or listened to it yourself, but there's nothing to link to |
| `reference` | Wikipedia, Wikidata, a published database |
| `community` | A fan wiki, forum thread, third-party post |

`tier` defaults to `reference`. CI enforces the tiers that make claims about
their own evidence: `firsthand` and `participant` need `attested_by`, and
`recording` needs a `locator` or `url`.

There is no `inferred` tier — you saw *something*, or you wouldn't be filing the
credit.

**If you saw it, say `firsthand` — and note that it outranks Wikipedia here.**
The ladder ranks by how close the source was to the thing happening, and someone
who watched the episode is closer to it than any summary. Wikipedia currently
has Aabria Iyengar down as a player on Pirates of Salt Bay when she ran it;
anyone who watched would have got that right.

Unlike Wikipedia, this project admits unpublished firsthand accounts at all —
small shows often keep no cast list, and boilerplate show notes can't register a
mid-season arrival. See [POLICY.md](POLICY.md) for the reasoning.

So: don't apologise for a firsthand credit, and don't inflate one either. If you
can give a timestamp, it's `recording`; if you can't, `firsthand` claims the
same proximity without pretending to a citation.

If you've already searched for corroboration and come up empty, say where you
looked in `note` — it stops the next person repeating the work, and it
distinguishes "nobody checked" from "checked, nothing there". There's a worked
example on the Carefree High credit in `data/people/aabria-iyengar.yml`.

### Corroborating something already listed

**You don't need a new credit to be useful.** If a credit shows *single source*
and you also watched that episode, add your own account to its `sources` list.
Two independent sources make it `corroborated`:

```yaml
    sources:
      - tier: firsthand
        attested_by: Original contributor
        note: Watched the stream live.
      - tier: firsthand
        attested_by: You
        note: Also watched it; confirming the same appearance.
```

The status is computed, never typed in. Independence is checked by who attested
a source or which page it cites, so one person filing twice doesn't count.

This is how verification works here — no publisher required.

### Don't guess to fill a field

If you know someone appeared but not which name was on the billing, **leave
`alias` out**. It is optional precisely so you don't have to invent one, and the
page will say "billed name not established" — which is honest and correct.

Be especially wary of reasoning a name from a date. Wikis and reference works
rename people retroactively, so their naming tells you the source's convention,
not what the title card said. An earlier version of this database got that
wrong, in a field that used to be mandatory.

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
