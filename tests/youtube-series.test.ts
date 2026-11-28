import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AGGREGATE_TITLE, selectSeries, tableSize } from '../src/lib/youtube-series.js';

const TABLE = 'DM: Ann Lee\nStarring Bo Day as Rix, Cy Poe as Mim';
const CREW = 'Edited by Jane Doe\nMusic by Kevin MacLeod';

const video = (id: string, description = '') => ({ id, title: id, description, publishedAt: '', url: id });
const run = (prefix: string, count: number, description = TABLE) =>
  Array.from({ length: count }, (_, i) => video(`${prefix}${i}`, description));
const names = (list: Array<{ name: string }>) => list.map((p) => p.name);

test('a table listed only in a later episode counts', () => {
  assert.ok(tableSize([video('1', 'Welcome!'), video('2', 'A prologue.'), video('3', TABLE)]) >= 2);
});

test('a table beyond the episodes the import reads does not make a series', () => {
  const late = [...run('i', 50, 'Welcome!'), ...run('t', 5)];
  assert.deepEqual(selectSeries([{ name: 'Late', videos: late }], new Set()).series, []);
});

test('crew, one person, or one name twice is not a table', () => {
  assert.equal(tableSize([video('1', CREW)]), 0);
  assert.equal(tableSize([video('1', 'DM: Ann Lee')]), 1);
  assert.equal(tableSize([video('1', 'DM: Ann Lee\nStarring Ann Lee as Rix')]), 1);
  assert.equal(tableSize([]), 0);
  const { series } = selectSeries([{ name: 'Lore', videos: run('l', 6, CREW) }], new Set());
  assert.deepEqual(series, []);
});

test('a long gathering playlist is held, in any order and however it is sorted', () => {
  const a = run('a', 80);
  const b = run('b', 80);
  for (const gathered of [[...a, ...b], [...b, ...a].reverse(), [...a, ...b].reverse()]) {
    const { series } = selectSeries(
      [
        { name: 'Everything so far', videos: gathered },
        { name: 'Campaign A', videos: a },
        { name: 'Campaign B', videos: b },
      ],
      new Set(),
    );
    assert.deepEqual(names(series), ['Campaign A', 'Campaign B']);
  }
});

test('gathering held or castless playlists does not make a series', () => {
  const quiet = run('q', 20, '');
  const blocked = run('t', 20);
  const { series, held } = selectSeries(
    [
      { name: 'Gathering', videos: [...quiet, ...blocked, ...run('x', 5)] },
      { name: 'No cast', videos: quiet },
      { name: 'Title taken', videos: blocked, blocked: 'a show or season already has this title' },
    ],
    new Set(),
  );
  assert.deepEqual(series, []);
  assert.equal(held.length, 3);
});

test('a playlist already seen on an earlier channel is held', () => {
  const seen = new Set<string>();
  const videos = run('a', 10);
  assert.equal(selectSeries([{ name: 'Original', videos }], seen).series.length, 1);
  assert.equal(selectSeries([{ name: 'Mirror', videos }], seen).series.length, 0);
});

test('gathering titles are recognised, campaign titles are not', () => {
  for (const t of ['Pathfinder All Episodes', 'All Videos', 'The Full Archive', 'Every Episode', 'Uploads']) {
    assert.match(t, AGGREGATE_TITLE);
  }
  for (const t of [
    'Curse of Strahd Campaign',
    'All Hallows One-Shot',
    'The Fall of Everything Campaign 2',
    'All Games Night Campaign',
    'Uploads from the Void: a Mothership series',
  ]) {
    assert.doesNotMatch(t, AGGREGATE_TITLE);
  }
});
