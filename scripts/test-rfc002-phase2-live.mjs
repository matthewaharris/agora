#!/usr/bin/env node
/**
 * RFC 002 Phase 2 live E2E — friendship removal + handle release/quarantine.
 *
 * Friend edges were append-only for beta; removal reverts a pair to
 * stranger rules, and the checks assert the registry actually enforces
 * that (closed agent unreachable), not just that a row disappeared.
 * Handle release runs the §2.4 anti-phishing quarantine: another owner is
 * locked out for 90 days, the releasing owner reclaims immediately.
 *
 * Needs SUPABASE_ACCESS_TOKEN (Management API) to provision scratch owner
 * accounts — handle claims require attachment, and there is no anonymous
 * path to an owner account (that is the point of RFC 003).
 *
 * Usage: SUPABASE_ACCESS_TOKEN=… node scripts/test-rfc002-phase2-live.mjs
 */
import { OACPAgent } from 'oacp-sdk';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP = join(tmpdir(), `oacp-p2-${Date.now()}`);
mkdirSync(TMP, { recursive: true });

const MGMT = 'https://api.supabase.com/v1/projects/zhenbunwugeskqtghjyt/database/query';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) { console.error('SUPABASE_ACCESS_TOKEN required'); process.exit(1); }
async function sql(query) {
  const res = await fetch(MGMT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`SQL failed: ${JSON.stringify(body)}`);
  return body;
}

let PASS = 0, FAIL = 0;
const pass = (m) => { PASS++; console.log(`  [PASS] ${m}`); };
const fail = (m, d) => { FAIL++; console.log(`  [FAIL] ${m}: ${d}`); };

const mk = (name, extra = {}) => new OACPAgent({
  name,
  capabilities: ['rfc002p2-e2e'],
  description: 'RFC002 Phase 2 E2E scratch agent — safe to delete',
  ownerHandle: 'matt-e2e',
  keypairPath: join(TMP, `${name}-kp.json`),
  ownerKeypairPath: join(TMP, `${name}-owner.json`),
  contactsPath: join(TMP, `${name}-contacts.json`),
  ...extra,
});

console.log(`RFC 002 Phase 2 live E2E (scratch dir: ${TMP})`);

const a = mk('p2-a');
const b = mk('p2-b', {
  actionSpecs: [{
    name: 'ping', description: 'reply pong',
    inputSchema: { type: 'object', properties: { action: { type: 'string' } } },
  }],
});
await a.register();
await b.register();
const aId = a.getAgentId();
const bId = b.getAgentId();

// ---- friendship removal ----

const code = await a.mintFriendCode();
await b.addFriend(code.code);
const f1 = await a.listFriends();
if (f1.friends.some((f) => f.agent_id === bId)) pass('1. friend code flow establishes the edge');
else fail('1. friendship established', JSON.stringify(f1).slice(0, 120));

await b.setAccessPolicy('closed');
try {
  await a.send(bId, 'chat', { text: 'friends can chat with closed agents' }, { seal: true });
  pass('2. friend can message the closed agent');
} catch (err) {
  fail('2. friend reaches closed agent', String(err).slice(0, 120));
}

const rm = await a.removeFriend(bId);
if (rm.removed === true) pass('3. removeFriend removes the edge');
else fail('3. removal', JSON.stringify(rm));

const f2 = await a.listFriends();
let sendBlocked = false;
try {
  await a.send(bId, 'chat', { text: 'this must not go through' });
} catch (err) {
  sendBlocked = String(err).includes('403');
}
if (f2.friends.every((f) => f.agent_id !== bId) && sendBlocked) {
  pass('4. pair reverted to stranger rules — closed agent now unreachable (403)');
} else {
  fail('4. stranger rules enforced', JSON.stringify({ friends: f2.friends.length, sendBlocked }));
}

const rm2 = await a.removeFriend(bId);
if (rm2.removed === false) pass('5. second removal is a clean no-op');
else fail('5. idempotent removal', JSON.stringify(rm2));

// ---- handle release + quarantine ----
// Provision two scratch owner accounts and attach the agents.
const suffix = String(Date.now()).slice(-6);
const H = `e2e-quar-${suffix}`;
// owners.owner_id references auth.users, so scratch owners need auth rows
const [{ o1 }] = await sql(`
  WITH u1 AS (
    INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
    VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'e2e-own1-${suffix}@example.com', now(), now())
    RETURNING id
  ), u2 AS (
    INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
    VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'e2e-own2-${suffix}@example.com', now(), now())
    RETURNING id
  ), own1 AS (
    INSERT INTO owners (owner_id, email, owner_public_key)
    SELECT id, 'e2e-own1-${suffix}@example.com', repeat('a1', 32) FROM u1
    RETURNING owner_id
  ), own2 AS (
    INSERT INTO owners (owner_id, email, owner_public_key)
    SELECT id, 'e2e-own2-${suffix}@example.com', repeat('b2', 32) FROM u2
    RETURNING owner_id
  ), att1 AS (
    UPDATE agents SET owner_id = (SELECT owner_id FROM own1) WHERE agent_id = '${aId}'
  ), att2 AS (
    UPDATE agents SET owner_id = (SELECT owner_id FROM own2) WHERE agent_id = '${bId}'
  )
  SELECT (SELECT owner_id FROM own1) AS o1;`);

const c1 = await a.claimHandle({ ownerHandle: H, agentHandle: 'worker' });
if (c1.handle === `@${H}/worker`) pass(`6. owner+agent handle claimed (@${H}/worker)`);
else fail('6. claim', JSON.stringify(c1));

const rel = await a.releaseHandle({ ownerHandle: true, agentHandle: true });
const relOwner = rel.owner_handle ?? {};
if (relOwner.released === true && relOwner.quarantined_until && rel.agent_handle?.released === true) {
  pass(`7. release: owner handle quarantined until ${String(relOwner.quarantined_until).slice(0, 10)}, agent handle freed`);
} else {
  fail('7. release', JSON.stringify(rel));
}

let quarBlocked = null;
try {
  await b.claimHandle({ ownerHandle: H });
} catch (err) {
  quarBlocked = String(err);
}
if (quarBlocked?.includes('409') && quarBlocked.includes('quarantine')) {
  pass('8. another owner is blocked by the 90-day quarantine (409)');
} else {
  fail('8. quarantine blocks others', (quarBlocked ?? 'claim succeeded').slice(0, 140));
}

const c2 = await a.claimHandle({ ownerHandle: H });
if (c2.owner_handle === `@${H}`) pass('9. releasing owner reclaims immediately (quarantine exemption)');
else fail('9. self-reclaim', JSON.stringify(c2));

const [{ qrows }] = await sql(`SELECT count(*)::int AS qrows FROM handle_quarantine WHERE handle = '${H}';`);
if (qrows === 0) pass('10. reclaim consumed the quarantine row');
else fail('10. quarantine row cleared', `rows=${qrows}`);

// ---- cleanup ----
await sql(`
  DELETE FROM messages WHERE sender_agent_id IN ('${aId}','${bId}') OR recipient_agent_id IN ('${aId}','${bId}');
  DELETE FROM agents WHERE 'rfc002p2-e2e' = ANY(capabilities);
  DELETE FROM owners WHERE email LIKE 'e2e-own%@example.com';
  DELETE FROM auth.users WHERE email LIKE 'e2e-own%@example.com';
  DELETE FROM handle_quarantine WHERE handle LIKE 'e2e-quar-%';`);
console.log('  (scratch agents, owners, and quarantine rows cleaned)');

console.log(`\nRFC 002 Phase 2 live E2E: ${PASS} passed, ${FAIL} failed`);
process.exit(FAIL === 0 ? 0 : 1);
