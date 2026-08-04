/**
 * Fleet identity — deterministic per-agent Ed25519 keys from one master seed.
 *
 * secret = sha256(seed_bytes || "oacp-fleet:" + name)
 *
 * One Render secret (FLEET_MASTER_SEED) pins the whole fleet's identities:
 * the same seed rebuilds the same keys on any host, and adding an agent to
 * the roster never requires minting or storing another secret.
 */
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { sha256 } from '@noble/hashes/sha256';
import { toHex, fromHex, type OACPKeypair } from 'oacp-sdk';

// Enable @noble/ed25519 v3 sync methods (same shim the SDK uses).
if ('hashes' in ed && typeof ed.hashes === 'object' && ed.hashes !== null) {
  (ed.hashes as { sha512?: typeof sha512 }).sha512 = sha512;
}

const SEED_HEX_RE = /^[0-9a-f]{64}$/i;

/** Validate a master seed: 32 bytes as 64 hex chars. */
export function isValidMasterSeed(seedHex: string | undefined): seedHex is string {
  return typeof seedHex === 'string' && SEED_HEX_RE.test(seedHex);
}

/** Derive the keypair for one named fleet resident from the master seed. */
export function deriveKeypair(masterSeedHex: string, name: string): OACPKeypair {
  if (!isValidMasterSeed(masterSeedHex)) {
    throw new Error('FLEET_MASTER_SEED must be 32 bytes as 64 hex chars');
  }
  const seed = fromHex(masterSeedHex);
  const label = new TextEncoder().encode(`oacp-fleet:${name}`);
  const material = new Uint8Array(seed.length + label.length);
  material.set(seed);
  material.set(label, seed.length);
  const secretKey = sha256(material);
  const publicKey = ed.getPublicKey(secretKey);
  return { secretKey: toHex(secretKey), publicKey: toHex(publicKey) };
}
