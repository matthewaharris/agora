/**
 * OACP Research Agent
 *
 * A reference agent that:
 * - Registers with the OACP Registry as 'research-summarization'
 * - Listens for task_request messages
 * - Processes research tasks (summarization)
 * - Returns task_result with the summary
 *
 * This is Agent A from the PRD Section 7 demo scenario.
 *
 * Usage:
 *   cd agents/research-agent
 *   cp .env.example .env  # fill in your Supabase credentials
 *   npm install && npm start
 */

import 'dotenv/config';
import { OACPAgent } from 'oacp-sdk';
import type { MessageEnvelope } from 'oacp-sdk';

// ============================================================
// Configuration
// ============================================================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_ANON_KEY in environment');
  console.error('   Copy .env.example to .env and fill in your credentials');
  process.exit(1);
}

// ============================================================
// Research Summarization Logic
// ============================================================

/**
 * Process a research task and produce a summary.
 *
 * In a production agent, this would call an LLM API (OpenAI, Anthropic, etc.).
 * For the demo, we return a pre-built summary about the topic.
 */
async function processResearchTask(
  task: string,
): Promise<{ summary: string; word_count: number; source: string }> {
  console.log(`[Research] Processing: "${task}"`);

  // Simulate processing delay (would be LLM call in production)
  await new Promise((r) => setTimeout(r, 2000 + Math.random() * 1000));

  // Generate a contextual summary based on the task
  const summary = generateSummary(task);
  const wordCount = summary.split(/\s+/).length;

  return {
    summary,
    word_count: wordCount,
    source: 'oacp-research-agent/v0.1.0',
  };
}

/**
 * Generate a summary. In production, this calls an LLM.
 * For demo purposes, returns a relevant pre-built response.
 */
function generateSummary(task: string): string {
  const taskLower = task.toLowerCase();

  if (taskLower.includes('agent') && taskLower.includes('protocol')) {
    return (
      'The AI agent protocol landscape in 2026 is defined by four complementary standards: ' +
      'MCP (Model Context Protocol) by Anthropic handles agent-to-tool connections with 97M+ monthly downloads. ' +
      'A2A (Agent-to-Agent) by Google, now at v0.3 under the Linux Foundation with 150+ backers, ' +
      'standardizes agent discovery via Agent Cards and task delegation via HTTP/SSE/JSON-RPC. ' +
      'ACP (Agent Commerce Protocol) from IBM addresses commerce transactions between agents. ' +
      'UCP (Universal Commerce Protocol) by Google handles shopping lifecycle semantics. ' +
      'Together these protocols form a layered stack: MCP for tool access, A2A for agent coordination, ' +
      'and ACP/UCP for commercial transactions. OACP adds a unique registry-and-relay pattern ' +
      'that enables agents behind NATs or in local development to participate in the ecosystem ' +
      'without exposing public HTTP endpoints — functioning like TURN/STUN does for WebRTC.'
    );
  }

  if (taskLower.includes('supabase')) {
    return (
      'Supabase is an open-source Firebase alternative built on PostgreSQL. ' +
      'It provides a full backend stack: Postgres database with Row Level Security, ' +
      'real-time subscriptions via WebSocket channels, Edge Functions (Deno-based TypeScript), ' +
      'authentication, storage, and vector embeddings. Edge Functions are globally distributed ' +
      'and support the Deno runtime with access to npm packages via esm.sh. ' +
      'Supabase Realtime enables pub-sub patterns by subscribing to database changes, ' +
      'making it well-suited for message bus architectures like OACP.'
    );
  }

  // Default response for any topic
  return (
    `Research summary for "${task}": ` +
    'This topic spans multiple domains and is actively evolving. ' +
    'Key findings indicate significant progress in standardization efforts, ' +
    'with growing industry adoption and emerging best practices. ' +
    'Further investigation recommended for domain-specific insights ' +
    'and implementation guidance tailored to your specific use case.'
  );
}

// ============================================================
// Agent Setup
// ============================================================

const agent = new OACPAgent({
  name: 'matts-research-agent',
  capabilities: ['research-summarization'],
  ownerHandle: 'matt',
  description: 'Summarizes research topics on demand via OACP task protocol',
  supabaseUrl: SUPABASE_URL,
  supabaseAnonKey: SUPABASE_ANON_KEY,
  keypairPath: './.oacp-keypair.json',
  heartbeatIntervalMs: 30_000,
});

// ============================================================
// Task Handler
// ============================================================

async function handleTaskRequest(msg: MessageEnvelope): Promise<void> {
  const payload = msg.payload as Record<string, unknown>;
  const task = (payload.task as string) || 'No task specified';
  const correlationId = msg.correlation_id;

  console.log(`\n📨 Task received from ${msg.sender_agent_id.substring(0, 8)}...`);
  console.log(`   Task: "${task}"`);
  console.log(`   Correlation: ${correlationId || 'none'}`);

  try {
    // Process the research task
    const result = await processResearchTask(task);

    // Send task_result back
    await agent.send(msg.sender_agent_id, 'task_result', result, {
      correlationId: correlationId,
    });

    console.log(`✅ Result sent (${result.word_count} words)`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error(`❌ Task failed: ${errorMsg}`);

    // Send task_error back
    await agent.send(msg.sender_agent_id, 'task_error', {
      error: errorMsg,
      task,
    }, {
      correlationId: correlationId,
    });
  }
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.log('🔬 OACP Research Agent starting...\n');

  // Register
  const agentId = await agent.register();
  console.log(`📝 Registered as ${agentId}`);
  console.log(`🔑 Public key: ${agent.getPublicKey().substring(0, 16)}...`);

  // Start heartbeat
  agent.startHeartbeat();

  // Listen for task requests
  agent.on('task_request', (msg) => {
    handleTaskRequest(msg as MessageEnvelope).catch(console.error);
  });

  console.log('\n⏳ Waiting for task requests... (Ctrl+C to stop)\n');

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n🛑 Shutting down...');
    await agent.shutdown();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep running
  await new Promise(() => {});
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
