# S01: Reference Agents — Research & Extraction Demo — UAT

**Milestone:** M003
**Written:** 2026-03-31T21:22:47.080Z

## UAT: M003/S01 — Reference Agents\n\n### Test 1: Research Agent\n- [ ] npm start in agents/research-agent/ registers and starts heartbeating\n- [ ] Agent appears in discovery with 'research-summarization' capability\n- [ ] Receives task_request and sends task_result with summary\n- [ ] Handles errors gracefully with task_error\n- [ ] Shuts down cleanly on SIGINT\n\n### Test 2: Extraction Agent\n- [ ] npm start in agents/extraction-agent/ registers and discovers research agent\n- [ ] Sends task_request with correlation_id\n- [ ] Receives task_result and extracts entities\n- [ ] Times out after 30s if no response\n- [ ] Shuts down cleanly on completion or SIGINT\n\n### Test 3: End-to-End\n- [ ] Start research-agent in terminal 1\n- [ ] Start extraction-agent in terminal 2\n- [ ] Extraction agent discovers research agent\n- [ ] Task request → result cycle completes\n- [ ] Entities extracted and displayed
