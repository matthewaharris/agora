#!/usr/bin/env node
/**
 * RFC 006 §3 live E2E — reply-by commitments.
 *
 * The field failure this addresses: six hours unable to distinguish
 * "working", "crashed" and "ignoring me". A stated deadline turns silence
 * into a fact.
 *
 * Usage: node scripts/test-commitment-live.mjs [tmpdir]
 */
import { OACPAgent } from 'oacp-sdk';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP = process.argv[2] || join(tmpdir(), `oacp-commit-${Date.now()}`);
mkdirSync(TMP, { recursive: true });

let PASS = 0, FAIL = 0;
const pass = (m) => { PASS++; console.log(`  [PASS] ${m}`); };
const fail = (m, d) => { FAIL++; console.log(`  [FAIL] ${m}: ${d}`); };

const mk = (name, extra = {}) => new OACPAgent({
  name,
  capabilities: ['commit-e2e'],
  description: 'commitment E2E scratch agent — safe to delete',
  ownerHandle: 'matt-e2e',
  keypairPath: join(TMP, `${name}-kp.json`),
  ownerKeypairPath: join(TMP, `${name}-owner.json`),
  contactsPath: join(TMP, `${name}-contacts.json`),
  ...extra,
});

console.log(`Commitment live E2E (scratch dir: ${TMP})`);

const worker = mk('commit-worker', {
  actionSpecs: [{
    name: 'long-job',
    description: 'a job that takes a while',
    inputSchema: { type: 'object', properties: { action: { type: 'string' } } },
  }],
});
const client = mk('commit-client');
await worker.register();
await client.register();
await worker.acceptSender(client.getAgentId());

const corr = crypto.randomUUID();
await client.send(worker.getAgentId(), 'task_request', { action: 'long-job' }, { correlationId: corr });
pass('1. task_request sent');

// No commitment yet — the requester should see nothing to rely on.
const none = await client.commitmentOn(corr);
if (none === null) pass('2. no commitment before acknowledgement');
else fail('2. no commitment before ack', JSON.stringify(none));

// Worker commits to a future deadline.
await worker.acknowledgeTask(client.getAgentId(), corr, {
  workingOn: 'running the migration audit',
  expectReplyBy: 900,
});
const live = await client.commitmentOn(corr);
if (live && live.overdue_by_seconds < 0 && live.working_on === 'running the migration audit') {
  pass(`3. commitment visible to requester, not yet due (${Math.round(-live.overdue_by_seconds / 60)} min out)`);
} else {
  fail('3. commitment visible and pending', JSON.stringify(live));
}

// A deadline already in the past must read as overdue — the escalation signal.
await worker.acknowledgeTask(client.getAgentId(), corr, {
  workingOn: 'still auditing',
  expectReplyBy: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
});
const late = await client.commitmentOn(corr);
if (late && late.overdue_by_seconds > 0) {
  pass(`4. passed deadline reads as overdue (~${Math.round(late.overdue_by_seconds / 60)} min)`);
} else {
  fail('4. overdue detection', JSON.stringify(late));
}

// Latest commitment wins, so a revised estimate supersedes the old one.
await worker.acknowledgeTask(client.getAgentId(), corr, {
  workingOn: 'revised: needs another pass',
  expectReplyBy: 1800,
});
const revised = await client.commitmentOn(corr);
if (revised && revised.overdue_by_seconds < 0 && revised.working_on.startsWith('revised')) {
  pass('5. revised commitment supersedes the overdue one');
} else {
  fail('5. revision supersedes', JSON.stringify(revised));
}

console.log(`\nCommitment live E2E: ${PASS} passed, ${FAIL} failed`);
process.exit(FAIL === 0 ? 0 : 1);
