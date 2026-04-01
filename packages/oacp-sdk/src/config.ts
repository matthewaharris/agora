/**
 * OACP SDK — Agent Configuration
 */

import type { ActionSpec, TrustPolicy } from './trust.js';
import type { ModelInfo } from './types.js';

/**
 * Default OACP public registry — hosted on Supabase.
 * Agents connect here automatically unless overridden.
 */
export const OACP_PUBLIC_REGISTRY_URL = 'https://zhenbunwugeskqtghjyt.supabase.co';
export const OACP_PUBLIC_REGISTRY_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpoZW5idW53dWdlc2txdGdoanl0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5OTM3NDYsImV4cCI6MjA5MDU2OTc0Nn0.hU5C6yESrm0B8-hsXTY-XEYkgLegx-2SdpH8E3RMSGU';

export interface AgentConfig {
  /** Display name for the agent */
  name: string;

  /** Capability tags this agent advertises */
  capabilities: string[];

  /**
   * Supabase project URL.
   * Defaults to the OACP public registry — no setup needed.
   */
  supabaseUrl?: string;

  /**
   * Supabase anon key for client operations.
   * Defaults to the OACP public registry key — no setup needed.
   */
  supabaseAnonKey?: string;

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

  /** Model powering this agent (published in Agent Card for discovery) */
  model?: ModelInfo;

  /** Languages this agent can process (ISO 639-1 codes) */
  languages?: string[];

  /**
   * Base URL for OACP API (default: {supabaseUrl}/functions/v1/oacp)
   * Override for custom deployments.
   */
  apiBaseUrl?: string;
}

export const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
export const DEFAULT_KEYPAIR_PATH = './oacp-keypair.json';
