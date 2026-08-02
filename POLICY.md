# Sourcing policy

This project's sourcing model is adapted from Wikipedia's, with one deliberate
and load-bearing divergence.

## The divergence: original research is admissible

Wikipedia's [No Original Research](https://en.wikipedia.org/wiki/Wikipedia:No_original_research)
rule makes unpublished first-hand accounts inadmissible. Its companion principle
is "verifiability, not truth": a claim belongs because a reader can check it
against a published source, not because it is correct.

That rule is sound for a subject area where published sources reliably exist.
For the actual-play long tail they frequently do not:

- Small shows keep no cast list at all.
- Where show notes exist they are often boilerplate, repeated verbatim on every
  episode — structurally incapable of recording a mid-season cast change.
- Fan wikis cover the shows with large fandoms, which are the shows already
  well indexed everywhere else.
- Performers change names, and nobody publishes the mapping.

Applying No Original Research here would systematically delete exactly the data
no other index has, which is the whole reason this project exists. A worked
example lives in `data/people/aabria-iyengar.yml`: a mid-season arrival on an
indie Monsterhearts campaign, absent from the show's own cast page, its
per-episode notes, its character-roster thread and every search — attested by a
contributor who was listening at the time.

**So: unpublished first-hand accounts are admissible here.** They are always
labelled, always ranked, and never disguised as something stronger.

What we keep from Wikipedia is the discipline, not the gatekeeping: every claim
carries its provenance, the strength of that provenance is visible on the page,
and nothing is asserted flatly when it is actually contested.

## What counts as an actual play

A show is in scope when **people play a roleplaying game and the play itself is
the programme**. Format does not matter: podcast, stream, edited video and live
show are all equally admissible, as are one-shots, con games and arcs of three
episodes.

Companion programming is **out of scope**, however closely tied to a show that
is in scope:

- post-show discussion and recap shows
- interview and talk shows, including ones hosted by the cast
- news, review and reaction programming
- behind-the-scenes and making-of material

The test is whether a game is being played, not whether the same people are on
camera. `RealmSmith's Aftermath` was removed under this rule: same channel, same
cast, same campaign discussed at length — but nobody rolls anything.

The consequence is that some real appearances will have no credit here. Chris
Perkins and Jeremy Crawford have both appeared on Critical Role's Fireside Chat;
only Perkins has Critical Role credits, because only Perkins sat at the table.

## Two jobs a source can do, and which sources may do which

**Discovery** — establishing that a show exists and belongs in this index.
**Cast-filling** — listing who was in a show already known to belong here.

They are not interchangeable, and the general film and TV catalogues may only
do the second.

IMDb, TMDB and TheTVDB index everything ever released. A title match inside one
of them therefore carries almost no evidence that the thing found is an actual
play: matching on title alone paired our "Legacy" with a 1902 title carrying
1,902 credits, and "Guardians of the Galaxy" with the Marvel series. 193
separate IMDb titles are called "Legacy"; 45 are called "Masks".

So shows are discovered from sources that only cover this medium — channels,
podcast feeds, actual play wikis, the productions' own sites — and the
catalogues are then used to fill in and corroborate the casts of shows already
present. Every catalogue importer additionally requires that the entry either
overlap the cast already recorded, or name at least two people who appear
somewhere in this database.

## Source tiers

Every credit's source declares a tier. The ladder ranks by **proximity** — how
close the source was to the thing actually happening:

| Tier | What it is |
| --- | --- |
| `official` | The production's own record — cast list, title card, official announcement |
| `recording` | The episode itself, cited with a locator someone else can go to |
| `participant` | A statement by someone who was at the table |
| `firsthand` | A named contributor who watched or listened to it themselves |
| `reference` | An established reference work: Wikipedia, Wikidata, a published database |
| `community` | A fan wiki, forum thread, or third-party social post |

### Why firsthand outranks published sources

Because it is closer to the fact. Someone who watched the episode is observing
the primary record directly. A reference work is summarising it at a distance,
and summaries of small shows are routinely thin, stale or simply absent.

This is not hypothetical. Wikipedia's filmography table lists Aabria Iyengar as
a *player* on Pirates of Salt Bay; she ran it. That is an error no one who
watched the show would have made, and under a ladder that ranked published
sources above direct observation, the wrong answer would have outranked the
right one.

An earlier version of this policy ranked firsthand accounts second from bottom,
below fan wikis. That was a mistake: it conflated *proximity* with
*citability*, and the effect was to rank a contributor who watched the episode
below a stranger's summary of it. Those are separate axes and this project
tracks them separately — see below.

**A tier is a statement about proximity, never about truth.** Tiers render as
neutral labels rather than a warning scale.

### Inference is not a status either

There is deliberately no `inferred` tier. An earlier version of this policy had
one, and it was a category error.

Nobody submits a credit without having seen something. Streams are watched;
episodes are listened to. If a contributor files an appearance, they observed it
somewhere — otherwise there would be nothing to file. So inference never
explains how a credit came to *exist*, and a tier is exactly a claim about how
the credit came to exist.

A briefly-lived second version recorded inference per *field*, on the theory
that a credit makes several claims with different provenance. That was also
wrong, for a simpler reason: **if you inferred something from something, you got
it from a source, and that source is the account.**

Only two cases exist:

1. **The value follows from sources.** Then cite the sources. It isn't inferred,
   it's sourced, and a special status only obscures that.
2. **The value doesn't follow.** Then it isn't knowledge, and it should not be a
   value at all.

The project's own data was case 2. An earlier revision recorded Aabria Iyengar's
2019 Saving Throw credits under the Lipscomb name, reasoned from the date. But
"born Lipscomb" plus "the show ran in 2019" does not entail "the title card said
Lipscomb" — no source establishes when her on-screen credit changed, and the
wiki documenting the show calls her Iyengar. That was a guess.

It happened because `alias` used to be a **required** field. A mandatory field
does not produce knowledge when knowledge is absent; it produces invention. So
`alias` is now optional, and those attributions are gone. Credits where nobody
established the billing render as *billed name not established*, which is the
true state.

If a field is unknown, leave it out. That is what the gap is for.

### What CI enforces

Tiers that make claims about their own evidence have to back them:

- `firsthand` and `participant` must name who attested it (`attested_by`).
- `recording` must carry a `locator` or `url`. `recording` and `firsthand` are
  the same observation — the locator is the only difference. Without one, use
  `firsthand`: it claims exactly as much proximity, just no citation.
- every credit must carry at least one source.

## The second axis: corroboration

Tier says how *close* a source was to the fact. Corroboration says how many
independent sources agree. Proximity and confirmation are different properties —
a source can be excellent on one and alone on the other, someone who watched the
stream being the obvious case.

**Corroboration is derived, never asserted.** Every credit carries a *list* of
sources, and the status falls out of it:

- `corroborated` — two or more independent sources agree
- `single-source` — one so far

Independence is checked, not assumed: sources are keyed by who attested them, or
by the **site** they cite — the host, not the page. Two articles on one fan wiki
are that wiki checking its own work, and the same person filing twice is one
source wearing two hats.

Keying on the page rather than the site was the original implementation, and it
was too weak in a way that only showed up when the numbers were checked: fourteen
credits cited the Critical Role wiki's Mighty Nein page under both its title and
its redirect, and all fourteen computed as corroborated. Correcting it took the
corroborated count from 21 to 8 — the smaller number being the true one. CI now
rejects a credit that cites the same url twice.

Host-level keying is still not a complete test of independence. A production's
own site and its own YouTube channel are different hosts and one publisher, and
fan wikis copy each other. Treat the corroborated count as a floor.

This is the mechanism that lets the community actually verify things. A second
listener who watched the same stream and files their own firsthand account moves
a credit from single-source to corroborated — **with no publisher involved
anywhere**. That is the point of admitting testimony at all: not merely to store
otherwise-unrecordable claims, but to let them accumulate confirmation on their
own terms.

An earlier version had a hand-set `needs_verification` flag instead. That was
backwards: it made corroboration a property of a source, asserted by whoever
filed first, when corroboration is by definition something that happens *between*
sources.

Note that agreement is not correctness. Wikipedia and the Saving Throw wiki
disagree about whether Aabria played or GMed Pirates of Salt Bay; that
disagreement is recorded in the source notes rather than silently resolved.

## Practical rules

1. **Never upgrade a tier you cannot support.** If you did not check the
   recording, it is not `recording`.
2. **Record failed searches.** If you looked for corroboration and found none,
   say where you looked in `note`. It stops the next contributor repeating the
   work, and it distinguishes "nobody has checked" from "checked, nothing there".
3. **Attribute names as they were credited, or not at all.** Where a source
   establishes an appearance but not which name was on screen, leave `alias`
   out. Note that reference works and wikis apply current names retroactively,
   so their naming is evidence of the source's convention, not of the billing.
4. **Conflicts get recorded, not resolved by fiat.** Where sources disagree,
   take the better-sourced value and write the disagreement into the note.
5. **Don't speculate about anyone's personal life.** Names are recorded as they
   appeared in credits, and for no other purpose.


## Images

Two different things, kept separate on purpose.

### Portraits — freely licensed where possible, fair use where not

Free-licence sources cover about a fifth of the people here and essentially
none of the indie long tail this project exists for. Skid Maher has 42 credits
and no Wikidata entry; neither do most of the Glass Cannon, Avantris or Saving
Throw casts. Leaving them blank made the index look emptier than it is and
answered a question nobody asked — whether a photo is *conveniently* licensed
is not what a reader wants to know.

So portraits are taken in this order:

1. **Wikidata and Wikimedia Commons**, under a licence that genuinely permits
   reuse. A stated licence is stronger provenance than a claim, so this is
   always tried first.
2. **Openverse**, same test.
3. **The fan wiki that person's own credits already cite**, under the same
   fair-use claim this policy already makes for show art, and under the same
   constraints: thumbnail scale, one image per person, attributed, linked back,
   used solely to identify the subject, removed on request.

A person is only ever looked up on a wiki their own credits cite, so a name is
never resolved against a wiki with nothing to do with them. A one-word name is
only looked up when every credit points at a single wiki — otherwise "Mikey"
would match on any wiki that happens to have a page by that name.

Where no image exists, the page says so and invites one, with the licence
question asked up front. That is deliberate: an unlicensed image someone
uploads in good faith is a liability, and asking afterwards never works.

### Portraits — the free-licence sources

Photographs of people come from **Wikimedia Commons**, which publishes a
machine-readable licence per file. Only licences that actually permit reuse are
accepted, and each image records its photographer and source. Anything whose
licence string isn't recognised is skipped, because unrecognised means unknown
terms.

Fan wikis are *not* used for portraits. Their text is CC-BY-SA; their uploaded
images are not, and a wiki cannot sublicense what it doesn't own.

### Where a licence is stated, it is recorded as itself

Some sources publish an explicit licence with the image — Internet Archive
uploaders in particular. Those are recorded as what they are rather than
flattened into a fair-use claim, because a stated licence is stronger
provenance than a claim, and because the obligations only survive if they are
written down.

Two of those obligations bind this project:

- **NC (non-commercial).** An image under a `-NC` licence obliges the index to
  stay non-commercial. If that ever changes, those images have to go.
- **ND (no derivatives).** An `-ND` image is displayed at the source's own
  dimensions rather than re-cropped.

### Show key art — used under a claim of fair use

Campaign and show artwork is the production's copyright. No wiki can license it
to us, however prominently it displays it — a fan wiki's fair-use rationale
covers that wiki's use, not ours.

**This project makes its own fair-use claim for show key art**, deliberately and
as a matter of policy. The claim is narrow, and how these images are stored and
displayed is chosen to keep it that way:

- **Thumbnail resolution only.** Images are requested at ~400px and displayed at
  200px. A low-resolution copy used for identification is a materially different
  use from redistributing the artwork.
- **Identification, never decoration.** One image per show, next to that show's
  title. No galleries, no hero banners, no use of artwork to illustrate anything
  other than the work it depicts.
- **Always attributed, always linked back** to the page it came from.
- **No substitution.** A thumbnail in a credits index does not compete with the
  original or reduce its market value; if anything it points people at the show.
- **Non-commercial.** This is a free, community-run index.
- **A rationale is recorded per image**, and CI rejects a `fair use` image that
  doesn't state one. The claim is per-use, not blanket.

Fair use is a claim, not a licence, and reasonable people can disagree about any
particular instance. **Rights holders: open an issue titled `[takedown]` naming
the image, and it will be removed — no argument, no delay.** Removal is a
one-line edit to the show's data file.

If you would rather not carry this risk, delete the `image` block from the show
files and the `fair use` value from `ImageLicence`; nothing else depends on it.
