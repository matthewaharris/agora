---
estimated_steps: 6
estimated_files: 2
skills_used: []
---

# T03: Update reference agents with action specs and verify end-to-end

1. Update research-agent to use registerAction() with action_spec
2. Update extraction-agent to handle task_error from rejected requests
3. Build SDK, run both agents, verify:
   - Valid task is accepted and processed
   - Task with wrong action name is rejected
4. Commit and push

## Inputs

- None specified.

## Expected Output

- `agents/research-agent/index.ts (updated)`
- `agents/extraction-agent/index.ts (updated)`

## Verification

Both agents run; valid task completes; SDK builds clean; git push succeeds
