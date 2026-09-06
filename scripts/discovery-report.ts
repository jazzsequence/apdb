#!/usr/bin/env tsx
/**
 * Turn a discovery sweep into one reviewable markdown report.
 *
 * The weekly job runs several passes whose natural output is a wall of
 * terminal text nobody reads at 6am on a Monday. This folds them into a single
 * document ordered by what actually needs a decision, and — the part that
 * matters for a cron job — decides whether there is anything worth opening a
 * pull request about at all. A weekly PR that says "nothing new" trains people
 * to close it unread, and the next one with a real find gets closed too.
 *
 *   npm run report:discovery -- --person out/person-sweep.json \
 *     --log "Internet Archive:out/archive.log" --out reports/discovery-latest.md
 *
 * Writes `findings=<n>` to $GITHUB_OUTPUT when running in Actions, so the
 * workflow can skip the PR when the count is zero.
 */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

const args = process.argv.slice(2);
const flag = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const flags = (n: string) =>
  args.flatMap((a, i) => (a === `--${n}` && args[i + 1] ? [args[i + 1]] : []));

interface Candidate {
  title: string;
  link?: string;
  year?: string;
  role?: string;
  character?: string;
  evidence?: string;
  verdict: 'actual-play' | 'excluded' | 'unclear';
  reasons: string[];
  status: 'missing-show' | 'missing-credit' | 'have-it';
  show?: string;
  season?: number;
}
interface PersonReport {
  person: string;
  wikipedia?: string;
  qid?: string;
  error?: string;
  candidates: Candidate[];
}

const out = flag('out') ?? 'reports/discovery-latest.md';
const lines: string[] = [];
const today = new Date().toISOString().slice(0, 10);

lines.push(`# Discovery sweep — ${today}`, '');
lines.push(
  'Automated reconnaissance. **Nothing here is data yet.** Every candidate below',
  'came from a reference work or a wiki, which makes it `reference` or `community`',
  'tier at best, and Wikipedia in particular is wrong about this project’s subject',
  'often enough to be worth naming (POLICY.md). Check each one against something',
  'closer to the fact before filing it.',
  '',
);

let findings = 0;
const wikipediaUrl = (link: string) =>
  `https://en.wikipedia.org/wiki/${encodeURIComponent(link.replace(/ /g, '_'))}`;

// ---------------------------------------------------------------------------
// Person-first
// ---------------------------------------------------------------------------
const personJson = flag('person');
if (personJson && existsSync(personJson)) {
  const { reports } = JSON.parse(await readFile(personJson, 'utf8')) as { reports: PersonReport[] };

  const missingShows: Array<{ person: string; c: Candidate }> = [];
  const missingCredits: Array<{ person: string; c: Candidate }> = [];
  const unclear: Array<{ person: string; c: Candidate }> = [];
  const errors: PersonReport[] = [];
  let excluded = 0;

  for (const report of reports) {
    if (report.error) errors.push(report);
    for (const candidate of report.candidates ?? []) {
      if (candidate.verdict === 'excluded') excluded++;
      else if (candidate.status === 'missing-show' && candidate.verdict === 'actual-play') {
        missingShows.push({ person: report.person, c: candidate });
      } else if (candidate.status === 'missing-credit' && candidate.verdict === 'actual-play') {
        missingCredits.push({ person: report.person, c: candidate });
      } else if (candidate.verdict === 'unclear' && candidate.status !== 'have-it') {
        unclear.push({ person: report.person, c: candidate });
      }
    }
  }
  // A show missing from the catalogue is missing from everyone in its cast, so
  // group by show before counting: three people naming the same missing series
  // is one show to add, and reporting it as three overstates the work and
  // understates the find.
  const byShow = new Map<string, Array<{ person: string; c: Candidate }>>();
  for (const hit of missingShows) {
    const key = (hit.c.link ?? hit.c.title).toLowerCase();
    byShow.set(key, [...(byShow.get(key) ?? []), hit]);
  }
  findings += byShow.size + missingCredits.length;

  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

  lines.push('## Person-first sweep', '');
  lines.push(
    `${plural(reports.length, 'person', 'people')} read. **${plural(byShow.size, 'show')}** with no record here ` +
      `(named by ${plural(missingShows.length, 'credit')}), **${plural(missingCredits.length, 'missing credit')}** ` +
      `on shows we already have, ${unclear.length} unclear, ${excluded} excluded as not actual play.`,
    '',
  );

  if (byShow.size > 0) {
    lines.push('### Shows with no record', '');
    lines.push('| Show | Named by | Role / character | Why it reads as actual play |', '| --- | --- | --- | --- |');
    for (const [key, hits] of [...byShow.entries()].sort((a, b) => b[1].length - a[1].length)) {
      const first = hits[0].c;
      const title = first.link ? `[${first.title}](${wikipediaUrl(first.link)})` : first.title;
      const who = hits.map((h) => h.person).join(', ');
      const role = [first.role, first.character && `as ${first.character}`].filter(Boolean).join(' ') || '—';
      lines.push(`| ${title}${first.year ? ` (${first.year})` : ''} | ${who} | ${role} | ${first.reasons[0] ?? '—'} |`);
    }
    lines.push('');
  }

  if (missingCredits.length > 0) {
    lines.push('### Missing credits on shows we have', '');
    lines.push('| Person | Show | Role / character | Evidence |', '| --- | --- | --- | --- |');
    for (const { person, c } of missingCredits) {
      const role = [c.role, c.character && `as ${c.character}`].filter(Boolean).join(' ') || '—';
      const evidence = (c.evidence ?? c.reasons[0] ?? '—').replace(/\|/g, '\\|').slice(0, 160);
      lines.push(`| ${person} | \`${c.show}\`${c.season ? ` s${c.season}` : ''} | ${role} | ${evidence} |`);
    }
    lines.push('');
  }

  if (unclear.length > 0) {
    lines.push('<details><summary>Unclear — read these before deciding (' + unclear.length + ')</summary>', '');
    for (const { person, c } of unclear) {
      lines.push(`- **${person}** — ${c.title}${c.year ? ` (${c.year})` : ''}: ${c.reasons[0] ?? 'no reason recorded'}`);
    }
    lines.push('', '</details>', '');
  }

  if (errors.length > 0) {
    lines.push('<details><summary>Lookups that failed (' + errors.length + ')</summary>', '');
    for (const report of errors) lines.push(`- \`${report.person}\` — ${report.error}`);
    lines.push('', '</details>', '');
  }
}

// ---------------------------------------------------------------------------
// The show-first passes, whose output is terminal text rather than JSON.
// Attached verbatim: they need a human's eye anyway, and half-parsing them
// into a table would only hide the caveats each one prints about itself.
// ---------------------------------------------------------------------------
for (const spec of flags('log')) {
  const [label, path] = spec.includes(':') ? [spec.slice(0, spec.indexOf(':')), spec.slice(spec.indexOf(':') + 1)] : [spec, spec];
  if (!existsSync(path)) continue;
  const body = (await readFile(path, 'utf8')).trim();
  if (!body) continue;
  lines.push(`## ${label}`, '');
  lines.push(
    '<details><summary>Raw output — these passes do not dedupe against the catalogue, so diff before believing</summary>',
    '',
    '```',
    body.slice(-20000),
    '```',
    '',
    '</details>',
    '',
  );
}

lines.push('---', '');
lines.push(
  'Filed by the weekly `discovery.yml` job. Reviewing means: pick the candidates',
  'worth having, find a source closer to the fact than the one that surfaced them,',
  'and file those as a separate change. Merging this report merges the report, not',
  'the data.',
  '',
);

await mkdir(dirname(out), { recursive: true });
await writeFile(out, lines.join('\n'), 'utf8');
console.log(`Wrote ${out} — ${findings} actionable finding(s).`);

if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, `findings=${findings}\n`);
}
