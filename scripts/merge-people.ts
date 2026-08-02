#!/usr/bin/env tsx
/**
 * Merge duplicate person records.
 *
 * Duplicates arrive every time a new source names someone slightly differently
 * — "Vince Caso" from one wiki, "Vincent Caso" from IMDb. The audit catches
 * them; this applies the fix, which was previously done by hand each time and
 * therefore done inconsistently.
 *
 *   npm run merge -- vince-caso vincent-caso        # first is folded into second
 *   npm run merge -- --auto                          # every pair the audit is sure of
 *
 * The name that survives is the surviving record's; the other becomes an alias,
 * because it is a name that person really was credited under somewhere.
 */
import { readdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { DATA_ROOT } from '../src/lib/load.js';

const args = process.argv.slice(2);
const AUTO = args.includes('--auto');
const DRY = args.includes('--dry-run');

const peopleDir = join(DATA_ROOT, 'people');
const load = async (id: string) => parse(await readFile(join(peopleDir, `${id}.yml`), 'utf8'));

function aliasId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'alt';
}

async function merge(fromId: string, intoId: string): Promise<number> {
  const from = await load(fromId);
  const into = await load(intoId);

  // The losing record's name is still a real billing, so keep it as an alias.
  into.aliases ??= [];
  if (!into.aliases.some((a: any) => a.name.toLowerCase() === from.canonical_name.toLowerCase())) {
    into.aliases.push({
      id: aliasId(from.canonical_name),
      name: from.canonical_name,
      alias_type: 'legal',
      note: `Credited under this name on some sources; merged from \`${fromId}\`.`,
    });
  }
  for (const a of from.aliases ?? []) {
    if (into.aliases.some((x: any) => x.name.toLowerCase() === a.name.toLowerCase())) continue;
    into.aliases.push({ ...a, id: aliasId(a.name) });
  }

  // Carry credits across, dropping ones the survivor already has. An alias id
  // from the old record will not exist on the new one, so drop it rather than
  // leave a dangling reference for the integrity check to trip over.
  const keyOf = (c: any) => `${c.show}|${c.season ?? ''}|${c.role}|${c.episode ?? ''}`;
  const have = new Set((into.credits ?? []).map(keyOf));
  let moved = 0;
  for (const c of from.credits ?? []) {
    if (have.has(keyOf(c))) continue;
    const copy = { ...c };
    if (copy.alias && !into.aliases.some((a: any) => a.id === copy.alias)) delete copy.alias;
    (into.credits ??= []).push(copy);
    moved++;
  }

  if (!DRY) {
    await writeFile(join(peopleDir, `${intoId}.yml`), stringify(into), 'utf8');
    await unlink(join(peopleDir, `${fromId}.yml`));
  }
  console.log(`${fromId} → ${intoId}  (${moved} credit(s) moved, ${from.credits?.length ?? 0} total)`);
  return moved;
}

/** The audit's rule, repeated here so --auto and the audit never disagree. */
function nameKey(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|wwe superstar|dr|mr|ms|mrs)\b/g, ' ')
    .replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
}
function likelySame(a: string, b: string): boolean {
  const [x, y] = [nameKey(a).split(' '), nameKey(b).split(' ')];
  if (x.length < 2 || y.length < 2) return false;
  if (x.at(-1) !== y.at(-1)) return false;
  const [fx, fy] = [x[0]!, y[0]!];
  if (fx === fy) return true;
  return fx.length >= 3 && fy.length >= 3 && (fx.startsWith(fy) || fy.startsWith(fx));
}

if (AUTO) {
  const people: { id: string; name: string; credits: number }[] = [];
  for (const f of (await readdir(peopleDir)).filter((f) => f.endsWith('.yml'))) {
    const p = parse(await readFile(join(peopleDir, f), 'utf8'));
    people.push({ id: p.id, name: p.canonical_name, credits: (p.credits ?? []).length });
  }
  const done = new Set<string>();
  let pairs = 0;
  for (const a of people) {
    for (const b of people) {
      if (a.id >= b.id || done.has(a.id) || done.has(b.id)) continue;
      if (!likelySame(a.name, b.name)) continue;
      // Keep the record with more credits; on a tie keep the fuller name,
      // since the shorter is usually one source abbreviating.
      const [loser, winner] =
        a.credits !== b.credits
          ? (a.credits < b.credits ? [a, b] : [b, a])
          : (a.name.length < b.name.length ? [a, b] : [b, a]);
      await merge(loser.id, winner.id);
      done.add(loser.id);
      pairs++;
    }
  }
  console.log(`\n${pairs} pair(s) merged.${DRY ? ' (dry run)' : ''}`);
} else {
  const [from, into] = args.filter((a) => !a.startsWith('--'));
  if (!from || !into) {
    console.error('Usage: npm run merge -- <from-slug> <into-slug>   |   npm run merge -- --auto');
    process.exit(1);
  }
  await merge(from, into);
}
