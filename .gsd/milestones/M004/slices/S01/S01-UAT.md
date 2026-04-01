# S01: Agent Trust Model — Action Specs & Sender Allowlists — UAT

**Milestone:** M004
**Written:** 2026-04-01T04:50:52.406Z

## UAT: M004/S01 — Agent Trust Model\n\n### Test 1: Action Specs\n- [x] Agent declares summarize-text action with inputSchema\n- [x] Action spec published in Agent Card metadata\n- [x] registerAction() sets up trust pipeline\n\n### Test 2: Trust Pipeline\n- [x] Sender check passes for 'open' policy\n- [x] Action matching finds summarize-text by payload.action field\n- [x] Payload validation passes for valid input\n- [x] Handler executes and auto-sends task_result\n\n### Test 3: End-to-End\n- [x] Research agent registers with action spec\n- [x] Extraction agent sends task with action field\n- [x] Trust check passes, task executes, result returned\n- [x] Full cycle completes in ~3 seconds
