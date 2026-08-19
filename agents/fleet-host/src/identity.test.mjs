/**
 * Fleet identity — derivation properties.
 *
 * Run: node --import tsx agents/fleet-host/src/identity.test.mjs
 *
 * These guard the fix for the ephemeral-owner-key bug: the owner keypair must
 * be reproducible from FLEET_MASTER_SEED alone, and must NOT be derivable from
 * the agent key, which travels to the registry on every message.
 */
import assert from 'node:assert/strict';
import { deriveKeypair, deriveOwnerKeypair, isValidMasterSeed } from './identity.ts';

const SEED_A = 'a'.repeat(64);
const SEED_B = 'b'.repeat(64);

let n = 0;
const test = (name, fn) => {
  fn();
  console.log(`  ok  ${name}`);
  n++;
};

test('seed validation accepts 64 hex, rejects everything else', () => {
  assert.equal(isValidMasterSeed(SEED_A), true);
  assert.equal(isValidMasterSeed('short'), false);
  assert.equal(isValidMasterSeed(undefined), false);
  assert.equal(isValidMasterSeed('z'.repeat(64)), false);
});

test('owner key is deterministic across calls', () => {
  const a = deriveOwnerKeypair(SEED_A, 'oacp-protocol-expert');
  const b = deriveOwnerKeypair(SEED_A, 'oacp-protocol-expert');
  assert.deepEqual(a, b);
  assert.match(a.secretKey, /^[0-9a-f]{64}$/);
  assert.match(a.publicKey, /^[0-9a-f]{64}$/);
});

test('owner key is NOT the agent key (domain separation)', () => {
  const agent = deriveKeypair(SEED_A, 'scribe-agent');
  const owner = deriveOwnerKeypair(SEED_A, 'scribe-agent');
  assert.notEqual(agent.secretKey, owner.secretKey);
  assert.notEqual(agent.publicKey, owner.publicKey);
});

test('agent key derivation is unchanged by the refactor', () => {
  // Pinned by running the PRE-refactor implementation (git show HEAD:…) against
  // this seed, not by recording what the new code happens to emit. If this
  // fails, every live fleet agent just lost its registry identity.
  const { publicKey } = deriveKeypair(SEED_A, 'oacp-concierge');
  assert.equal(
    publicKey,
    'b5dd108457f4f8b55b673e1cd7e8d0ad37692abf24992349015f3a6fea2435bb',
  );
});

test('different residents get different owner keys', () => {
  const a = deriveOwnerKeypair(SEED_A, 'translator-agent');
  const b = deriveOwnerKeypair(SEED_A, 'code-review-agent');
  assert.notEqual(a.publicKey, b.publicKey);
});

test('different seeds get different owner keys', () => {
  const a = deriveOwnerKeypair(SEED_A, 'translator-agent');
  const b = deriveOwnerKeypair(SEED_B, 'translator-agent');
  assert.notEqual(a.publicKey, b.publicKey);
});

test('name prefix yields a disjoint identity (staging vs prod)', () => {
  const prod = deriveOwnerKeypair(SEED_A, 'scribe-agent');
  const staging = deriveOwnerKeypair(SEED_A, 'scratch-scribe-agent');
  assert.notEqual(prod.publicKey, staging.publicKey);
});

console.log(`\n${n} passed`);
