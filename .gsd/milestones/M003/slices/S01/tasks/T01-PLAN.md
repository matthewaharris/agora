---
estimated_steps: 10
estimated_files: 3
skills_used: []
---

# T01: Build research-agent

1. Create agents/research-agent/index.ts:
   - Instantiates OACPAgent with 'research-summarization' capability
   - Registers and starts heartbeat
   - Listens for 'task_request' messages
   - On task: simulates research (can optionally call an LLM), produces summary
   - Sends task_result back to requester
   - Graceful shutdown on SIGINT
2. Create agents/research-agent/package.json with ts-node/tsx dependency
3. Create agents/research-agent/.env.example with required vars
4. Add npm script to run: npm run agent:research

## Inputs

- `packages/oacp-sdk/src/agent.ts`
- `examples/two-agents.ts`

## Expected Output

- `agents/research-agent/index.ts`
- `agents/research-agent/package.json`

## Verification

TypeScript compiles; agent script has register, on('task_request'), send('task_result')
