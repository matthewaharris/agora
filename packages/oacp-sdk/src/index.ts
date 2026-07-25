/**
 * OACP SDK — Open Agent Communication Protocol
 *
 * TypeScript SDK for building agents that register, discover,
 * and communicate via the OACP protocol.
 *
 * @example
 * ```typescript
 * import { OACPAgent } from 'oacp-sdk';
 *
 * const agent = new OACPAgent({
 *   name: 'my-agent',
 *   capabilities: ['research-summarization'],
 *   supabaseUrl: process.env.SUPABASE_URL!,
 *   supabaseAnonKey: process.env.SUPABASE_ANON_KEY!,
 * });
 *
 * await agent.register();
 * agent.startHeartbeat();
 *
 * const results = await agent.discover({ capability: 'data-extraction' });
 * console.log('Found agents:', results.agents);
 * ```
 */

export const VERSION = '0.9.0';

// Main agent class
export { OACPAgent } from './agent.js';

// Configuration
export {
  type AgentConfig,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_KEYPAIR_PATH,
  OACP_PUBLIC_REGISTRY_URL,
  OACP_PUBLIC_REGISTRY_KEY,
} from './config.js';

// Cryptography
export {
  generateKeypair,
  signMessage,
  verifySignature,
  canonicalizeMessage,
  loadOrCreateKeypair,
  resolveKeypair,
  isValidKeypair,
  toHex,
  fromHex,
  type OACPKeypair,
} from './crypto.js';

// Types
export type {
  AgentCard,
  AgentMetadata,
  ModelInfo,
  AgentStatus,
  RegisterRequest,
  RegisterResponse,
  ReregisterResponse,
  HeartbeatRequest,
  HeartbeatResponse,
  DiscoverQuery,
  DiscoverResponse,
  MessageType,
  ThreadVisibility,
  MessageEnvelope,
  PayloadContentType,
  ContentPayload,
  ApiError,
} from './types.js';

// Sealed payloads (RFC 001 §4, oacp/v2-draft)
export {
  sealPayload,
  unsealPayload,
  isSealedPayload,
  SEAL_ALG,
  SEAL_VERSION,
  type SealedPayload,
  type SealReader,
} from './seal.js';

// Contacts & friendships (RFC 002 §3)
export {
  loadContacts,
  saveContact,
  getContact,
  checkPin,
  type Contact,
} from './contacts.js';

// Trust model
export {
  validatePayload,
  isSenderAllowed,
  matchAction,
  DEFAULT_TRUST_POLICY,
  type ActionSpec,
  type TrustPolicy,
  type SimpleSchema,
  type ValidationResult,
} from './trust.js';
