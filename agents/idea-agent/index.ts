/**
 * OACP Idea Agent
 *
 * Generates creative ideas with a configurable "chaos index" (0-10).
 * - 0 = safe, practical, incremental
 * - 5 = interesting, novel, plausible
 * - 10 = unhinged, wildly creative, possibly genius, possibly insane
 *
 * Optionally accepts a subject (e.g., "mobile app", "book idea").
 * Without a subject, generates ideas for things you could use AI agents for.
 *
 * Powered by Anthropic Claude.
 */

import 'dotenv/config';
import { OACPAgent } from 'oacp-sdk';
import type { ActionSpec } from 'oacp-sdk';

// ============================================================
// Configuration
// ============================================================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_ANON_KEY');
  process.exit(1);
}

if (!ANTHROPIC_API_KEY) {
  console.error('❌ Missing ANTHROPIC_API_KEY — this agent requires an LLM');
  process.exit(1);
}

// ============================================================
// Action Spec
// ============================================================

const ideaAction: ActionSpec = {
  name: 'generate-idea',
  description: 'Generate a creative idea with configurable chaos level (0=safe, 10=unhinged)',
  price: 5,
  inputSchema: {
    type: 'object',
    properties: {
      chaos: {
        type: 'number',
        description: 'Chaos index 0-10. 0=practical, 5=novel, 10=wildly creative',
        minimum: 0,
        maximum: 10,
      },
      subject: {
        type: 'string',
        description: 'Optional subject like "mobile app", "book idea", "startup". Leave blank for AI agent ideas.',
        maxLength: 200,
      },
    },
    required: ['chaos'],
  },
};

// ============================================================
// LLM Call
// ============================================================

function buildSystemPrompt(chaos: number): string {
  const chaosDescriptions: Record<number, string> = {
    0: 'extremely safe, boring, incremental. Think "add a dark mode toggle." Practical to a fault.',
    1: 'very conservative. Minor improvements to existing things. Low risk, low reward.',
    2: 'sensible and grounded. Could pitch this to a skeptical manager.',
    3: 'reasonable with a twist. There\'s one interesting angle that makes people go "huh, actually..."',
    4: 'getting creative. Combines two things that don\'t obviously go together.',
    5: 'genuinely novel. Makes people stop and think. Plausible but unexpected.',
    6: 'bold. Some people would say this is brilliant, others would say you\'re crazy.',
    7: 'wild. This requires a whiteboard and three hours to explain why it might work.',
    8: 'visionary or delusional, hard to tell. Would need a manifesto.',
    9: 'absolutely unhinged. Connects things that have no business being connected. Might be genius.',
    10: 'maximum chaos. Reality-bending. The kind of idea that either changes the world or gets you committed. No guardrails. Let the intrusive thoughts win.',
  };

  const chaosLevel = chaosDescriptions[Math.round(chaos)] || chaosDescriptions[5];

  return `You are an idea generator. Your creativity level is set to ${chaos}/10: ${chaosLevel}

Generate ONE idea. Respond in this exact JSON format:
{
  "title": "Short punchy title (under 10 words)",
  "idea": "2-3 sentence description of the idea",
  "why_it_works": "One sentence on why this could actually work",
  "chaos_justification": "One sentence explaining how this matches the chaos level",
  "potential": "moonshot | high | medium | low | who-knows",
  "tags": ["tag1", "tag2", "tag3"]
}

Rules:
- Match the chaos level precisely. Chaos 0 should be boring. Chaos 10 should be unhinged.
- Be specific, not vague. Name technologies, markets, or mechanics.
- The idea should be immediately understandable from the title alone.
- Never repeat common ideas like "AI personal assistant" or "blockchain for X" unless the chaos level demands banality.`;
}

interface AnthropicResponse {
  content: Array<{ type: string; text: string }>;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
}

async function generateIdea(chaos: number, subject?: string) {
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
  const startTime = Date.now();

  // Temperature scales with chaos: 0.2 at chaos=0, 1.0 at chaos=10
  const temperature = 0.2 + (chaos / 10) * 0.8;

  const userPrompt = subject
    ? `Generate a creative idea about: ${subject}`
    : 'Generate a creative idea for something you could build with AI agents — think multi-agent systems, agent marketplaces, agent tools, or novel uses of agent-to-agent communication.';

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 500,
      temperature,
      system: buildSystemPrompt(chaos),
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${error}`);
  }

  const data = (await response.json()) as AnthropicResponse;
  const text = data.content[0]?.text?.trim() || '{}';
  const durationMs = Date.now() - startTime;
  const totalTokens = data.usage.input_tokens + data.usage.output_tokens;

  console.log(`[LLM] ${model} generated in ${durationMs}ms (${totalTokens} tokens, temp: ${temperature.toFixed(1)})`);

  let idea;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    idea = jsonMatch ? JSON.parse(jsonMatch[0]) : { title: 'Parse Error', idea: text };
  } catch {
    idea = { title: 'Raw Idea', idea: text };
  }

  return {
    ...idea,
    chaos_index: chaos,
    subject: subject || 'ai-agents',
    model: data.model,
    temperature: parseFloat(temperature.toFixed(2)),
    tokens_used: totalTokens,
    duration_ms: durationMs,
  };
}

// ============================================================
// Agent Setup
// ============================================================

const agent = new OACPAgent({
  name: 'idea-generator',
  capabilities: ['idea-generation', 'brainstorming', 'creativity'],
  ownerHandle: 'matt',
  description: 'Generates creative ideas with configurable chaos level (0=safe, 10=unhinged)',
  supabaseUrl: SUPABASE_URL,
  supabaseAnonKey: SUPABASE_ANON_KEY,
  keypairPath: './.oacp-keypair.json',
  heartbeatIntervalMs: 30_000,
  actionSpecs: [ideaAction],
  trustPolicy: { allowedSenders: 'open' },
  model: {
    provider: 'anthropic',
    name: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
    modalities: ['text'],
  },
  languages: ['en'],
});

agent.registerAction(ideaAction, async (payload) => {
  const chaos = payload.chaos as number;
  const subject = payload.subject as string | undefined;

  const chaosBar = '█'.repeat(Math.round(chaos)) + '░'.repeat(10 - Math.round(chaos));
  console.log(`\n💡 Generating idea [${chaosBar}] chaos=${chaos}${subject ? ` subject="${subject}"` : ''}`);

  const result = await generateIdea(chaos, subject);
  console.log(`✅ "${result.title}" (potential: ${result.potential})`);

  return result;
});

// ============================================================
// Main
// ============================================================

async function main() {
  console.log('💡 OACP Idea Agent starting...\n');

  const agentId = await agent.register();
  console.log(`📝 Registered as ${agentId}`);
  agent.startHeartbeat();

  console.log('\n⏳ Waiting for idea requests... (Ctrl+C to stop)');
  console.log('   Send { action: "generate-idea", chaos: 7 } for wild ideas');
  console.log('   Send { action: "generate-idea", chaos: 2, subject: "mobile app" } for safe ideas\n');

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
