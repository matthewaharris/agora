---
estimated_steps: 10
estimated_files: 1
skills_used: []
---

# T02: Integrate trust validation into OACPAgent message pipeline

1. Modify OACPAgent.on() to run a validation pipeline before dispatching:
   a. Check sender against allowedSenders
   b. Match message payload against action_spec inputSchema
   c. If validation fails, auto-send task_error back with reason
   d. If validation passes, invoke handler
2. Add registerAction(spec, handler) method as alternative to raw on()
   - Binds an action_spec to a handler
   - Multiple actions per agent
3. Log all trust decisions (accepted/rejected with reason)
4. Include action_specs in Agent Card metadata on registration

## Inputs

- `packages/oacp-sdk/src/trust.ts`

## Expected Output

- `packages/oacp-sdk/src/agent.ts (updated)`

## Verification

tsc --noEmit; agent.ts has registerAction, validation pipeline, trust logging
