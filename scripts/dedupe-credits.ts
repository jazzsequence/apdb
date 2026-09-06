#!/usr/bin/env tsx
/**
 * Fold credits that describe one appearance into a single record.
 *
 * Different sources describe the same appearance at different granularity and
 * with different labels — series-level or per-season, "player" or "guest
 * player", a character named or omitted. Stored separately they look like
 * several appearances and each stays single-source. Folded, the person's page
 * is correct and the sources corroborate one another.
 *
 *   npm run dedupe -- --dry-run
 *   npm run dedupe -- --check     # exit 1 if anything would fold
 *
 * `--check` is the CI form. Duplicates do not arrive by hand — they arrive
 * whenever an importer runs and this does not, which is how CelebriD&D ended
 * up with fourteen people credited twice for one appearance and nobody
 * noticed for months. A gate that fails the moment an unfolded pair lands is
 * the difference between that and a one-line fix at review time.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { DATA_ROOT } from '../src/lib/load.js';
import { upsertCredit } from '../src/lib/credits.js';

const CHECK = process.argv.includes('--check');
const DRY = process.argv.includes('--dry-run') || CHECK;
let before = 0, after = 0, files = 0;

for (const f of (await readdir(join(DATA_ROOT, 'people'))).filter((x) => x.endsWith('.yml'))) {
  const path = join(DATA_ROOT, 'people', f);
  const p = parse(await readFile(path, 'utf8'));
  const original: any[] = p.credits ?? [];
  before += original.length;

  // Rebuild the list through the same merge rule the importers use. Most
  // specific first, so a series-level record folds into a season-level one
  // rather than the other way round.
  const ordered = [...original].sort((a, b) => {
    const rank = (c: any) => (c.episode ? 0 : c.season !== undefined ? 1 : 2);
    return rank(a) - rank(b);
  });
  let acc: any[] = [];
  for (const c of ordered) acc = upsertCredit(acc, c).credits;

  after += acc.length;
  if (acc.length !== original.length) {
    files++;
    if (!DRY) { p.credits = acc; await writeFile(path, stringify(p), 'utf8'); }
  }
}
console.log(`${before} credits → ${after} (${before - after} folded) across ${files} people.${DRY ? ' Dry run.' : ''}`);

if (CHECK && before !== after) {
  console.error(
    `\n✗ ${before - after} credit(s) across ${files} people describe an appearance ` +
      `already recorded by another credit.\n` +
      `  Run \`npm run dedupe\` and commit the result.\n` +
      `  Left alone these render as separate appearances, and each stays ` +
      `single-source while the pair cites the same evidence twice.\n`,
  );
  process.exit(1);
}
