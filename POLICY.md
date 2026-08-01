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
by the page they cite. The same person filing twice, or two citations of one
wiki page, is one source wearing two hats.

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
