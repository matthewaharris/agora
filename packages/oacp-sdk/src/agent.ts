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
  OACP_PUBLIC_REGISTRY_URL,
  OACP_PUBLIC_REGISTRY_KEY,
} from './config.js';
import {
  generateKeypair,
  loadOrCreateKeypair,
  resolveKeypair,
  signMessage,
  verifySignature,
  canonicalizeMessage,
  type OACPKeypair,
} from './crypto.js';
import {
  sealPayload,
  unsealPayload,
  isSealedPayload,
  type SealReader,
} from './seal.js';
import {
  validatePayload,
  isSenderAllowed,
  matchAction,
  DEFAULT_TRUST_POLICY,
  type ActionSpec,
  type TrustPolicy,
  type ValidationResult,
} from './trust.js';
import {
  saveContact,
  getContact,
  checkPin,
  loadContacts,
  type Contact,
} from './contacts.js';
import type {
  RegisterResponse,
  ReregisterResponse,
  HeartbeatResponse,
  DiscoverQuery,
  DiscoverResponse,
  MessageType,
  ThreadVisibility,
  MessageEnvelope,
  AgentCard,
  ApiError,
} from './types.js';

export class OACPAgent {
  private config: AgentConfig;
  private keypair: OACPKeypair;
  private ownerKeypair: OACPKeypair;
  // Account owner key (RFC 003): undefined = not yet fetched, null = not attached
  private accountOwnerKey: string | null | undefined = undefined;
  private agentId: string | null = null;
  private registryToken: string | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private apiBaseUrl: string;
  private registered = false;

  // Messaging — event handlers and Realtime subscription
  // deno-lint-ignore no-explicit-any
  private messageHandlers: Map<string, Array<(msg: any) => void>> = new Map();
  // deno-lint-ignore no-explicit-any
  private realtimeChannel: any = null;
  private realtimeActive = false;
  // deno-lint-ignore no-explicit-any
  private supabaseClient: any = null;

  // Trust model
  private actionSpecs: ActionSpec[] = [];
  private trustPolicy: TrustPolicy;
  // deno-lint-ignore no-explicit-any
  private actionHandlers: Map<string, (payload: Record<string, unknown>, msg: any) => Promise<Record<string, unknown> | void>> = new Map();

  // Daily limits tracking
  private dailyRequestCount = 0;
  private dailyTokensServed = 0;
  private limitResetDate = new Date().toDateString();

  // Contacts file (RFC 002 §3): local pinned-key address book
  private contactsPath!: string;

  constructor(config: AgentConfig) {
    this.config = config;

    // Resolve keypair: config.keypair → OACP_SECRET_KEY/OACP_PUBLIC_KEY env → file
    const keypairPath = config.keypairPath || DEFAULT_KEYPAIR_PATH;
    this.keypair = resolveKeypair(config.keypair, keypairPath);

    // Owner keypair (RFC 001 §3.1): the human's own encryption identity,
    // kept beside the agent keypair. Sealed messages are also wrapped for
    // the owners of both participants, so humans can decrypt their agents'
    // sealed threads in the dashboard without the agent's key leaving disk.
    const ownerPath = config.ownerKeypairPath
      || keypairPath.replace(/[^/\\]+$/, 'owner-keypair.json');
    this.ownerKeypair = loadOrCreateKeypair(ownerPath);

    // Contacts (RFC 002 §3): pinned counterparty keys, beside the keypair
    this.contactsPath = config.contactsPath
      || keypairPath.replace(/[^/\\]+$/, 'contacts.json');

    // Set API base URL
    const supabaseUrl = config.supabaseUrl || OACP_PUBLIC_REGISTRY_URL;
    this.apiBaseUrl =
      config.apiBaseUrl ||
      `${supabaseUrl}/functions/v1/oacp`;

    // Store resolved config for Realtime client
    this.config = {
      ...config,
      supabaseUrl: supabaseUrl,
      supabaseAnonKey: config.supabaseAnonKey || OACP_PUBLIC_REGISTRY_KEY,
    };

    // Trust model
    this.actionSpecs = config.actionSpecs || [];
    this.trustPolicy = config.trustPolicy || DEFAULT_TRUST_POLICY;

    console.log(
      `[OACP] Agent "${config.name}" initialized (pubkey: ${this.keypair.publicKey.substring(0, 16)}...)`,
    );
    if (this.actionSpecs.length > 0) {
      console.log(
        `[OACP] Actions: ${this.actionSpecs.map((s) => s.name).join(', ')}`,
      );
    }
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

  /**
   * The owner's encryption keypair (RFC 001 §3.1). The secret is meant to
   * be handed to the owner's *own* browser (dashboard localStorage via a
   * URL fragment) so they can decrypt their agent's sealed threads —
   * never sent to the registry or any other party.
   */
  getOwnerKeypair(): OACPKeypair {
    return { ...this.ownerKeypair };
  }

  /**
   * Attach this agent to an owner account (RFC 003 §2.2) using a
   * single-use code the owner generated in the dashboard. After attaching,
   * sealed messages use the account's owner key, so one browser key opens
   * every attached agent's sealed threads.
   */
  async attachOwner(code: string): Promise<{ owner_id: string; owner_public_key: string | null }> {
    if (!this.agentId || !this.registryToken) {
      throw new Error('Agent must be registered before attaching to an owner');
    }
    const response = await fetch(`${this.apiBaseUrl}/owners/attach`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.registryToken}`,
      },
      body: JSON.stringify({ agent_id: this.agentId, code }),
    });
    if (!response.ok) {
      const error = (await response.json()) as ApiError;
      throw new Error(`Owner attach failed (${response.status}): ${error.error}`);
    }
    // deno-lint-ignore no-explicit-any
    const data = (await response.json()) as any;
    this.accountOwnerKey =
      typeof data.owner_public_key === 'string' ? data.owner_public_key : null;
    console.log(`[OACP] Attached to owner account ${data.owner_id}`);
    return { owner_id: data.owner_id, owner_public_key: this.accountOwnerKey ?? null };
  }

  /**
   * The account owner key for this agent, fetched once from its own card.
   * @private
   */
  private async resolveAccountOwnerKey(): Promise<string | null> {
    if (this.accountOwnerKey !== undefined) return this.accountOwnerKey;
    if (!this.agentId) return null;
    try {
      const card = await this.getAgentCard(this.agentId);
      const key = card?.owner_public_key;
      this.accountOwnerKey =
        typeof key === 'string' && /^[0-9a-fA-F]{64}$/.test(key) ? key : null;
    } catch {
      // Transient lookup failure — don't cache; fall back this send only
      return null;
    }
    return this.accountOwnerKey;
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

    // Include structured metadata so other agents can discover our capabilities
    const structuredMeta: Record<string, unknown> = {
      ...(body.metadata as Record<string, unknown> || {}),
    };

    if (this.actionSpecs.length > 0) {
      structuredMeta.action_specs = this.actionSpecs.map((s) => ({
        name: s.name,
        description: s.description,
        price: s.price || 0,
      }));
    }

    if (this.config.model) {
      structuredMeta.model = this.config.model;
    }

    // Advertise the owner's encryption key so counterparties can wrap
    // sealed payloads for this agent's human too (RFC 001 §3.1)
    structuredMeta.owner_public_key = this.ownerKeypair.publicKey;

    if (this.config.languages) {
      structuredMeta.languages = this.config.languages;
    }

    if (this.config.dailyFreeBudget !== undefined) {
      structuredMeta.daily_free_budget = this.config.dailyFreeBudget;
    }

    if (this.config.maxRequestsPerDay !== undefined) {
      structuredMeta.max_requests_per_day = this.config.maxRequestsPerDay;
    }

    if (Object.keys(structuredMeta).length > 0) {
      body.metadata = structuredMeta;
    }

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
      // New or returning registration (both return registry_token)
      this.agentId = data.agent_id;
      this.registryToken = data.registry_token;
      this.registered = true;

      if (data.returning) {
        console.log(`[OACP] Welcome back — ${data.agent_id} (persistent identity)`);
      } else {
        console.log(`[OACP] Registered as ${data.agent_id}`);
      }

      // Start Realtime if handlers were registered before register() was called
      if (this.messageHandlers.size > 0) {
        this.startRealtimeSubscription();
      }

      return data.agent_id;
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

  /**
   * Fetch a single agent's card by agent_id (used to get the recipient's
   * public_key before sealing). Uses the registry's agent_id filter when
   * available, with a client-side paging fallback for older registries.
   */
  async getAgentCard(agentId: string): Promise<AgentCard | null> {
    // Fast path: registry supports ?agent_id= (additive, RFC 001)
    const response = await fetch(
      `${this.apiBaseUrl}/discover?agent_id=${encodeURIComponent(agentId)}`,
    );
    if (response.ok) {
      const data = (await response.json()) as DiscoverResponse;
      const hit = data.agents.find((a) => a.agent_id === agentId);
      if (hit) return hit;
      // Older registries ignore the filter and return page 1 of everything —
      // fall through to paging only if the result looks unfiltered.
      if (data.agents.length === 0 || data.total <= data.agents.length) return null;
    }

    // Fallback: page through discovery (capped)
    for (let page = 1; page <= 10; page++) {
      const res = await this.discover({ page, page_size: 100 });
      const hit = res.agents.find((a) => a.agent_id === agentId);
      if (hit) return hit;
      if (page * 100 >= res.total) break;
    }
    return null;
  }

  // ============================================================
  // Token Economy
  // ============================================================

  /**
   * Get this agent's token balance.
   */
  async getBalance(): Promise<number> {
    if (!this.agentId) throw new Error('Agent must be registered');

    const response = await fetch(`${this.apiBaseUrl}/balance?agent_id=${this.agentId}`);
    if (!response.ok) return 0;

    // deno-lint-ignore no-explicit-any
    const data = (await response.json()) as any;
    return data.balance as number;
  }

  /**
   * Get this agent's transaction history.
   */
  async getTransactions(options: { limit?: number; type?: string } = {}): Promise<{
    transactions: Array<Record<string, unknown>>;
    total: number;
  }> {
    if (!this.agentId || !this.registryToken) throw new Error('Agent must be registered');

    const params = new URLSearchParams();
    params.set('agent_id', this.agentId);
    if (options.limit) params.set('limit', String(options.limit));
    if (options.type) params.set('type', options.type);

    const response = await fetch(`${this.apiBaseUrl}/transactions?${params.toString()}`, {
      headers: { Authorization: `Bearer ${this.registryToken}` },
    });

    if (!response.ok) {
      const error = (await response.json()) as ApiError;
      throw new Error(`Get transactions failed: ${error.error}`);
    }

    // deno-lint-ignore no-explicit-any
    return (await response.json()) as any;
  }

  /**
   * Transfer tokens to another agent.
   * @private — used internally for task payments
   */
  private async transferTokens(
    toAgentId: string,
    amount: number,
    messageId?: string,
    description?: string,
  ): Promise<string> {
    if (!this.agentId || !this.registryToken) throw new Error('Agent must be registered');

    const response = await fetch(`${this.apiBaseUrl}/transfer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.registryToken}`,
      },
      body: JSON.stringify({
        from_agent_id: this.agentId,
        to_agent_id: toAgentId,
        amount,
        type: 'task_payment',
        message_id: messageId || null,
        description: description || `Payment for task`,
      }),
    });

    if (!response.ok) {
      const error = (await response.json()) as ApiError;
      throw new Error(`Transfer failed: ${error.error}`);
    }

    // deno-lint-ignore no-explicit-any
    const data = (await response.json()) as any;
    return data.transaction_id;
  }

  // ============================================================
  // Messaging
  // ============================================================

  /**
   * Send a message to another agent.
   *
   * Composes the OACP Message Envelope, signs it with this agent's
   * Ed25519 key, and POSTs to the registry message bus.
   *
   * @param recipientId - Target agent's agent_id
   * @param messageType - Message type (task_request, task_ack, task_result, task_error)
   * @param payload - Message payload object
   * @param options - Optional correlation_id, sequence, seal flag, and
   *   thread visibility.
   *   `seal: true` end-to-end encrypts the payload (RFC 001 §4): the
   *   registry relays ciphertext it cannot read; only the recipient and
   *   this agent can open it. Requires the recipient's card to be
   *   discoverable (for their public key).
   *   `visibility` (RFC 001 §2) sets the thread's tier at creation —
   *   'open' (default), 'summarized' (public abstract via publicSummary,
   *   sealed contents), 'private' (parties visible, nothing else), or
   *   'secret' (thread invisible to observers). Only honored on the first
   *   message of a correlation_id; later tier changes go through
   *   updateThread(). A sealed first message defaults to 'private'.
   * @returns The message_id assigned by the registry
   */
  async send(
    recipientId: string,
    messageType: MessageType,
    payload: Record<string, unknown>,
    options?: {
      correlationId?: string;
      sequence?: number;
      seal?: boolean;
      visibility?: ThreadVisibility;
      publicSummary?: string;
    },
  ): Promise<string> {
    if (!this.agentId || !this.registryToken) {
      throw new Error('Agent must be registered before sending messages');
    }

    if (options?.seal) {
      const recipientCard = await this.getAgentCard(recipientId);
      if (!recipientCard?.public_key) {
        throw new Error(
          `[OACP] Cannot seal: no public key found for recipient ${recipientId}`,
        );
      }
      // Key-pin check (RFC 002 §3): never seal to a key that contradicts
      // the pinned one — that would hand the plaintext to whoever now
      // controls the registration.
      const pinWarning = checkPin(this.contactsPath, recipientId, recipientCard.public_key);
      if (pinWarning) {
        throw new Error(`[OACP] ${pinWarning}`);
      }
      // Owner slots: both humans can decrypt their agents' sealed threads
      // (RFC 001 §3.1 / RFC 003). Prefer the account owner key (one key
      // for all the human's agents); fall back to the per-machine key.
      // Owners of *participants* only — the registry can't read anything.
      const ownOwnerKey = (await this.resolveAccountOwnerKey()) ?? this.ownerKeypair.publicKey;
      const readers: SealReader[] = [
        { agentId: recipientId, ed25519PublicKey: recipientCard.public_key },
        { agentId: this.agentId, ed25519PublicKey: this.keypair.publicKey },
        { agentId: `owner:${this.agentId}`, ed25519PublicKey: ownOwnerKey },
      ];
      const recipientOwnerKey =
        recipientCard.owner_public_key ??
        (recipientCard.metadata as Record<string, unknown> | undefined)?.owner_public_key;
      if (typeof recipientOwnerKey === 'string' && /^[0-9a-fA-F]{64}$/.test(recipientOwnerKey)) {
        readers.push({ agentId: `owner:${recipientId}`, ed25519PublicKey: recipientOwnerKey });
      }
      payload = sealPayload(payload, readers);
    }

    // Canonicalize and sign — normalize null/undefined to ensure consistency
    const correlationId = options?.correlationId || undefined;
    const sequence = options?.sequence ?? undefined;

    const canonical = canonicalizeMessage({
      sender_agent_id: this.agentId,
      recipient_agent_id: recipientId,
      message_type: messageType,
      payload,
      correlation_id: correlationId,
      sequence: sequence,
    });

    const signature = signMessage(canonical, this.keypair.secretKey);

    const body: Record<string, unknown> = {
      sender_agent_id: this.agentId,
      recipient_agent_id: recipientId,
      message_type: messageType,
      payload,
      signature,
    };

    if (correlationId) body.correlation_id = correlationId;
    if (sequence !== undefined) body.sequence = sequence;
    if (options?.visibility) body.visibility = options.visibility;
    if (options?.publicSummary !== undefined) body.public_summary = options.publicSummary;

    const response = await fetch(`${this.apiBaseUrl}/messages/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.registryToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = (await response.json()) as ApiError;
      throw new Error(`Send failed (${response.status}): ${error.error}`);
    }

    // deno-lint-ignore no-explicit-any
    const result = (await response.json()) as any;
    console.log(
      `[OACP] Sent ${messageType} to ${recipientId.substring(0, 8)}... (msg: ${result.message_id})`,
    );
    return result.message_id;
  }

  /**
   * Get messages for this agent from the registry.
   *
   * @param options - Filter options (direction, messageType, correlationId, since, limit)
   */
  async getMessages(options: {
    direction?: 'inbox' | 'outbox';
    messageType?: MessageType;
    correlationId?: string;
    since?: string;
    limit?: number;
  } = {}): Promise<{ messages: MessageEnvelope[]; total: number }> {
    if (!this.agentId || !this.registryToken) {
      throw new Error('Agent must be registered before retrieving messages');
    }

    const params = new URLSearchParams();
    params.set('agent_id', this.agentId);
    if (options.direction) params.set('direction', options.direction);
    if (options.messageType) params.set('message_type', options.messageType);
    if (options.correlationId) params.set('correlation_id', options.correlationId);
    if (options.since) params.set('since', options.since);
    if (options.limit) params.set('limit', String(options.limit));

    const response = await fetch(
      `${this.apiBaseUrl}/messages?${params.toString()}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.registryToken}`,
        },
      },
    );

    if (!response.ok) {
      const error = (await response.json()) as ApiError;
      throw new Error(`Get messages failed (${response.status}): ${error.error}`);
    }

    // deno-lint-ignore no-explicit-any
    const result = (await response.json()) as any;
    return {
      messages: (result.messages as MessageEnvelope[]).map((m) => this.unsealEnvelope(m)),
      total: result.total as number,
    };
  }

  /**
   * If the envelope carries a sealed payload this agent can open,
   * return a copy with the decrypted payload and `was_sealed: true`.
   * Sealed payloads we cannot open (or that fail to decrypt) pass
   * through unchanged so callers can still see the sealed marker.
   */
  unsealEnvelope(msg: MessageEnvelope): MessageEnvelope {
    if (!isSealedPayload(msg.payload) || !this.agentId) return msg;
    try {
      const payload = unsealPayload(msg.payload, this.keypair, this.agentId);
      return { ...msg, payload, was_sealed: true } as MessageEnvelope;
    } catch (err) {
      console.warn(
        `[OACP] Could not unseal message ${msg.message_id}: ${err instanceof Error ? err.message : err}`,
      );
      return msg;
    }
  }

  /**
   * Register an event handler for incoming messages.
   *
   * Uses Supabase Realtime to subscribe to the messages table,
   * filtering for messages addressed to this agent.
   *
   * @param eventType - Message type to listen for, or '*' for all
   * @param handler - Callback receiving the message envelope
   */
  on(
    eventType: MessageType | '*',
    handler: (msg: MessageEnvelope) => void,
  ): void {
    const handlers = this.messageHandlers.get(eventType) || [];
    handlers.push(handler);
    this.messageHandlers.set(eventType, handlers);

    // Start Realtime subscription if not already running
    if (!this.realtimeChannel) {
      this.startRealtimeSubscription();
    }
  }

  /**
   * Remove event handlers for a message type.
   */
  off(eventType: MessageType | '*'): void {
    this.messageHandlers.delete(eventType);

    // If no handlers left, unsubscribe from Realtime
    if (this.messageHandlers.size === 0 && this.realtimeChannel) {
      this.stopRealtimeSubscription();
    }
  }

  /**
   * Start Supabase Realtime subscription for incoming messages.
   * Called automatically after register() if handlers are registered.
   * @private
   */
  private async startRealtimeSubscription(): Promise<void> {
    if (!this.agentId) {
      // Not registered yet — will be called again after register()
      return;
    }

    // Already subscribed
    if (this.realtimeChannel) return;

    try {
      // Dynamic import for ESM compatibility
      const { createClient } = await import('@supabase/supabase-js');

      if (!this.supabaseClient) {
        this.supabaseClient = createClient(
          this.config.supabaseUrl || OACP_PUBLIC_REGISTRY_URL,
          this.config.supabaseAnonKey || OACP_PUBLIC_REGISTRY_KEY,
        );
      }

      const channelName = `oacp-messages-${this.agentId}`;
      this.realtimeChannel = this.supabaseClient
        .channel(channelName)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'messages',
            filter: `recipient_agent_id=eq.${this.agentId}`,
          },
          // deno-lint-ignore no-explicit-any
          (payload: any) => {
            const msg = payload.new as MessageEnvelope;
            this.dispatchMessage(msg);
          },
        )
        .subscribe((status: string) => {
          if (status === 'SUBSCRIBED') {
            this.realtimeActive = true;
            console.log(`[OACP] Realtime subscription active for ${this.agentId}`);
          } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            this.realtimeActive = false;
          }
        });
    } catch (err) {
      console.warn(
        '[OACP] Supabase Realtime not available — use getMessages() for polling instead',
        err instanceof Error ? err.message : err,
      );
    }
  }

  /**
   * Stop Realtime subscription.
   * @private
   */
  private stopRealtimeSubscription(): void {
    if (this.realtimeChannel && this.supabaseClient) {
      this.supabaseClient.removeChannel(this.realtimeChannel);
      this.realtimeChannel = null;
      this.realtimeActive = false;
      console.log('[OACP] Realtime subscription stopped');
    }
  }

  /** True while the Realtime push channel is connected (push delivery live). */
  isRealtimeConnected(): boolean {
    return this.realtimeActive;
  }

  /**
   * Register an action with a trust-validated handler.
   *
   * This is the preferred way to handle incoming tasks. The handler
   * only runs if:
   * 1. The sender is allowed by the trust policy
   * 2. The message matches a declared action_spec
   * 3. The payload validates against the action's inputSchema
   *
   * @param spec - The action specification
   * @param handler - Async function receiving validated payload and full message.
   *                  Return a result object to auto-send task_result back.
   *
   * @example
   * agent.registerAction(
   *   {
   *     name: 'summarize-text',
   *     description: 'Summarize a topic',
   *     inputSchema: { type: 'object', properties: { task: { type: 'string' } }, required: ['task'] },
   *   },
   *   async (payload, msg) => {
   *     const summary = await doResearch(payload.task);
   *     return { summary, word_count: summary.split(' ').length };
   *   },
   * );
   */
  registerAction(
    spec: ActionSpec,
    handler: (payload: Record<string, unknown>, msg: MessageEnvelope) => Promise<Record<string, unknown> | void>,
  ): void {
    // Add to action specs if not already present
    if (!this.actionSpecs.find((s) => s.name === spec.name)) {
      this.actionSpecs.push(spec);
    }
    this.actionHandlers.set(spec.name, handler);

    // Ensure we're listening for task_requests
    if (!this.messageHandlers.has('__trust_pipeline')) {
      this.messageHandlers.set('__trust_pipeline', []);
      this.on('task_request', (msg) => {
        this.handleTrustedTask(msg as MessageEnvelope).catch((err) => {
          console.error('[OACP] Trust pipeline error:', err);
        });
      });
    }

    console.log(`[OACP] Registered action: ${spec.name} — "${spec.description}"`);
  }

  /**
   * Process a task_request through the trust pipeline.
   * @private
   */
  private async handleTrustedTask(msg: MessageEnvelope): Promise<void> {
    const payload = (msg.payload || {}) as Record<string, unknown>;
    const senderId = msg.sender_agent_id;

    // Step 1: Check sender trust
    const senderCheck = isSenderAllowed(senderId, this.trustPolicy);
    if (!senderCheck.allowed) {
      console.log(`[OACP] ⛔ Rejected task from ${senderId.substring(0, 8)}...: ${senderCheck.reason}`);
      await this.send(senderId, 'task_error', {
        error: 'unauthorized',
        message: senderCheck.reason,
      }, { correlationId: msg.correlation_id });
      return;
    }

    // Step 2: Match action
    const actionMatch = matchAction(payload, this.actionSpecs);
    if (!actionMatch.matched) {
      console.log(`[OACP] ⛔ No matching action: ${actionMatch.reason}`);
      await this.send(senderId, 'task_error', {
        error: 'unknown_action',
        message: actionMatch.reason,
        available_actions: this.actionSpecs.map((s) => ({
          name: s.name,
          description: s.description,
        })),
      }, { correlationId: msg.correlation_id });
      return;
    }

    const action = actionMatch.matched;

    // Step 3: Validate payload against inputSchema
    const validation = validatePayload(payload, action.inputSchema);
    if (!validation.valid) {
      console.log(`[OACP] ⛔ Payload validation failed: ${validation.errors.join('; ')}`);
      await this.send(senderId, 'task_error', {
        error: 'invalid_payload',
        message: `Payload does not match schema for action "${action.name}"`,
        validation_errors: validation.errors,
      }, { correlationId: msg.correlation_id });
      return;
    }

    // Step 4: Check daily limits
    // Reset counters if it's a new day
    const today = new Date().toDateString();
    if (today !== this.limitResetDate) {
      this.dailyRequestCount = 0;
      this.dailyTokensServed = 0;
      this.limitResetDate = today;
    }

    // Check request limit
    const maxRequests = this.config.maxRequestsPerDay || 0;
    if (maxRequests > 0 && this.dailyRequestCount >= maxRequests) {
      console.log(`[OACP] ⛔ Daily request limit reached (${this.dailyRequestCount}/${maxRequests})`);
      await this.send(senderId, 'task_error', {
        error: 'rate_limited',
        message: `Agent has reached its daily request limit (${maxRequests}/day). Try again tomorrow.`,
        limit: maxRequests,
        used: this.dailyRequestCount,
      }, { correlationId: msg.correlation_id });
      return;
    }

    // Check token budget
    const dailyBudget = this.config.dailyFreeBudget || 0;
    if (dailyBudget > 0 && this.dailyTokensServed >= dailyBudget) {
      console.log(`[OACP] ⛔ Daily free token budget exhausted (${this.dailyTokensServed}/${dailyBudget})`);
      await this.send(senderId, 'task_error', {
        error: 'budget_exhausted',
        message: `Agent has used its daily free token budget (${dailyBudget.toLocaleString()} tokens/day). Try again tomorrow.`,
        budget: dailyBudget,
        used: this.dailyTokensServed,
      }, { correlationId: msg.correlation_id });
      return;
    }

    this.dailyRequestCount++;

    // Step 5: Execute handler
    console.log(`[OACP] ✅ Trust check passed — executing action: ${action.name}`);
    const handler = this.actionHandlers.get(action.name);
    if (!handler) {
      console.error(`[OACP] No handler registered for action: ${action.name}`);
      return;
    }

    try {
      const result = await handler(payload, msg);

      // If handler returns a result, auto-send task_result
      if (result && typeof result === 'object') {
        const resultMsgId = await this.send(senderId, 'task_result', result, {
          correlationId: msg.correlation_id,
        });

        // Credit this agent for the work done (proof-of-work)
        // If the result contains tokens_used, credit that amount
        const tokensUsed = (result as Record<string, unknown>).tokens_used as number | undefined;
        if (tokensUsed && tokensUsed > 0 && this.agentId) {
          try {
            const response = await fetch(`${this.apiBaseUrl}/credit-work`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.registryToken}`,
              },
              body: JSON.stringify({
                agent_id: this.agentId,
                tokens_used: tokensUsed,
                message_id: msg.message_id,
              }),
            });

            if (response.ok) {
              // deno-lint-ignore no-explicit-any
              const data = (await response.json()) as any;
              console.log(`[OACP] 💰 Earned ${tokensUsed} tokens (proof-of-work, tx: ${data.transaction_id})`);
              this.dailyTokensServed += tokensUsed;            } else {
              const errText = await response.text();
              console.warn(`[OACP] ⚠️ Credit failed (${response.status}): ${errText.substring(0, 100)}`);
            }
          } catch (payErr) {
            console.warn(`[OACP] ⚠️ Credit error: ${payErr instanceof Error ? payErr.message : payErr}`);
          }
        }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[OACP] Action "${action.name}" failed:`, errorMsg);
      await this.send(senderId, 'task_error', {
        error: 'execution_error',
        message: errorMsg,
        action: action.name,
      }, { correlationId: msg.correlation_id });
    }
  }

  /**
   * Dispatch an incoming message to registered handlers.
   * @private
   */
  private dispatchMessage(msg: MessageEnvelope): void {
    console.log(
      `[OACP] Received ${msg.message_type} from ${msg.sender_agent_id?.substring(0, 8)}...`,
    );

    msg = this.unsealEnvelope(msg);

    // Dispatch to type-specific handlers
    const typeHandlers = this.messageHandlers.get(msg.message_type) || [];
    for (const handler of typeHandlers) {
      try {
        handler(msg);
      } catch (err) {
        console.error(`[OACP] Handler error for ${msg.message_type}:`, err);
      }
    }

    // Dispatch to wildcard handlers
    const wildcardHandlers = this.messageHandlers.get('*') || [];
    for (const handler of wildcardHandlers) {
      try {
        handler(msg);
      } catch (err) {
        console.error('[OACP] Wildcard handler error:', err);
      }
    }
  }

  // ============================================================
  // Thread Control — pause / resume / end a conversation
  // ============================================================

  /**
   * Set a thread's status. Only participants of the thread may call this.
   * 'paused' blocks further sends until resumed ('active'); 'ended' is final.
   */
  async setThreadStatus(
    correlationId: string,
    status: 'active' | 'paused' | 'ended',
  ): Promise<{ correlation_id: string; status: string }> {
    if (!this.agentId || !this.registryToken) {
      throw new Error('Agent must be registered before controlling threads');
    }

    const response = await fetch(`${this.apiBaseUrl}/threads/set-status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.registryToken}`,
      },
      body: JSON.stringify({
        agent_id: this.agentId,
        correlation_id: correlationId,
        status,
      }),
    });

    if (!response.ok) {
      const error = (await response.json()) as ApiError;
      throw new Error(`Set thread status failed (${response.status}): ${error.error}`);
    }

    // deno-lint-ignore no-explicit-any
    return (await response.json()) as any;
  }

  /**
   * Update a thread's visibility tier and/or public summary (RFC 001).
   * Participants only. Visibility is a ratchet — it can only move toward
   * more private (open → summarized → private → secret); downgrades are
   * rejected by the registry. Upgrading to 'private'/'secret' clears the
   * public summary.
   */
  async updateThread(
    correlationId: string,
    changes: { visibility?: ThreadVisibility; publicSummary?: string | null },
  ): Promise<{ correlation_id: string; status: string; visibility: string; public_summary: string | null }> {
    if (!this.agentId || !this.registryToken) {
      throw new Error('Agent must be registered before controlling threads');
    }

    const body: Record<string, unknown> = {
      agent_id: this.agentId,
      correlation_id: correlationId,
    };
    if (changes.visibility) body.visibility = changes.visibility;
    if (changes.publicSummary !== undefined) body.public_summary = changes.publicSummary;

    const response = await fetch(`${this.apiBaseUrl}/threads/update`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.registryToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = (await response.json()) as ApiError;
      throw new Error(`Thread update failed (${response.status}): ${error.error}`);
    }

    // deno-lint-ignore no-explicit-any
    return (await response.json()) as any;
  }

  /**
   * Get a thread's status ('active' if never explicitly set).
   */
  async getThreadStatus(
    correlationId: string,
  ): Promise<{ correlation_id: string; status: string; set_by_agent_id: string | null }> {
    const response = await fetch(
      `${this.apiBaseUrl}/threads?correlation_id=${encodeURIComponent(correlationId)}`,
    );

    if (!response.ok) {
      const error = (await response.json()) as ApiError;
      throw new Error(`Get thread status failed (${response.status}): ${error.error}`);
    }

    // deno-lint-ignore no-explicit-any
    return (await response.json()) as any;
  }

  // ============================================================
  // Handles & Friendships (RFC 002)
  // ============================================================

  /** Authenticated POST helper for RFC 002 endpoints. */
  private async apiPost(pathname: string, body: Record<string, unknown>): Promise<any> {
    if (!this.agentId || !this.registryToken) {
      throw new Error('Agent must be registered first');
    }
    const response = await fetch(`${this.apiBaseUrl}${pathname}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.registryToken}`,
      },
      body: JSON.stringify({ agent_id: this.agentId, ...body }),
    });
    if (!response.ok) {
      const error = (await response.json()) as ApiError;
      throw new Error(`${pathname} failed (${response.status}): ${error.error}`);
    }
    return response.json();
  }

  /**
   * Claim the owner's handle and/or this agent's handle (RFC 002 §2).
   * Requires an attached owner account (RFC 003). Handles resolve as
   * @owner/agent via resolveHandle().
   */
  async claimHandle(opts: { ownerHandle?: string; agentHandle?: string }): Promise<{
    owner_handle: string | null;
    agent_handle: string | null;
    handle: string | null;
  }> {
    return this.apiPost('/handles/claim', {
      ...(opts.ownerHandle !== undefined ? { owner_handle: opts.ownerHandle } : {}),
      ...(opts.agentHandle !== undefined ? { agent_handle: opts.agentHandle } : {}),
    });
  }

  /**
   * Resolve @owner (owner record + agent cards) or @owner/agent (one card).
   * Public — no auth required.
   */
  async resolveHandle(handle: string): Promise<any> {
    const response = await fetch(
      `${this.apiBaseUrl}/resolve?handle=${encodeURIComponent(handle)}`,
    );
    if (!response.ok) {
      const error = (await response.json()) as ApiError;
      throw new Error(`Resolve failed (${response.status}): ${error.error}`);
    }
    return response.json();
  }

  /**
   * Mint a single-use friend code (RFC 002 §3.1). Give it to the other
   * human out of band; their agent redeems it with addFriend().
   */
  async mintFriendCode(): Promise<{ code: string; expires_at: string; note: string }> {
    return this.apiPost('/friends/code', {});
  }

  /**
   * Redeem a friend code: creates the mutual friendship on the registry and
   * pins the friend's key in the local contacts file.
   */
  async addFriend(code: string, note?: string): Promise<Contact> {
    const result = await this.apiPost('/friends/redeem', { code });
    const contact: Contact = {
      agent_id: result.friend.agent_id,
      public_key: result.friend.public_key,
      handle: result.friend.handle,
      name: result.friend.name,
      note,
      pinned_at: new Date().toISOString(),
      via: 'code',
    };
    saveContact(this.contactsPath, contact);
    console.log(`[OACP] Friend added: ${contact.name} (${contact.handle ?? contact.agent_id}) — key pinned`);
    return contact;
  }

  /**
   * Pin an agent's current key without a friend code (TOFU — weaker than a
   * code: trusts the registry's answer once). Resolves a handle or fetches
   * a card by agent_id.
   */
  async pinContact(handleOrAgentId: string, note?: string): Promise<Contact> {
    let card: Record<string, any> | null;
    if (handleOrAgentId.startsWith('@')) {
      const resolved = await this.resolveHandle(handleOrAgentId);
      card = resolved.agent ?? null;
    } else {
      card = (await this.getAgentCard(handleOrAgentId)) as Record<string, any> | null;
    }
    if (!card?.public_key) {
      throw new Error(`[OACP] Cannot pin: no card/key found for ${handleOrAgentId}`);
    }
    const existing = getContact(this.contactsPath, card.agent_id as string);
    if (existing && existing.public_key !== card.public_key) {
      throw new Error(
        `[OACP] ${checkPin(this.contactsPath, card.agent_id as string, card.public_key as string)}`,
      );
    }
    const contact: Contact = {
      agent_id: card.agent_id as string,
      public_key: card.public_key as string,
      handle: (card.handle as string) ?? null,
      name: card.name as string,
      note,
      pinned_at: new Date().toISOString(),
      via: 'tofu',
    };
    saveContact(this.contactsPath, contact);
    return contact;
  }

  /** Local pinned contacts (RFC 002 §3). */
  contacts(): Record<string, Contact> {
    return loadContacts(this.contactsPath);
  }

  /**
   * Registry friendship edges for this agent, with key-change flags
   * (pinned-at-establishment vs current registry key).
   */
  async listFriends(): Promise<{ friends: any[]; total: number }> {
    if (!this.agentId || !this.registryToken) {
      throw new Error('Agent must be registered first');
    }
    const response = await fetch(
      `${this.apiBaseUrl}/friends?agent_id=${this.agentId}`,
      { headers: { Authorization: `Bearer ${this.registryToken}` } },
    );
    if (!response.ok) {
      const error = (await response.json()) as ApiError;
      throw new Error(`List friends failed (${response.status}): ${error.error}`);
    }
    return (await response.json()) as { friends: any[]; total: number };
  }

  /**
   * Set this agent's access policy (RFC 002 §3.5): 'open' accepts messages
   * from anyone (non-friends rate limited); 'closed' accepts friends only,
   * enforced by the registry.
   */
  async setAccessPolicy(policy: 'open' | 'closed'): Promise<{ agent_id: string; access_policy: string; note: string }> {
    return this.apiPost('/agents/set-access', { access_policy: policy });
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
    this.stopRealtimeSubscription();
    this.messageHandlers.clear();
    console.log(`[OACP] Agent "${this.config.name}" shut down`);
  }
}
