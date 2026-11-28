#!/usr/bin/env tsx
/**
 * Print the findings in one audit report that an earlier one lacks.
 *
 *   npm run audit:new -- before.md after.md
 */
import { readFile } from 'node:fs/promises';
import { findings, newFindings } from '../src/lib/audit-delta.js';

const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) {
  console.error('Usage: npm run audit:new -- <before.md> <after.md>');
  process.exit(1);
}
const [before, after] = await Promise.all([beforePath, afterPath].map((p) => readFile(p, 'utf8')));
const added = newFindings(before!, after!);

console.log(`${findings(before!).length} audit finding(s) before this import, ${findings(after!).length} after.`);
console.log(added.length ? `\n${added.length} new or changed:` : '\nNone are new.');
for (const f of added) console.log(`   ${f}`);
