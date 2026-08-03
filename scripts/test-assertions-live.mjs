#!/usr/bin/env node
/**
 * RFC 007 §§2-4 live E2E — assertions, disputes, accuracy.
 *
 * The property under test is the calibration rule: honest uncertainty must
 * outscore confident error BY CONSTRUCTION. So beyond the mechanics, the
 * final checks compare two agents — one that honestly marks claims
 * 'assumed', one that marks everything 'measured' and gets refuted — and
 * assert the score ordering the whole reputation story depends on.
 *
 * Usage: node scripts/test-assertions-live.mjs [tmpdir]
 */
import { OACPAgent, digestEvidence, saveContact } from 'oacp-sdk';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP = process.argv[2] || join(tmpdir(), `oacp-assert-${Date.now()}`);
mkdirSync(TMP, { recursive: true });

let PASS = 0, FAIL = 0;
const pass = (m) => { PASS++; console.log(`  [PASS] ${m}`); };
const fail = (m, d) => { FAIL++; console.log(`  [FAIL] ${m}: ${d}`); };

const mk = (name, extra = {}) => new OACPAgent({
  name,
  capabilities: ['assert-e2e'],
  description: 'RFC007 assertions E2E scratch agent — safe to delete',
  ownerHandle: 'matt-e2e',
  keypairPath: join(TMP, `${name}-kp.json`),
  ownerKeypairPath: join(TMP, `${name}-owner.json`),
  contactsPath: join(TMP, `${name}-contacts.json`),
  ...extra,
});

console.log(`RFC 007 assertions live E2E (scratch dir: ${TMP})`);

const HOLD_SPEC = {
  actionSpecs: [{
    name: 'hold', description: 'accept a result report',
    inputSchema: { type: 'object', properties: { action: { type: 'string' }, report: { type: 'string' } } },
  }],
};
const a = mk('assert-a');            // the confident claimant
const b = mk('assert-b', HOLD_SPEC); // the counterparty / disputer
const c = mk('assert-c');            // outsider — must not be able to dispute
const d = mk('assert-d', HOLD_SPEC); // recipient for the honest-assumed agent
const e = mk('assert-e');            // the honestly-uncertain claimant
await a.register(); await b.register(); await c.register(); await d.register(); await e.register();
await b.acceptSender(a.getAgentId());
await d.acceptSender(e.getAgentId());

// --- 1. a message carries labeled claims; the recipient reads them ---
const testLog = '214 tests, 214 passed, 0 failed';
const cid = crypto.randomUUID();
const CLAIM = 'test suite passes: 214/214';
const r1 = await a.sendChecked(b.getAgentId(), 'task_request', {
  action: 'hold', report: 'work finished',
}, {
  correlationId: cid,
  assertions: [
    { claim: CLAIM, status: 'measured', method: 'ran npm test, read the summary line', evidence_digest: digestEvidence(testLog) },
    { claim: 'the counterparty deployed their side', status: 'reported', basis: 'their agent stated it' },
  ],
});
const inbox = await b.getMessages({ direction: 'inbox', limit: 10 });
const got = inbox.messages.find((m) => m.message_id === r1.message_id);
const arrived = got?.payload?.assertions;
if (Array.isArray(arrived) && arrived.length === 2 && arrived[0].status === 'measured') {
  pass('1. assertions ride the payload and arrive labeled');
} else {
  fail('1. assertions arrive', JSON.stringify(got?.payload).slice(0, 160));
}

// --- 2. the registry counted them for the scoring layer ---
const rep1 = await (await fetch(`${a.getApiBaseUrl()}/reputation?agent_id=${a.getAgentId()}`)).json();
if (rep1.assertions_total === 2 && rep1.assertions_measured === 1 && rep1.assertions_reported === 1) {
  pass('2. ingest counted 1 measured + 1 reported');
} else {
  fail('2. ingest counters', JSON.stringify(rep1).slice(0, 160));
}

// --- 3. refuting requires a measurement, not a vibe ---
try {
  await b.disputeAssertion(r1.message_id, 0, {
    claim: CLAIM, verdict: 'refuted',
    assertion: { claim: 'that seems wrong', status: 'assumed', basis: 'gut feeling' },
  });
  fail('3. vibe refutation rejected', 'dispute succeeded');
} catch (err) {
  if (String(err).includes('vibe') || String(err).includes('400')) pass('3. refuted verdict without a measured counter-assertion is rejected (400)');
  else fail('3. vibe refutation rejected', String(err).slice(0, 140));
}

// --- 4. a real dispute lands ---
const disputeRes = await b.disputeAssertion(r1.message_id, 0, {
  claim: CLAIM, verdict: 'refuted',
  assertion: {
    claim: 'test suite fails: 3 of 214 red on a clean checkout',
    status: 'measured', method: 'cloned the branch, ran npm test twice',
    evidence_digest: digestEvidence('211 passed, 3 failed'),
  },
});
if (disputeRes.dispute_id) pass('4. measured counter-assertion records the dispute');
else fail('4. dispute recorded', JSON.stringify(disputeRes));

// --- 5. one dispute per claim per disputer ---
try {
  await b.disputeAssertion(r1.message_id, 0, {
    claim: CLAIM, verdict: 'refuted',
    assertion: { claim: 'still fails', status: 'measured', method: 'ran again' },
  });
  fail('5. duplicate dispute rejected', 'second dispute succeeded');
} catch (err) {
  if (String(err).includes('409')) pass('5. duplicate dispute rejected (409)');
  else fail('5. duplicate dispute rejected', String(err).slice(0, 120));
}

// --- 6. you cannot dispute your own claims, and outsiders cannot dispute at all ---
let own = null, outsider = null;
try { await a.disputeAssertion(r1.message_id, 1, { claim: 'x', verdict: 'unsupported', assertion: { claim: 'y', status: 'measured', method: 'z' } }); } catch (err) { own = String(err); }
try { await c.disputeAssertion(r1.message_id, 0, { claim: CLAIM, verdict: 'unsupported', assertion: { claim: 'y', status: 'measured', method: 'z' } }); } catch (err) { outsider = String(err); }
if (own?.includes('own claims') && outsider?.includes('403')) {
  pass('6. self-disputes 400, non-participants 403');
} else {
  fail('6. dispute authz', JSON.stringify({ own: own?.slice(0, 60), outsider: outsider?.slice(0, 60) }));
}

// --- 7. the disputed agent gets one response round ---
const resp = await a.respondToDispute(disputeRes.dispute_id, {
  claim: 'suite passes on the pinned toolchain; the 3 failures are the disputer\'s node version',
  status: 'measured', method: 're-ran on node 20 per repo engines field',
  evidence_digest: digestEvidence(testLog),
});
let secondResp = null;
try { await a.respondToDispute(disputeRes.dispute_id, { claim: 'x', status: 'measured', method: 'y' }); } catch (err) { secondResp = String(err); }
if (resp.responded === true && secondResp?.includes('409')) {
  pass('7. counter-evidence recorded; second response rejected (one round)');
} else {
  fail('7. response round', JSON.stringify({ resp, secondResp: secondResp?.slice(0, 80) }));
}

// --- 8. participants can read the dispute thread ---
const list = await b.getDisputes(r1.message_id);
const d0 = list.disputes?.[0];
if (list.disputes?.length === 1 && d0.verdict === 'refuted' && d0.response && d0.assertion?.method) {
  pass('8. dispute + staked methods + response readable by participants');
} else {
  fail('8. dispute list', JSON.stringify(list).slice(0, 200));
}

// --- 9. calibration: confident error scores below honest uncertainty ---
await e.send(d.getAgentId(), 'task_request', { action: 'hold', report: 'estimate' }, {
  assertions: [
    { claim: 'the fix probably resolves the dedupe issue', status: 'assumed', basis: 'fix deployed; duplicate not re-triggered' },
    { claim: 'their side is deployed', status: 'reported', basis: 'counterparty said so' },
  ],
});
const repA = await (await fetch(`${a.getApiBaseUrl()}/reputation?agent_id=${a.getAgentId()}`)).json();
const repE = await (await fetch(`${a.getApiBaseUrl()}/reputation?agent_id=${e.getAgentId()}`)).json();
// A: 1 measured, 1 refuted → accuracy max(0, (1-2)/1) = 0. E: no measured → null, never penalized.
if (repA.assertion_accuracy === 0 && repA.disputes_refuted === 1 &&
    repE.assertion_accuracy === null && repE.disputes_received === 0 && repE.assertions_assumed === 1) {
  pass('9. refuted-measured floors accuracy; honest assumed costs nothing (calibration by construction)');
} else {
  fail('9. calibration', JSON.stringify({ a: { acc: repA.assertion_accuracy, ref: repA.disputes_refuted }, e: { acc: repE.assertion_accuracy, rec: repE.disputes_received } }));
}

// --- 10. sealed assertions are not counted (invisible by design) ---
const codeRes = await a.mintFriendCode();
await c.addFriend(codeRes.code);
saveContact(join(TMP, 'assert-a-contacts.json'), {
  agent_id: c.getAgentId(), public_key: c.getPublicKey(), pinned_at: new Date().toISOString(), via: 'code',
});
await a.send(c.getAgentId(), 'chat', { text: 'sealed with claims' }, {
  seal: true,
  assertions: [{ claim: 'sealed claim the registry must not see', status: 'measured', method: 'x', evidence_digest: digestEvidence('y') }],
});
const repA2 = await (await fetch(`${a.getApiBaseUrl()}/reputation?agent_id=${a.getAgentId()}`)).json();
if (repA2.assertions_total === repA.assertions_total) {
  pass('10. sealed assertions never reach the public counters');
} else {
  fail('10. sealed invisible', `total ${repA.assertions_total} → ${repA2.assertions_total}`);
}

console.log(`\nRFC 007 assertions live E2E: ${PASS} passed, ${FAIL} failed`);
process.exit(FAIL === 0 ? 0 : 1);
