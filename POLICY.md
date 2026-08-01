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

Every credit's source declares a tier. Strongest first:

| Tier | What it is |
| --- | --- |
| `official` | The production's own record — cast list, title card, official announcement |
| `recording` | The episode itself, cited with a locator someone else can go to |
| `participant` | A statement by someone who was at the table |
| `reference` | An established reference work: Wikipedia, Wikidata, a published database |
| `community` | A fan wiki, forum thread, or third-party social post |
| `testimony` | A named contributor who saw or heard it, with no citable locator |
| `inferred` | Reasoned from other data rather than observed |

**A tier is a statement about checkability, never about truth.** A first-hand
account from someone who was in the room may well be more accurate than a fan
wiki. It ranks lower because a stranger cannot independently confirm it, and the
interface should not pretend otherwise in either direction. Tiers are therefore
rendered as neutral labels, not as a warning scale.

CI enforces the tiers that make claims about their own evidence:

- `testimony` and `participant` must name who attested it (`attested_by`).
- `recording` must carry a `locator` or `url` — the point of the tier is that
  someone else can go and check. Without one it is testimony wearing a better
  hat.
- `inferred` must show its reasoning in `note`. Inference is reasoning, not
  evidence.

## The second axis: corroboration

`needs_verification` is orthogonal to tier. Tier says how strong this *class* of
source is; the flag says whether anything independent has confirmed this
particular claim.

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
