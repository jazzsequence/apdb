#!/usr/bin/env tsx
/**
 * The merge gate.
 *
 * Flat files give you no referential integrity for free. This script is the
 * replacement for every constraint a database would have enforced, and it runs
 * on every pull request. Exit code 1 blocks the merge.
 *
 *   npm run validate
 *   npm run validate -- --strict   # treat duplicate-person warnings as errors
 */
import { checkIntegrity, findPossibleDuplicatePeople } from '../src/lib/integrity.js';
import { bestTier, corroboration } from '../src/lib/derive.js';
import { loadDataset, type Problem } from '../src/lib/load.js';
import { SOURCE_TIERS } from '../src/lib/schema.js';

const strict = process.argv.includes('--strict');

function report(problems: Problem[]): void {
  const byFile = new Map<string, Problem[]>();
  for (const problem of problems) {
    const bucket = byFile.get(problem.file) ?? [];
    bucket.push(problem);
    byFile.set(problem.file, bucket);
  }

  for (const [file, fileProblems] of [...byFile].sort()) {
    console.error(`\n  ${file}`);
    for (const problem of fileProblems) {
      const where = problem.path ? `${problem.path}: ` : '';
      console.error(`    ${where}${problem.message}`);
    }
  }
}

async function main(): Promise<void> {
  const { dataset, problems: schemaProblems } = await loadDataset();

  const counts = `${dataset.people.length} people, ${dataset.shows.length} shows, ${dataset.channels.length} channels, ${dataset.games.length} games`;

  // Referential integrity is only meaningful over records that parsed. If the
  // schema failed, report that first — the reference errors would be noise.
  if (schemaProblems.length > 0) {
    console.error(`\n✗ Schema validation failed (${schemaProblems.length} problem(s)).`);
    report(schemaProblems);
    console.error('\nFix the schema errors, then re-run to check references.\n');
    process.exit(1);
  }

  const integrityProblems = checkIntegrity(dataset);
  if (integrityProblems.length > 0) {
    console.error(`\n✗ Referential integrity failed (${integrityProblems.length} problem(s)).`);
    report(integrityProblems);
    console.error('');
    process.exit(1);
  }

  const duplicates = findPossibleDuplicatePeople(dataset.people);
  if (duplicates.length > 0) {
    const label = strict ? '✗ Possible duplicate people' : '⚠ Possible duplicate people';
    console.error(`\n${label} (${duplicates.length}) — needs maintainer review.`);
    report(duplicates);
    console.error('');
    if (strict) process.exit(1);
  }

  const creditCount = dataset.people.reduce((sum, person) => sum + person.credits.length, 0);
  console.log(`✓ Valid: ${counts}, ${creditCount} credits.`);

  // Provenance health, so the sourcing profile is visible on every run rather
  // than something you have to go looking for.
  const byTier = new Map<string, number>();
  let corroborated = 0;
  let noBilling = 0;
  for (const person of dataset.people) {
    for (const credit of person.credits) {
      const best = bestTier(credit.sources);
      byTier.set(best.tier, (byTier.get(best.tier) ?? 0) + 1);
      if (corroboration(credit.sources).status === 'corroborated') corroborated += 1;
      if (credit.alias === undefined) noBilling += 1;
    }
  }
  const profile = SOURCE_TIERS.filter((tier) => byTier.has(tier))
    .map((tier) => `${tier} ${byTier.get(tier)}`)
    .join(' · ');
  console.log(`  Best source per credit: ${profile}`);
  console.log(
    `  ${corroborated}/${creditCount} corroborated by two or more independent sources.`,
  );
  if (noBilling > 0) {
    console.log(`  ${noBilling} credit(s) with no established billed name.`);
  }
  if (duplicates.length > 0) {
    console.log(`  (${duplicates.length} duplicate-name warning(s) above — advisory, not blocking.)`);
  }
}

main().catch((error: unknown) => {
  console.error('\nValidator crashed:', error);
  process.exit(1);
});
