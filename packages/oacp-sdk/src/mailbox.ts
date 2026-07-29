/**
 * OACP SDK — Blinded Mailboxes (RFC 001 §5.1, oacp/v2-draft)
 *
 * Secret-tier messaging where even the registry's own tables cannot link
 * the parties. Messages are deposited to a rotating pseudonymous tag that
 * only the two participants can derive, as an opaque encrypted blob that
 * names no one.
 *
 * Scheme:
 *   1. Pair key: both parties convert their Ed25519 identity keys to
 *      X25519 (RFC 7748) and compute the static DH secret;
 *      K = HKDF-SHA256(dh, info="oacp-mailbox-v1"). Symmetric — either
 *      side derives the same K.
 *   2. Tags rotate every 6 hours: tag_e = HMAC-SHA256(K, "tag:" + epoch).
 *      A tag observed in the registry's table is a pseudonym that dies
 *      within six hours; nothing connects consecutive tags without K.
 *   3. Blobs: random 24-byte nonce n, msgKey = HKDF-SHA256(K, salt=n,
 *      info="oacp-mailbox-msg-v1"), XChaCha20-Poly1305. The blob is
 *      {v, alg, n, ct} — no reader ids, unlike sealed payloads (§4),
 *      whose keys map would deanonymize the pair.
 *   4. Authenticity is inside the ciphertext: the inner message carries
 *      an Ed25519 signature the RECIPIENT verifies against the pinned
 *      key. The registry never authenticates a deposit — the 256-bit tag
 *      is the capability, and authenticating the depositor is precisely
 *      what the design must not do.
 *
 * Known limitation (RFC 001 §5.1): no forward secrecy until per-thread
 * ratcheting ships — the static pair secret decrypts captured mailbox
 * history if an identity key later leaks. Mitigated by mandatory expiry:
 * the registry deletes items outright (max 7 days).
 *
 * All primitives are audited @noble libraries — no hand-rolled crypto.
 */

import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { toHex, fromHex, signMessage, verifySignature, type OACPKeypair } from './crypto.js';

export const MAILBOX_ALG = 'x25519-hkdf-xchacha20poly1305';
export const MAILBOX_VERSION = 1;
/** Tag rotation period. 6 hours balances unlinkability against the number
 *  of tags an offline recipient must derive to catch up. */
export const MAILBOX_EPOCH_SECONDS = 21600;

const NONCE_BYTES = 24;

/** Wire format of a mailbox blob. Deliberately identifies no one. */
export interface MailboxBlob extends Record<string, unknown> {
  v: number;
  alg: string;
  /** 24-byte nonce, hex */
  n: string;
  /** AEAD(inner JSON), base64 */
  ct: string;
}

/** The plaintext inside a mailbox blob. Never leaves the ciphertext. */
export interface BlindedInner {
  sender_agent_id: string;
  message_type: string;
  payload: Record<string, unknown>;
  correlation_id?: string;
  /** Sender-claimed send time, ISO 8601. */
  ts: string;
  /** Ed25519 over the canonical inner (minus sig), hex. */
  sig: string;
}

/** A decrypted, signature-verified message out of a blinded mailbox. */
export interface BlindedMessage {
  sender_agent_id: string;
  message_type: string;
  payload: Record<string, unknown>;
  correlation_id?: string;
  ts: string;
  /** The tag it arrived on (registry-side pseudonym for the pair+epoch). */
  tag: string;
  item_id: string;
  deposited_at: string;
  expires_at: string;
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

/** Recursively sort object keys — a stable canonical form for signing. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return '{' + entries.map(([k, v]) => JSON.stringify(k) + ':' + stableStringify(v)).join(',') + '}';
  }
  return JSON.stringify(value);
}

/**
 * Derive the pair's mailbox key from this agent's Ed25519 keypair and the
 * counterpart's Ed25519 public key. Symmetric: both sides get the same key.
 */
export function mailboxKeyFor(myKeypair: OACPKeypair, theirEd25519PublicKey: string): Uint8Array {
  const xSecret = ed25519.utils.toMontgomerySecret(fromHex(myKeypair.secretKey));
  const theirXPub = ed25519.utils.toMontgomery(fromHex(theirEd25519PublicKey));
  const dh = x25519.getSharedSecret(xSecret, theirXPub);
  return hkdf(sha256, dh, undefined, utf8('oacp-mailbox-v1'), 32);
}

/** The current mailbox epoch (6-hour window index). */
export function mailboxEpoch(atMs: number = Date.now()): number {
  return Math.floor(atMs / 1000 / MAILBOX_EPOCH_SECONDS);
}

/** The pair's tag for an epoch: hex(HMAC-SHA256(K, "tag:" + epoch)). */
export function mailboxTag(mailboxKey: Uint8Array, epoch: number): string {
  return toHex(hmac(sha256, mailboxKey, utf8(`tag:${epoch}`)));
}

/** Sign the inner message. Canonical form excludes `sig` itself. */
export function signInner(inner: Omit<BlindedInner, 'sig'>, secretKeyHex: string): string {
  return signMessage(stableStringify(inner), secretKeyHex);
}

/** Verify an inner signature against the claimed sender's public key. */
export function verifyInner(inner: BlindedInner, senderPublicKeyHex: string): boolean {
  const { sig, ...rest } = inner;
  return verifySignature(sig, stableStringify(rest), senderPublicKeyHex);
}

/** Encrypt an inner message into an opaque blob string. */
export function encryptMailboxBlob(mailboxKey: Uint8Array, inner: BlindedInner): string {
  const nonce = randomBytes(NONCE_BYTES);
  const msgKey = hkdf(sha256, mailboxKey, nonce, utf8('oacp-mailbox-msg-v1'), 32);
  const ct = xchacha20poly1305(msgKey, nonce).encrypt(utf8(JSON.stringify(inner)));
  const blob: MailboxBlob = {
    v: MAILBOX_VERSION,
    alg: MAILBOX_ALG,
    n: toHex(nonce),
    ct: Buffer.from(ct).toString('base64'),
  };
  return JSON.stringify(blob);
}

/**
 * Try to decrypt a blob with a pair key. Returns null when the blob is not
 * for this pair (or is malformed) — expected, not an error, when polling
 * several peers' tags in one fetch.
 */
export function decryptMailboxBlob(mailboxKey: Uint8Array, blob: string): BlindedInner | null {
  try {
    const parsed = JSON.parse(blob) as MailboxBlob;
    if (parsed.v !== MAILBOX_VERSION || parsed.alg !== MAILBOX_ALG) return null;
    const nonce = fromHex(parsed.n);
    const msgKey = hkdf(sha256, mailboxKey, nonce, utf8('oacp-mailbox-msg-v1'), 32);
    const plaintext = xchacha20poly1305(msgKey, nonce).decrypt(
      new Uint8Array(Buffer.from(parsed.ct, 'base64')),
    );
    return JSON.parse(new TextDecoder().decode(plaintext)) as BlindedInner;
  } catch {
    return null;
  }
}
