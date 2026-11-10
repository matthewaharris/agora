/**
 * Agent harness — loop behaviour with a scripted fake model (no network).
 *
 * Run: node --import tsx agents/fleet-host/src/runtime/harness.test.mjs
 */
import assert from 'node:assert/strict';
import { runAgent } from './harness.ts';

const usage = (n) => ({ input_tokens: n, output_tokens: 0 });
const say = (text, tokens = 10) => ({
  model: 'fake',
  stop_reason: 'end_turn',
  content: [{ type: 'text', text }],
  usage: usage(tokens),
});
const ask = (calls, tokens = 10) => ({
  model: 'fake',
  stop_reason: 'tool_use',
  content: calls.map(([id, name, input]) => ({ type: 'tool_use', id, name, input })),
  usage: usage(tokens),
});

/** A model that replays `script` and records every request it was sent. */
function fakeModel(script) {
  const requests = [];
  const callModel = async (params) => {
    requests.push(structuredClone(params));
    const next = script.shift();
    assert.ok(next, 'model was called more times than the script allows');
    return next;
  };
  return { callModel, requests };
}

const echo = {
  name: 'echo',
  description: 'echo',
  inputSchema: { type: 'object', properties: {} },
  run: async (input) => `echo:${input.v}`,
};
const boom = {
  name: 'boom',
  description: 'always fails',
  inputSchema: { type: 'object', properties: {} },
  run: async () => {
    throw new Error('kaboom');
  },
};
const limits = { maxSteps: 5, maxTotalTokens: 1000, maxTokensPerTurn: 100 };
const base = { model: 'fake', system: 's', user: 'u', tools: [echo, boom], limits };

let n = 0;
const test = async (name, fn) => {
  await fn();
  console.log(`  ok  ${name}`);
  n++;
};

await test('no tool use: one turn, completed', async () => {
  const { callModel, requests } = fakeModel([say('done')]);
  const run = await runAgent({ ...base, callModel });
  assert.equal(run.stopReason, 'completed');
  assert.equal(run.text, 'done');
  assert.equal(run.modelTurns, 1);
  assert.equal(run.steps.length, 0);
  assert.deepEqual(requests[0].tool_choice, { type: 'auto' });
});

await test('tool results return in one user message, in call order', async () => {
  const { callModel, requests } = fakeModel([
    ask([
      ['a', 'echo', { v: 1 }],
      ['b', 'echo', { v: 2 }],
    ]),
    say('final'),
  ]);
  const run = await runAgent({ ...base, callModel });
  assert.equal(run.stopReason, 'completed');
  assert.equal(run.steps.length, 2);
  const sent = requests[1].messages;
  assert.equal(sent.length, 3); // user, assistant(tool_use), user(tool_results)
  assert.deepEqual(
    sent[2].content.map((b) => [b.type, b.tool_use_id, b.content]),
    [
      ['tool_result', 'a', 'echo:1'],
      ['tool_result', 'b', 'echo:2'],
    ],
  );
});

await test('a failing tool becomes an error result and the loop continues', async () => {
  const { callModel, requests } = fakeModel([ask([['a', 'boom', {}]]), say('recovered')]);
  const run = await runAgent({ ...base, callModel });
  assert.equal(run.stopReason, 'completed');
  assert.equal(run.steps[0].ok, false);
  assert.equal(run.steps[0].error, 'kaboom');
  assert.equal(requests[1].messages[2].content[0].is_error, true);
});

await test('an unknown tool is reported to the model, not thrown', async () => {
  const { callModel } = fakeModel([ask([['a', 'nope', {}]]), say('ok')]);
  const run = await runAgent({ ...base, callModel });
  assert.equal(run.steps[0].ok, false);
  assert.match(run.steps[0].error, /Unknown tool/);
});

await test('step cap: extra calls are skipped, final turn has tools disabled', async () => {
  const { callModel, requests } = fakeModel([
    ask([
      ['a', 'echo', { v: 1 }],
      ['b', 'echo', { v: 2 }],
      ['c', 'echo', { v: 3 }],
    ]),
    say('partial'),
  ]);
  const run = await runAgent({ ...base, limits: { ...limits, maxSteps: 2 }, callModel });
  assert.equal(run.stopReason, 'step_cap');
  assert.equal(run.text, 'partial');
  assert.deepEqual(
    run.steps.map((s) => s.ok),
    [true, true, false],
  );
  assert.match(run.steps[2].error, /Not run/);
  assert.deepEqual(requests[1].tool_choice, { type: 'none' });
  const last = requests[1].messages.at(-1).content;
  assert.equal(last.filter((b) => b.type === 'tool_result').length, 3); // every tool_use answered
  assert.match(last.at(-1).text, /cut short/);
});

await test('token budget: no tool runs once the budget is spent', async () => {
  let ran = 0;
  const counted = { ...echo, run: async () => (ran++, 'x') };
  const { callModel } = fakeModel([ask([['a', 'echo', { v: 1 }]], 2000), say('out of budget')]);
  const run = await runAgent({ ...base, tools: [counted], callModel });
  assert.equal(run.stopReason, 'token_budget');
  assert.equal(ran, 0);
  assert.equal(run.modelTurns, 2);
});

await test('the loop keeps going across several turns until the model stops', async () => {
  const { callModel } = fakeModel([
    ask([['a', 'echo', { v: 1 }]]),
    ask([['b', 'echo', { v: 2 }]]),
    ask([['c', 'echo', { v: 3 }]]),
    say('done after three'),
  ]);
  const run = await runAgent({ ...base, callModel });
  assert.equal(run.stopReason, 'completed');
  assert.equal(run.steps.length, 3);
  assert.equal(run.modelTurns, 4);
  assert.equal(run.tokens_used, 40);
});

console.log(`\n${n} passed`);
