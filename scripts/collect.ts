#!/usr/bin/env tsx
/**
 * Import adapter runner.
 *
 * Pulls identity data from cleared external sources and emits person files for
 * review. Nothing is merged automatically: output lands in data/_incoming/ and
 * becomes a pull request like any other contribution, because an import is
 * still an assertion about a real person.
 *
 *   npm run collect -- --search "Aabria Iyengar"     # find candidate QIDs
 *   npm run collect -- --qid Q117600290              # stage one person
 *   npm run collect -- --refresh                     # re-pull every person with a qid
 *   npm run collect -- --qid Q117600290 --apply      # merge into data/people/ in place
 *   npm run collect -- --sources                     # show licence/clearance table
 *
 * Merge policy when a person already exists: identity fields and NEW aliases
 * are added; existing bio, links, credits and alias ids are never overwritten.
 * Curated data always wins over imported data.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { DATA_ROOT, loadDataset } from '../src/lib/load.js';
import { assertCleared, SOURCES } from '../src/lib/sources/registry.js';
import {
  discoverCampaignPages,
  fetchCampaign,
  type WikiPerson,
} from '../src/lib/sources/mediawiki.js';
import { fetchPerson, searchPeople, type WikidataPerson } from '../src/lib/sources/wikidata.js';
import { Person, type CreditRole, type Show } from '../src/lib/schema.js';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const has = (name: string) => args.includes(`--${name}`);

const STAGING = join(DATA_ROOT, '_incoming');

/** "Emily Axford" -> "Axford, Emily". Best-effort; a curator can correct it. */
function sortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  const last = parts.pop()!;
  return `${last}, ${parts.join(' ')}`;
}

function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Build the YAML record. `existing` is the curated file if one exists — its
 * values take precedence, so re-running the collector is always safe.
 */
function toPersonRecord(imported: WikidataPerson, existing?: Person): Record<string, unknown> {
  const id = existing?.id ?? slugify(imported.canonical_name);

  // Merge aliases by name. Existing entries keep their id, type and notes.
  const aliases = existing ? [...existing.aliases] : [];
  const known = new Set(aliases.map((a) => a.name.toLowerCase()));
  const added: string[] = [];

  for (const alias of imported.aliases) {
    if (known.has(alias.name.toLowerCase())) continue;
    let uniqueId = alias.id;
    while (aliases.some((a) => a.id === uniqueId)) uniqueId = `${uniqueId}-2`;
    aliases.push({ ...alias, id: uniqueId });
    known.add(alias.name.toLowerCase());
    added.push(alias.name);
  }

  const record: Record<string, unknown> = {
    id,
    canonical_name: existing?.canonical_name ?? imported.canonical_name,
    sort_name: existing?.sort_name ?? imported.sort_name,
    ...(existing?.pronouns ? { pronouns: existing.pronouns } : {}),
    ...(existing?.bio || imported.description
      ? { bio: existing?.bio ?? imported.description }
      : {}),
    wikidata_qid: imported.qid,
    links: {
      ...(imported.wikipedia ? { wikipedia: imported.wikipedia } : {}),
      ...(imported.website ? { website: imported.website } : {}),
      ...(existing?.links ?? {}),
    },
    aliases,
    credits: existing?.credits ?? [],
  };

  (record as any).__added = added;
  return record;
}

function header(imported: WikidataPerson, added: string[], isNew: boolean): string {
  const source = SOURCES.wikidata!;
  return [
    `# ${isNew ? 'Imported' : 'Refreshed'} from Wikidata ${imported.qid} on ${new Date().toISOString().slice(0, 10)}.`,
    `# ${source.attribution} Licence: ${source.licence}`,
    '#',
    '# Identity only — Wikidata is not a source of actual-play credits, and the',
    '# indie long tail this project exists to index is not in it. Credits must',
    '# still be added by hand, with their own sources.',
    '#',
    ...imported.provenance.map((line) => `#   ${line}`),
    ...(added.length > 0
      ? ['#', `# New aliases this run: ${added.join(', ')} — confirm alias_type before merging.`]
      : []),
    '',
  ].join('\n');
}

async function stage(imported: WikidataPerson, existing: Person | undefined, apply: boolean) {
  const record = toPersonRecord(imported, existing);
  const added = (record as any).__added as string[];
  delete (record as any).__added;

  // Fail fast: never emit a file the validator would reject.
  const parsed = Person.safeParse(record);
  if (!parsed.success) {
    console.error(`  ✗ ${imported.qid} (${imported.canonical_name}) would not validate:`);
    for (const issue of parsed.error.issues) {
      console.error(`      ${issue.path.join('.')}: ${issue.message}`);
    }
    return false;
  }

  const id = record.id as string;
  const dir = apply ? join(DATA_ROOT, 'people') : STAGING;
  await mkdir(dir, { recursive: true });

  const path = join(dir, `${id}.yml`);
  await writeFile(path, header(imported, added, !existing) + stringify(record), 'utf8');

  const where = apply ? `data/people/${id}.yml` : `data/_incoming/${id}.yml`;
  const what = existing ? 'updated' : 'new';
  console.log(`  ✓ ${imported.canonical_name} (${imported.qid}) -> ${where} [${what}]`);
  if (added.length > 0) console.log(`      new aliases: ${added.join(', ')}`);
  return true;
}

/**
 * Enumerate a wiki's campaigns and stage them as shows/seasons.
 *
 * Shows are the spine credits hang off, so a broad show catalogue is worth
 * building on its own — and the wiki already knows which of its pages are
 * campaigns, so this needs no page names typed by hand.
 */
async function discoverShows(existingShows: Show[], apply: boolean): Promise<void> {
  const host = flag('wiki');
  if (!host) {
    console.error('--discover needs --wiki <host>.');
    process.exit(1);
  }

  const channelId = flag('channel');
  const { template, pages } = await discoverCampaignPages(host);
  if (pages.length === 0) {
    console.error(
      `No campaign pages found on ${host}. It may use a template name this adapter doesn't know — ` +
        `add it to CAMPAIGN_TEMPLATES in src/lib/sources/mediawiki.ts.`,
    );
    process.exit(1);
  }

  console.log(`\n${pages.length} campaign page(s) on ${host} (via ${template}).`);
  const limit = Number.parseInt(flag('limit') ?? '', 10);
  const selected = Number.isFinite(limit) ? pages.slice(0, limit) : pages;

  if (has('dry-run')) {
    for (const page of selected) console.log(`  ${page}`);
    console.log('\nRe-run without --dry-run to stage these as shows.\n');
    return;
  }

  const known = new Set(existingShows.map((s) => s.id));
  const dir = apply ? join(DATA_ROOT, 'shows') : STAGING;
  await mkdir(dir, { recursive: true });

  let written = 0;
  for (const page of selected) {
    let campaign;
    try {
      campaign = await fetchCampaign(host, page);
    } catch (error) {
      console.error(`  ✗ ${page}: ${(error as Error).message}`);
      continue;
    }

    const id = slugify(campaign.title ?? page);
    if (known.has(id)) {
      console.log(`  – ${page} (already have ${id})`);
      continue;
    }

    // Season/game are left for a curator: mapping a system string onto a game
    // id needs judgement about edition, which is a required field here.
    const record = {
      id,
      title: campaign.title ?? page,
      channels: channelId ? [channelId] : ['UNKNOWN-set-a-channel-id'],
      format: 'video',
      status: 'unknown',
      ...(campaign.system ? { description: `System per source: ${campaign.system}.` } : {}),
      links: { website: campaign.url },
      seasons: [
        {
          ordinal: campaign.season ?? 1,
          game: 'UNKNOWN-set-a-game-id',
          ...(campaign.airDates ? { description: `Aired: ${campaign.airDates}` } : {}),
        },
      ],
    };

    const header = [
      `# Discovered on ${host} (${campaign.url}), CC-BY-SA.`,
      '#',
      '# Before merging: set `channels` and `seasons[].game` to real ids, confirm',
      '# `format` and `status`, and split into seasons if the wiki page covers more',
      '# than one. Placeholder ids are deliberately invalid so CI blocks a careless',
      '# merge.',
      '',
    ].join('\n');

    await writeFile(join(dir, `show-${id}.yml`), header + stringify(record), 'utf8');
    console.log(
      `  ✓ ${campaign.title ?? page}${campaign.system ? ` — ${campaign.system.slice(0, 60)}` : ''}`,
    );
    written += 1;
    await new Promise((r) => setTimeout(r, 250));
  }

  console.log(`\n${written} show(s) staged to ${apply ? 'data/shows/' : 'data/_incoming/'}.`);
  console.log('Placeholder channel/game ids must be replaced — CI rejects them as written.\n');
}

/**
 * Pull a whole campaign's cast off a fan wiki and stage credits for everyone on
 * it. This is the mode that actually populates the database — Wikidata gives
 * identities, the wikis give credits.
 */
async function collectFromWiki(existingPeople: Person[], apply: boolean): Promise<void> {
  const host = flag('wiki');
  const page = flag('page');
  const showId = flag('show');
  if (!host || !page || !showId) {
    console.error('--wiki needs --page "<Wiki Page>" and --show <show-slug>.');
    console.error(
      'e.g. npm run collect -- --wiki dimension20.fandom.com --page "Fantasy High" --show dimension-20 --season 1',
    );
    process.exit(1);
  }

  const seasonFlag = flag('season');
  const season = seasonFlag ? Number.parseInt(seasonFlag, 10) : undefined;

  const campaign = await fetchCampaign(host, page);
  console.log(`\n${campaign.title ?? page} — ${campaign.url}`);
  if (campaign.system) console.log(`  system: ${campaign.system}`);
  if (campaign.airDates) console.log(`  aired: ${campaign.airDates}`);
  for (const group of campaign.credits) {
    console.log(`  ${group.field} -> ${group.role}: ${group.people.length}`);
  }
  if (campaign.dropped.length > 0) {
    console.log(`  not people (per wiki categories): ${campaign.dropped.join(', ')}`);
  }
  if (campaign.unmapped.length > 0) {
    console.log(`  unmapped infobox fields: ${campaign.unmapped.join(', ')}`);
  }

  // Guest groups arrive already distinguished from main cast by the wiki, which
  // is the long-tail case this adapter exists for.
  const wanted: { person: WikiPerson; role: CreditRole }[] = campaign.credits.flatMap((group) =>
    group.people.map((person) => ({ person, role: group.role })),
  );

  const byId = new Map(existingPeople.map((p) => [p.id, p]));
  const dir = apply ? join(DATA_ROOT, 'people') : STAGING;
  await mkdir(dir, { recursive: true });

  let written = 0;
  let skipped = 0;

  for (const { person: wikiPerson, role } of wanted) {
    const id = slugify(wikiPerson.name);
    const existing = byId.get(id);

    const credit: Record<string, unknown> = {
      show: showId,
      ...(season !== undefined ? { season } : {}),
      role,
      ...(wikiPerson.character ? { character: wikiPerson.character } : {}),
      // The infobox marks guests at season level without naming episodes. The
      // schema wants a locator or an explanation; this is the explanation, and
      // narrowing it to specific episodes is a job for a contributor.
      ...(role === 'guest player'
        ? { note: 'Listed as a guest player for this season; specific episodes not identified.' }
        : {}),
      // No `alias`: the wiki's naming is its own convention, not evidence of
      // what the billing said. See POLICY.md.
      sources: [
        {
          tier: 'community',
          url: campaign.url,
          note: `${campaign.title ?? page} cast, via the ${host} infobox. CC-BY-SA.`,
        },
      ],
    };

    // Don't restate a credit that is already recorded.
    const duplicate = existing?.credits.some(
      (c) => c.show === showId && c.season === season && c.role === role,
    );
    if (duplicate) {
      skipped += 1;
      continue;
    }

    const record: Record<string, unknown> = existing
      ? { ...existing, credits: [...existing.credits, credit] }
      : {
          id,
          canonical_name: wikiPerson.name,
          sort_name: sortName(wikiPerson.name),
          aliases: [{ id: 'default', name: wikiPerson.name, alias_type: 'legal' }],
          credits: [credit],
        };

    const parsed = Person.safeParse(record);
    if (!parsed.success) {
      console.error(`  ✗ ${wikiPerson.name}:`);
      for (const issue of parsed.error.issues) {
        console.error(`      ${issue.path.join('.')}: ${issue.message}`);
      }
      continue;
    }

    const header = [
      `# Credits imported from ${host} on ${new Date().toISOString().slice(0, 10)}.`,
      `# Source: ${campaign.url} (CC-BY-SA).`,
      '#',
      '# Verify the role and character before merging, and add an `alias` only if',
      "# you know which name was actually on the billing — the wiki's naming is",
      '# not evidence of that.',
      '',
    ].join('\n');

    await writeFile(join(dir, `${id}.yml`), header + stringify(record), 'utf8');
    const label = existing ? 'updated' : 'new';
    const as = wikiPerson.character ? ` as ${wikiPerson.character}` : '';
    console.log(`  ✓ ${wikiPerson.name} — ${role}${as} [${label}]`);
    written += 1;
  }

  console.log(`\n${written} file(s) written${skipped > 0 ? `, ${skipped} already recorded` : ''}.`);
  if (!apply && written > 0) {
    console.log('Review data/_incoming/, move what you want into data/people/, then:');
    console.log('  npm run validate\n');
  }
}

async function main(): Promise<void> {
  if (has('sources')) {
    console.log('\nImport sources:\n');
    for (const source of Object.values(SOURCES)) {
      const mark = source.clearance === 'cleared' ? '✓' : '✗';
      console.log(`  ${mark} ${source.name} — ${source.clearance}`);
      console.log(`      licence: ${source.licence}`);
      console.log(`      ${source.notes}\n`);
    }
    return;
  }

  const apply = has('apply');

  if (has('wiki')) {
    assertCleared('mediawiki');
    const { dataset } = await loadDataset();
    if (has('discover')) {
      await discoverShows(dataset.shows, apply);
    } else {
      await collectFromWiki(dataset.people, apply);
    }
    return;
  }

  const source = assertCleared(flag('source') ?? 'wikidata');

  const search = flag('search');
  if (search) {
    console.log(`\nCandidates for "${search}" on ${source.name}:\n`);
    for (const hit of await searchPeople(search)) {
      console.log(`  ${hit.id}  ${hit.label}${hit.description ? ` — ${hit.description}` : ''}`);
    }
    console.log('\nStage one with:  npm run collect -- --qid <QID>\n');
    return;
  }

  const { dataset } = await loadDataset();
  const byQid = new Map(
    dataset.people.filter((p) => p.wikidata_qid).map((p) => [p.wikidata_qid!, p]),
  );
  const byId = new Map(dataset.people.map((p) => [p.id, p]));

  /**
   * Match an import to a curated person by QID first, then by the slug the
   * import would land on. Without the slug fallback, importing someone who is
   * already curated but has no qid yet would look "new" and --apply would
   * overwrite their file — destroying hand-entered credits.
   */
  const findExisting = (imported: WikidataPerson): Person | undefined =>
    byQid.get(imported.qid) ?? byId.get(slugify(imported.canonical_name));

  let qids: string[];
  if (has('refresh')) {
    qids = [...byQid.keys()];
    if (qids.length === 0) {
      console.log('No existing people carry a wikidata_qid — nothing to refresh.');
      return;
    }
  } else {
    const qid = flag('qid');
    if (!qid) {
      console.error('Nothing to do. Try --search <name>, --qid <QID>, --refresh or --sources.');
      process.exit(1);
    }
    qids = [qid];
  }

  console.log(`\nCollecting ${qids.length} record(s) from ${source.name}.`);
  console.log(apply ? 'Writing into data/people/ (--apply).' : 'Staging to data/_incoming/.\n');

  let ok = 0;
  for (const qid of qids) {
    try {
      const imported = await fetchPerson(qid);
      if (await stage(imported, findExisting(imported), apply)) ok += 1;
    } catch (error) {
      console.error(`  ✗ ${qid}: ${(error as Error).message}`);
    }
    // Be a good citizen of a free public API.
    if (qids.length > 1) await new Promise((r) => setTimeout(r, 350));
  }

  console.log(`\n${ok}/${qids.length} record(s) written.`);
  if (!apply && ok > 0) {
    console.log('Review data/_incoming/, move what you want into data/people/, then run:');
    console.log('  npm run validate\n');
  }
}

main().catch((error: unknown) => {
  console.error(`\n${(error as Error).message}\n`);
  process.exit(1);
});
