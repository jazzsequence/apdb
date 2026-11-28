import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const script = resolve('scripts/checkpoint.sh');

/** A throwaway repository whose "validation" fails while data/bad exists. */
function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'checkpoint-'));
  mkdirSync(join(dir, 'data'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { validate: 'test ! -e data/bad' } }));
  writeFileSync(join(dir, 'data/base'), 'base\n');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  git('add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'base');
  const run = (name: string, actions = 'true') =>
    spawnSync('bash', [script, name], { cwd: dir, env: { ...process.env, GITHUB_ACTIONS: actions } });
  const read = (file: string) => readFileSync(join(dir, file), 'utf8');
  const write = (file: string, text: string) => writeFileSync(join(dir, file), text);
  return { dir, run, read, write, has: (f: string) => existsSync(join(dir, f)) };
}

test('a failed step loses its own output and nothing earlier', () => {
  const r = repo();
  try {
    r.write('data/first', 'one\n');
    r.write('data/base', 'base\nfirst\n');
    assert.equal(r.run('first').status, 0);

    r.write('data/first', 'damaged\n');
    r.write('data/base', 'damaged\n');
    r.write('data/second', 'two\n');
    r.write('data/bad', 'x\n');
    assert.equal(r.run('second').status, 0, 'discarding must not fail the job');

    assert.equal(r.read('data/first'), 'one\n');
    assert.equal(r.read('data/base'), 'base\nfirst\n');
    assert.equal(r.has('data/second'), false);
    assert.equal(r.has('data/bad'), false);
    assert.match(r.read('out/discarded.log'), /^second: output discarded/);

    r.write('data/third', 'three\n');
    assert.equal(r.run('third').status, 0);
    assert.equal(r.has('data/third'), true);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test('outside GitHub Actions it touches nothing', () => {
  const r = repo();
  try {
    r.write('data/bad', 'x\n');
    assert.equal(r.run('local', '').status, 2);
    assert.equal(r.has('data/bad'), true);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});
