import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { showsAwaitingCast } from '../src/lib/known.js';

const tsx = resolve('node_modules/.bin/tsx');
function temp<T>(use: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'weekly-'));
  try {
    return use(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('only swept shows with nobody credited are queued for a cast again', () => {
  const show = (id: string, extra: object = {}) => ({
    id,
    description: 'System per source: X (per the series title).',
    links: { website: `https://www.youtube.com/playlist?list=PL-${id}` },
    seasons: [{}],
    ...extra,
  });
  const queued = showsAwaitingCast({
    shows: [
      show('empty'),
      show('cast'),
      show('curated', { description: 'A show.' }),
      show('seasons', { seasons: [{}, {}] }),
      show('elsewhere', { links: { website: 'https://example.com' } }),
    ],
    people: [{ credits: [{ show: 'cast' }] }],
  });
  assert.deepEqual(queued, [{ show: 'empty', playlist: 'PL-empty' }]);
});

test('a failed Archive search imports nothing and fails the step', () =>
  temp((dir) => {
    const stub = join(dir, 'offline.mjs');
    writeFileSync(stub, 'globalThis.fetch = async () => new Response("down", { status: 503 });\n');
    const run = spawnSync(tsx, ['--import', stub, 'scripts/import-archive.ts', '--dry-run'], { encoding: 'utf8' });
    assert.equal(run.status, 1, run.stdout + run.stderr);
    assert.match(run.stderr, /no shows were imported/);
  }));

test('the report does not call discarded candidates filed', () =>
  temp((dir) => {
    const candidate = { title: 'Some Show', verdict: 'actual-play', reasons: ['r'], status: 'missing-credit', show: 's', applied: true };
    writeFileSync(join(dir, 'sweep.json'), JSON.stringify({ reports: [{ person: 'p', candidates: [candidate] }] }));
    const report = (log: string) => {
      writeFileSync(join(dir, 'discarded.log'), log);
      const out = join(dir, 'report.md');
      const run = spawnSync(
        tsx,
        ['scripts/discovery-report.ts', '--person', join(dir, 'sweep.json'), '--discarded', join(dir, 'discarded.log'), '--out', out],
        { encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: '' } },
      );
      assert.equal(run.status, 0, run.stderr);
      return readFileSync(out, 'utf8');
    };
    assert.match(report('images: output discarded because it did not validate.\n'), /1 candidate filed/);
    const lost = report('person sweep: output discarded because it did not validate.\n');
    assert.match(lost, /none of its candidates were filed/);
    assert.match(lost, /0 candidates filed/);
    assert.match(lost, /\| p \| `s`/);
  }));
