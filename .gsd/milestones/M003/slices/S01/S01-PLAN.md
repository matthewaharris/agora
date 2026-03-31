# S01: Reference Agents — Research & Extraction Demo

**Goal:** Build two standalone reference agent scripts that execute the PRD Section 7 demo scenario — research-agent processes summarization tasks, extraction-agent discovers and delegates
**Demo:** After this: Run research-agent and extraction-agent in two terminals; extraction-agent discovers and sends task; research-agent returns summarized result

## Tasks
- [x] **T01: Built research-agent with task processing, topic-aware summaries, and graceful lifecycle** — 1. Create agents/research-agent/index.ts:
   - Instantiates OACPAgent with 'research-summarization' capability
   - Registers and starts heartbeat
   - Listens for 'task_request' messages
   - On task: simulates research (can optionally call an LLM), produces summary
   - Sends task_result back to requester
   - Graceful shutdown on SIGINT
2. Create agents/research-agent/package.json with ts-node/tsx dependency
3. Create agents/research-agent/.env.example with required vars
4. Add npm script to run: npm run agent:research
  - Estimate: 25min
  - Files: agents/research-agent/index.ts, agents/research-agent/package.json, agents/research-agent/.env.example
  - Verify: TypeScript compiles; agent script has register, on('task_request'), send('task_result')
- [x] **T02: Built extraction-agent with discovery, task delegation, result processing, and entity extraction** — 1. Create agents/extraction-agent/index.ts:
   - Instantiates OACPAgent with 'data-extraction' capability
   - Registers and starts heartbeat
   - Discovers agents with 'research-summarization' capability
   - Sends task_request to discovered agent
   - Listens for task_result and logs the response
   - Optionally processes the result (extract key entities)
   - Graceful shutdown on SIGINT
2. Create agents/extraction-agent/package.json
3. Create agents/extraction-agent/.env.example
4. Add npm script: npm run agent:extraction
  - Estimate: 20min
  - Files: agents/extraction-agent/index.ts, agents/extraction-agent/package.json, agents/extraction-agent/.env.example
  - Verify: TypeScript compiles; agent script has register, discover, send('task_request'), on('task_result')
- [x] **T03: Added agent npm scripts and committed S01** — 1. Verify both agent scripts have correct structure
2. Update root package.json with agent:research and agent:extraction scripts
3. Commit all S01 work
  - Estimate: 10min
  - Files: package.json
  - Verify: npm run scripts listed; git commit succeeds
