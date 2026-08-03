#!/usr/bin/env node
/**
 * RFC 001 §5.2 live E2E — per-thread ratcheting over blinded mailboxes.
 *
 * The claim under test is forward secrecy: once the thread key exists,
 * message keys are one-time, ephemeral secrets are already gone, and
 * wiping the thread state makes captured ciphertext permanently
 * undecryptable — even holding both identity keys. The registry was never
 * told any of this is happening: ratcheted blobs relay through the same
 * deposit/fetch surface as static ones.
 *
 * Usage: node scripts/test-ratchet-live.mjs [tmpdir]
 */
import {
  OACPAgent,
  saveContact,
  loadRatchets,
  OACP_PUBLIC_REGISTRY_URL,
} from 'oacp-sdk';
import { mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP = process.argv[2] || join(tmpdir(), `oacp-ratchet-${Date.now()}`);
mkdirSync(TMP, { recursive: true });
const API = `${OACP_PUBLIC_REGISTRY_URL}/functions/v1/oacp`;

let PASS = 0, FAIL = 0;
const pass = (m) => { PASS++; console.log(`  [PASS] ${m}`); };
const fail = (m, d) => { FAIL++; console.log(`  [FAIL] ${m}: ${d}`); };

const mk = (name) => new OACPAgent({
  name,
  capabilities: ['ratchet-e2e'],
  description: 'ratchet E2E scratch agent — safe to delete',
  ownerHandle: 'matt-e2e',
  keypairPath: join(TMP, `${name}-kp.json`),
  ownerKeypairPath: join(TMP, `${name}-owner.json`),
  contactsPath: join(TMP, `${name}-contacts.json`),
  ratchetsPath: join(TMP, `${name}-ratchets.json`),
});

console.log(`Per-thread ratcheting live E2E (scratch dir: ${TMP})`);

const a = mk('ratchet-a');
const b = mk('ratchet-b');
await a.register();
await b.register();
const aId = a.getAgentId();
const bId = b.getAgentId();
const pin = (path, id, key) => saveContact(path, {
  agent_id: id, public_key: key, pinned_at: new Date().toISOString(), via: 'code',
});
pin(join(TMP, 'ratchet-a-contacts.json'), bId, b.getPublicKey());
pin(join(TMP, 'ratchet-b-contacts.json'), aId, a.getPublicKey());

const cid = crypto.randomUUID();

// --- 1. thread opener is honest about NOT being forward-secret yet ---
const r1 = await a.sendBlinded(bId, 'chat', { text: 'opening move' }, { correlationId: cid });
if (r1.forward_secret === false) pass('1. first message reports forward_secret: false (handshake not complete)');
else fail('1. opener not FS', JSON.stringify(r1));

// --- 2. responder receives it and the handshake completes on its side ---
const bInbox1 = await b.checkBlindedMailbox();
const got1 = bInbox1.find((m) => m.correlation_id === cid);
const bState = loadRatchets(join(TMP, 'ratchet-b-ratchets.json'))[`${aId}:${cid}`];
if (got1?.payload?.text === 'opening move' && got1.forward_secret === false && bState?.tk) {
  pass('2. responder read the opener and derived the thread key');
} else {
  fail('2. responder handshake', JSON.stringify({ got: got1?.payload, tk: !!bState?.tk }));
}

// --- 3. ephemeral secrets do not survive the handshake ---
if (bState && !bState.my_ek_secret) pass('3. responder ephemeral secret already deleted from state');
else fail('3. ephemeral secret deleted', JSON.stringify(Object.keys(bState ?? {})));

// --- 4. responder's reply is ratcheted ---
const r2 = await b.sendBlinded(aId, 'chat', { text: 'ratcheted reply' }, { correlationId: cid });
if (r2.forward_secret === true) pass('4. reply sent under the thread key (forward_secret: true)');
else fail('4. reply ratcheted', JSON.stringify(r2));

// --- 5. the ratcheted blob on the wire is v2 and still names no one ---
const rawFetch = await (await fetch(`${API}/mailbox?tags=${r2.tag}`)).json();
const rawItem = rawFetch.items?.find((i) => i.item_id === r2.item_id);
const parsed = rawItem ? JSON.parse(rawItem.blob) : null;
const aEk = loadRatchets(join(TMP, 'ratchet-a-ratchets.json'))[`${bId}:${cid}`]?.my_ek_pub ?? 'missing-a';
const bEk = loadRatchets(join(TMP, 'ratchet-b-ratchets.json'))[`${aId}:${cid}`]?.my_ek_pub ?? 'missing-b';
if (
  parsed?.v === 2 && typeof parsed.hdr === 'string' &&
  !rawItem.blob.includes(aId) && !rawItem.blob.includes(bId) &&
  !rawItem.blob.includes(aEk) && !rawItem.blob.includes(bEk)
) {
  pass('5. wire blob is v2; neither agent ids nor ephemeral pubs appear in cleartext');
} else {
  fail('5. v2 wire opacity', JSON.stringify(parsed)?.slice(0, 160));
}

// --- 6. initiator bootstraps from the encrypted header and reads the reply ---
const aInbox1 = await a.checkBlindedMailbox();
const got2 = aInbox1.find((m) => m.correlation_id === cid && m.forward_secret);
if (got2?.payload?.text === 'ratcheted reply' && got2.sender_agent_id === bId) {
  pass('6. initiator derived the thread key from the header and decrypted the reply');
} else {
  fail('6. initiator bootstrap', JSON.stringify(aInbox1).slice(0, 200));
}

// --- 7. both directions now ratchet ---
const r3 = await a.sendBlinded(bId, 'chat', { text: 'fully ratcheted now' }, { correlationId: cid });
const bInbox2 = await b.checkBlindedMailbox();
const got3 = bInbox2.find((m) => m.forward_secret && m.payload?.text === 'fully ratcheted now');
if (r3.forward_secret === true && got3) pass('7. subsequent traffic ratchets in both directions');
else fail('7. both directions FS', JSON.stringify({ r3: r3.forward_secret, got: !!got3 }));

// --- 8. ratcheted messages are consume-once (their keys are already gone) ---
const bInbox3 = await b.checkBlindedMailbox();
const replayed = bInbox3.find((m) => m.forward_secret && m.payload?.text === 'fully ratcheted now');
if (!replayed) pass('8. re-poll does not return a consumed ratcheted message (key deleted on use)');
else fail('8. consume-once', 'message decrypted twice');

// --- 9. a replayed deposit of captured ciphertext is dead on arrival ---
const captured = rawItem; // B's reply blob, captured off the wire in check 5
await fetch(`${API}/mailbox/deposit`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ tag: captured.tag, blob: captured.blob }),
});
const aInbox2 = await a.checkBlindedMailbox();
const replayHit = aInbox2.find((m) => m.forward_secret && m.payload?.text === 'ratcheted reply');
if (!replayHit) pass('9. replayed captured blob is not accepted (one-time key already consumed)');
else fail('9. replay rejected', 'replay decrypted');

// --- 10. ending the thread destroys the ability to decrypt, permanently ---
const wiped = a.endBlindedThread(bId, cid);
const aStateAfter = loadRatchets(join(TMP, 'ratchet-a-ratchets.json'))[`${bId}:${cid}`];
// B sends once more; A — with state wiped — must not be able to read it.
await b.sendBlinded(aId, 'chat', { text: 'after the wipe' }, { correlationId: cid });
const aInbox3 = await a.checkBlindedMailbox();
const afterWipe = aInbox3.find((m) => m.payload?.text === 'after the wipe');
if (wiped && !aStateAfter && !afterWipe) {
  pass('10. endBlindedThread wiped state; subsequent ciphertext is undecryptable');
} else {
  fail('10. FS lever', JSON.stringify({ wiped, state: !!aStateAfter, read: !!afterWipe }));
}

console.log(`\nPer-thread ratcheting live E2E: ${PASS} passed, ${FAIL} failed`);
process.exit(FAIL === 0 ? 0 : 1);
