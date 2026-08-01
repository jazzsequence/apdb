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

### Inference is not a source

There is deliberately no `inferred` tier. An earlier version of this policy had
one, and it was a category error.

Nobody submits a credit without having seen something. Streams are watched;
episodes are listened to. If a contributor files an appearance, they observed it
somewhere — otherwise there would be nothing to file. So inference never
explains how a credit came to *exist*, and a tier is exactly a claim about how
the credit came to exist.

What inference actually describes is a **field**. A credit is not one claim:

> *Aabria GMed Pirates of Salt Bay season 1* — from a wiki someone read.
> *She was billed as Lipscomb at the time* — derived from the date.

Those have different provenance. One tier on the credit shows only the stronger
of the two and quietly launders the weaker one under it.

So derived values are recorded per field, in `inferred_fields`, each with its
reasoning:

```yaml
- show: pirates-of-salt-bay
  season: 1
  role: GM/DM
  alias: lipscomb
  inferred_fields:
    alias: >-
      Derived from the 2019 date against the Lipscomb alias's active_to of
      2020 — not from a seen title card.
  source:
    tier: community
    url: https://savingthrowshow.fandom.com/wiki/Pirates_of_Salt_Bay
```

The source stays `community` — a real person read a real wiki. The alias carries
its own mark, and renders next to the name rather than at the credit level, so a
reasoned-out name cannot inherit the credibility of the citation beside it.

CI rejects marking a field inferred that the credit does not actually have.

### What CI enforces

Tiers that make claims about their own evidence have to back them:

- `firsthand` and `participant` must name who attested it (`attested_by`).
- `recording` must carry a `locator` or `url`. `recording` and `firsthand` are
  the same observation — the locator is the only difference. Without one, use
  `firsthand`: it claims exactly as much proximity, just no citation.
- any entry in `inferred_fields` must name a field the credit actually has, and
  must show its reasoning. Inference is reasoning, not evidence, so it has to
  show its working.

## The second axis: corroboration

`needs_verification` is orthogonal to tier. Tier says how *close* the source was
to the fact; the flag says whether anything independent has confirmed this
particular claim. Proximity and citability are different properties, and the
whole point of separating them is that a source can be excellent on one and poor
on the other — someone who watched the stream being the obvious case.

The two genuinely come apart. A first-hand account can be completely trustworthy
and still uncorroborated. A reference-work citation can be corroborated and
still wrong — Wikipedia and the Saving Throw wiki disagree about whether Aabria
played or GMed Pirates of Salt Bay, and that disagreement is recorded rather
than silently resolved.

Collapsing the two axes would file a contributor who was in the room alongside a
guess made from a date. They are not the same thing.

## Practical rules

1. **Never upgrade a tier you cannot support.** If you did not check the
   recording, it is not `recording`.
2. **Record failed searches.** If you looked for corroboration and found none,
   say where you looked in `note`. It stops the next contributor repeating the
   work, and it distinguishes "nobody has checked" from "checked, nothing there".
3. **Attribute names as they were credited.** Where a source establishes an
   appearance but not which name was on screen, say so — don't let an inference
   inherit the strength of the citation it sits next to.
4. **Conflicts get recorded, not resolved by fiat.** Where sources disagree,
   take the better-sourced value and write the disagreement into the note.
5. **Don't speculate about anyone's personal life.** Names are recorded as they
   appeared in credits, and for no other purpose.
