# For AI agents

This file is for you, specifically — an LLM or an agent built on one, reading
this on your own initiative or because a human pointed you at the repo. Not a
human reading about agents. If you're a human, [CONTRIBUTING.md](CONTRIBUTING.md)
is the one you want; everything below assumes you've already read it, and
covers only what's different about you filing something.

## The one rule that matters more than the others

**You are not a witness.** Every credit in this database carries a `sources`
list with a `tier`, ranked by how close the source was to the thing
happening: `official` → `recording` → `participant` → `firsthand` →
`reference` → `community` (see [POLICY.md](POLICY.md) for the full
reasoning). The first three tiers are claims about direct observation — the
production's own record, the episode itself, someone who was at the table.
The fourth, `firsthand`, is a person who watched or listened and is
vouching for it personally.

You didn't watch anything. You read a page. That makes you, structurally, a
`reference` or `community` source — never higher — no matter how confident
the page you read sounded. Specifically:

- **Never write `tier: official`, `tier: recording`, `tier: participant` or
  `tier: firsthand` on a source you are adding.** Those tiers assert a kind
  of proximity you don't have. If the page you read is itself the
  production's own site, the credit is still `official` in the sense of
  *what it's citing*, and that's fine — tier the source by what it is (the
  production's own cast list), not by promoting your own epistemic position.
- **`attested_by` is for a named person who was there.** Don't put your own
  name or model name in it, and don't leave it implying a human witness
  when the actual chain is "I read a wiki page."
- If a credit already exists as `single-source` and you found a *second*
  independent citation for it, adding that source is exactly the kind of
  contribution this project wants — go ahead. Corroboration only works if
  the second source is genuinely independent (a different page, a
  different author), not the same claim reworded.

This isn't a formality. The entire sourcing model exists to keep a gap
between "documented" and "confidently stated," and an agent that skips it —
even with good intentions, even when it's *right* — reintroduces exactly the
failure mode the tier system was built to catch. A hallucinated season, a
misremembered role, a plausible-sounding character name: all of these read
identically to a real credit once the tier label is gone.

## What you can do

- **File a correction or addition the same way a git-literate human would**:
  edit the YAML under `data/`, run `npm run validate`, open a PR. See
  [CONTRIBUTING.md](CONTRIBUTING.md) for the field-by-field mechanics —
  it's written for exactly this.
- **Say where you looked.** CONTRIBUTING already asks humans for this; for
  you it's not optional. A `note` on the source should name the page or
  document you read, not just carry a bare URL.
- **Leave a field out rather than infer it.** `alias`, `character`, `year` —
  all optional for a reason. An agent asked to "fill in the missing fields"
  is under more pressure to guess than a human doing the same task, because
  guessing is cheap for you and the guess will *sound* plausible either way.
  Don't. `alias` omitted renders as "billing unknown," which is correct;
  a wrong guess renders as fact, which isn't.
- **Don't invent URLs.** If you can't confirm a link actually resolves —
  because you don't have live fetch access in this context, say — don't
  cite it as if you checked. Say what you know and flag what you don't
  instead of constructing a plausible-looking source list.
- **Mark your own work as agent-filed.** Say so in the PR or issue body —
  something as plain as "filed by an AI agent" is enough. This project
  already tracks who's vouching for what down to the individual source;
  don't be the one uncredited exception.
- **Fetch data from `/api/*.json` or `/llms.txt` rather than scraping HTML.**
  Same underlying records, no markup to misparse. `/api/index.json` is the
  entry point.

## What not to do

- Don't bulk-generate credits from a model's general knowledge of a show's
  cast. If you weren't reading a specific, citable page for a specific
  credit, you don't have a credit — you have a guess, and this project has
  no tier for those on purpose (see POLICY.md's reasoning against an
  `inferred` tier).
- Don't resolve a `needs_verification`-shaped question (there isn't a field
  called that, deliberately — corroboration is derived from independent
  sources, not asserted) by adding a second source that traces back to the
  same origin as the first.
- Don't touch git history, force-push, or bypass the validator. A PR goes
  through `npm run validate` and CI like any other; that gate exists so a
  bad reference can't reach the published site, and it applies to you too.
