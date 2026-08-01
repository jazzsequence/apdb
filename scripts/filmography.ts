#!/usr/bin/env tsx
/**
 * Renders a person's filmography to the terminal from the normalized data.
 *
 * This is the Phase 0 acceptance test in executable form: it proves the join
 * works — alias-aware, grouped by show, guest spots included — before any UI
 * exists to dress it up.
 *
 *   npm run filmography -- aabria-iyengar
 *   npm run filmography -- "Aabria Lipscomb"    # resolves via alias
 */
import { Db } from '../src/lib/derive.js';
import { loadDataset } from '../src/lib/load.js';
import type { Person } from '../src/lib/schema.js';

function resolvePerson(db: Db, query: string): Person | undefined {
  const needle = query.trim().toLowerCase();
  return (
    db.person(needle) ??
    db.people.find((p) =>
      db.searchableNames(p).some((name) => name.toLowerCase() === needle),
    )
  );
}

async function main(): Promise<void> {
  const query = process.argv.slice(2).join(' ');
  if (!query) {
    console.error('Usage: npm run filmography -- <person-slug|name|alias>\n');
    const { dataset } = await loadDataset();
    console.error('Known people:');
    for (const person of dataset.people) console.error(`  ${person.id}`);
    process.exit(1);
  }

  const { dataset, problems } = await loadDataset();
  if (problems.length > 0) {
    console.error('Data does not validate — run `npm run validate` first.');
    process.exit(1);
  }

  const db = new Db(dataset);
  const person = resolvePerson(db, query);
  if (!person) {
    console.error(`No person found matching "${query}".`);
    process.exit(1);
  }

  const matchedAlias = person.aliases.find(
    (a) => a.name.toLowerCase() === query.trim().toLowerCase(),
  );

  console.log(`\n${person.canonical_name}`);
  console.log('='.repeat(person.canonical_name.length));
  if (matchedAlias && matchedAlias.name !== person.canonical_name) {
    console.log(`(searched as "${matchedAlias.name}" — resolved to one person)`);
  }

  const otherNames = person.aliases.filter((a) => a.name !== person.canonical_name);
  if (otherNames.length > 0) {
    console.log(
      `Also credited as: ${otherNames.map((a) => `${a.name} [${a.alias_type}]`).join(', ')}`,
    );
  }

  const groups = db.filmography(person);
  const total = groups.reduce((sum, g) => sum + g.credits.length, 0);
  console.log(`\n${total} credit(s) across ${groups.length} show(s):\n`);

  for (const group of groups) {
    const years =
      group.earliestYear && group.latestYear && group.earliestYear !== group.latestYear
        ? `${group.earliestYear}–${group.latestYear}`
        : (group.latestYear ?? 'date unknown');
    const channels = group.channels.map((c) => `${c.name} · ${c.type}`).join(', ');
    console.log(`  ${group.show.title}  (${years})`);
    console.log(`    ${channels}`);

    for (const { credit, season, game, alias, creditedUnderFormerName, tier } of group.credits) {
      const where = [
        season ? `S${season.ordinal}${season.title ? ` — ${season.title}` : ''}` : null,
        credit.episode,
      ]
        .filter(Boolean)
        .join(' · ');

      const bits = [
        credit.role,
        credit.character ? `as ${credit.character}` : null,
        game ? `[${game.name} ${game.edition}]` : null,
      ].filter(Boolean);

      console.log(`      ${where || 'show-level'}`);
      console.log(`        ${bits.join('  ')}`);
      console.log(
        `        credited as: ${alias.name}${creditedUnderFormerName ? '  <- former name' : ''}`,
      );
      console.log(
        `        source: ${tier.label} [tier ${tier.rank}/7]` +
          (credit.source.attested_by ? ` — ${credit.source.attested_by}` : '') +
          (credit.source.needs_verification ? '   · uncorroborated' : ''),
      );
    }
    console.log('');
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
