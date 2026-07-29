#!/usr/bin/env node
/**
 * RFC 001 §5.1 live E2E — blinded mailboxes.
 *
 * The claim under test is unlinkability: the registry stores ciphertext
 * addressed to rotating pseudonymous tags, and nothing it holds — the
 * deposit, the blob, the row — names either party. So beyond "the message
 * arrives", the checks here read the registry's own surfaces and assert
 * the parties are NOT in them.
 *
 * Usage: node scripts/test-blinded-mailbox-live.mjs [tmpdir]
 */
import {
  OACPAgent,
  saveContact,
  mailboxKeyFor,
  mailboxTag,
  mailboxEpoch,
  OACP_PUBLIC_REGISTRY_URL,
  OACP_PUBLIC_REGISTRY_KEY,
} from '../packages/oacp-sdk/dist/index.js';
import { mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP = process.argv[2] || join(tmpdir(), `oacp-blind-${Date.now()}`);
mkdirSync(TMP, { recursive: true });

let PASS = 0, FAIL = 0;
const pass = (m) => { PASS++; console.log(`  [PASS] ${m}`); };
const fail = (m, d) => { FAIL++; console.log(`  [FAIL] ${m}: ${d}`); };

const mk = (name) => new OACPAgent({
  name,
  capabilities: ['blind-e2e'],
  description: 'blinded mailbox E2E scratch agent — safe to delete',
  ownerHandle: 'matt-e2e',
  keypairPath: join(TMP, `${name}-kp.json`),
  ownerKeypairPath: join(TMP, `${name}-owner.json`),
  contactsPath: join(TMP, `${name}-contacts.json`),
});

console.log(`Blinded mailboxes live E2E (scratch dir: ${TMP})`);

const a = mk('blind-a');
const b = mk('blind-b');
await a.register();
await b.register();
const aId = a.getAgentId();
const bId = b.getAgentId();

// --- 1. blinded send refuses an unpinned recipient ---
try {
  await a.sendBlinded(crypto.randomUUID(), 'chat', { text: 'x' });
  fail('1. unpinned recipient rejected', 'send succeeded');
} catch (err) {
  if (String(err).includes('pinned contact')) pass('1. blinded send refuses an unpinned recipient');
  else fail('1. unpinned recipient rejected', String(err).slice(0, 120));
}

// Pin each other (out-of-band exchange, as a friend code would do).
const pin = (path, id, key) => saveContact(path, {
  agent_id: id, public_key: key, pinned_at: new Date().toISOString(), via: 'code',
});
pin(join(TMP, 'blind-a-contacts.json'), bId, b.getPublicKey());
pin(join(TMP, 'blind-b-contacts.json'), aId, a.getPublicKey());

// --- 2. both sides derive the same tag without talking to anyone ---
const aKp = JSON.parse(readFileSync(join(TMP, 'blind-a-kp.json'), 'utf8'));
const bKp = JSON.parse(readFileSync(join(TMP, 'blind-b-kp.json'), 'utf8'));
const epoch = mailboxEpoch();
const tagFromA = mailboxTag(mailboxKeyFor(aKp, b.getPublicKey()), epoch);
const tagFromB = mailboxTag(mailboxKeyFor(bKp, a.getPublicKey()), epoch);
if (tagFromA === tagFromB && /^[0-9a-f]{64}$/.test(tagFromA)) {
  pass('2. pair derives identical 64-hex tags from opposite ends');
} else {
  fail('2. symmetric tag derivation', `${tagFromA} vs ${tagFromB}`);
}

// --- 3. deposit: receipt carries a tag and an expiry, and names no one ---
const corr = crypto.randomUUID();
const receipt = await a.sendBlinded(bId, 'chat',
  { text: 'the drop is at the usual place' }, { correlationId: corr });
if (receipt.tag === tagFromA && receipt.expires_at) {
  pass(`3. deposited to the derived tag, expires ${receipt.expires_at}`);
} else {
  fail('3. deposit receipt', JSON.stringify(receipt));
}

// --- 4. the registry-side surfaces contain neither party ---
const rawFetch = await fetch(`${OACP_PUBLIC_REGISTRY_URL}/functions/v1/oacp/mailbox?tags=${receipt.tag}`);
const raw = await rawFetch.json();
const rawText = JSON.stringify(raw);
if (raw.items?.length === 1 && !rawText.includes(aId) && !rawText.includes(bId)) {
  pass('4. fetched item is an opaque blob — neither agent id appears anywhere in it');
} else {
  fail('4. blob names no one', rawText.slice(0, 200));
}

// --- 5. TTL bounds enforced ---
try {
  await a.sendBlinded(bId, 'chat', { text: 'x' }, { ttlSeconds: 10 });
  fail('5. absurd TTL rejected', 'deposit succeeded');
} catch (err) {
  if (String(err).includes('400')) pass('5. TTL below the floor is rejected (400)');
  else fail('5. absurd TTL rejected', String(err).slice(0, 120));
}

// --- 6. recipient decrypts, verifies the pinned-key signature, reads it ---
const inbox = await b.checkBlindedMailbox();
const msg = inbox.find((m) => m.correlation_id === corr);
if (msg && msg.sender_agent_id === aId && msg.payload.text === 'the drop is at the usual place') {
  pass('6. recipient decrypted and verified the message against the pinned key');
} else {
  fail('6. recipient reads the message', JSON.stringify(inbox).slice(0, 200));
}

// --- 7. reply flows through the same mailbox; own deposits are filtered ---
await b.sendBlinded(aId, 'chat', { text: 'copy that' }, { correlationId: corr });
const aInbox = await a.checkBlindedMailbox();
const reply = aInbox.find((m) => m.correlation_id === corr);
const ownEcho = aInbox.find((m) => m.sender_agent_id === aId);
if (reply?.payload?.text === 'copy that' && !ownEcho) {
  pass('7. reply received; sender\'s own deposits filtered out');
} else {
  fail('7. reply + self-filter', JSON.stringify({ reply: reply?.payload, ownEcho: !!ownEcho }));
}

// --- 8. nothing reached the ordinary message tables ---
const bMessages = await b.getMessages({ direction: 'inbox', limit: 50 });
const leaked = bMessages.messages.find((m) => m.correlation_id === corr);
if (!leaked) pass('8. blinded traffic never touched the messages table');
else fail('8. messages table clean', JSON.stringify(leaked).slice(0, 120));

// --- 9. the table itself is invisible to anonymous PostgREST ---
const anonRest = await fetch(`${OACP_PUBLIC_REGISTRY_URL}/rest/v1/mailbox_items?select=*`, {
  headers: { apikey: OACP_PUBLIC_REGISTRY_KEY, Authorization: `Bearer ${OACP_PUBLIC_REGISTRY_KEY}` },
});
const anonBody = await anonRest.text();
if (!anonRest.ok || anonBody.trim() === '[]') {
  pass('9. anon PostgREST sees zero mailbox rows (deny-all RLS)');
} else {
  fail('9. RLS deny-all', `${anonRest.status}: ${anonBody.slice(0, 120)}`);
}

// --- 10. garbage on the pair's tag is skipped, not crashed on ---
await fetch(`${OACP_PUBLIC_REGISTRY_URL}/functions/v1/oacp/mailbox/deposit`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ tag: receipt.tag, blob: 'not-even-json' }),
});
const afterGarbage = await b.checkBlindedMailbox();
if (afterGarbage.some((m) => m.correlation_id === corr)) {
  pass('10. undecryptable garbage on the tag is skipped silently');
} else {
  fail('10. garbage tolerance', JSON.stringify(afterGarbage).slice(0, 120));
}

console.log(`\nBlinded mailboxes live E2E: ${PASS} passed, ${FAIL} failed`);
process.exit(FAIL === 0 ? 0 : 1);
