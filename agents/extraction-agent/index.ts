/**
 * OACP Extraction Agent
 *
 * A reference agent that:
 * - Registers with the OACP Registry as 'data-extraction'
 * - Discovers agents with 'research-summarization' capability
 * - Sends a research task_request
 * - Receives and processes the task_result
 * - Extracts key entities from the summary
 *
 * This is Agent B from the PRD Section 7 demo scenario.
 *
 * Usage:
 *   cd agents/extraction-agent
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

// The research task to delegate
const RESEARCH_TASK =
  process.env.TASK ||
  'Summarize the current state of open agent communication protocols in under 300 words';

// ============================================================
// Data Extraction Logic
// ============================================================

/**
 * Extract key entities from a research summary.
 * In production, this could use NLP or an LLM for entity extraction.
 */
function extractEntities(summary: string): {
  protocols: string[];
  organizations: string[];
  technologies: string[];
  keyInsight: string;
} {
  const text = summary.toLowerCase();

  // Extract protocol names
  const protocols: string[] = [];
  const protocolPatterns = ['mcp', 'a2a', 'acp', 'ucp', 'oacp', 'agent2agent'];
  for (const p of protocolPatterns) {
    if (text.includes(p)) protocols.push(p.toUpperCase());
  }

  // Extract organization names
  const organizations: string[] = [];
  const orgPatterns = [
    'anthropic', 'google', 'ibm', 'linux foundation', 'aws',
    'microsoft', 'salesforce', 'sap', 'supabase',
  ];
  for (const o of orgPatterns) {
    if (text.includes(o)) {
      organizations.push(o.charAt(0).toUpperCase() + o.slice(1));
    }
  }

  // Extract technologies
  const technologies: string[] = [];
  const techPatterns = [
    'ed25519', 'postgresql', 'postgres', 'websocket', 'http',
    'json-rpc', 'grpc', 'typescript', 'deno', 'realtime',
  ];
  for (const t of techPatterns) {
    if (text.includes(t)) technologies.push(t);
  }

  // Extract a key insight (first sentence or up to 150 chars)
  const firstSentence = summary.split(/[.!?]/)[0] + '.';
  const keyInsight = firstSentence.length > 150
    ? firstSentence.substring(0, 147) + '...'
    : firstSentence;

  return { protocols, organizations, technologies, keyInsight };
}

// ============================================================
// Agent Setup
// ============================================================

const agent = new OACPAgent({
  name: 'friends-extraction-agent',
  capabilities: ['data-extraction'],
  ownerHandle: 'friend',
  description: 'Extracts structured data from research summaries via OACP',
  supabaseUrl: SUPABASE_URL,
  supabaseAnonKey: SUPABASE_ANON_KEY,
  keypairPath: './.oacp-keypair.json',
  heartbeatIntervalMs: 30_000,
});

// ============================================================
// Main Flow
// ============================================================

async function main() {
  console.log('🔍 OACP Extraction Agent starting...\n');

  // ── Step 1: Register ──
  const agentId = await agent.register();
  console.log(`📝 Registered as ${agentId}`);
  agent.startHeartbeat();

  // ── Step 2: Discover research agents ──
  console.log('\n🔎 Discovering research agents...');
  const results = await agent.discover({ capability: 'research-summarization', status: 'online' });

  if (results.total === 0) {
    console.error('❌ No online research agents found!');
    console.error('   Start the research-agent first: cd agents/research-agent && npm start');
    await agent.shutdown();
    process.exit(1);
  }

  const target = results.agents[0];
  console.log(`✅ Found: ${target.name} (${target.agent_id.substring(0, 8)}...)`);
  console.log(`   Capabilities: [${target.capabilities.join(', ')}]`);
  console.log(`   Status: ${target.status}`);

  // ── Step 3: Send task request ──
  const correlationId = crypto.randomUUID();
  console.log(`\n📤 Sending task request...`);
  console.log(`   Task: "${RESEARCH_TASK}"`);
  console.log(`   Correlation: ${correlationId}`);

  const messageId = await agent.send(
    target.agent_id,
    'task_request',
    {
      action: 'summarize-text',  // Matches the research agent's action_spec
      task: RESEARCH_TASK,
      priority: 'normal',
      max_words: 300,
    },
    { correlationId },
  );

  console.log(`   Message ID: ${messageId}`);

  // ── Step 4: Wait for result ──
  console.log('\n⏳ Waiting for result...');

  // Set up handler for task_result
  let resultReceived = false;

  agent.on('task_result', (msg: MessageEnvelope) => {
    if (msg.correlation_id !== correlationId) return; // Not our conversation

    resultReceived = true;
    const payload = msg.payload as Record<string, unknown>;
    const summary = payload.summary as string;
    const wordCount = payload.word_count as number;

    console.log('\n' + '='.repeat(60));
    console.log('📋 TASK RESULT RECEIVED');
    console.log('='.repeat(60));
    console.log(`From: ${msg.sender_agent_id.substring(0, 8)}...`);
    console.log(`Words: ${wordCount}`);
    console.log(`Summary:\n${summary}\n`);

    // ── Step 5: Extract entities ──
    console.log('🔍 Extracting entities...');
    const entities = extractEntities(summary);

    console.log('\n📊 EXTRACTED DATA:');
    console.log(`   Protocols: ${entities.protocols.join(', ') || 'none found'}`);
    console.log(`   Organizations: ${entities.organizations.join(', ') || 'none found'}`);
    console.log(`   Technologies: ${entities.technologies.join(', ') || 'none found'}`);
    console.log(`   Key Insight: ${entities.keyInsight}`);
    console.log('\n' + '='.repeat(60));

    // Done — shut down after a brief pause
    setTimeout(async () => {
      console.log('\n✅ Demo complete!');
      await agent.shutdown();
      process.exit(0);
    }, 2000);
  });

  agent.on('task_error', (msg: MessageEnvelope) => {
    if (msg.correlation_id !== correlationId) return;

    resultReceived = true;
    const payload = msg.payload as Record<string, unknown>;
    console.error(`\n❌ Task failed: ${payload.error}`);
    setTimeout(async () => {
      await agent.shutdown();
      process.exit(1);
    }, 1000);
  });

  // Polling fallback — check every 3 seconds for up to 30 seconds
  for (let i = 0; i < 10 && !resultReceived; i++) {
    await new Promise((r) => setTimeout(r, 3000));

    if (!resultReceived) {
      try {
        const inbox = await agent.getMessages({
          direction: 'inbox',
          correlationId,
          messageType: 'task_result',
        });

        if (inbox.messages.length > 0) {
          const msg = inbox.messages[0] as MessageEnvelope;
          // Dispatch manually if Realtime didn't catch it
          const payload = msg.payload as Record<string, unknown>;
          console.log('\n📬 Result received via polling:');
          console.log(`Summary: ${(payload.summary as string).substring(0, 100)}...`);

          const entities = extractEntities(payload.summary as string);
          console.log(`Protocols: ${entities.protocols.join(', ')}`);
          console.log(`Organizations: ${entities.organizations.join(', ')}`);

          resultReceived = true;
          console.log('\n✅ Demo complete!');
          await agent.shutdown();
          process.exit(0);
        }
      } catch {
        // Polling failed, continue waiting
      }
    }
  }

  if (!resultReceived) {
    console.error('\n⏰ Timeout — no result received after 30 seconds');
    console.error('   Is the research-agent running?');
    await agent.shutdown();
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Interrupted');
  await agent.shutdown();
  process.exit(0);
});

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
