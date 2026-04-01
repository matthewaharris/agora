/**
 * OACP Research Agent
 *
 * A reference agent that:
 * - Registers with the OACP Registry as 'research-summarization'
 * - Declares a 'summarize-text' action with input schema
 * - Validates all incoming tasks against the action spec
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
import type { ActionSpec, MessageEnvelope } from 'oacp-sdk';
import { summarizeWithLLM, isLLMAvailable, getLLMProvider } from './llm.js';

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
// Action Spec — declares what this agent can do
// ============================================================

const summarizeAction: ActionSpec = {
  name: 'summarize-text',
  description: 'Summarize a topic or text passage in under N words',
  inputSchema: {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description: 'Topic or text to summarize',
        minLength: 3,
        maxLength: 2000,
      },
      max_words: {
        type: 'number',
        description: 'Maximum words in the summary',
        minimum: 10,
        maximum: 1000,
      },
    },
    required: ['task'],
  },
};

// ============================================================
// Research Summarization Logic
// ============================================================

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
  actionSpecs: [summarizeAction],
  trustPolicy: {
    allowedSenders: 'open',
    requireSignature: true,
  },
  model: getLLMProvider()
    ? { provider: getLLMProvider()!.provider, name: getLLMProvider()!.model, modalities: ['text'] }
    : { provider: 'local', name: 'built-in', modalities: ['text'] },
  languages: ['en'],
});

// ============================================================
// Register Action with Trust Pipeline
// ============================================================

agent.registerAction(summarizeAction, async (payload) => {
  const task = payload.task as string;
  const maxWords = (payload.max_words as number) || 300;

  console.log(`\n📨 Processing: "${task}"`);

  if (isLLMAvailable()) {
    // Use real LLM
    console.log('🤖 Using LLM for summarization...');
    try {
      const result = await summarizeWithLLM(task, maxWords);
      console.log(`✅ LLM summary generated (${result.word_count} words, ${result.duration_ms}ms)`);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'LLM error';
      console.warn(`⚠️ LLM failed: ${msg} — falling back to built-in`);
      // Fall through to built-in
    }
  } else {
    console.log('📝 Using built-in summaries (set OPENAI_API_KEY for LLM)');
  }

  // Built-in fallback
  await new Promise((r) => setTimeout(r, 2000 + Math.random() * 1000));
  const summary = generateSummary(task);
  const wordCount = summary.split(/\s+/).length;
  console.log(`✅ Built-in summary generated (${wordCount} words)`);

  return {
    summary,
    word_count: wordCount,
    source: 'oacp-research-agent/built-in',
  };
});

// ============================================================
// Main
// ============================================================

async function main() {
  console.log('🔬 OACP Research Agent starting...\n');

  const agentId = await agent.register();
  console.log(`📝 Registered as ${agentId}`);
  console.log(`🔑 Public key: ${agent.getPublicKey().substring(0, 16)}...`);

  agent.startHeartbeat();

  console.log('\n⏳ Waiting for task requests... (Ctrl+C to stop)\n');
  console.log('   This agent only accepts "summarize-text" actions.');
  if (isLLMAvailable()) {
    console.log(`   🤖 LLM mode: ${process.env.OPENAI_MODEL || 'gpt-4o-mini'}`);
  } else {
    console.log('   📝 Built-in mode (set OPENAI_API_KEY for LLM)');
  }
  console.log('');

  const shutdown = async () => {
    console.log('\n🛑 Shutting down...');
    await agent.shutdown();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await new Promise(() => {});
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
