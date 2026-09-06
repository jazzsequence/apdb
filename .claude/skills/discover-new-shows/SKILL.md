---
name: discover-new-shows
description: Sweep known and new sources (fan wikis, YouTube, Internet Archive) for actual-play shows not yet in data/shows, and report candidates for human review. Use when the user asks to check for new/recent shows, "what's new since last time", or to run a discovery pass.
---

Report-only reconnaissance. Nothing in this skill writes to `data/` — every
command below is `--discover` or `--dry-run`. Importing a candidate is a
separate, explicit step the human decides on afterward (see "Handing off" at
the end).

## 1. Orient

Check how stale the catalogue is before sweeping, so the report can say
"last touched N days ago" instead of nothing:

```bash
git log -1 --format='%ar (%ad)' --date=short -- data/shows data/channels
```

## 2. Known wikis — re-run `--discover` against each one

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

## 3. YouTube — targeted discovery

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

## 4. Internet Archive — defunct shows with no live source left

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

## 5. Report

Summarize by source, not as a raw command dump:

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
- Present the candidate list to the user and let them pick which to import
  and via which command (`collect --wiki ... --discover --apply`,
  `import:yt-shows`, `import:archive`, etc.).
