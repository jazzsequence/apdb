---
name: discover-gaps
description: Find what the catalogue is missing — shows not in data/shows, and credits missing from people who are. Sweeps person-first (Wikipedia/Wikidata filmographies) and show-first (fan wikis, YouTube, Internet Archive), then reports candidates for review. Use when the user asks to check for new or recent shows, "what's new since last time", why someone's credits look thin, or to run a discovery pass. (Was: discover-new-shows.)
---

Report-only reconnaissance. Nothing in this skill writes to `data/` — every
command below is `--discover`, `--dry-run` or report-only by construction.
Importing a candidate is a separate, explicit step the human decides on
afterward (see "Handing off" at the end).

## 0. What counts as a gap

Two different kinds, and until recently this skill only looked for one:

- **A missing show** — a series with no record in `data/shows`.
- **A missing credit** — a person we have, on a show we have, with no credit
  joining them. Or, worse and much more common: a person whose credit is
  missing *because the show is missing*, which no show-first sweep can see.

**Only actual play belongs in the database.** A performer's Wikipedia article
lists voice roles, hosting, film, TV, video games and podcasts that are not
actual play; none of that is in scope, and a sweep that drags it in makes more
cleanup than it saves. The rule is enforced in code, not judgement —
`src/lib/sources/actual-play.ts` classifies each candidate from the *work's*
own article (categories first, lead text second) into `actual-play`,
`excluded` or `unclear`. Report `unclear` as its own bucket; never quietly
promote it to either of the others.

## 1. Orient

Check how stale the catalogue is before sweeping, so the report can say
"last touched N days ago" instead of nothing:

```bash
git log -1 --format='%ar (%ad)' --date=short -- data/shows data/channels
```

And check whether the robot already did this. `.github/workflows/discovery.yml`
runs the sweeps every Monday on a runner — which, unlike an agent session, has
open network access to Wikipedia, Wikidata, the fan wikis and archive.org — and
opens a PR against `reports/discovery-latest.md` when it finds something. Read
that before sweeping by hand:

```bash
git log -1 --format='%ar' -- reports/discovery-latest.md   # when it last found anything
gh pr list --head discovery/weekly --state open            # the open report, if any
```

Running the passes by hand is for an off-schedule question ("what are we missing
for this one person?") or for sources the job does not cover. If the session has
no network egress — Wikipedia and the wikis are commonly blocked — say so rather
than reporting an empty sweep as a clean one, and read the last automated report
instead.

## 2. Person-first — run this before the show-first passes

The pass with the highest yield, and the one the other four are structurally
incapable of: every other adapter in this repo starts from a show already in
`data/shows` and reads its cast down, so **a show nobody has catalogued
contributes nothing to anybody's filmography, however well documented it is
elsewhere**. That blind spot is worst for the people with the most credits,
because a long list looks complete.

It is not hypothetical. Aabria Iyengar had 42 credits here, a stored
`wikidata_qid`, a stored Wikipedia link, and four whole series missing — NY by
Night, KOllOK 1991, Into the Mother Lands, Private Nightmares — every one of
them named in the article this repo already linked to and never read. A
show-first sweep run the night before found none of them, and could not have.

```bash
npm run discover:person -- --person aabria-iyengar     # one person
npm run discover:person -- --limit 25                  # the queue, 25 at a time
npm run discover:person -- --all --json out/sweep.json # everything, machine-readable
```

What it does: resolves each person's enwiki article (from `links.wikipedia`,
falling back to the QID's sitelink), reads the filmography tables **and the
prose** — Kollok is prose-only on Aabria's article, so a table-only parse
misses it — adds Wikidata's own works claims (P800 "notable work", plus a
reverse P161/P725 lookup), classifies every candidate against the actual-play
gate, and diffs the survivors against both `data/shows` and that person's
existing credits.

Output buckets, and what to do with each:

- **`NO SHOW RECORD` + `actual-play`** — the real find. A series nothing here
  knows about. Everyone else in its cast is missing it too, so treat one hit
  as a show record plus a full cast to source, not a single credit.
- **`have show ..., no credit`** — we hold the show and missed the person.
  Cheapest fix in the report.
- **`unclear`** — read the evidence line and decide. Usually a work with no
  Wikipedia article, or a tabletop-adjacent thing that isn't a play.
- **`excluded`** — counted, not listed. Voice roles, film, TV. Leave them out.

Coverage caveat, and it is a big one: only ~126 of ~950 people carry a QID and
**three** carry a stored `links.wikipedia`, so most of the index is unreachable
by this pass. The script prints that count. Widening it — `npm run collect --
--search "<name>"` to attach QIDs, then `--refresh` to backfill the Wikipedia
links the collector already knows how to write — is itself a gap worth
reporting.

Offline check on the parser, when the network is unavailable or you are
changing the parse:

```bash
npm run discover:person -- --fixture path/to/article.wikitext
```

## 3. Known wikis — re-run `--discover` against each one

**`--dry-run` does NOT dedupe against the existing catalogue.** In
`scripts/collect.ts`, the `--dry-run` branch of `discoverShows()` prints
every page and `return`s *before* reaching the `known.has(id)` check further
down — that check only runs on the write path (plain or `--seasons-of`).
Plain `--dry-run` output is every campaign page the wiki has, full stop, not
a diff. (An earlier version of this skill claimed otherwise — don't trust
`(already have ...)` / `(already a season)` annotations from a bare
`--dry-run` run; those markers only appear once you're on the write path.)

```bash
for host in \
  acquisitionsincorporated.fandom.com arcanearcade.fandom.com avantris.fandom.com \
  criticalrole.fandom.com dicecameraaction.fandom.com dimension20.fandom.com \
  dorktales.fandom.com dungeonsanddads.fandom.com foreververse.fandom.com \
  geekandsundry.fandom.com glasscannonnetwork.fandom.com high-rollers-dnd.fandom.com \
  highrollers.fandom.com intothedarkness.fandom.com magirpg.fandom.com mcdm.fandom.com \
  notanotherdndpodcast.fandom.com savingthrowshow.fandom.com shield-of-tomorrow.fandom.com \
  stexpanded.fandom.com tablestory.fandom.com the-glass-cannon-network.fandom.com \
  theadventurezone.fandom.com vampire-the-masquerade-la-by-night.fandom.com \
  vldl.fandom.com worldsbeyondnumber.fandom.com; do
  echo "=== $host ==="
  npm run collect -- --wiki "$host" --discover --dry-run
done
```

Some of these hosts will error with "no campaign pages found... may use a
template name this adapter doesn't know" — that's a `CAMPAIGN_TEMPLATES` gap
in `src/lib/sources/mediawiki.ts`, not evidence the wiki has nothing. Note
which hosts fail this way; don't read it as "zero candidates."

You have to do the diffing yourself:

- Pull every existing show **title** (not just id) and every existing
  **season title** — a wiki's "campaign" is very often a season of a show
  already in the catalogue (Dimension 20's 30-odd campaigns are one show),
  and id-slug matching alone misses that:

  ```bash
  grep -h '^title:\|^  title:\|^    title:' data/shows/*.yml | sed 's/^\s*title:\s*//' | tr -d '"' | sort -u
  ```

- Compare each printed page title against that list (case/punctuation loose
  — a wiki writes "&" where a curator wrote "and"). Anything with no
  reasonable match is a real candidate; anything that matches a season title
  is fillable via `--seasons-of <show-id>`, not a new show.

Regenerate the host list itself first if it's been a while — grep for it
instead of trusting a stale copy:

```bash
grep -rhoE 'https?://[a-z0-9.-]+\.(fandom|miraheze)\.(com|org)' data/shows/*.yml data/people/*.yml \
  | sed -E 's#https?://([^/]+).*#\1#' | sort -u
```

## 4. YouTube — targeted discovery

Needs `YOUTUBE_API_KEY` (check `.env`; export it into the shell if the
scripts don't pick it up automatically — they read `process.env` directly,
there's no dotenv loading here):

```bash
npm run discover:youtube
```

This searches a fixed set of queries (D&D, Call of Cthulhu, Pathfinder,
generic ttrpg, Blades in the Dark, Daggerheart) and, unlike the wiki pass,
does **not** dedupe against the existing dataset — it just reports what
YouTube's search API returns. Before treating a hit as new, check it isn't
already covered:

```bash
grep -il "<channel title>" data/channels/*.yml data/shows/*.yml
```

If quota allows and it's been a genuinely long gap since the last sweep, the
broader net costs more but covers more systems/formats:

```bash
npm run sweep:youtube -- --dry-run
```

(~30 searches, about a third of the 10k/day quota — don't run both this and
`discover:youtube` back to back without checking remaining quota.)

## 5. Internet Archive — defunct shows with no live source left

```bash
npm run import:archive -- --dry-run
```

Same caveat as the wiki pass: **`--dry-run` doesn't dedupe either.** In
`scripts/import-archive.ts`, the `has('dry-run')` branch logs and
`continue`s before the later `if (existingShows.has(showId)) continue;`
check, so every series above `--min-episodes` prints regardless of whether
it's already in `data/shows/`. Diff the printed titles against
`data/shows/*.yml` yourself (slugify the printed title and check for a
matching filename, or match on title text — the archive importer slugifies
with the same scheme `collect.ts` does). Series without a recognizable
system tag are skipped by the script itself and won't print at all; that's
a separate, silent gap worth noting in the report, not zero results.

This is the only source here for shows whose sites/feeds are already gone,
so it's worth including even though it moves slower than the others.

## 6. Report

Summarize by source, not as a raw command dump:

- **Person-first hits** — person, work, whether the show record exists at all,
  the classifier's verdict and its reason. Say how many people the pass could
  not reach for want of a QID or a Wikipedia link.
- **New wiki pages** — host, page title, episode/season count if visible.
- **New YouTube channels/playlists** — channel title, playlist title, episode
  count, whether a cast was readable from descriptions (`discover:youtube`
  prints this).
- **New archive.org series** — title, episode count.

Flag anything ambiguous (e.g. a playlist that might be a season of an
existing show rather than a new show — `collect --discover` usually catches
this via `seasons_of`, but a manual look is worth it for close calls).

## Handing off

Per `AGENTS.md`, discovery output is a list to review, not something to
import unattended:

- Don't run any of these with `--apply`/without `--dry-run` as part of this
  skill. That's a separate, deliberate step per candidate.
- Don't bulk-generate cast credits from a model's general knowledge of a
  show just because it was found here — importing still means reading an
  actual source per credit.
- Non-actual-play candidates are not a judgement call to re-litigate per item.
  Film, TV, voice and video game credits stay out.
- Present the candidate list to the user and let them pick which to import
  and via which command (`collect --wiki ... --discover --apply`,
  `import:yt-shows`, `import:archive`, etc.).
