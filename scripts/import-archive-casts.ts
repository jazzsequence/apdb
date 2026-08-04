#!/usr/bin/env tsx
/**
 * Read casts out of the Internet Archive item each credit-less show already
 * links to.
 *
 *   npm run import:archive-casts -- --dry-run
 *   npm run import:archive-casts
 *
 * The archive adapter has only ever pulled art and grouping metadata from
 * these items; nothing has read the description for a cast, even though the
 * production wrote one directly into it on plenty of items. This reuses the
 * link already stored on each show rather than searching again, so it only
 * ever touches items already judged to belong here.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { DATA_ROOT } from '../src/lib/load.js';
import { castFromArchiveDescription } from '../src/lib/sources/archive-cast.js';
import { upsertCredit } from '../src/lib/credits.js';

const UA = 'ActualPlayDatabase/0.1 (community actual-play credit index; contact via repository issues)';
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const only = (() => { const i = args.indexOf('--only'); return i >= 0 ? args[i + 1] : undefined; })();

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 55).replace(/-+$/, '');
const sortName = (n: string) => { const p = n.trim().split(/\s+/); if (p.length < 2) return n; const l = p.pop()!; return `${l}, ${p.join(' ')}`; };

const personByName = new Map<string, string>();
for (const f of (await readdir(join(DATA_ROOT, 'people'))).filter((f) => f.endsWith('.yml'))) {
  const p = parse(await readFile(join(DATA_ROOT, 'people', f), 'utf8'));
  for (const a of p.aliases ?? []) personByName.set(a.name.toLowerCase(), p.id);
  personByName.set(p.canonical_name.toLowerCase(), p.id);
}

const showsWithCredits = new Set<string>();
for (const f of (await readdir(join(DATA_ROOT, 'people'))).filter((f) => f.endsWith('.yml'))) {
  const p = parse(await readFile(join(DATA_ROOT, 'people', f), 'utf8'));
  for (const c of p.credits ?? []) showsWithCredits.add(c.show);
}

const targets: { id: string; title: string; identifier: string; seasons: number }[] = [];
for (const f of (await readdir(join(DATA_ROOT, 'shows'))).filter((f) => f.endsWith('.yml'))) {
  const s = parse(await readFile(join(DATA_ROOT, 'shows', f), 'utf8'));
  if (only && s.id !== only) continue;
  if (!only && showsWithCredits.has(s.id)) continue;
  const identifier = String(s.links?.website ?? '').match(/archive\.org\/details\/([^/?#]+)/)?.[1];
  if (!identifier) continue;
  targets.push({ id: s.id, title: s.title, identifier: decodeURIComponent(identifier), seasons: (s.seasons ?? []).length });
}

console.log(`\n${targets.length} credit-less show(s) link to an Internet Archive item.\n`);

let filled = 0, added = 0, corroborated = 0, created = 0, none = 0;

for (const t of targets) {
  let desc = '';
  try {
    const r = await fetch(`https://archive.org/metadata/${t.identifier}`, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) { none++; continue; }
    const data = await r.json();
    const raw = data?.metadata?.description ?? '';
    const html = Array.isArray(raw) ? raw[0] : raw;
    desc = String(html)
      .replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ');
  } catch {
    none++;
    continue;
  }

  const cast = castFromArchiveDescription(desc);
  if (cast.length < 2) { none++; continue; }

  filled++;
  console.log(`✓ ${t.title.slice(0, 44).padEnd(44)} ${cast.length} name(s)`);
  if (DRY) {
    for (const c of cast) console.log(`      ${c.role.padEnd(9)} ${c.name}${c.character ? ` as ${c.character}` : ''}`);
    continue;
  }

  const source = {
    tier: 'official' as const,
    url: `https://archive.org/details/${t.identifier}`,
    note: "Cast stated in the item's own description on the Internet Archive.",
  };
  for (const c of cast) {
    const id = personByName.get(c.name.toLowerCase()) ?? slug(c.name);
    if (!id) continue;
    const path = join(DATA_ROOT, 'people', `${id}.yml`);
    let person: any;
    try { person = parse(await readFile(path, 'utf8')); }
    catch {
      person = { id, canonical_name: c.name, sort_name: c.name.includes(' ') ? sortName(c.name) : c.name,
        aliases: [{ id: 'default', name: c.name, alias_type: c.name.includes(' ') ? 'legal' : 'handle' }], credits: [] };
      created++;
    }
    const credit: any = { show: t.id, role: c.role, sources: [source] };
    if (t.seasons === 1) credit.season = 1;
    if (c.character) credit.character = c.character;
    if (person.aliases?.length === 1) credit.alias = person.aliases[0].id;

    const result = upsertCredit(person.credits ??= [], credit);
    if (result.outcome === 'already-cited') continue;
    person.credits = result.credits;
    await writeFile(path, stringify(person), 'utf8');
    result.outcome === 'corroborated' ? corroborated++ : added++;
    personByName.set(c.name.toLowerCase(), id);
  }
  await new Promise((r) => setTimeout(r, 150));
}

console.log(`\n${filled} show(s) had a cast in their item description, ${none} did not.`);
console.log(DRY ? 'Dry run — nothing written.\n' : `${added} credit(s) added, ${corroborated} corroborated, ${created} new people.\n`);
