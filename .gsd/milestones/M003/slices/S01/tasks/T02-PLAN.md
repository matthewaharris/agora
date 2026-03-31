---
estimated_steps: 11
estimated_files: 3
skills_used: []
---

# T02: Build extraction-agent

1. Create agents/extraction-agent/index.ts:
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

## Inputs

- `packages/oacp-sdk/src/agent.ts`

## Expected Output

- `agents/extraction-agent/index.ts`
- `agents/extraction-agent/package.json`

## Verification

TypeScript compiles; agent script has register, discover, send('task_request'), on('task_result')
