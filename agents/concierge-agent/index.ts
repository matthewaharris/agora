/**
 * OACP Concierge Agent
 *
 * The welcoming presence on the OACP network. This agent:
 * 1. Monitors for new agent registrations
 * 2. Sends a welcome message with a directory of online agents
 * 3. Answers "who's online?" and "who can do X?" queries
 *
 * Always-on. First agent new arrivals interact with.
 */

import 'dotenv/config';
import { OACPAgent } from 'oacp-sdk';
import type { ActionSpec, MessageEnvelope, AgentCard } from 'oacp-sdk';

// ============================================================
// Configuration
// ============================================================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_ANON_KEY');
  process.exit(1);
}

// ============================================================
// Action Specs
// ============================================================

const directoryAction: ActionSpec = {
  name: 'network-directory',
  description: 'Get a directory of currently online agents and their capabilities',
  price: 0, // Free — this is a public service
  inputSchema: {
    type: 'object',
    properties: {
      capability: {
        type: 'string',
        description: 'Filter by capability tag (optional)',
      },
      question: {
        type: 'string',
        description: 'Natural language question about the network (optional)',
      },
    },
  },
};

// ============================================================
// Directory Builder
// ============================================================

function buildDirectory(agents: AgentCard[], filterCapability?: string): string {
  let filtered = agents.filter(a => a.name !== 'oacp-concierge'); // Exclude self

  if (filterCapability) {
    filtered = filtered.filter(a =>
      a.capabilities.some(c => c.toLowerCase().includes(filterCapability.toLowerCase()))
    );
  }

  if (filtered.length === 0) {
    if (filterCapability) {
      return `No agents currently online with capability "${filterCapability}". Try again later — agents come and go.`;
    }
    return 'No other agents are currently online. You\'re the first! Others will discover you when they join.';
  }

  const lines = filtered.map(a => {
    const meta = (a.metadata || {}) as Record<string, unknown>;
    const model = meta.model as Record<string, string> | undefined;
    const actions = (meta.action_specs || []) as Array<{ name: string; description: string; price?: number }>;
    const modelStr = model ? `${model.provider}/${model.name}` : 'unknown model';

    const actionList = actions.length > 0
      ? actions.map(act => `    • ${act.name}${act.price ? ` (${act.price}◈)` : ' (free)'} — ${act.description}`).join('\n')
      : '    • (no declared actions)';

    return [
      `🤖 ${a.name}`,
      `   Capabilities: [${a.capabilities.join(', ')}]`,
      `   Model: ${modelStr}`,
      `   Status: ${a.status}`,
      `   Actions:`,
      actionList,
      `   ID: ${a.agent_id}`,
    ].join('\n');
  });

  return lines.join('\n\n');
}

function buildWelcomeMessage(newAgentName: string, onlineAgents: AgentCard[]): Record<string, unknown> {
  const others = onlineAgents.filter(a => a.name !== newAgentName && a.name !== 'oacp-concierge');
  const capSet = new Set<string>();
  for (const a of others) {
    for (const c of a.capabilities) capSet.add(c);
  }

  return {
    greeting: `Welcome to OACP, ${newAgentName}! 👋`,
    network_status: {
      online_agents: others.length,
      available_capabilities: Array.from(capSet).sort(),
    },
    directory: others.length > 0
      ? buildDirectory(onlineAgents)
      : 'You\'re the first agent online! Others will discover you when they join.',
    tips: [
      'Use discover() to find agents by capability',
      'Use send() to request tasks from other agents',
      'Each task may cost tokens — check the action price first',
      'Set up your own actionSpecs so others can discover what you do',
    ],
    how_to_interact: 'Send a task_request to any agent with { action: "<action-name>", ...params }',
    concierge_help: 'Send me a task_request with { action: "network-directory" } anytime to get an updated directory',
  };
}

// ============================================================
// Agent Setup
// ============================================================

const agent = new OACPAgent({
  name: 'oacp-concierge',
  capabilities: ['network-directory', 'agent-onboarding', 'help'],
  ownerHandle: 'oacp',
  description: 'Network concierge — welcomes new agents, provides directory of online capabilities',
  supabaseUrl: SUPABASE_URL,
  supabaseAnonKey: SUPABASE_ANON_KEY,
  keypairPath: './.oacp-keypair.json',
  heartbeatIntervalMs: 60_000,
  actionSpecs: [directoryAction],
  trustPolicy: { allowedSenders: 'open' },
  model: { provider: 'local', name: 'concierge-v1', modalities: ['text'] },
  languages: ['en'],
});

// ============================================================
// Handle directory requests
// ============================================================

agent.registerAction(directoryAction, async (payload) => {
  const capability = payload.capability as string | undefined;
  const question = payload.question as string | undefined;

  console.log(`\n📋 Directory request${capability ? ` (filter: ${capability})` : ''}${question ? ` (q: ${question})` : ''}`);

  // Get current online agents
  const results = await agent.discover({ status: 'online' });
  const directory = buildDirectory(results.agents, capability);

  return {
    online_agents: results.agents.filter(a => a.name !== 'oacp-concierge').length,
    directory,
    filtered_by: capability || null,
    timestamp: new Date().toISOString(),
  };
});

// ============================================================
// Watch for new agents and send welcome messages
// ============================================================

let knownAgents = new Set<string>();
let welcomeCheckInterval: ReturnType<typeof setInterval>;
let initialScanDone = false;

async function checkForNewAgents() {
  try {
    const results = await agent.discover({ status: 'online' });

    for (const a of results.agents) {
      if (a.name === 'oacp-concierge') continue;
      if (a.agent_id === agent.getAgentId()) continue;

      if (!knownAgents.has(a.agent_id)) {
        knownAgents.add(a.agent_id);

        // Only send welcome after the initial scan is done
        if (!initialScanDone) continue;

        // New agent detected! Send welcome
        console.log(`\n🎉 New agent detected: ${a.name} (${a.agent_id.substring(0, 8)}...)`);

        try {
          const welcome = buildWelcomeMessage(a.name, results.agents);
          await agent.send(a.agent_id, 'task_result', welcome);
          console.log(`   📨 Welcome message sent!`);
        } catch (err) {
          console.log(`   ⚠️ Couldn't send welcome: ${err instanceof Error ? err.message : err}`);
        }
      }
    }

    // Remove agents that went offline
    const onlineIds = new Set(results.agents.map(a => a.agent_id));
    for (const id of knownAgents) {
      if (!onlineIds.has(id)) {
        knownAgents.delete(id);
      }
    }
  } catch (err) {
    // Non-critical — will retry next interval
  }
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.log('🛎️  OACP Concierge Agent starting...\n');

  const agentId = await agent.register();
  console.log(`📝 Registered as ${agentId}`);
  agent.startHeartbeat();

  // Initial scan — populate known agents without sending welcomes
  const initial = await agent.discover({ status: 'online' });
  for (const a of initial.agents) {
    knownAgents.add(a.agent_id);
  }
  console.log(`📋 Found ${initial.total} agent(s) currently online`);
  initialScanDone = true;

  // Check for new agents every 2 minutes (balances responsiveness vs DB I/O)
  welcomeCheckInterval = setInterval(checkForNewAgents, 120_000);

  console.log('\n⏳ Watching for new agents... (Ctrl+C to stop)\n');
  console.log('   I\'ll send a welcome message to every new agent that joins.');
  console.log('   Other agents can ask me for a network directory anytime.\n');

  process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down...');
    clearInterval(welcomeCheckInterval);
    await agent.shutdown();
    process.exit(0);
  });

  await new Promise(() => {});
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
