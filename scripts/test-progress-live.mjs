#!/usr/bin/env node
/**
 * RFC 006 Phase 3 live E2E — task_progress + presence.
 *
 * Usage: node scripts/test-progress-live.mjs [tmpdir]
 */
import { OACPAgent } from '../packages/oacp-sdk/dist/index.js';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP = process.argv[2] || join(tmpdir(), `oacp-progress-${Date.now()}`);
mkdirSync(TMP, { recursive: true });

let PASS = 0, FAIL = 0;
const pass = (m) => { PASS++; console.log(`  [PASS] ${m}`); };
const fail = (m, d) => { FAIL++; console.log(`  [FAIL] ${m}: ${d}`); };

const mk = (name, extra = {}) => new OACPAgent({
  name,
  capabilities: ['progress-e2e'],
  description: 'task_progress E2E scratch agent — safe to delete',
  ownerHandle: 'matt-e2e',
  keypairPath: join(TMP, `${name}-kp.json`),
  ownerKeypairPath: join(TMP, `${name}-owner.json`),
  contactsPath: join(TMP, `${name}-contacts.json`),
  ...extra,
});

console.log(`task_progress live E2E (scratch dir: ${TMP})`);

const worker = mk('progress-worker', {
  actionSpecs: [{
    name: 'long-job',
    description: 'A job that reports progress',
    inputSchema: { type: 'object', properties: { action: { type: 'string' } } },
  }],
});
const client = mk('progress-client');
await worker.register();
await client.register();
await worker.acceptSender(client.getAgentId());

const corr = crypto.randomUUID();
await client.send(worker.getAgentId(), 'task_request', { action: 'long-job' }, { correlationId: corr });
pass('1. task_request sent');

// Worker emits interim progress, then the result.
const pid = await worker.send(client.getAgentId(), 'task_progress',
  { percent: 40, note: 'fetched sources' }, { correlationId: corr });
pass(`2. task_progress accepted by registry (${pid.slice(0, 8)}…)`);

const inbox = await client.getMessages({ direction: 'inbox', correlationId: corr, limit: 10 });
const prog = inbox.messages.find((m) => m.message_id === pid);
if (prog?.message_type === 'task_progress' && prog.payload?.percent === 40) {
  pass('3. progress readable by the requester with its payload');
} else {
  fail('3. progress readable', JSON.stringify(prog?.payload));
}

if (prog?.sender_info?.relationship) {
  pass(`4. progress carries provenance (relationship=${prog.sender_info.relationship})`);
} else {
  fail('4. progress provenance', JSON.stringify(prog?.sender_info));
}

const rid = await worker.send(client.getAgentId(), 'task_result',
  { summary: 'done' }, { correlationId: corr });
const after = await client.getMessages({ direction: 'inbox', correlationId: corr, limit: 10 });
const types = after.messages.map((m) => m.message_type).sort();
if (after.messages.find((m) => m.message_id === rid) && types.includes('task_progress')) {
  pass(`5. progress and result coexist on one thread (${types.join(', ')})`);
} else {
  fail('5. progress + result on one thread', types.join(', '));
}

console.log(`\ntask_progress live E2E: ${PASS} passed, ${FAIL} failed`);
process.exit(FAIL === 0 ? 0 : 1);
