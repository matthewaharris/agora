# S01: Agent Trust Model — Action Specs & Sender Allowlists

**Goal:** Add action_spec declarations, allowed_senders configuration, and pre-processing validation to the SDK so agents have bounded, auditable behavior
**Demo:** After this: Agent rejects out-of-scope task and unauthorized sender; accepts valid task from allowed sender

## Tasks
- [x] **T01: Defined ActionSpec, TrustPolicy types with payload validator and sender allowlist checker** — 1. Define ActionSpec interface in SDK types:
   - name: string (e.g., 'summarize-text')
   - description: string
   - inputSchema: JSON Schema object for payload validation
   - outputSchema: optional JSON Schema for response
2. Define TrustPolicy interface:
   - allowedSenders: string[] (agent_ids) | 'open' (anyone) | 'none' (reject all)
   - requireSignature: boolean (default true)
3. Extend AgentConfig to accept actionSpecs and trustPolicy
4. Add simple JSON Schema validator (lightweight, no dependency)
5. Export new types from index.ts
  - Estimate: 20min
  - Files: packages/oacp-sdk/src/types.ts, packages/oacp-sdk/src/trust.ts, packages/oacp-sdk/src/config.ts, packages/oacp-sdk/src/index.ts
  - Verify: tsc --noEmit passes; types exported
- [x] **T02: Integrated trust pipeline into OACPAgent: registerAction() with sender check, action matching, payload validation** — 1. Modify OACPAgent.on() to run a validation pipeline before dispatching:
   a. Check sender against allowedSenders
   b. Match message payload against action_spec inputSchema
   c. If validation fails, auto-send task_error back with reason
   d. If validation passes, invoke handler
2. Add registerAction(spec, handler) method as alternative to raw on()
   - Binds an action_spec to a handler
   - Multiple actions per agent
3. Log all trust decisions (accepted/rejected with reason)
4. Include action_specs in Agent Card metadata on registration
  - Estimate: 25min
  - Files: packages/oacp-sdk/src/agent.ts
  - Verify: tsc --noEmit; agent.ts has registerAction, validation pipeline, trust logging
- [ ] **T03: Update reference agents with action specs and verify end-to-end** — 1. Update research-agent to use registerAction() with action_spec
2. Update extraction-agent to handle task_error from rejected requests
3. Build SDK, run both agents, verify:
   - Valid task is accepted and processed
   - Task with wrong action name is rejected
4. Commit and push
  - Estimate: 20min
  - Files: agents/research-agent/index.ts, agents/extraction-agent/index.ts
  - Verify: Both agents run; valid task completes; SDK builds clean; git push succeeds
