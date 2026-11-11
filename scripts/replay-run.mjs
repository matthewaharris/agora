/**
 * Replay a recorded agent run.
 *
 *   default   Tool replay: the LIVE model, but every tool answers from the
 *             recording. "Given the same world, what does the model do now?"
 *             Costs model tokens; the model may take a different path.
 *   --full    Full replay: the model's answers ALSO come from the recording.
 *             "Given exactly what happened, what does my code do?"
 *             Costs nothing and gives the same result every time.
 *
 *   --model <id>   Tool replay with a different model than the recording
 *             used, e.g. --model claude-sonnet-5-5. "Would another model
 *             have handled this same situation better?"
 *
 * Usage (from the repo root):
 *   node --import tsx scripts/replay-run.mjs <run> [--full | --model <id>]
 * where <run> is a .jsonl file, or a run ID to read from the trajectory
 * database (TRAJECTORY_DB_URL / TRAJECTORY_DB_KEY). Tool replay needs
 * ANTHROPIC_API_KEY.
 */
import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => join(ROOT, 'agents/fleet-host/src', p);
const { runAgent } = await import(src('runtime/harness.ts'));
const { createReplayModel, createReplayTools, readDatabaseRun, readJsonlRun } = await import(
  src('runtime/trajectory.ts')
);

const args = process.argv.slice(2);
const full = args.includes('--full');
const modelAt = args.indexOf('--model');
const modelOverride = modelAt >= 0 ? args[modelAt + 1] : undefined;
const source = args.find((a, i) => !a.startsWith('--') && (modelAt < 0 || i !== modelAt + 1));
if (!source || (modelAt >= 0 && (!modelOverride || modelOverride.startsWith('--')))) {
  console.error('Usage: node --import tsx scripts/replay-run.mjs <run .jsonl | run ID> [--full | --model <id>]');
  process.exit(1);
}
if (full && modelOverride) {
  console.error('--full takes every answer from the recording, so there is no model to change. Use one or the other.');
  process.exit(1);
}

let events;
if (source.endsWith('.jsonl')) {
  events = await readJsonlRun(source);
} else {
  const { TRAJECTORY_DB_URL: url, TRAJECTORY_DB_KEY: key } = process.env;
  if (!url || !key) {
    console.error('A run ID needs TRAJECTORY_DB_URL and TRAJECTORY_DB_KEY to be set.');
    process.exit(1);
  }
  events = await readDatabaseRun({ url, key, runId: source });
}

const started = events.find((e) => e.type === 'run.started');
const ended = events.find((e) => e.type === 'run.ended');
if (!started?.content) {
  console.error(
    events.length === 0
      ? 'No events found for that run.'
      : 'This recording has no run.started content (missing or expired); it cannot be replayed.',
  );
  process.exit(1);
}

const recordedModel = started.attrs['gen_ai.request.model'];
const callModel = full ? createReplayModel(events) : (await import(src('llm.ts'))).callModel;

let run;
try {
  run = await runAgent({
    model: modelOverride ?? recordedModel,
    system: started.content.system,
    user: started.content.user,
    tools: createReplayTools(events),
    limits: started.attrs.limits,
    callModel,
  });
} catch (err) {
  console.log(`replay stopped:  ${err.message}`);
  process.exit(1);
}

const row = (label, a, b) => console.log(`${label.padEnd(14)} ${String(a).padEnd(22)} ${b}`);
console.log(`── recorded vs ${full ? 'full replay' : 'tool replay'} ───────────────────────`);
row('', 'recorded', 'replay');
row('model', recordedModel, full ? '(from recording)' : run.model);
row('stop_reason', ended?.attrs.stop_reason ?? '(run never ended)', run.stopReason);
row('tool_calls', ended?.attrs.tool_calls ?? '?', run.steps.length);
row('tokens_used', ended?.attrs.tokens_used ?? '?', run.tokens_used);
if (ended?.content) row('same answer', '', run.text === ended.content.text ? 'yes, identical' : 'no');
console.log('── replay steps ──────────────────────────────────');
for (const s of run.steps) {
  console.log(
    `${String(s.step).padStart(2)}. ${s.ok ? 'ok ' : 'ERR'} ${s.tool} ${JSON.stringify(s.input)}${s.error ? ` — ${s.error}` : ''}`,
  );
}
console.log('── replay answer ─────────────────────────────────');
console.log(run.text);
