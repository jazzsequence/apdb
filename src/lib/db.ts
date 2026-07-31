/**
 * Single entry point for pages: loads, validates and joins once per build.
 *
 * The build refuses to produce a site from invalid data — the same gate CI
 * runs, so a broken reference can never reach a rendered page.
 */
import { Db } from './derive.js';
import { checkIntegrity } from './integrity.js';
import { loadDataset } from './load.js';

let cached: Db | undefined;

export async function getDb(): Promise<Db> {
  if (cached) return cached;

  const { dataset, problems } = await loadDataset();
  const all = [...problems, ...(problems.length === 0 ? checkIntegrity(dataset) : [])];

  if (all.length > 0) {
    const detail = all.map((p) => `  ${p.file}${p.path ? ` (${p.path})` : ''}: ${p.message}`);
    throw new Error(
      `Refusing to build from invalid data — ${all.length} problem(s):\n${detail.join('\n')}\n\nRun \`npm run validate\` for the full report.`,
    );
  }

  cached = new Db(dataset);
  return cached;
}

export type { Db };
