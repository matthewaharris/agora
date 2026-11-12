#!/usr/bin/env node
/**
 * RFC 008 live E2E — trace context.
 *
 * Checks the deployed registry accepts, verifies, stores and returns the
 * signed trace fields, and still accepts messages without them.
 *
 * Usage: OACP_SDK_PATH=/path/to/oacp-sdk/dist/index.js node scripts/test-trace-live.mjs
 * (OACP_SDK_PATH is only needed until an SDK release with RFC 008 is installed here.)
 */
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { OACPAgent, canonicalizeMessage, newTraceId, traceOf } = await import(process.env.OACP_SDK_PATH || 'oacp-sdk');
if (!newTraceId) throw new Error('This oacp-sdk has no RFC 008 support; set OACP_SDK_PATH to a build that does.');

const TMP = join(tmpdir(), `oacp-trace-${Date.now()}`);
mkdirSync(TMP, { recursive: true });
let PASS = 0, FAIL = 0;
const pass = (m) => { PASS++; console.log(`  [PASS] ${m}`); };
const fail = (m, d) => { FAIL++; console.log(`  [FAIL] ${m}: ${d}`); };

const mk = (name, extra = {}) => new OACPAgent({
  name,
  capabilities: ['trace-e2e'],
  description: 'trace context E2E scratch agent — safe to delete',
  ownerHandle: 'matt-e2e',
  keypairPath: join(TMP, `${name}-kp.json`),
  ownerKeypairPath: join(TMP, `${name}-owner.json`),
  contactsPath: join(TMP, `${name}-contacts.json`),
  ...extra,
});

const a = mk('trace-sender');
const b = mk('trace-recipient', {
  actionSpecs: [{ name: 'noop', description: 'accept a test message', inputSchema: { type: 'object', properties: { action: { type: 'string' } } } }],
});
await a.register();
await b.register();
await b.acceptSender(a.getAgentId());

const TRACE = newTraceId();
const RUN = '010b9671-3b5c-4fd2-a303-64a841ba93b3';
const inbox = async () => (await b.getMessages({ direction: 'inbox', limit: 20 })).messages;

// 1. Untraced messages are unaffected.
try {
  const id = await a.send(b.getAgentId(), 'task_request', { action: 'noop', n: 1 }, { seal: false });
  const got = (await inbox()).find((m) => m.message_id === id);
  if (got && got.trace_id == null) pass('1. a message with no trace is still accepted, and stored with none');
  else fail('1. untraced message', JSON.stringify(got));
} catch (err) { fail('1. untraced message', String(err).slice(0, 160)); }

// 2. Traced: accepted, stored, returned.
try {
  const id = await a.send(b.getAgentId(), 'task_request', { action: 'noop', n: 2 }, { seal: false, trace: { traceId: TRACE, parentId: RUN } });
  const got = (await inbox()).find((m) => m.message_id === id);
  const t = got && traceOf(got);
  if (t && t.traceId === TRACE && t.parentId === RUN && t.sealed === false) pass('2. signed trace fields accepted and returned to the recipient');
  else fail('2. traced message', JSON.stringify(got));
} catch (err) { fail('2. traced message', String(err).slice(0, 200)); }

// Raw sends, to try what the SDK refuses to do.
const raw = async (signedFields, bodyFields) => {
  const base = { sender_agent_id: a.getAgentId(), recipient_agent_id: b.getAgentId(), message_type: 'task_request', payload: { action: 'noop', n: 3 } };
  const signature = a.sign(canonicalizeMessage({ ...base, ...signedFields }));
  return fetch(`${a.apiBaseUrl}/messages/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${a.registryToken}` },
    body: JSON.stringify({ ...base, ...bodyFields, signature }),
  });
};

// 3. A trace ID changed after signing is rejected.
{
  const res = await raw({ trace_id: TRACE }, { trace_id: newTraceId() });
  if (res.status === 403) pass('3. trace ID altered after signing is rejected (403)');
  else fail('3. altered trace', `status ${res.status}`);
}
// 4. A trace ID stripped after signing is rejected.
{
  const res = await raw({ trace_id: TRACE }, {});
  if (res.status === 403) pass('4. trace ID stripped after signing is rejected (403)');
  else fail('4. stripped trace', `status ${res.status}`);
}
// 5. Malformed values are a 400, not a signature error.
{
  const bad = TRACE.toUpperCase();
  const res = await raw({ trace_id: bad }, { trace_id: bad });
  const orphan = await raw({ trace_parent_id: RUN }, { trace_parent_id: RUN });
  if (res.status === 400 && orphan.status === 400) pass('5. malformed trace ID and parent-without-trace are rejected (400)');
  else fail('5. malformed', `statuses ${res.status}, ${orphan.status}`);
}

// 6. Sealed trace: nothing in the envelope, readable by the recipient.
// Sealing needs a friendship (RFC 005 forbids sealed stranger traffic).
try {
  const code = await b.mintFriendCode();
  await a.addFriend(code.code, 'trace e2e');
  const id = await a.send(b.getAgentId(), 'task_request', { action: 'noop', n: 6 }, { seal: true, trace: { traceId: TRACE, parentId: RUN, sealed: true } });
  const got = (await inbox()).find((m) => m.message_id === id);
  const t = got && traceOf(got);
  if (got && got.trace_id == null && got.was_sealed && t && t.traceId === TRACE && t.sealed === true) pass('6. sealed trace is absent from the envelope and readable after unsealing');
  else fail('6. sealed trace', JSON.stringify({ trace_id: got?.trace_id, was_sealed: got?.was_sealed, t }));
} catch (err) { fail('6. sealed trace', String(err).slice(0, 200)); }

console.log(`\n${PASS} passed, ${FAIL} failed`);
process.exit(FAIL ? 1 : 0);
