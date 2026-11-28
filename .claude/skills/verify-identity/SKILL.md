---
name: verify-identity
description: Check that a person's wikidata_qid and portrait belong to that person and not a namesake. Use when asked to verify, audit or double-check Wikidata IDs, photos or portraits, after an import or image fetch adds them, or when a record looks like it points at someone else.
---

A matching name proves nothing. Wrong IDs found in this project include a
cyclist, a footballer, a politician, a baseball player and a novelist, each
attached to a performer who shares the name, each bringing that stranger's
photo with it.

## 1. Gather the evidence

One person at a time. From the repository root:

```bash
python3 -I .claude/skills/verify-identity/lookup.py amelia-tyler justin-turner
```

It prints the record's shows and cited sources, the Wikidata entry, the photo's
caption and categories, and other Wikidata entries with the same name. It
writes nothing. Wikidata rate-limits; the script waits and retries, so run a
handful of people at a time.

## 2. Find out who the credited person is

Read the sources the credits cite **before** judging the Wikidata entry:
production video descriptions (YouTube Data API, key in `.env`), fan wiki cast
pages (`api.php?action=query&prop=revisions&rvprop=content&rvslots=main`),
interviews and articles. Collect identifying facts: day job, handle, employer,
other shows. If the sources only give the name, search the web.

## 3. Judge the Wikidata ID

Keep it only if a fact ties the entry to the credited person: same employer,
handle, website, profession named by a cited source, or the show itself.

| Verdict | Meaning | Recommend |
| --- | --- | --- |
| confirmed | a fact ties the two together | keep |
| wrong | the facts conflict | remove the ID and the image it supplied |
| unconfirmed | nothing ties them, nothing conflicts | remove, and say it is unproven |
| replace | wrong, and another entry is confirmed | swap in the new ID |

Check the same-name list before concluding there is no right entry. A shared
profession is not enough on its own, and neither is nationality.

A wrong ID also feeds `discover:person`, so check whether any credit cites the
namesake's Wikipedia article.

## 4. Judge the portrait

- The caption, filename or categories must name the person, **and** the context
  (event, band, channel) must fit who step 2 says they are.
- **Never identify anyone from their face or appearance.** Looking at an image
  tells you what kind of picture it is, not who is in it.
- Open every image whose title names more than one person or describes an
  action. A group shot, panel photo or picture of two people is not a portrait.
  Also reject objects, logos, artwork and historical images. View it in the
  browser; do not save the file without asking.
- A photo supplied by a wrong or unconfirmed ID goes with the ID.
- Licence rules are in `POLICY.md` ("Portraits").

## 5. Report, then edit only when told

Give a table: person, verdict, the fact that decided it, source link,
recommendation. Separate what you confirmed from what you could not, and name
any source that failed to load.

When asked to apply the changes: delete `wikidata_qid` and the `image` block
(or swap the ID), leave every credit untouched, run `npm run validate`, and
check that the diff under `data/` touches only those fields. Do not add notes
about the audit to `bio` (use a YAML `#` comment if one is needed). Mark the
work as agent-filed in the PR, per `AGENTS.md`.

The weekly job refills any person without an `image`. If the rejected photo
could come back (it is the confirmed ID's own image, or a fan wiki's), also set
`no_auto_image: true`. It stops every automatic portrait for that person; one
can still be added by hand.

`npm run audit` and `npm run validate` do not test whether an ID or photo
matches its person, so a clean run says nothing about this.
