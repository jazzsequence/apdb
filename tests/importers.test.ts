import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newUploads } from '../src/lib/archive-uploads.js';
import { fetchSeriesArt } from '../src/lib/images.js';
import { characterFromSentence } from '../src/lib/sources/wikipedia.js';

test('a character is taken only where the sentence says who was played', () => {
  assert.equal(characterFromSentence('She was playing as Laura Bennett in the series.'), 'Laura Bennett');
  assert.equal(characterFromSentence('He portrayed Evelyn, a cleric.'), 'Evelyn');
  for (const sentence of [
    'He played Dungeons & Dragons on the show.',
    'She plays Call of Cthulhu, a horror game.',
    'They played Critical Role for a year.',
    'He was acting as Dungeon Master for the campaign.',
    'She appeared as herself in the finale.',
    'He played as a guest in two episodes.',
  ]) {
    assert.equal(characterFromSentence(sentence), undefined, sentence);
  }
});

const item = (identifier: string, date?: string) => ({ identifier, date });

test('older episodes of an imported show are not new uploads', () => {
  const catalogued = new Map([['ep1', '2020-05-01']]);
  const run = [item('Ep1', '2020-01-01'), item('ep2', '2020-03-01'), item('ep3', '2020-05-01T10:00:00Z')];
  assert.equal(newUploads(run, catalogued), 0);
  assert.equal(newUploads([...run, item('new1', '2021-01-01'), item('new2', '2021-02-01')], catalogued), 2);
});

test('uploads that cannot be dated against the catalogue are reported', () => {
  assert.equal(newUploads([item('ep1'), item('ep2', '2020-01-01')], new Map([['ep1', undefined]])), 1);
  assert.equal(newUploads([item('ep1'), item('ep2')], new Map([['ep1', '2020']])), 1);
  assert.equal(newUploads([item('ep1'), item('ep2', '2020-12-31')], new Map([['ep1', '2020']])), 0);
});

test('a failed art request does not throw, and marks the run failed', async () => {
  const { fetch: real } = globalThis;
  const key = process.env.YOUTUBE_API_KEY;
  process.env.YOUTUBE_API_KEY = 'test';
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  try {
    assert.equal(await fetchSeriesArt(), 0);
    assert.equal(process.exitCode, 1);
  } finally {
    // That exit code is the thing under test, not this run's result.
    process.exitCode = 0;
    globalThis.fetch = real;
    if (key === undefined) delete process.env.YOUTUBE_API_KEY;
    else process.env.YOUTUBE_API_KEY = key;
  }
});
