/**
 * Resident: network concierge — welcomes new agents, serves the directory.
 * No LLM: the directory is built from live discovery data. Ported from
 * agents/concierge-agent (retired as a standalone worker).
 */
import type { OACPAgent, AgentCard } from 'oacp-sdk';
import type { Resident } from '../roster.js';

const WELCOME_CHECK_INTERVAL_MS = 120_000;

function buildDirectory(agents: AgentCard[], selfId: string | null, filterCapability?: string): string {
  let filtered = agents.filter((a) => a.agent_id !== selfId);

  if (filterCapability) {
    filtered = filtered.filter((a) =>
      a.capabilities.some((c) => c.toLowerCase().includes(filterCapability.toLowerCase())),
    );
  }

  if (filtered.length === 0) {
    if (filterCapability) {
      return `No agents currently online with capability "${filterCapability}". Try again later — agents come and go.`;
    }
    return "No other agents are currently online. You're the first! Others will discover you when they join.";
  }

  const lines = filtered.map((a) => {
    const meta = (a.metadata || {}) as Record<string, unknown>;
    const model = meta.model as Record<string, string> | undefined;
    const actions = (meta.action_specs || []) as Array<{ name: string; description: string; price?: number }>;
    const modelStr = model ? `${model.provider}/${model.name}` : 'unknown model';

    const actionList =
      actions.length > 0
        ? actions.map((act) => `    • ${act.name}${act.price ? ` (${act.price}◈)` : ' (free)'} — ${act.description}`).join('\n')
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

function buildWelcomeMessage(newAgent: AgentCard, onlineAgents: AgentCard[], selfId: string | null) {
  const others = onlineAgents.filter((a) => a.agent_id !== newAgent.agent_id && a.agent_id !== selfId);
  const capSet = new Set<string>();
  for (const a of others) {
    for (const c of a.capabilities) capSet.add(c);
  }

  return {
    greeting: `Welcome to OACP, ${newAgent.name}! 👋`,
    network_status: {
      online_agents: others.length,
      available_capabilities: Array.from(capSet).sort(),
    },
    directory:
      others.length > 0
        ? buildDirectory(onlineAgents, selfId)
        : "You're the first agent online! Others will discover you when they join.",
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

export function createConcierge(): Resident {
  let agent: OACPAgent | null = null;
  let watchTimer: ReturnType<typeof setInterval> | null = null;
  const knownAgents = new Set<string>();
  let initialScanDone = false;

  async function checkForNewAgents() {
    if (!agent) return;
    try {
      const results = await agent.discover({ status: 'online' });
      const selfId = agent.getAgentId();

      for (const a of results.agents) {
        if (a.agent_id === selfId) continue;
        if (knownAgents.has(a.agent_id)) continue;
        knownAgents.add(a.agent_id);
        if (!initialScanDone) continue;

        console.log(`[concierge] 🎉 New agent: ${a.name} (${a.agent_id.substring(0, 8)}…)`);
        try {
          await agent.send(a.agent_id, 'task_result', buildWelcomeMessage(a, results.agents, selfId));
          console.log('[concierge] 📨 Welcome message sent');
        } catch (err) {
          console.log(`[concierge] ⚠️ Couldn't send welcome: ${err instanceof Error ? err.message : err}`);
        }
      }

      const onlineIds = new Set(results.agents.map((a) => a.agent_id));
      for (const id of knownAgents) {
        if (!onlineIds.has(id)) knownAgents.delete(id);
      }
    } catch {
      // Non-critical — will retry next interval
    }
  }

  return {
    name: 'oacp-concierge',
    capabilities: ['network-directory', 'agent-onboarding', 'help'],
    description: 'Network concierge — welcomes new agents, provides directory of online capabilities',
    model: { provider: 'local', name: 'concierge-v1', modalities: ['text'] },
    languages: ['en'],
    actions: [
      {
        spec: {
          name: 'network-directory',
          description: 'Get a directory of currently online agents and their capabilities',
          price: 0, // Free — this is a public service
          inputSchema: {
            type: 'object',
            properties: {
              capability: { type: 'string', description: 'Filter by capability tag (optional)' },
              question: { type: 'string', description: 'Natural language question about the network (optional)' },
            },
          },
        },
        handler: async (payload) => {
          if (!agent) throw new Error('concierge not initialized');
          const capability = payload.capability as string | undefined;
          console.log(`[concierge] 📋 Directory request${capability ? ` (filter: ${capability})` : ''}`);

          const results = await agent.discover({ status: 'online' });
          const selfId = agent.getAgentId();
          return {
            online_agents: results.agents.filter((a) => a.agent_id !== selfId).length,
            directory: buildDirectory(results.agents, selfId, capability),
            filtered_by: capability || null,
            timestamp: new Date().toISOString(),
          };
        },
      },
    ],
    init: async (a) => {
      agent = a;
      // Initial scan — populate known agents without sending welcomes
      const initial = await a.discover({ status: 'online' });
      for (const card of initial.agents) knownAgents.add(card.agent_id);
      initialScanDone = true;
      console.log(`[concierge] 📋 Found ${initial.total} agent(s) currently online`);
      watchTimer = setInterval(checkForNewAgents, WELCOME_CHECK_INTERVAL_MS);
    },
    stop: () => {
      if (watchTimer) clearInterval(watchTimer);
    },
  };
}
