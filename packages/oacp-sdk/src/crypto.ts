/**
 * OACP SDK — Ed25519 Identity & Cryptography
 *
 * Manages Ed25519 keypair generation, message signing, and verification.
 * Uses @noble/ed25519 for all cryptographic operations.
 *
 * Keys are represented as hex strings externally and Uint8Array internally.
 */

import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import * as fs from 'fs';
import * as path from 'path';

// Enable sync methods by providing SHA-512 hash function
// @noble/ed25519 v3.x uses `hashes` property
if ('hashes' in ed && typeof ed.hashes === 'object' && ed.hashes !== null) {
  (ed.hashes as Record<string, unknown>).sha512 = sha512;
}

// ============================================================
// Hex encoding utilities
// ============================================================

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

// ============================================================
// Keypair types
// ============================================================

export interface OACPKeypair {
  /** Ed25519 secret key as hex string (64 chars = 32 bytes) */
  secretKey: string;
  /** Ed25519 public key as hex string (64 chars = 32 bytes) */
  publicKey: string;
}

// ============================================================
// Key generation
// ============================================================

/**
 * Generate a new Ed25519 keypair.
 * Returns hex-encoded secret and public keys.
 */
export function generateKeypair(): OACPKeypair {
  const { secretKey, publicKey } = ed.keygen();
  return {
    secretKey: toHex(secretKey),
    publicKey: toHex(publicKey),
  };
}

// ============================================================
// Message signing
// ============================================================

/**
 * Sign a message string with an Ed25519 secret key.
 * Returns the signature as a hex string.
 */
export function signMessage(message: string, secretKeyHex: string): string {
  const msgBytes = new TextEncoder().encode(message);
  const secretKey = fromHex(secretKeyHex);
  const signature = ed.sign(msgBytes, secretKey);
  return toHex(signature);
}

/**
 * Verify an Ed25519 signature on a message.
 * Returns true if the signature is valid.
 */
export function verifySignature(
  signatureHex: string,
  message: string,
  publicKeyHex: string,
): boolean {
  try {
    const signature = fromHex(signatureHex);
    const msgBytes = new TextEncoder().encode(message);
    const publicKey = fromHex(publicKeyHex);
    return ed.verify(signature, msgBytes, publicKey);
  } catch {
    return false;
  }
}

// ============================================================
// Keypair persistence
// ============================================================

/**
 * Load a keypair from a JSON file, or generate a new one and save it.
 *
 * File format: { "secretKey": "hex...", "publicKey": "hex..." }
 *
 * @param filePath - Path to the keypair JSON file
 * @returns The loaded or newly generated keypair
 */
export function loadOrCreateKeypair(filePath: string): OACPKeypair {
  const resolvedPath = path.resolve(filePath);

  // Try to load existing keypair
  if (fs.existsSync(resolvedPath)) {
    try {
      const raw = fs.readFileSync(resolvedPath, 'utf-8');
      const parsed = JSON.parse(raw) as OACPKeypair;

      if (
        typeof parsed.secretKey === 'string' &&
        typeof parsed.publicKey === 'string' &&
        /^[0-9a-fA-F]{64}$/.test(parsed.secretKey) &&
        /^[0-9a-fA-F]{64}$/.test(parsed.publicKey)
      ) {
        return parsed;
      }

      console.warn(`[OACP] Invalid keypair file at ${resolvedPath}, generating new keypair`);
    } catch {
      console.warn(`[OACP] Failed to read keypair file at ${resolvedPath}, generating new keypair`);
    }
  }

  // Generate new keypair
  const keypair = generateKeypair();

  // Ensure directory exists
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Save keypair (restrictive permissions where supported)
  fs.writeFileSync(resolvedPath, JSON.stringify(keypair, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });

  console.log(`[OACP] Generated new keypair, saved to ${resolvedPath}`);
  return keypair;
}
