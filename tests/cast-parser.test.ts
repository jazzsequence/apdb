// Layouts below are shortened from real production descriptions.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCast } from '../src/lib/sources/youtube.js';
import { tableSize } from '../src/lib/youtube-series.js';

const read = (text: string) => {
  const cast = parseCast(text);
  return {
    credits: cast.credits.map((c) => `${c.role}: ${c.name}${c.character ? ` as ${c.character}` : ''}`),
    held: cast.held.length,
  };
};
const players = (text: string) => read(text).credits.filter((c) => c.includes('player'));

const BLUE_NOTE = `CAST:

Game Master: Skye (she/her)
Carmen: Emma (she/her)
Romeo: Max (they/them)
Luka: Josh (he/him)

All art, animations, editing and sound effects by Naren.`;

test('no "Name: Name" or "Name - Name" line is ever filed as a player', () => {
  for (const text of [
    BLUE_NOTE,
    'Cast:\nAankia: Hank Green\nLemley: Laura Bailey',
    'Cast:\nHank Green - Aankia\nLaura Bailey – Lemley',
    'DM: Mark Hulmes\nDaisy: Katie Morrison - https://example.com/a\nRowan: Chris Trott',
    'DM: Matthew Mercer\nLaura Bailey: Vex\nSystem: Pathfinder',
    'Dungeon Master: Jasmine Bhullar\nSet & Shoot: HyperRPG\nAudio: Michael Rich',
  ]) {
    assert.deepEqual(players(text), [], text);
    assert.ok(read(text).held > 0, text);
  }
});

test('a "played by" line is held wherever it appears', () => {
  for (const text of [
    'Cast:\nIryna (Played by Milo Mannion)\nAstrid (Played by Josh Hodge)',
    'Meet the cast\nIryna (Played by Milo Mannion)\nAstrid (Played by Josh Hodge)',
    'Cast: Iryna (Played by Milo Mannion), Astrid (Played by Josh Hodge)',
  ]) {
    assert.deepEqual(read(text).credits, [], text);
    assert.ok(read(text).held > 0, text);
  }
});

test('a game master line still stands beside held rows', () => {
  assert.deepEqual(read('DM: Matthew Mercer\nLaura Bailey: Vex').credits, ['GM/DM: Matthew Mercer']);
});

test('a game master under a heading survives when the players are held', () => {
  assert.deepEqual(read('Gamemaster\nMichael\n\nCast\n\nAngela - Reaper\nDoug - Blinder').credits, ['GM/DM: Michael']);
});

test('pronouns are not a character', () => {
  assert.deepEqual(read('Game Master: Ann Lee (she/her)').credits, ['GM/DM: Ann Lee']);
  // A one-word GM is read from the GM line; no row under it becomes a player.
  assert.deepEqual(read(BLUE_NOTE).credits, ['GM/DM: Skye']);
});

test('a linked game master line keeps the game master', () => {
  const text = 'DM: Mark Hulmes - https://example.com/m\nDaisy: Katie Morrison - https://example.com/k';
  assert.deepEqual(read(text).credits, ['GM/DM: Mark Hulmes']);
});

test('"as" and brackets are still read', () => {
  assert.deepEqual(read('Cast:\nJasmine Bhullar as The Dungeon Master\nChristian Navarro as Eloin, a Ranger').credits, [
    'GM/DM: Jasmine Bhullar',
    'player: Christian Navarro as Eloin',
  ]);
  assert.deepEqual(read('Cast: Emily Axford (Fig), Zac Oyama (Gorgug)').credits, [
    'player: Emily Axford as Fig',
    'player: Zac Oyama as Gorgug',
  ]);
});

test('the sweep does not count held rows as a table', () => {
  const video = { id: '1', title: 't', url: 'u', publishedAt: '', description: BLUE_NOTE };
  assert.ok(tableSize([video]) < 2);
});
