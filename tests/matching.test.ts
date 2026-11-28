import assert from 'node:assert/strict';
import { test } from 'node:test';
import { personMatcher } from '../src/lib/match-person.js';
import { rotateForWeek } from '../src/lib/rotation.js';
import type { Person } from '../src/lib/schema.js';

const person = (id: string, name: string, show: string, aliases: string[] = []) =>
  ({
    id,
    canonical_name: name,
    aliases: [name, ...aliases].map((n) => ({ name: n })),
    credits: [{ show }],
  }) as unknown as Person;

const shows = [
  { id: 'home', channels: ['c1'] },
  { id: 'sibling', channels: ['c1'] },
  { id: 'other', channels: ['c2'] },
  { id: 'second', channels: ['c3'] },
];
const matcher = () =>
  personMatcher(
    [
      person('travis', 'Travis', 'home'),
      person('jenny-smith', 'Jenny Smith', 'home', ['Jenn']),
      person('jo-doe', 'Jo Doe', 'home'),
      person('jo-doe-2', 'Jo Doe', 'other'),
    ],
    shows,
  );

test('a one-word name needs history on the show or its channel', () => {
  assert.equal(matcher().match('Travis', 'travis', 'other').kind, 'held');
  assert.equal(matcher().match('travis', 'travis', 'sibling').kind, 'existing');
  assert.equal(matcher().match('Jenn', 'jenn', 'home').kind, 'existing');
  assert.equal(matcher().match('Jenn', 'jenn', 'other').kind, 'held');
});

test('a shared full name is held; an unknown name is new', () => {
  assert.equal(matcher().match('Jo Doe', 'jo-doe', 'second').kind, 'held');
  assert.equal(matcher().match('New Name', 'new-name', 'home').kind, 'new');
});

test('a person written earlier in a run is matched afterwards', () => {
  const m = matcher();
  m.add(person('kyle', 'Kyle', 'second'));
  assert.equal(m.match('Kyle', 'kyle', 'second').kind, 'existing');
  assert.equal(m.match('Kyle', 'kyle', 'other').kind, 'held');
});

test('four weekly runs that each cover a quarter reach everyone', () => {
  for (const size of [0, 1, 3, 4, 5, 174, 178]) {
    const items = Array.from({ length: size }, (_, i) => i);
    const seen = new Set<number>();
    for (let week = 2900; week < 2904; week++) {
      const queue = rotateForWeek(items, week);
      assert.equal(queue.length, size);
      for (const i of queue.slice(0, Math.ceil(size / 4))) seen.add(i);
    }
    assert.equal(seen.size, size, `size ${size}`);
  }
});
