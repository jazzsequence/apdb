// Layouts below are shortened from real production descriptions.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { knownPerformers, parseCast, type CastOptions } from '../src/lib/sources/youtube.js';
import { tableSize } from '../src/lib/youtube-series.js';

const read = (text: string, options: CastOptions = {}) => {
  const cast = parseCast(text, options);
  return {
    credits: cast.credits.map((c) => `${c.role}: ${c.name}${c.character ? ` as ${c.character}` : ''}`),
    unresolved: cast.unresolved.length,
  };
};
const knowing = (...names: string[]): CastOptions => ({
  isPerson: knownPerformers(names.map((n) => ({ canonical_name: n, aliases: [] }))),
});

const BLUE_NOTE = `CAST:

Game Master: Skye (she/her)
Carmen: Emma (she/her)
Romeo: Max (they/them)
Luka: Josh (he/him)

All art, animations, editing and sound effects by Naren.`;

test('with nothing to say which side is the player, only the GM is filed', () => {
  assert.deepEqual(read(BLUE_NOTE), { credits: ['GM/DM: Skye'], unresolved: 3 });
});

test('one known performer settles the whole cast, either way round', () => {
  assert.deepEqual(read('Cast:\nAankia: Hank Green\nLemley: Laura Bailey', knowing('Laura Bailey')).credits, [
    'player: Hank Green as Aankia',
    'player: Laura Bailey as Lemley',
  ]);
  assert.deepEqual(read('Cast:\nHank Green - Aankia\nLaura Bailey - Lemley', knowing('Laura Bailey')).credits, [
    'player: Hank Green as Aankia',
    'player: Laura Bailey as Lemley',
  ]);
});

test('evidence both ways, or only a first name, settles nothing', () => {
  const both = 'Cast:\nLaura Bailey: Lemley\nAankia: Hank Green';
  assert.deepEqual(read(both, knowing('Laura Bailey', 'Hank Green')), { credits: [], unresolved: 2 });
  const first = 'Cast:\nAngela - Reaper\nDoug - Blinder';
  assert.deepEqual(read(first, knowing('Angela', 'Doug')), { credits: [], unresolved: 2 });
});

test('a GM line does not make the lines under it character first', () => {
  const text = 'DM: Mark Hulmes\nDaisy Fields: Katie Morrison\nRowan Pike: Chris Trott';
  assert.deepEqual(read(text), { credits: ['GM/DM: Mark Hulmes'], unresolved: 2 });
  assert.deepEqual(read(text, knowing('Chris Trott')).credits.slice(1), [
    'player: Katie Morrison as Daisy Fields',
    'player: Chris Trott as Rowan Pike',
  ]);
});

test('"as", "played by" and brackets need no outside evidence', () => {
  assert.deepEqual(read('Cast:\nJasmine Bhullar as The Dungeon Master\nChristian Navarro as Eloin, a Ranger').credits, [
    'GM/DM: Jasmine Bhullar',
    'player: Christian Navarro as Eloin',
  ]);
  assert.deepEqual(read('Cast:\nIryna (Played by Milo Mannion)\nHoisin - Mallard Fighter (Played by Josh Hodge)').credits, [
    'player: Milo Mannion as Iryna',
    'player: Josh Hodge as Hoisin',
  ]);
  assert.deepEqual(read('Cast: Emily Axford (Fig), Zac Oyama (Gorgug)').credits, [
    'player: Emily Axford as Fig',
    'player: Zac Oyama as Gorgug',
  ]);
});

test('crew lines are never players', () => {
  const text = `Dungeon Master: Jasmine Bhullar
Director/EP: Joe Starr
Producer: Amy Dallen
Set & Shoot: HyperRPG
Hair & Make-Up: Kait Matlock
Audio: Michael J Rich
Camera Operator: Sean Goode`;
  const { credits } = read(text, knowing('Joe Starr', 'Amy Dallen'));
  assert.deepEqual(credits.filter((c) => /player/.test(c)), []);
});

test('an advert under the cast is neither filed nor held', () => {
  const text = `Cast:
Jasmine Bhullar as The Dungeon Master
Neil Newbon as Professor Crem
Pre-order Ravenloft: The Horrors Within: https://example.com/book`;
  assert.deepEqual(read(text, knowing('Jasmine Bhullar')), {
    credits: ['GM/DM: Jasmine Bhullar', 'player: Neil Newbon as Professor Crem'],
    unresolved: 0,
  });
});

test('"as your Gamemaster" is the game master', () => {
  const { credits } = read('Cast:\nDaniel Lok as your Gamemaster, Writer and Editor\nAnn Lee as Mim');
  assert.equal(credits[0], 'GM/DM: Daniel Lok');
});

test('a name list after "Featuring" is a cast; a synopsis after "With" is not', () => {
  assert.equal(read('Featuring Ivan Van Norman, Amy Vorpahl, and Keller Knoblock, using V5.').credits.length > 0, true);
  assert.deepEqual(read("With Prince Skjoll and Lady Azalea's treason looming, danger threatens.").credits, []);
  assert.deepEqual(read('Cast Members Jasmine Bhullar, Caroline Lux').credits, [
    'player: Jasmine Bhullar',
    'player: Caroline Lux',
  ]);
});

test('the sweep counts only the table the cast import would file', () => {
  const video = { id: '1', title: 't', url: 'u', publishedAt: '', description: BLUE_NOTE };
  assert.equal(tableSize([video]), 1);
});
