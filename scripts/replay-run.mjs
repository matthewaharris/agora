/**
 * Replay a recorded agent run: the live model, but every tool answers from
 * the recording instead of the network. Use it to reproduce a failure.
 *
 * Usage (from the repo root; needs ANTHROPIC_API_KEY):
 *   node --import tsx scripts/replay-run.mjs .trajectories/<run_id>.jsonl
 */
import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => join(ROOT, 'agents/fleet-host/src', p);
const { runAgent } = await import(src('runtime/harness.ts'));
const { createReplayTools, readJsonlRun } = await import(src('runtime/trajectory.ts'));
const { callModel } = await import(src('llm.ts'));

const file = process.argv[2];
if (!file) {
  console.error('Usage: node --import tsx scripts/replay-run.mjs <recorded run .jsonl>');
  process.exit(1);
}

const events = await readJsonlRun(file);
const started = events.find((e) => e.type === 'run.started');
const ended = events.find((e) => e.type === 'run.ended');
if (!started?.content) {
  console.error('This recording has no run.started content; it cannot be replayed.');
  process.exit(1);
}

const run = await runAgent({
  model: started.attrs['gen_ai.request.model'],
  system: started.content.system,
  user: started.content.user,
  tools: createReplayTools(events),
  limits: started.attrs.limits,
  callModel,
});

const row = (label, a, b) => console.log(`${label.padEnd(14)} ${String(a).padEnd(22)} ${b}`);
console.log('── recorded vs replay ────────────────────────────');
row('', 'recorded', 'replay');
row('stop_reason', ended?.attrs.stop_reason ?? '(run never ended)', run.stopReason);
row('tool_calls', ended?.attrs.tool_calls ?? '?', run.steps.length);
row('tokens_used', ended?.attrs.tokens_used ?? '?', run.tokens_used);
console.log('── replay steps ──────────────────────────────────');
for (const s of run.steps) {
  console.log(`${String(s.step).padStart(2)}. ${s.ok ? 'ok ' : 'ERR'} ${s.tool} ${JSON.stringify(s.input)}${s.error ? ` — ${s.error}` : ''}`);
}
console.log('── replay answer ─────────────────────────────────');
console.log(run.text);
