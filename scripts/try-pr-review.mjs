/**
 * Run the pr-review agent on one public PR, locally, and print every step.
 * No registry, no fleet — it calls the resident's review-pr handler directly.
 *
 * Usage (from the repo root; needs ANTHROPIC_API_KEY, GITHUB_TOKEN optional):
 *   node --import tsx scripts/try-pr-review.mjs https://github.com/owner/repo/pull/123
 *
 * Experiments:
 *   PR_REVIEW_MAX_STEPS=2 ...        force the step cap
 *   PR_REVIEW_TOKEN_BUDGET=5000 ...  force the token budget
 */
import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { createPrReviewer } = await import(join(ROOT, 'agents/fleet-host/src/residents/pr-review.ts'));

const prUrl = process.argv[2];
if (!prUrl) {
  console.error('Usage: node --import tsx scripts/try-pr-review.mjs <public PR url>');
  process.exit(1);
}

const reviewPr = createPrReviewer().actions.find((a) => a.spec.name === 'review-pr');
const result = await reviewPr.handler({ pr_url: prUrl }, {});

console.log('\n── steps ─────────────────────────────────────────');
for (const s of result.steps) {
  const mark = s.ok ? 'ok ' : 'ERR';
  console.log(`${String(s.step).padStart(2)}. ${mark} ${s.tool} ${JSON.stringify(s.input)} (${s.duration_ms} ms)${s.error ? ` — ${s.error}` : ''}`);
}
console.log('── outcome ───────────────────────────────────────');
console.log(`stop_reason:     ${result.stop_reason}`);
console.log(`review_complete: ${result.review_complete}`);
console.log(`tool_calls:      ${result.tool_calls}`);
console.log(`files_read:      ${result.files_read.join(', ') || '(none)'}`);
console.log(`tokens_used:     ${result.tokens_used}`);
console.log(`duration:        ${result.duration_ms} ms`);
console.log('── review ────────────────────────────────────────');
console.log(`verdict: ${result.verdict}${result.verdict_reported ? ` (model reported: ${result.verdict_reported})` : ''}`);
for (const issue of result.issues) {
  console.log(`- [${issue.severity}] (${issue.basis ?? '?'}) ${issue.file}: ${issue.description}`);
}
console.log(`\n${result.summary}`);
