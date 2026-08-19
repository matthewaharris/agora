/**
 * Fleet identity — deterministic per-agent Ed25519 keys from one master seed.
 *
 *   agent secret = sha256(seed_bytes || "oacp-fleet:" + name)
 *   owner secret = sha256(seed_bytes || "oacp-fleet-owner:" + name)
 *
 * One Render secret (FLEET_MASTER_SEED) pins the whole fleet's identities:
 * the same seed rebuilds the same keys on any host, and adding an agent to
 * the roster never requires minting or storing another secret.
 *
 * The two labels are distinct domains on purpose — the owner key must not be
 * recoverable from the agent key, since the agent key travels to the registry
 * on every message while the owner key is what decrypts sealed threads.
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

/** Derive an Ed25519 keypair from the master seed under a labelled domain. */
function deriveUnderLabel(
  masterSeedHex: string,
  label: string,
): OACPKeypair {
  if (!isValidMasterSeed(masterSeedHex)) {
    throw new Error('FLEET_MASTER_SEED must be 32 bytes as 64 hex chars');
  }
  const seed = fromHex(masterSeedHex);
  const labelBytes = new TextEncoder().encode(label);
  const material = new Uint8Array(seed.length + labelBytes.length);
  material.set(seed);
  material.set(labelBytes, seed.length);
  const secretKey = sha256(material);
  const publicKey = ed.getPublicKey(secretKey);
  return { secretKey: toHex(secretKey), publicKey: toHex(publicKey) };
}

/** Derive the agent keypair for one named fleet resident. */
export function deriveKeypair(masterSeedHex: string, name: string): OACPKeypair {
  return deriveUnderLabel(masterSeedHex, `oacp-fleet:${name}`);
}

/**
 * Derive the OWNER keypair for one named fleet resident (RFC 001 §3.1) — the
 * key that decrypts the owner slot of sealed messages.
 *
 * Without this the SDK falls back to `loadOrCreateKeypair`, which generates a
 * fresh random owner key whenever the file is missing. On a Render worker the
 * filesystem is ephemeral, so that happened on every deploy — silently, and
 * with permanent consequences: threads sealed to the previous owner key can
 * never be read again. The SDK already documents this hazard for the agent
 * keypair (`resolveKeypair`, crypto.ts) and pins it from config; the owner key
 * had no equivalent escape hatch, so we derive it and place the file ourselves.
 */
export function deriveOwnerKeypair(
  masterSeedHex: string,
  name: string,
): OACPKeypair {
  return deriveUnderLabel(masterSeedHex, `oacp-fleet-owner:${name}`);
}
