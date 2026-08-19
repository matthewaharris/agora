/**
 * Owner-key pinning — the fix for the ephemeral-disk bug.
 *
 * Run: node --import tsx agents/fleet-host/src/owner-key-pinning.test.mjs
 *
 * The property under test is the one that actually failed in production: after
 * a restart wipes the state directory, the owner key must come back identical.
 * The SDK's own loadOrCreateKeypair is used as the reader, so this checks the
 * real contract rather than our idea of it.
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadOrCreateKeypair } from 'oacp-sdk';
import { pinOwnerKeypair } from '../index.ts';
import { deriveOwnerKeypair } from './identity.ts';

const SEED = 'c'.repeat(64);
const NAME = 'oacp-protocol-expert';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-owner-'));
const keyPath = path.join(tmp, `${NAME}.owner.json`);

let n = 0;
const test = (name, fn) => { fn(); console.log(`  ok  ${name}`); n++; };

test('writes the derived key when the file is absent', () => {
  const derived = deriveOwnerKeypair(SEED, NAME);
  pinOwnerKeypair(keyPath, derived);
  assert.equal(fs.existsSync(keyPath), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(keyPath, 'utf-8')), derived);
});

test('the SDK reads back exactly what we wrote', () => {
  const derived = deriveOwnerKeypair(SEED, NAME);
  const loaded = loadOrCreateKeypair(keyPath);
  assert.equal(loaded.publicKey, derived.publicKey);
  assert.equal(loaded.secretKey, derived.secretKey);
});

test('file is not world-readable', () => {
  assert.equal(fs.statSync(keyPath).mode & 0o077, 0);
});

test('idempotent — repinning the same key leaves the file byte-identical', () => {
  const before = fs.readFileSync(keyPath, 'utf-8');
  pinOwnerKeypair(keyPath, deriveOwnerKeypair(SEED, NAME));
  assert.equal(fs.readFileSync(keyPath, 'utf-8'), before);
});

test('THE BUG: owner key survives an ephemeral-disk wipe', () => {
  const before = loadOrCreateKeypair(keyPath).publicKey;
  fs.rmSync(tmp, { recursive: true, force: true }); // simulate a Render redeploy
  assert.equal(fs.existsSync(keyPath), false);

  pinOwnerKeypair(keyPath, deriveOwnerKeypair(SEED, NAME)); // fresh boot
  const after = loadOrCreateKeypair(keyPath).publicKey;
  assert.equal(after, before, 'owner key changed across a state-dir wipe');
});

test('without pinning, the same wipe DOES change the key (bug reproduces)', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-nopin-'));
  const p = path.join(scratch, 'x.owner.json');
  const first = loadOrCreateKeypair(p).publicKey;
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(scratch, { recursive: true });
  const second = loadOrCreateKeypair(p).publicKey;
  assert.notEqual(first, second);
  fs.rmSync(scratch, { recursive: true, force: true });
});

test('replaces a differing pre-existing key and warns', () => {
  const warnings = [];
  const orig = console.warn;
  console.warn = (m) => warnings.push(String(m));
  try {
    const foreign = deriveOwnerKeypair('d'.repeat(64), NAME);
    fs.writeFileSync(keyPath, JSON.stringify(foreign));
    pinOwnerKeypair(keyPath, deriveOwnerKeypair(SEED, NAME));
  } finally {
    console.warn = orig;
  }
  assert.equal(loadOrCreateKeypair(keyPath).publicKey, deriveOwnerKeypair(SEED, NAME).publicKey);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /no longer be readable/);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${n} passed`);
