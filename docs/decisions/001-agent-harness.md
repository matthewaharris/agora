# Decision 001 — Agent harness for the fleet host

**Date:** 2026-11-09 · **Phase:** 1 (Harness) · **Status:** accepted
**Decided by:** Matthew, taking Claude's recommended option on all three.

## Context

Every fleet resident made exactly one model call per task. `pr-review` could only see the diff,
so it could not check how a changed function is used elsewhere. A single call also leaves no
trajectory to record, nothing to checkpoint and nothing for memory to improve, which blocks
phases 2–7 of `docs/AGENT-PLATFORM-ROADMAP.md`.

## Decisions

### 1. Tools: read-only, bound to one repository and one commit

`read_file`, `list_directory`, and `search_code` (only when the owner has set `GITHUB_TOKEN`,
because GitHub's code search requires authentication).

- The repository and commit are fixed by the harness from the PR, not chosen by the model. A
  malicious PR cannot steer the agent to another repository.
- No write tools, no web fetch, no CI or comment access.
- **Rejected:** PR context tools (CI status, review comments) and web fetch. Each widens what
  injected text in a PR could make the agent do, for context the review rarely needs.

### 2. Stopping: the model decides, inside hard caps

The model ends the loop when it has enough. Two caps bound it: a tool-call limit and a total
token budget. When a cap is hit the harness skips the pending tool calls, tells the model, and
forces one final turn with tools disabled.

- A capped run is reported as incomplete (`review_complete: false`, `stop_reason`), so the
  caller can tell a finished review from one that ran out of budget.
- **Rejected:** fixed step count (wastes calls on simple PRs, starves complex ones) and no caps
  (unbounded spend on a public, open-sender agent).

### 3. Placement: a small shared module, one user

`agents/fleet-host/src/runtime/` holds the loop and the tool interface. Only `pr-review` uses it.

- The harness knows nothing about GitHub or reviews; the resident supplies prompt, tools, limits.
- **Rejected:** keeping it inside the resident (phase 2 would have to extract it anyway) and
  moving every resident now (guessing at needs not yet seen).

### 4. Result policy: measured facts overrule reported ones

Added 2026-11-10, after a live run capped at two tool calls returned "approve" having read one
file out of the three the change depended on.

The model reports a verdict and a `basis` for each issue. The harness measures why the run
stopped and which files were read. `residents/pr-review-policy.ts` applies two rules in code:

- A run that did not end on the model's own decision cannot approve. The verdict becomes
  `incomplete` and the model's verdict is kept in `verdict_reported`. Issues are kept, and so is
  `request_changes`: a partial read can support "I found a problem" but not "I found none".
- An issue marked `verified` when no file was read is relabelled `diff_only`.
- **Rejected:** passing the result through with only the `review_complete` flag (every caller
  must remember to check it), rejecting the run (discards paid-for findings), and automatic
  retry with a larger budget (worth doing, but needs a spend ceiling; left for phase 5).
- **Known gap:** a completed run can still approve without reading everything the change
  depends on. `completed` means the model chose to stop, not that coverage was sufficient.
  That needs an eval, which is phase 3.

## Consequences

- `review-pr` now costs several model turns and several GitHub API calls per task. Anonymous
  GitHub access allows 60 requests an hour, so a busy host needs `GITHUB_TOKEN`.
- `review-diff` (pasted diff, private repos) stays single-call: there is no repository to read.
- Step records are kept in memory and returned with the result. Persisting them is phase 2.
- The model and price per action are unchanged; revisit once phase 3 can measure quality per cost.

## Open questions for later phases

- Should findings carry RFC 007 assertions (`measured` for verified, `assumed` for diff-only)?
- Should the token budget be derived from the action price instead of an environment variable?
