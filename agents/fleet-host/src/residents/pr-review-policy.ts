/**
 * Result policy for the review-pr agent.
 *
 * The model REPORTS a verdict and a "basis" for each issue. The harness
 * MEASURES why the run stopped and which files were read. This module is
 * ordinary code that lets the measured facts overrule the reported ones:
 *
 *   1. A run that did not end on the model's own decision cannot approve.
 *      An approval claims nothing is wrong, and a partial read cannot support
 *      that. Issues it did find are kept: a partial read can still support
 *      "I found a problem".
 *   2. An issue cannot be "verified" when no file was read.
 *
 * See docs/decisions/001-agent-harness.md, decision 4.
 */
import type { StopReason } from '../runtime/harness.js';

export interface ReportedReview {
  verdict: string;
  issues: unknown[];
  suggestions: unknown[];
  summary: string;
}

export interface MeasuredRun {
  stopReason: StopReason;
  /** Paths the agent successfully read with read_file. */
  filesRead: string[];
}

export function applyReviewPolicy(reported: ReportedReview, measured: MeasuredRun) {
  const complete = measured.stopReason === 'completed';
  const downgradeVerdict = !complete && reported.verdict === 'approve';

  const issues = reported.issues.map((issue) => {
    if (typeof issue !== 'object' || issue === null) return issue;
    const record = issue as Record<string, unknown>;
    if (record.basis === 'verified' && measured.filesRead.length === 0) {
      return { ...record, basis: 'diff_only', basis_reported: 'verified' };
    }
    return issue;
  });

  return {
    ...reported,
    verdict: downgradeVerdict ? 'incomplete' : reported.verdict,
    // Present only when the platform overruled the model, so a caller can see both.
    ...(downgradeVerdict ? { verdict_reported: reported.verdict } : {}),
    issues,
  };
}
