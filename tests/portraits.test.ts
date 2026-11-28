import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileNamesPerson } from '../src/lib/images.js';
import { mergePortrait } from '../src/lib/merge-portrait.js';

test('a wiki file named only for the person is accepted', () => {
  for (const [file, name] of [
    ['Sam_Riegel.png', 'Sam Riegel'],
    ['SamRiegel.jpg', 'Sam Riegel'],
    ['Sam_Riegel_portrait_2.jpg', 'Sam Riegel'],
    ['Sam_Riegel_(cropped).jpg', 'Sam Riegel'],
    ["Liam_OBrien.jpg", "Liam O'Brien"],
    ['Skid_2.png', 'Skid'],
    ['Zoë_Quinn.png', 'Zoe Quinn'],
  ] as const) {
    assert.equal(fileNamesPerson(file, [name]), true, file);
  }
});

test('group shots, logos, characters and namesakes are refused', () => {
  for (const [file, names] of [
    ['Sam_Riegel_and_Liam_OBrien.jpg', ['Sam Riegel']],
    ['Sam_Riegel_as_Scanlan.png', ['Sam Riegel']],
    ['JoAnn_Lee.png', ['Ann Lee']],
    ['Matt_Colville.png', ['Matt Smith', 'Matt']],
    ['Sam_logo.png', ['Sam Riegel', 'Sam']],
    ['The_Table.png', ['The Gamemaster']],
    ['Riegel.png', ['Sam Riegel']],
    ['2019.png', ['Sam']],
    ['.png', ['Sam']],
  ] as const) {
    assert.equal(fileNamesPerson(file, [...names]), false, file);
  }
});

const image = (url: string) => ({ url }) as any;

test('merging keeps a rejection from either record', () => {
  const survivor: any = {};
  mergePortrait(survivor, { no_auto_image: true });
  assert.equal(survivor.no_auto_image, true);

  const rejected: any = { no_auto_image: true };
  mergePortrait(rejected, { image: image('b') });
  assert.deepEqual(rejected, { no_auto_image: true });
});

test('merging moves an image only onto a record with none', () => {
  const empty: any = {};
  mergePortrait(empty, { image: image('b') });
  assert.equal(empty.image.url, 'b');

  const kept: any = { image: image('a') };
  mergePortrait(kept, { image: image('b') });
  assert.equal(kept.image.url, 'a');

  const none: any = {};
  mergePortrait(none, { image: image('b'), no_auto_image: true });
  assert.equal(none.image, undefined);
});
