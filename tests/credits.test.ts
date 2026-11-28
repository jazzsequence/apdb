import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GUEST_NOTE, startYear, statedRole, upsertCredit } from '../src/lib/credits.js';
import type { Credit } from '../src/lib/schema.js';

const credit = (role: string, url: string, extra: object = {}) =>
  ({ show: 'x', season: 1, role, sources: [{ tier: 'reference', url }], ...extra }) as Credit;

const catalogue = 'https://www.imdb.com/title/tt1/';
const wiki = 'https://example.fandom.com/wiki/X';

for (const explicitRole of [true, false]) {
  test(`a guest note never lands on a regular or GM credit (explicitRole ${explicitRole})`, () => {
    for (const [held, claimed] of [['player', 'guest player'], ['GM/DM', 'guest GM']] as const) {
      const { credits } = upsertCredit(
        [credit(held, 'https://a.test')],
        credit(claimed, 'https://b.test', { note: GUEST_NOTE }),
        { explicitRole },
      );
      assert.equal(credits.length, 1);
      assert.equal(credits[0]!.note, undefined);
      assert.equal(credits[0]!.sources.length, 2);
    }
  });
}

test('a guest credit still gains the guest note, and other notes still carry', () => {
  const guest = upsertCredit(
    [credit('guest player', 'https://a.test')],
    credit('guest player', 'https://b.test', { note: GUEST_NOTE }),
  );
  assert.equal(guest.credits[0]!.note, GUEST_NOTE);

  const other = upsertCredit([credit('player', 'https://a.test')], credit('player', 'https://b.test', { note: 'Played twice.' }));
  assert.equal(other.credits[0]!.note, 'Played twice.');
});

test('only a catalogue "player" folds into a GM credit', () => {
  const gm = [credit('GM/DM', 'https://a.test')];
  assert.equal(upsertCredit(gm, credit('player', catalogue)).credits.length, 1);
  assert.equal(upsertCredit(gm, credit('player', wiki)).credits.length, 2);
  assert.equal(upsertCredit(gm, credit('player', catalogue), { explicitRole: true }).credits.length, 2);
  const mixed = credit('player', catalogue);
  mixed.sources.push({ tier: 'community', url: wiki });
  assert.equal(upsertCredit(gm, mixed).credits.length, 2);
});

test('only stated roles and usable years are written', () => {
  assert.equal(statedRole('Dungeon Master'), 'GM/DM');
  assert.equal(statedRole('Herself'), undefined);
  assert.equal(statedRole('Imogen Temult'), undefined);
  assert.equal(startYear('2019–present'), '2019');
  assert.equal(startYear('present'), undefined);
});
