#!/usr/bin/env node
/**
 * RFC 007 §1 live E2E — wire state visibility + thread stickiness.
 *
 * Reproduces the 2026-07-25 leak shape: an agent sends unsealed onto an
 * observer-visible thread while believing the channel is private. The point
 * is no longer that this is impossible — it's that it can no longer happen
 * SILENTLY.
 *
 * Usage: node scripts/test-wire-state-live.mjs [tmpdir]
 */
import { OACPAgent } from 'oacp-sdk';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP = process.argv[2] || join(tmpdir(), `oacp-wire-${Date.now()}`);
mkdirSync(TMP, { recursive: true });

let PASS = 0, FAIL = 0;
const pass = (m) => { PASS++; console.log(`  [PASS] ${m}`); };
const fail = (m, d) => { FAIL++; console.log(`  [FAIL] ${m}: ${d}`); };

const mk = (name, extra = {}) => new OACPAgent({
  name,
  capabilities: ['wire-e2e'],
  description: 'wire-state E2E scratch agent — safe to delete',
  ownerHandle: 'matt-e2e',
  keypairPath: join(TMP, `${name}-kp.json`),
  ownerKeypairPath: join(TMP, `${name}-owner.json`),
  contactsPath: join(TMP, `${name}-contacts.json`),
  ...extra,
});

console.log(`Wire-state live E2E (scratch dir: ${TMP})`);

const a = mk('wire-sender');
const b = mk('wire-recipient', {
  actionSpecs: [{
    name: 'note',
    description: 'accept a note',
    inputSchema: { type: 'object', properties: { action: { type: 'string' }, text: { type: 'string' } } },
  }],
});
await a.register();
await b.register();
await b.acceptSender(a.getAgentId());

// --- 1. The leak shape: unsealed on an open thread ---
const r1 = await a.sendChecked(b.getAgentId(), 'task_request',
  { action: 'note', text: 'cutover 03:00, pricing rules attached' });
if (r1.observer_readable === true && r1.sealed === false) {
  pass('1. unsealed send on open thread reports observer_readable=true');
} else {
  fail('1. observer_readable on plaintext', JSON.stringify(r1));
}
if (r1.visibility === 'open') pass(`2. receipt reports the real tier (${r1.visibility})`);
else fail('2. receipt reports real tier', JSON.stringify(r1));

// --- 2. Sealed private send is reported as safe ---
// Sealing requires a friendship: RFC 005 forbids sealed stranger traffic so
// the registry can inspect it. Establish the friend edge first.
const code = await b.mintFriendCode();
await a.addFriend(code.code, 'wire e2e');
const corr = crypto.randomUUID();
const r2 = await a.sendChecked(b.getAgentId(), 'task_request',
  { action: 'note', text: 'same content, sealed' },
  { correlationId: corr, seal: true, visibility: 'private' });
if (r2.sealed === true && r2.observer_readable === false) {
  pass('3. sealed private send reports sealed=true, observer_readable=false');
} else {
  fail('3. sealed send receipt', JSON.stringify(r2));
}

// RFC 004: once friends, seal is the DEFAULT — a caller who forgets should
// still end up private, and the receipt should say so.
const r2b = await a.sendChecked(b.getAgentId(), 'task_request',
  { action: 'note', text: 'no seal flag passed' }, { correlationId: corr });
if (r2b.sealed === true && r2b.observer_readable === false) {
  pass('3b. friend send seals by default without asking (RFC 004)');
} else {
  fail('3b. friend seal-by-default', JSON.stringify(r2b));
}

// --- 3. Thread stickiness ---
const found = await a.currentThreadWith(b.getAgentId());
if (found) pass(`4. currentThreadWith found an existing thread (${found.slice(0, 8)}…)`);
else fail('4. currentThreadWith', 'returned null despite an active thread');

// --- 4. Receipt is retrievable after a plain send() ---
const id = await a.send(b.getAgentId(), 'task_request', { action: 'note', text: 'plain send' });
const last = a.getLastReceipt();
if (last && last.message_id === id && typeof last.observer_readable === 'boolean') {
  pass('5. getLastReceipt() exposes wire state after a normal send()');
} else {
  fail('5. getLastReceipt after send()', JSON.stringify(last));
}

// --- 5. Quarantine is reported, not silent ---
const c = mk('wire-stranger');
await c.register();
const r3 = await c.sendChecked(b.getAgentId(), 'task_request', { action: 'note', text: 'hi' });
if (r3.delivery_status === 'quarantined') {
  pass('6. first contact reports delivery_status=quarantined');
} else {
  fail('6. quarantine reported', JSON.stringify(r3));
}

console.log(`\nWire-state live E2E: ${PASS} passed, ${FAIL} failed`);
process.exit(FAIL === 0 ? 0 : 1);
