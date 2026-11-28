import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findings, newFindings } from '../src/lib/audit-delta.js';

const report = (...sections: Array<[string, string[]]>) =>
  [
    '# Audit',
    '## Contents',
    ...sections.map(([name, items]) => `- [${name}](#x) — ${items.length}`),
    ...sections.flatMap(([name, items]) => ['', `## ${name}`, '', 'N finding(s).', '', ...items.map((i) => `- ${i}`)]),
  ].join('\n');

test('only findings that were not there before are new', () => {
  const before = report(['empty', ['A', 'B']]);
  const after = report(['empty', ['B', 'C']], ['inverted', ['A']]);
  assert.deepEqual(newFindings(before, after), ['[empty] C', '[inverted] A']);
  assert.deepEqual(newFindings(before, before), []);
});

test('the table of contents is not a finding, and a repeat counts', () => {
  assert.deepEqual(findings(report(['empty', ['A']])), ['[empty] A']);
  assert.deepEqual(newFindings(report(['empty', ['A']]), report(['empty', ['A', 'A']])), ['[empty] A']);
  assert.deepEqual(findings(report()), []);
});
