import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyMutation, buildEvidence, changedHunks, completionStatus, mutationResult, renderEvidence, requirementIds, validMutation } from './evidence.mjs';

const diff = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,2 +1,3 @@',
  ' one',
  '+two',
  ' three',
  '@@ -10,1 +11,2 @@',
  ' ten',
  '+eleven',
  'diff --git a/src/a.spec.ts b/src/a.spec.ts',
  '--- a/src/a.spec.ts',
  '+++ b/src/a.spec.ts',
  '@@ -0,0 +1,1 @@',
  '+test',
  'diff --git a/src/gone.ts b/src/gone.ts',
  '--- a/src/gone.ts',
  '+++ /dev/null',
  '@@ -1,1 +0,0 @@',
  '-removed',
].join('\n');
const file = 'one\ntwo\nthree\n4\n5\n6\n7\n8\n9\n10\nten\neleven';
const read = () => file;

test('changedHunks returns production hunks only, deletions included', () => {
  const hunks = changedHunks(diff);
  assert.deepEqual(hunks.map((h) => [h.file, h.start, h.end]), [['src/a.ts', 1, 3], ['src/a.ts', 11, 12], ['src/gone.ts', 0, 0]]);
  assert.match(hunks[1].text, /\+eleven/);
});

test('requirementIds reads the numbered list under Requirements only', () => {
  const brief = '# T\n1. not this\n## Requirements\n1. a\n   detail\n2. b\n## Out of scope\n3. no';
  assert.deepEqual(requirementIds(brief), ['1', '2']);
});

test('a claim with a real quote gets a snippet cut by the script, not the model', () => {
  const claims = [{ requirement: '1', file: 'src/a.ts', line: 2, quote: 'two', why: 'adds two' }];
  const pack = buildEvidence({ claims, diff, requirements: ['1'], readFile: read });
  assert.equal(pack.verified.length, 1);
  assert.match(pack.verified[0].snippet, /2: two/);
  assert.match(pack.verified[0].snippet, /1: one/);
  assert.deepEqual(pack.missing, []);
});

test('an invented quote is rejected and does not satisfy its requirement', () => {
  const claims = [{ requirement: '1', file: 'src/a.ts', line: 2, quote: 'invented', why: 'x' }];
  const pack = buildEvidence({ claims, diff, requirements: ['1'], readFile: read });
  assert.equal(pack.verified.length, 0);
  assert.equal(pack.rejected.length, 1);
  assert.deepEqual(pack.missing, ['1']);
});

test('a hunk no claim cites is surfaced, so the model cannot hide a change', () => {
  const claims = [{ requirement: '1', file: 'src/a.ts', line: 2, quote: 'two', why: 'x' }];
  const pack = buildEvidence({ claims, diff, requirements: ['1'], readFile: read });
  assert.deepEqual(pack.uncited.map((h) => [h.file, h.start]), [['src/a.ts', 11], ['src/gone.ts', 0]]);
});

test('a real quote outside any changed hunk does not count as citing one', () => {
  const claims = [{ requirement: '1', file: 'src/a.ts', line: 6, quote: '6', why: 'x' }];
  const pack = buildEvidence({ claims, diff, requirements: ['1'], readFile: read });
  assert.equal(pack.uncited.length, 3);
});

test('no claims at all fails safe: everything is surfaced for reading', () => {
  const pack = buildEvidence({ claims: [], diff, requirements: ['1', '2'], readFile: read });
  assert.equal(pack.uncited.length, 3);
  assert.deepEqual(pack.missing, ['1', '2']);
});

test('renderEvidence shows gaps, rejected claims and uncited code', () => {
  const pack = buildEvidence({ claims: [{ requirement: '1', file: 'src/a.ts', line: 2, quote: 'nope', why: 'x' }], diff, requirements: ['1'], readFile: read });
  const text = renderEvidence(pack, [{ file: 'src/a.ts', line: 2, result: 'SURVIVED', test: 't' }]);
  assert.match(text, /No verified claim for requirements: 1/);
  assert.match(text, /Rejected/);
  assert.match(text, /\+eleven/);
  assert.match(text, /SURVIVED/);
});

test('applyMutation replaces the real line only, and refuses a quote that is not there', () => {
  assert.equal(applyMutation('a\nif (x) y;\nb', { line: 2, quote: 'if (x) y;', replacement: 'y;' }), 'a\ny;\nb');
  assert.equal(applyMutation('a\nb', { line: 2, quote: 'nope', replacement: 'y' }), null);
  assert.equal(applyMutation('a\nb', { line: 2, quote: 'b', replacement: 'b' }), null);
});

test('validMutation rejects malformed entries instead of crashing the run', () => {
  const ok = { file: 'src/a.ts', line: 2, quote: 'x', replacement: 'y', test: 'pnpm test' };
  assert.equal(validMutation(ok), true);
  for (const bad of [null, {}, { ...ok, file: undefined }, { ...ok, test: undefined }, { ...ok, line: '2' }, { ...ok, replacement: 1 }]) {
    assert.equal(validMutation(bad), false);
  }
  assert.equal(validMutation({ ...ok, file: 'src/a.spec.ts' }), false);
  assert.equal(validMutation({ ...ok, file: 'apps/api/test/a.ts' }), false);
  // pnpm hardlinks node_modules into the shared store, so a mutation there edits every project's copy.
  assert.equal(validMutation({ ...ok, file: 'node_modules/x/index.js' }), false);
  assert.equal(validMutation({ ...ok, file: 'apps/api/node_modules/x/index.js' }), false);
  assert.equal(validMutation({ ...ok, file: '.git/config' }), false);
});

test('completionStatus needs a caught mutation inside the change itself', () => {
  const hunks = [{ file: 'src/a.ts', start: 10, end: 20 }];
  const inChange = { file: 'src/a.ts', line: 15, result: 'KILLED' };
  assert.equal(completionStatus([inChange, { ...inChange, result: 'INVALID' }], hunks), 'DONE');
  assert.equal(completionStatus([{ ...inChange, result: 'INVALID' }], hunks), 'DONE_UNMUTATED');
  assert.equal(completionStatus([{ ...inChange, result: 'SURVIVED' }], hunks), 'DONE_UNMUTATED');
  assert.equal(completionStatus([], hunks), 'DONE_UNMUTATED');
  assert.equal(completionStatus([{ file: 'src/other.ts', line: 15, result: 'KILLED' }], hunks), 'DONE_UNMUTATED');
  assert.equal(completionStatus([{ file: 'src/a.ts', line: 21, result: 'KILLED' }], hunks), 'DONE_UNMUTATED');
});

test('mutationResult only counts a real test failure as caught', () => {
  assert.equal(mutationResult(0), 'SURVIVED');
  assert.equal(mutationResult(1), 'KILLED');
  assert.equal(mutationResult(null), 'INVALID'); // killed by a signal, such as the idle timeout: the test never finished
});

test('null and non-object claims from the model do not throw', () => {
  const pack = buildEvidence({ claims: [null, 'x', 3], diff, requirements: ['1'], readFile: read });
  assert.equal(pack.verified.length, 0);
  assert.equal(pack.uncited.length, 3);
  assert.deepEqual(pack.missing, ['1']);
});
