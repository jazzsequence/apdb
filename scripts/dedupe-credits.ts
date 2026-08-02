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
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { DATA_ROOT } from '../src/lib/load.js';
import { upsertCredit } from '../src/lib/credits.js';

const DRY = process.argv.includes('--dry-run');
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
