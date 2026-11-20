/**
 * Trajectories — recording, store failure modes, and replay (no network).
 *
 * Run: node --import tsx agents/fleet-host/src/runtime/trajectory.test.mjs
 */
import assert from 'node:assert/strict';
import { runAgent } from './harness.ts';
import {
  createRecorder,
  createReplayModel,
  createReplayTools,
  memoryStore,
  postgresStore,
  readDatabaseRun,
  TrajectoryUnavailableError,
} from './trajectory.ts';

const say = (text) => ({
  model: 'fake',
  stop_reason: 'end_turn',
  content: [{ type: 'text', text }],
  usage: { input_tokens: 10, output_tokens: 0 },
});
const ask = (calls) => ({
  model: 'fake',
  stop_reason: 'tool_use',
  content: calls.map(([id, name, input]) => ({ type: 'tool_use', id, name, input })),
  usage: { input_tokens: 10, output_tokens: 0 },
});
function fakeModel(script) {
  let calls = 0;
  const callModel = async () => {
    calls++;
    const next = script.shift();
    assert.ok(next, 'model was called more times than the script allows');
    return next;
  };
  return { callModel, calls: () => calls };
}

let toolRuns = 0;
const tool = (name, run) => ({
  name,
  description: name,
  inputSchema: { type: 'object', properties: {} },
  run,
});
const echo = tool('echo', async (input) => (toolRuns++, `echo:${input.v}`));
const boom = tool('boom', async () => {
  throw new Error('kaboom');
});
const limits = { maxSteps: 5, maxTotalTokens: 1000, maxTokensPerTurn: 100 };
const base = { model: 'fake', system: 's', user: 'u', tools: [echo, boom], limits };

/** A store that fails while `down()` is true. */
function flakyStore(down) {
  const inner = memoryStore();
  let attempts = 0;
  return {
    events: inner.events,
    append: async (event) => {
      if (down(++attempts)) throw new Error('db down');
      await inner.append(event);
    },
  };
}

let n = 0;
const test = async (name, fn) => {
  await fn();
  console.log(`  ok  ${name}`);
  n++;
};

await test('a capped run is recorded event by event, in order', async () => {
  const store = memoryStore();
  const recorder = createRecorder({ store, mode: 'required' });
  const { callModel } = fakeModel([
    ask([
      ['a', 'echo', { v: 1 }],
      ['b', 'echo', { v: 2 }],
    ]),
    say('partial'),
  ]);
  const run = await runAgent({ ...base, limits: { ...limits, maxSteps: 2 }, callModel, recorder });
  assert.equal(run.stopReason, 'step_cap');
  assert.deepEqual(
    store.events.map((e) => e.type),
    ['run.started', 'model.turn', 'tool.call', 'tool.call', 'limit.hit', 'model.turn', 'run.ended'],
  );
  assert.deepEqual(
    store.events.map((e) => e.seq),
    [1, 2, 3, 4, 5, 6, 7],
  );
  assert.ok(store.events.every((e) => e.run_id === recorder.run_id && e.trace_id === recorder.trace_id));
  assert.match(recorder.trace_id, /^[0-9a-f]{32}$/);
  assert.equal(store.events[2].content.output, 'echo:1');
  assert.equal(store.events[6].attrs.stop_reason, 'step_cap');
});

await test('a continued trace keeps the trace ID and names the parent run', async () => {
  const store = memoryStore();
  const trace = { trace_id: 'ab'.repeat(16), parent_run_id: 'parent-run' };
  const recorder = createRecorder({ store, mode: 'required', trace });
  await runAgent({ ...base, callModel: fakeModel([say('done')]).callModel, recorder });
  assert.ok(store.events.every((e) => e.trace_id === trace.trace_id && e.parent_run_id === 'parent-run'));
});

await test('required: store down at the start refuses the run before any model call', async () => {
  const recorder = createRecorder({ store: flakyStore(() => true), mode: 'required' });
  const model = fakeModel([say('never')]);
  await assert.rejects(
    runAgent({ ...base, callModel: model.callModel, recorder }),
    TrajectoryUnavailableError,
  );
  assert.equal(model.calls(), 0);
});

await test('required: store failing part-way stops the run and no more tools run', async () => {
  const store = flakyStore((attempt) => attempt > 2); // run.started and turn 1 are saved
  const recorder = createRecorder({ store, mode: 'required' });
  const model = fakeModel([ask([['a', 'echo', { v: 1 }]]), ask([['b', 'echo', { v: 2 }]]), say('never')]);
  toolRuns = 0;
  const run = await runAgent({ ...base, callModel: model.callModel, recorder });
  assert.equal(run.stopReason, 'trajectory_unavailable');
  assert.equal(run.text, '');
  assert.equal(model.calls(), 1);
  assert.equal(toolRuns, 1); // the call in flight finished; nothing after it started
  assert.deepEqual(
    store.events.map((e) => e.type),
    ['run.started', 'model.turn'],
  );
});

await test('buffered: the run completes and events land in order once the store returns', async () => {
  const store = flakyStore((attempt) => attempt <= 3);
  const recorder = createRecorder({ store, mode: 'buffered' });
  const { callModel } = fakeModel([ask([['a', 'echo', { v: 1 }]]), say('done')]);
  const run = await runAgent({ ...base, callModel, recorder });
  assert.equal(run.stopReason, 'completed');
  assert.deepEqual(await recorder.close(), { unsaved: 0 });
  assert.deepEqual(
    store.events.map((e) => e.seq),
    [1, 2, 3, 4, 5],
  );
});

await test('buffered: a store that never returns loses the events, and says how many', async () => {
  const recorder = createRecorder({ store: flakyStore(() => true), mode: 'buffered' });
  const run = await runAgent({ ...base, callModel: fakeModel([say('done')]).callModel, recorder });
  assert.equal(run.stopReason, 'completed');
  assert.deepEqual(await recorder.close(), { unsaved: 3 });
});

await test('replay: tools answer from the recording and never run for real', async () => {
  const store = memoryStore();
  const script = () => [
    ask([
      ['a', 'echo', { v: 1 }],
      ['b', 'boom', {}],
    ]),
    say('done'),
  ];
  await runAgent({
    ...base,
    callModel: fakeModel(script()).callModel,
    recorder: createRecorder({ store, mode: 'required' }),
  });

  toolRuns = 0;
  const tools = createReplayTools(store.events);
  assert.deepEqual(
    tools.map((t) => t.name),
    ['echo', 'boom'],
  );
  const replay = await runAgent({ ...base, tools, callModel: fakeModel(script()).callModel });
  assert.equal(toolRuns, 0);
  assert.equal(replay.stopReason, 'completed');
  assert.deepEqual(
    replay.steps.map((s) => [s.tool, s.ok, s.error]),
    [
      ['echo', true, undefined],
      ['boom', false, 'kaboom'],
    ],
  );
});

await test('replay: a call the recording never saw fails instead of reaching out', async () => {
  const store = memoryStore();
  await runAgent({
    ...base,
    callModel: fakeModel([ask([['a', 'echo', { v: 1 }]]), say('done')]).callModel,
    recorder: createRecorder({ store, mode: 'required' }),
  });
  const [replayEcho] = createReplayTools(store.events);
  assert.equal(await replayEcho.run({ v: 1 }), 'echo:1');
  await assert.rejects(replayEcho.run({ v: 99 }), /Not in the recording/);
});

await test('replay: a recording whose content has expired cannot be replayed', async () => {
  assert.throws(
    () => createReplayTools([{ type: 'run.started', attrs: {}, seq: 1, run_id: 'r', trace_id: 't', ts: '' }]),
    /cannot be replayed/,
  );
});

const event = (extra = {}) => ({
  run_id: 'r1',
  trace_id: 'ab'.repeat(16),
  seq: 1,
  ts: '2026-11-11T00:00:00.000Z',
  type: 'tool.call',
  attrs: { ok: true },
  ...extra,
});
function fakeFetch(status = 201) {
  const requests = [];
  const fetchImpl = async (url, init) => (requests.push({ url, init }), new Response(null, { status }));
  return { fetchImpl, requests };
}

await test('postgres store: inserts one row, and content gets an expiry', async () => {
  const { fetchImpl, requests } = fakeFetch();
  const store = postgresStore({ url: 'https://db.example/', key: 'k', contentDays: 7, fetchImpl });
  await store.append(event({ content: { output: 'x' } }));
  const { url, init } = requests[0];
  assert.equal(url, 'https://db.example/rest/v1/trajectory_events?on_conflict=run_id,seq');
  assert.equal(init.method, 'POST');
  // A new-style secret key is not a JWT: apikey only, no bearer header.
  assert.equal(init.headers.apikey, 'k');
  assert.equal(init.headers.Authorization, undefined);
  const legacy = fakeFetch();
  await postgresStore({ url: 'https://db.example/', key: 'eyJlegacy', fetchImpl: legacy.fetchImpl }).append(event());
  assert.equal(legacy.requests[0].init.headers.Authorization, 'Bearer eyJlegacy');
  assert.match(init.headers.Prefer, /ignore-duplicates/);
  const row = JSON.parse(init.body);
  assert.deepEqual(row.content, { output: 'x' });
  assert.equal(row.content_expires_at, '2026-11-18T00:00:00.000Z');
  assert.equal(row.parent_run_id, null);
});

await test('postgres store: an event without content has nothing to expire', async () => {
  const { fetchImpl, requests } = fakeFetch();
  await postgresStore({ url: 'https://db.example', key: 'k', fetchImpl }).append(event());
  const row = JSON.parse(requests[0].init.body);
  assert.equal(row.content, null);
  assert.equal(row.content_expires_at, null);
});

await test('postgres store: a rejected write is an error that names only the status', async () => {
  const { fetchImpl } = fakeFetch(503);
  const store = postgresStore({ url: 'https://db.example', key: 'secret-key', fetchImpl });
  await assert.rejects(
    store.append(event()),
    (err) => /503/.test(err.message) && !/secret-key/.test(err.message),
  );
});

await test('postgres store: a failed write stops a required run', async () => {
  const { fetchImpl } = fakeFetch(500);
  const recorder = createRecorder({
    store: postgresStore({ url: 'https://db.example', key: 'k', fetchImpl }),
    mode: 'required',
  });
  await assert.rejects(
    runAgent({ ...base, callModel: fakeModel([say('never')]).callModel, recorder }),
    TrajectoryUnavailableError,
  );
});

const recordCappedRun = async () => {
  const store = memoryStore();
  const original = await runAgent({
    ...base,
    limits: { ...limits, maxSteps: 2 },
    callModel: fakeModel([
      ask([
        ['a', 'echo', { v: 1 }],
        ['b', 'boom', {}],
      ]),
      say('partial'),
    ]).callModel,
    recorder: createRecorder({ store, mode: 'required' }),
  });
  return { store, original };
};
const fullReplay = (events, overrides = {}) =>
  runAgent({
    ...base,
    limits: { ...limits, maxSteps: 2 },
    tools: createReplayTools(events),
    callModel: createReplayModel(events),
    ...overrides,
  });

await test('full replay: the same run comes back exactly, with no model or tool called', async () => {
  const { store, original } = await recordCappedRun();
  toolRuns = 0;
  const replay = await fullReplay(store.events);
  assert.equal(toolRuns, 0);
  const comparable = ({ duration_ms, steps, ...rest }) => ({
    ...rest,
    steps: steps.map(({ duration_ms: _, ...step }) => step),
  });
  assert.deepEqual(comparable(replay), comparable(original));
});

await test('full replay: it is repeatable', async () => {
  const { store } = await recordCappedRun();
  const [a, b] = [await fullReplay(store.events), await fullReplay(store.events)];
  assert.equal(a.text, b.text);
  assert.equal(a.tokens_used, b.tokens_used);
});

await test('full replay: a harness that now behaves differently is caught, not papered over', async () => {
  const { store } = await recordCappedRun();
  // Same recording, but the cap is lifted: the harness would now keep tools on for turn 2.
  await assert.rejects(fullReplay(store.events, { limits }), /Replay diverged at turn 2/);
});

await test('full replay: asking for more turns than were recorded is caught', async () => {
  const { store } = await recordCappedRun();
  const model = createReplayModel(store.events.filter((e) => e.seq < 6)); // drop the final turn
  await assert.rejects(fullReplay(store.events, { callModel: model }), /only 1 were recorded/);
});

await test('database read: rows come back as events, in order, with NULL content dropped', async () => {
  const rows = [
    { ...event({ seq: 1 }), content: { output: 'x' }, content_expires_at: 'later' },
    { ...event({ seq: 2 }), content: null },
  ];
  const requests = [];
  const fetchImpl = async (url) => (requests.push(url), Response.json(rows));
  const runId = '00000000-0000-0000-0000-000000000001';
  const events = await readDatabaseRun({ url: 'https://db.example', key: 'k', runId, fetchImpl });
  assert.match(requests[0], /run_id=eq\.00000000-0000-0000-0000-000000000001&order=seq$/);
  assert.deepEqual(events[0].content, { output: 'x' });
  assert.equal('content' in events[1], false);
  await assert.rejects(
    readDatabaseRun({ url: 'https://db.example', key: 'k', runId: 'x&select=*', fetchImpl }),
    /UUID/,
  );
});

console.log(`\n${n} passed`);
