/**
 * OACP Edge Function — Crypto Utilities
 *
 * Ed25519 signature verification for message envelopes.
 * Uses @noble/ed25519 via esm.sh for Deno compatibility.
 */

import * as ed from 'https://esm.sh/@noble/ed25519@3';
import { sha512 } from 'https://esm.sh/@noble/hashes@1/sha512';

// Enable sync verify by providing SHA-512
if ('hashes' in ed && typeof ed.hashes === 'object' && ed.hashes !== null) {
  (ed.hashes as Record<string, unknown>).sha512 = sha512;
}

/**
 * Convert hex string to Uint8Array.
 */
function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Create a canonical string representation of a message for signing/verification.
 * This ensures both sender and verifier produce the same bytes to sign.
 *
 * Canonical format: JSON.stringify of sorted fields (excluding signature).
 */
export function canonicalizeMessage(fields: {
  sender_agent_id: string;
  recipient_agent_id: string;
  message_type: string;
  payload: Record<string, unknown>;
  correlation_id?: string;
  sequence?: number;
  timestamp?: string;
  trace_id?: string;
  trace_parent_id?: string;
}): string {
  // Sort keys for deterministic output
  const canonical: Record<string, unknown> = {};
  if (fields.correlation_id !== undefined) canonical.correlation_id = fields.correlation_id;
  canonical.message_type = fields.message_type;
  canonical.payload = fields.payload;
  canonical.recipient_agent_id = fields.recipient_agent_id;
  canonical.sender_agent_id = fields.sender_agent_id;
  if (fields.sequence !== undefined) canonical.sequence = fields.sequence;
  if (fields.timestamp !== undefined) canonical.timestamp = fields.timestamp;
  // RFC 008: signed when present, omitted when absent, so untraced messages verify as before.
  if (fields.trace_id !== undefined) canonical.trace_id = fields.trace_id;
  if (fields.trace_parent_id !== undefined) canonical.trace_parent_id = fields.trace_parent_id;

  return JSON.stringify(canonical);
}

/**
 * The string an agent signs to deregister (RFC 009 §4). Keys in exactly this
 * order, no whitespace. Must match the SDK's canonicalizeDeregistration.
 */
export function canonicalizeDeregistration(agentId: string, timestamp: string): string {
  return JSON.stringify({ action: 'deregister', agent_id: agentId, timestamp });
}

/**
 * Verify an Ed25519 signature on a canonical message string.
 *
 * @param signatureHex - Hex-encoded 64-byte Ed25519 signature
 * @param message - The canonical message string that was signed
 * @param publicKeyHex - Hex-encoded 32-byte Ed25519 public key
 * @returns true if signature is valid
 */
export function verifyMessageSignature(
  signatureHex: string,
  message: string,
  publicKeyHex: string,
): boolean {
  try {
    const signature = fromHex(signatureHex);
    const msgBytes = new TextEncoder().encode(message);
    const publicKey = fromHex(publicKeyHex);
    return ed.verify(signature, msgBytes, publicKey);
  } catch (err) {
    console.error('[OACP] Signature verification error:', err);
    return false;
  }
}
