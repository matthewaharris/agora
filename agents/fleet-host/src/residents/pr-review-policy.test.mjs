/**
 * review-pr result policy — measured facts overrule reported ones.
 *
 * Run: node --import tsx agents/fleet-host/src/residents/pr-review-policy.test.mjs
 */
import assert from 'node:assert/strict';
import { applyReviewPolicy } from './pr-review-policy.ts';

const review = (verdict, issues = []) => ({ verdict, issues, suggestions: [], summary: 's' });
const issue = (basis) => ({ severity: 'medium', file: 'a.ts', description: 'd', basis });

let n = 0;
const test = (name, fn) => {
  fn();
  console.log(`  ok  ${name}`);
  n++;
};

test('a completed run keeps its approval', () => {
  const out = applyReviewPolicy(review('approve'), { stopReason: 'completed', filesRead: ['a.ts'] });
  assert.equal(out.verdict, 'approve');
  assert.equal('verdict_reported' in out, false);
});

for (const stopReason of ['step_cap', 'token_budget', 'output_truncated', 'refused']) {
  test(`${stopReason}: an approval becomes incomplete, and the reported verdict is kept`, () => {
    const out = applyReviewPolicy(review('approve'), { stopReason, filesRead: ['a.ts'] });
    assert.equal(out.verdict, 'incomplete');
    assert.equal(out.verdict_reported, 'approve');
  });
}

test('a cut-short run keeps request_changes and its issues', () => {
  const issues = [issue('verified')];
  const out = applyReviewPolicy(review('request_changes', issues), { stopReason: 'step_cap', filesRead: ['a.ts'] });
  assert.equal(out.verdict, 'request_changes');
  assert.deepEqual(out.issues, issues);
});

test('"verified" with no file read becomes diff_only', () => {
  const out = applyReviewPolicy(review('request_changes', [issue('verified'), issue('diff_only')]), {
    stopReason: 'completed',
    filesRead: [],
  });
  assert.deepEqual(
    out.issues.map((i) => [i.basis, i.basis_reported]),
    [
      ['diff_only', 'verified'],
      ['diff_only', undefined],
    ],
  );
});

test('malformed issues pass through untouched', () => {
  const out = applyReviewPolicy(review('comment', ['text', null]), { stopReason: 'completed', filesRead: [] });
  assert.deepEqual(out.issues, ['text', null]);
});

console.log(`\n${n} passed`);
