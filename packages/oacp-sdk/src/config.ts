/**
 * OACP SDK — Agent Configuration
 */

import type { ActionSpec, TrustPolicy } from './trust.js';

export interface AgentConfig {
  /** Display name for the agent */
  name: string;

  /** Capability tags this agent advertises */
  capabilities: string[];

  /** Supabase project URL (e.g., https://xxx.supabase.co) */
  supabaseUrl: string;

  /** Supabase anon key for client operations */
  supabaseAnonKey: string;

  /** Optional owner handle */
  ownerHandle?: string;

  /** Optional description */
  description?: string;

  /** Optional public endpoint URL */
  endpointUrl?: string;

  /** Optional additional protocols supported */
  protocolsSupported?: string[];

  /** Optional metadata */
  metadata?: Record<string, unknown>;

  /** Path to keypair JSON file (default: ./oacp-keypair.json) */
  keypairPath?: string;

  /** Heartbeat interval in milliseconds (default: 30000) */
  heartbeatIntervalMs?: number;

  /** Action specs declaring what this agent can do */
  actionSpecs?: ActionSpec[];

  /** Trust policy controlling who can send tasks to this agent */
  trustPolicy?: TrustPolicy;

  /**
   * Base URL for OACP API (default: {supabaseUrl}/functions/v1/oacp)
   * Override for custom deployments.
   */
  apiBaseUrl?: string;
}

export const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
export const DEFAULT_KEYPAIR_PATH = './oacp-keypair.json';
