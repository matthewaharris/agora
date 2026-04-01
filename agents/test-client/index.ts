/**
 * OACP Multi-Agent Test Client
 *
 * Discovers all online agents and sends tasks to each one.
 * Demonstrates cross-agent communication with different capabilities.
 *
 * Usage:
 *   cd agents/test-client
 *   npm install && npm start
 */

import 'dotenv/config';
import { OACPAgent } from 'oacp-sdk';
import type { MessageEnvelope } from 'oacp-sdk';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_ANON_KEY');
  process.exit(1);
}

const agent = new OACPAgent({
  name: 'multi-agent-test-client',
  capabilities: ['testing'],
  ownerHandle: 'matt',
  description: 'Test client that exercises all available OACP agents',
  supabaseUrl: SUPABASE_URL,
  supabaseAnonKey: SUPABASE_ANON_KEY,
  keypairPath: './.oacp-keypair.json',
});

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log('🧪 OACP Multi-Agent Test Client\n');
  console.log('='.repeat(60));

  await agent.register();
  agent.startHeartbeat();

  // Discover all online agents
  console.log('\n🔎 Discovering online agents...\n');
  const all = await agent.discover({ status: 'online' });

  const otherAgents = all.agents.filter(a => a.agent_id !== agent.getAgentId());
  console.log(`Found ${otherAgents.length} other agent(s):\n`);

  for (const a of otherAgents) {
    const meta = a.metadata as Record<string, unknown> || {};
    const model = meta.model as Record<string, unknown> | undefined;
    const actions = meta.action_specs as Array<{ name: string; description: string }> | undefined;
    console.log(`  🤖 ${a.name}`);
    console.log(`     ID: ${a.agent_id.substring(0, 12)}...`);
    console.log(`     Capabilities: [${a.capabilities.join(', ')}]`);
    if (model) console.log(`     Model: ${model.provider}/${model.name}`);
    if (actions) console.log(`     Actions: ${actions.map(a => a.name).join(', ')}`);
    console.log('');
  }

  // ── Test each capability we find ──
  const results: Array<{ agent: string; action: string; success: boolean; duration: number }> = [];

  // Research agent
  const researchAgent = otherAgents.find(a => a.capabilities.includes('research-summarization'));
  if (researchAgent) {
    console.log('='.repeat(60));
    console.log('📚 Testing: Research Agent');
    console.log('='.repeat(60));
    const start = Date.now();
    try {
      const cid = crypto.randomUUID();
      await agent.send(researchAgent.agent_id, 'task_request', {
        action: 'summarize-text',
        task: 'What are the key differences between WebSockets and Server-Sent Events for real-time web applications?',
        max_words: 150,
      }, { correlationId: cid });

      console.log('   📤 Sent research task, waiting for result...');
      await sleep(10000);

      const inbox = await agent.getMessages({ direction: 'inbox', correlationId: cid });
      const result = inbox.messages.find(m => m.message_type === 'task_result');
      if (result) {
        const p = result.payload as Record<string, unknown>;
        console.log(`\n   ✅ Summary (${p.word_count} words, ${p.provider || 'unknown'}):`);
        console.log(`   "${(p.summary as string).substring(0, 200)}..."\n`);
        results.push({ agent: researchAgent.name, action: 'summarize-text', success: true, duration: Date.now() - start });
      } else {
        console.log('   ⏰ No result received\n');
        results.push({ agent: researchAgent.name, action: 'summarize-text', success: false, duration: Date.now() - start });
      }
    } catch (err) {
      console.log(`   ❌ Error: ${err instanceof Error ? err.message : err}\n`);
      results.push({ agent: researchAgent.name, action: 'summarize-text', success: false, duration: Date.now() - start });
    }
  }

  // Code review agent
  const codeAgent = otherAgents.find(a => a.capabilities.includes('code-review'));
  if (codeAgent) {
    console.log('='.repeat(60));
    console.log('🔍 Testing: Code Review Agent');
    console.log('='.repeat(60));
    const start = Date.now();
    try {
      const cid = crypto.randomUUID();
      await agent.send(codeAgent.agent_id, 'task_request', {
        action: 'review-code',
        code: `function fetchUser(id) {
  const query = "SELECT * FROM users WHERE id = " + id;
  const result = db.query(query);
  if (result) {
    return result;
  }
}`,
        language: 'javascript',
        focus: 'security',
      }, { correlationId: cid });

      console.log('   📤 Sent code for review, waiting...');
      await sleep(10000);

      const inbox = await agent.getMessages({ direction: 'inbox', correlationId: cid });
      const result = inbox.messages.find(m => m.message_type === 'task_result');
      if (result) {
        const p = result.payload as Record<string, unknown>;
        console.log(`\n   ✅ Review — Score: ${p.score}/10`);
        console.log(`   Summary: ${p.summary}`);
        const issues = p.issues as Array<Record<string, string>> | undefined;
        if (issues?.length) {
          console.log(`   Issues (${issues.length}):`);
          for (const issue of issues) {
            console.log(`     ⚠ [${issue.severity}] ${issue.description}`);
          }
        }
        console.log('');
        results.push({ agent: codeAgent.name, action: 'review-code', success: true, duration: Date.now() - start });
      } else {
        console.log('   ⏰ No result received\n');
        results.push({ agent: codeAgent.name, action: 'review-code', success: false, duration: Date.now() - start });
      }
    } catch (err) {
      console.log(`   ❌ Error: ${err instanceof Error ? err.message : err}\n`);
      results.push({ agent: codeAgent.name, action: 'review-code', success: false, duration: Date.now() - start });
    }
  }

  // Sentiment agent
  const sentimentAgent = otherAgents.find(a => a.capabilities.includes('sentiment-analysis'));
  if (sentimentAgent) {
    console.log('='.repeat(60));
    console.log('💭 Testing: Sentiment Agent');
    console.log('='.repeat(60));
    const start = Date.now();
    try {
      const cid = crypto.randomUUID();
      await agent.send(sentimentAgent.agent_id, 'task_request', {
        action: 'analyze-sentiment',
        text: 'I absolutely love how the OACP protocol lets agents discover each other automatically. ' +
              'The setup was incredibly easy and the real-time dashboard is beautiful. ' +
              'My only concern is the lack of rate limiting, but that seems planned for a future release.',
        context: 'developer feedback',
      }, { correlationId: cid });

      console.log('   📤 Sent text for analysis, waiting...');
      await sleep(10000);

      const inbox = await agent.getMessages({ direction: 'inbox', correlationId: cid });
      const result = inbox.messages.find(m => m.message_type === 'task_result');
      if (result) {
        const p = result.payload as Record<string, unknown>;
        console.log(`\n   ✅ Sentiment: ${p.sentiment} (confidence: ${p.confidence})`);
        console.log(`   Emotions: ${(p.emotions as string[])?.join(', ') || 'none'}`);
        console.log(`   Tone: ${p.tone}`);
        console.log(`   Summary: ${p.summary}\n`);
        results.push({ agent: sentimentAgent.name, action: 'analyze-sentiment', success: true, duration: Date.now() - start });
      } else {
        console.log('   ⏰ No result received\n');
        results.push({ agent: sentimentAgent.name, action: 'analyze-sentiment', success: false, duration: Date.now() - start });
      }
    } catch (err) {
      console.log(`   ❌ Error: ${err instanceof Error ? err.message : err}\n`);
      results.push({ agent: sentimentAgent.name, action: 'analyze-sentiment', success: false, duration: Date.now() - start });
    }
  }

  // ── Summary ──
  console.log('='.repeat(60));
  console.log('📊 TEST RESULTS');
  console.log('='.repeat(60));
  for (const r of results) {
    const status = r.success ? '✅' : '❌';
    console.log(`  ${status} ${r.agent} → ${r.action} (${(r.duration / 1000).toFixed(1)}s)`);
  }
  const passed = results.filter(r => r.success).length;
  console.log(`\n  ${passed}/${results.length} tests passed`);
  console.log('='.repeat(60));

  await agent.shutdown();
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
