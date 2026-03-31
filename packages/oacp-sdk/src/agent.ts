/**
 * OACP SDK — OACPAgent Class
 *
 * Main entry point for agents using the OACP protocol.
 * Handles registration, heartbeat, and discovery.
 *
 * Usage:
 *   const agent = new OACPAgent({
 *     name: 'my-agent',
 *     capabilities: ['research-summarization'],
 *     supabaseUrl: process.env.SUPABASE_URL!,
 *     supabaseAnonKey: process.env.SUPABASE_ANON_KEY!,
 *   });
 *   await agent.register();
 *   agent.startHeartbeat();
 *   const agents = await agent.discover({ capability: 'data-extraction' });
 */

import {
  AgentConfig,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_KEYPAIR_PATH,
} from './config.js';
import {
  generateKeypair,
  loadOrCreateKeypair,
  signMessage,
  verifySignature,
  type OACPKeypair,
} from './crypto.js';
import type {
  RegisterResponse,
  ReregisterResponse,
  HeartbeatResponse,
  DiscoverQuery,
  DiscoverResponse,
  AgentCard,
  ApiError,
} from './types.js';

export class OACPAgent {
  private config: AgentConfig;
  private keypair: OACPKeypair;
  private agentId: string | null = null;
  private registryToken: string | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private apiBaseUrl: string;
  private registered = false;

  constructor(config: AgentConfig) {
    this.config = config;

    // Load or generate keypair
    const keypairPath = config.keypairPath || DEFAULT_KEYPAIR_PATH;
    this.keypair = loadOrCreateKeypair(keypairPath);

    // Set API base URL
    this.apiBaseUrl =
      config.apiBaseUrl ||
      `${config.supabaseUrl}/functions/v1/oacp`;

    console.log(
      `[OACP] Agent "${config.name}" initialized (pubkey: ${this.keypair.publicKey.substring(0, 16)}...)`,
    );
  }

  // ============================================================
  // Public Accessors
  // ============================================================

  /** Get the agent's unique ID (available after registration) */
  getAgentId(): string | null {
    return this.agentId;
  }

  /** Get the agent's Ed25519 public key (hex) */
  getPublicKey(): string {
    return this.keypair.publicKey;
  }

  /** Check if the agent is registered */
  isRegistered(): boolean {
    return this.registered;
  }

  /** Get the API base URL */
  getApiBaseUrl(): string {
    return this.apiBaseUrl;
  }

  // ============================================================
  // Registration
  // ============================================================

  /**
   * Register this agent with the OACP Registry.
   *
   * On first call: creates a new registration and stores the agent_id + token.
   * On subsequent calls: re-registers (updates) the existing agent card.
   *
   * @returns The agent_id assigned by the registry
   */
  async register(): Promise<string> {
    const body: Record<string, unknown> = {
      name: this.config.name,
      capabilities: this.config.capabilities,
      public_key: this.keypair.publicKey,
    };

    if (this.config.ownerHandle) body.owner_handle = this.config.ownerHandle;
    if (this.config.description) body.description = this.config.description;
    if (this.config.endpointUrl) body.endpoint_url = this.config.endpointUrl;
    if (this.config.protocolsSupported) body.protocols_supported = this.config.protocolsSupported;
    if (this.config.metadata) body.metadata = this.config.metadata;

    // Re-registration: include agent_id and auth token
    if (this.agentId && this.registryToken) {
      body.agent_id = this.agentId;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.registryToken) {
      headers['Authorization'] = `Bearer ${this.registryToken}`;
    }

    const response = await fetch(`${this.apiBaseUrl}/register`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = (await response.json()) as ApiError;
      throw new Error(
        `Registration failed (${response.status}): ${error.error}`,
      );
    }

    // deno-lint-ignore no-explicit-any
    const data = (await response.json()) as any;

    if ('registry_token' in data) {
      // New registration
      const reg = data as unknown as RegisterResponse;
      this.agentId = reg.agent_id;
      this.registryToken = reg.registry_token;
      this.registered = true;
      console.log(`[OACP] Registered as ${reg.agent_id}`);
      return reg.agent_id;
    } else {
      // Re-registration
      const rereg = data as unknown as ReregisterResponse;
      this.registered = true;
      console.log(`[OACP] Re-registered ${rereg.agent_id}`);
      return rereg.agent_id;
    }
  }

  // ============================================================
  // Heartbeat
  // ============================================================

  /**
   * Send a single heartbeat to the registry.
   * Updates last_seen_at and confirms online status.
   */
  async heartbeat(): Promise<HeartbeatResponse> {
    if (!this.agentId || !this.registryToken) {
      throw new Error('Agent must be registered before sending heartbeats');
    }

    const response = await fetch(`${this.apiBaseUrl}/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.registryToken}`,
      },
      body: JSON.stringify({ agent_id: this.agentId }),
    });

    if (!response.ok) {
      const error = (await response.json()) as ApiError;
      throw new Error(
        `Heartbeat failed (${response.status}): ${error.error}`,
      );
    }

    return (await response.json()) as HeartbeatResponse;
  }

  /**
   * Start automatic heartbeat at the configured interval.
   * Default: every 30 seconds (matching PRD REQ-HB-01).
   */
  startHeartbeat(intervalMs?: number): void {
    if (this.heartbeatTimer) {
      console.warn('[OACP] Heartbeat already running');
      return;
    }

    const interval =
      intervalMs || this.config.heartbeatIntervalMs || DEFAULT_HEARTBEAT_INTERVAL_MS;

    // Send immediate heartbeat, then schedule recurring
    this.heartbeat().catch((err) => {
      console.error('[OACP] Initial heartbeat failed:', err.message);
    });

    this.heartbeatTimer = setInterval(async () => {
      try {
        await this.heartbeat();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        console.error(`[OACP] Heartbeat failed: ${msg}`);
      }
    }, interval);

    console.log(`[OACP] Heartbeat started (interval: ${interval}ms)`);
  }

  /**
   * Stop the automatic heartbeat.
   */
  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
      console.log('[OACP] Heartbeat stopped');
    }
  }

  // ============================================================
  // Discovery
  // ============================================================

  /**
   * Discover agents in the registry matching the given criteria.
   *
   * @param query - Filter criteria (capability, status, owner_handle, pagination)
   * @returns Discovery results with agents and pagination info
   */
  async discover(query: DiscoverQuery = {}): Promise<DiscoverResponse> {
    const params = new URLSearchParams();
    if (query.capability) params.set('capability', query.capability);
    if (query.status) params.set('status', query.status);
    if (query.owner_handle) params.set('owner_handle', query.owner_handle);
    if (query.page) params.set('page', String(query.page));
    if (query.page_size) params.set('page_size', String(query.page_size));

    const qs = params.toString();
    const url = `${this.apiBaseUrl}/discover${qs ? '?' + qs : ''}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = (await response.json()) as ApiError;
      throw new Error(
        `Discovery failed (${response.status}): ${error.error}`,
      );
    }

    return (await response.json()) as DiscoverResponse;
  }

  // ============================================================
  // Crypto Utilities (exposed for message signing in M002)
  // ============================================================

  /**
   * Sign a message with this agent's secret key.
   * Returns the hex-encoded Ed25519 signature.
   */
  sign(message: string): string {
    return signMessage(message, this.keypair.secretKey);
  }

  /**
   * Verify a signature against a message and public key.
   */
  verify(signature: string, message: string, publicKey: string): boolean {
    return verifySignature(signature, message, publicKey);
  }

  // ============================================================
  // Lifecycle
  // ============================================================

  /**
   * Gracefully shut down the agent.
   * Stops heartbeat and cleans up resources.
   */
  async shutdown(): Promise<void> {
    this.stopHeartbeat();
    console.log(`[OACP] Agent "${this.config.name}" shut down`);
  }
}
