/**
 * OACP Provocateur Agent
 *
 * The network instigator. This agent:
 * 1. Discovers all online agents and their capabilities
 * 2. Orchestrates multi-agent workflows by chaining tasks
 * 3. Makes the whole network come alive
 *
 * Workflows:
 * - "Idea Pipeline": idea-agent → research-agent → sentiment-agent
 * - "Code Gauntlet": idea-agent → code gets reviewed → sentiment on the review
 * - "Random Encounter": pick two random agents and make them interact
 *
 * Runs on a configurable interval. Every cycle, it picks a workflow
 * and chains requests across available agents.
 */

import 'dotenv/config';
import { OACPAgent } from 'oacp-sdk';
import type { AgentCard, MessageEnvelope } from 'oacp-sdk';

// ============================================================
// Configuration
// ============================================================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const CYCLE_INTERVAL_MS = parseInt(process.env.CYCLE_INTERVAL || '120000', 10); // 2 minutes default

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_ANON_KEY');
  process.exit(1);
}

// ============================================================
// Agent Setup
// ============================================================

const agent = new OACPAgent({
  name: 'provocateur',
  capabilities: ['orchestration', 'multi-agent-workflows', 'network-activator'],
  ownerHandle: 'oacp',
  description: 'Orchestrates multi-agent workflows — makes the network come alive',
  supabaseUrl: SUPABASE_URL,
  supabaseAnonKey: SUPABASE_ANON_KEY,
  keypairPath: './.oacp-keypair.json',
  heartbeatIntervalMs: 30_000,
  trustPolicy: { allowedSenders: 'open' },
  model: { provider: 'local', name: 'provocateur-v1', modalities: ['text'] },
});

// ============================================================
// Helpers
// ============================================================

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function findAgent(agents: AgentCard[], capability: string): AgentCard | null {
  return agents.find(a =>
    a.capabilities.includes(capability) && a.name !== 'provocateur'
  ) || null;
}

async function sendAndWait(
  targetId: string,
  payload: Record<string, unknown>,
  timeoutMs = 30000,
): Promise<Record<string, unknown> | null> {
  const correlationId = crypto.randomUUID();

  await agent.send(targetId, 'task_request', payload, { correlationId });

  // Poll for result
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    await sleep(3000);
    try {
      const inbox = await agent.getMessages({
        direction: 'inbox',
        correlationId,
        messageType: 'task_result',
      });
      if (inbox.messages.length > 0) {
        return inbox.messages[0].payload as Record<string, unknown>;
      }

      // Check for errors too
      const errors = await agent.getMessages({
        direction: 'inbox',
        correlationId,
        messageType: 'task_error',
      });
      if (errors.messages.length > 0) {
        console.log(`   ⚠️ Task error: ${(errors.messages[0].payload as any)?.message || 'unknown'}`);
        return null;
      }
    } catch {
      // Polling failed, retry
    }
  }
  console.log('   ⏰ Timed out waiting for response');
  return null;
}

// ============================================================
// Workflows
// ============================================================

/**
 * Idea Pipeline: Generate idea → Research it → Analyze sentiment
 */
async function ideaPipeline(agents: AgentCard[]): Promise<void> {
  const ideaAgent = findAgent(agents, 'idea-generation');
  const researchAgent = findAgent(agents, 'research-summarization');
  const sentimentAgent = findAgent(agents, 'sentiment-analysis');

  if (!ideaAgent) { console.log('   ⚠️ No idea agent online, skipping'); return; }

  const chaosLevel = Math.floor(Math.random() * 8) + 2; // 2-9
  console.log(`\n   🎲 Chaos level: ${chaosLevel}/10`);

  // Step 1: Generate idea
  console.log(`   💡 Asking ${ideaAgent.name} for an idea...`);
  const idea = await sendAndWait(ideaAgent.agent_id, {
    action: 'generate-idea',
    chaos: chaosLevel,
  });

  if (!idea) return;
  console.log(`   💡 Got: "${idea.title}"`);
  console.log(`   📝 ${(idea.idea as string)?.substring(0, 100)}...`);

  // Step 2: Research the idea (if research agent available)
  if (researchAgent) {
    console.log(`\n   📚 Asking ${researchAgent.name} to research it...`);
    const research = await sendAndWait(researchAgent.agent_id, {
      action: 'summarize-text',
      task: `Research the feasibility and existing implementations of this idea: ${idea.title} — ${idea.idea}`,
      max_words: 150,
    });

    if (research) {
      console.log(`   📚 Research: ${(research.summary as string)?.substring(0, 100)}...`);

      // Step 3: Sentiment on the research (if sentiment agent available)
      if (sentimentAgent) {
        console.log(`\n   💭 Asking ${sentimentAgent.name} for sentiment on the research...`);
        const sentiment = await sendAndWait(sentimentAgent.agent_id, {
          action: 'analyze-sentiment',
          text: `Idea: ${idea.title}. ${idea.idea} Research says: ${research.summary}`,
          context: 'startup idea evaluation',
        });

        if (sentiment) {
          console.log(`   💭 Verdict: ${sentiment.sentiment} (confidence: ${sentiment.confidence})`);
        }
      }
    }
  }

  console.log(`\n   ✅ Idea Pipeline complete for "${idea.title}"`);
}

/**
 * Random Encounter: Pick two random agents and make one ask the other something
 */
async function randomEncounter(agents: AgentCard[]): Promise<void> {
  const usableAgents = agents.filter(a =>
    a.name !== 'provocateur' &&
    a.name !== 'oacp-concierge' &&
    (a.metadata as any)?.action_specs?.length > 0
  );

  if (usableAgents.length < 1) {
    console.log('   ⚠️ Not enough agents with actions for a random encounter');
    return;
  }

  const target = pickRandom(usableAgents);
  const actions = ((target.metadata as any)?.action_specs || []) as Array<{ name: string; description: string }>;
  if (actions.length === 0) return;

  const action = pickRandom(actions);
  console.log(`   🎯 Target: ${target.name} → action: ${action.name}`);

  // Build a reasonable request based on the action name
  let payload: Record<string, unknown> = { action: action.name };

  if (action.name === 'generate-idea') {
    const chaos = Math.floor(Math.random() * 11);
    const subjects = ['AI agents', 'space exploration', 'cooking', 'music', 'education', 'gaming', 'healthcare', 'transportation'];
    payload.chaos = chaos;
    if (Math.random() > 0.5) payload.subject = pickRandom(subjects);
    console.log(`   🎲 Requesting idea with chaos=${chaos}${payload.subject ? ` about ${payload.subject}` : ''}`);
  } else if (action.name === 'summarize-text') {
    const topics = [
      'The future of multi-agent AI systems',
      'How decentralized agent networks could replace traditional APIs',
      'The role of token economies in AI agent marketplaces',
      'Why agent-to-agent communication needs open standards',
      'How AI agents could form autonomous organizations',
    ];
    payload.task = pickRandom(topics);
    payload.max_words = 100;
    console.log(`   📚 Requesting summary of: "${payload.task}"`);
  } else if (action.name === 'analyze-sentiment') {
    const texts = [
      'I am incredibly excited about the potential of AI agents working together autonomously!',
      'The current state of agent protocols is frustrating — nothing works together seamlessly.',
      'This agent network is interesting but I have concerns about security and trust.',
      'Just registered my first OACP agent and it immediately found three other agents to work with. Mind blown.',
      'Token economies for agents seem gimmicky. Why would a bot need money?',
    ];
    payload.text = pickRandom(texts);
    payload.context = 'social media post';
    console.log(`   💭 Analyzing: "${(payload.text as string).substring(0, 60)}..."`);
  } else if (action.name === 'review-code') {
    const snippets = [
      `async function fetchData(url) {\n  const res = await fetch(url);\n  return res.json();\n}`,
      `const users = db.query("SELECT * FROM users WHERE role = 'admin'");\nfor (const u of users) { sendEmail(u.email, secret); }`,
      `function fibonacci(n) { return n <= 1 ? n : fibonacci(n-1) + fibonacci(n-2); }`,
    ];
    payload.code = pickRandom(snippets);
    payload.language = 'javascript';
    console.log(`   🔍 Sending code for review...`);
  } else {
    console.log(`   ❓ Don't know how to invoke ${action.name}, skipping`);
    return;
  }

  const result = await sendAndWait(target.agent_id, payload);
  if (result) {
    const preview = JSON.stringify(result).substring(0, 150);
    console.log(`   ✅ Got response: ${preview}...`);
  }
}

/**
 * Network Pulse: Just ask the concierge for a directory
 */
async function networkPulse(agents: AgentCard[]): Promise<void> {
  const concierge = findAgent(agents, 'network-directory');
  if (!concierge) {
    console.log('   ⚠️ Concierge not online');
    return;
  }

  console.log(`   📋 Asking concierge for network directory...`);
  const result = await sendAndWait(concierge.agent_id, {
    action: 'network-directory',
  });

  if (result) {
    console.log(`   📋 ${result.online_agents} agents online`);
  }
}

// ============================================================
// Main Loop
// ============================================================

const workflows = [
  { name: '💡 Idea Pipeline', fn: ideaPipeline, weight: 3 },
  { name: '🎲 Random Encounter', fn: randomEncounter, weight: 5 },
  { name: '📋 Network Pulse', fn: networkPulse, weight: 2 },
];

function pickWorkflow(): typeof workflows[0] {
  const totalWeight = workflows.reduce((sum, w) => sum + w.weight, 0);
  let random = Math.random() * totalWeight;
  for (const w of workflows) {
    random -= w.weight;
    if (random <= 0) return w;
  }
  return workflows[0];
}

let cycleCount = 0;

async function runCycle() {
  cycleCount++;

  // Discover what's available
  const results = await agent.discover({ status: 'online' });
  const onlineAgents = results.agents.filter(a => a.name !== 'provocateur');

  if (onlineAgents.length === 0) {
    console.log(`\n⚡ Cycle ${cycleCount}: No other agents online. Waiting...`);
    return;
  }

  const workflow = pickWorkflow();
  console.log(`\n${'='.repeat(60)}`);
  console.log(`⚡ Cycle ${cycleCount}: ${workflow.name} (${onlineAgents.length} agents online)`);
  console.log('='.repeat(60));

  try {
    await workflow.fn(results.agents);
  } catch (err) {
    console.error(`   ❌ Workflow failed: ${err instanceof Error ? err.message : err}`);
  }
}

async function main() {
  console.log('⚡ OACP Provocateur Agent starting...\n');
  console.log(`   Cycle interval: ${CYCLE_INTERVAL_MS / 1000}s`);
  console.log('   Workflows: Idea Pipeline, Random Encounter, Network Pulse\n');

  const agentId = await agent.register();
  console.log(`📝 Registered as ${agentId}`);
  agent.startHeartbeat();

  // Run first cycle immediately
  await runCycle();

  // Then on interval
  setInterval(runCycle, CYCLE_INTERVAL_MS);

  console.log(`\n⏳ Next cycle in ${CYCLE_INTERVAL_MS / 1000}s... (Ctrl+C to stop)\n`);

  process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down...');
    await agent.shutdown();
    process.exit(0);
  });

  await new Promise(() => {});
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
