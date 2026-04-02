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
  signMessage,
  verifySignature,
  canonicalizeMessage,
  type OACPKeypair,
} from './crypto.js';
import {
  validatePayload,
  isSenderAllowed,
  matchAction,
  DEFAULT_TRUST_POLICY,
  type ActionSpec,
  type TrustPolicy,
  type ValidationResult,
} from './trust.js';
import type {
  RegisterResponse,
  ReregisterResponse,
  HeartbeatResponse,
  DiscoverQuery,
  DiscoverResponse,
  MessageType,
  MessageEnvelope,
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

  // Messaging — event handlers and Realtime subscription
  // deno-lint-ignore no-explicit-any
  private messageHandlers: Map<string, Array<(msg: any) => void>> = new Map();
  // deno-lint-ignore no-explicit-any
  private realtimeChannel: any = null;
  // deno-lint-ignore no-explicit-any
  private supabaseClient: any = null;

  // Trust model
  private actionSpecs: ActionSpec[] = [];
  private trustPolicy: TrustPolicy;
  // deno-lint-ignore no-explicit-any
  private actionHandlers: Map<string, (payload: Record<string, unknown>, msg: any) => Promise<Record<string, unknown> | void>> = new Map();

  constructor(config: AgentConfig) {
    this.config = config;

    // Load or generate keypair
    const keypairPath = config.keypairPath || DEFAULT_KEYPAIR_PATH;
    this.keypair = loadOrCreateKeypair(keypairPath);

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

    if (this.config.languages) {
      structuredMeta.languages = this.config.languages;
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
   * @param options - Optional correlation_id and sequence
   * @returns The message_id assigned by the registry
   */
  async send(
    recipientId: string,
    messageType: MessageType,
    payload: Record<string, unknown>,
    options?: { correlationId?: string; sequence?: number },
  ): Promise<string> {
    if (!this.agentId || !this.registryToken) {
      throw new Error('Agent must be registered before sending messages');
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
      messages: result.messages as MessageEnvelope[],
      total: result.total as number,
    };
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
            console.log(`[OACP] Realtime subscription active for ${this.agentId}`);
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
      console.log('[OACP] Realtime subscription stopped');
    }
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

    // Step 4: Execute handler
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

        // Auto-collect payment if this action has a price
        if (action.price && action.price > 0 && this.agentId) {
          try {
            // Call server-side payment collection — server verifies the task was real
            const response = await fetch(`${this.apiBaseUrl}/collect-payment`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.registryToken}`,
              },
              body: JSON.stringify({
                provider_agent_id: this.agentId,
                requester_agent_id: senderId,
                amount: action.price,
                message_id: msg.message_id,
                action_name: action.name,
              }),
            });

            if (response.ok) {
              // deno-lint-ignore no-explicit-any
              const data = (await response.json()) as any;
              console.log(`[OACP] 💰 Collected ${action.price} tokens from ${senderId.substring(0, 8)}... (tx: ${data.transaction_id})`);
            } else {
              const errText = await response.text();
              console.warn(`[OACP] ⚠️ Payment collection failed (${response.status}): ${errText.substring(0, 100)}`);
            }
          } catch (payErr) {
            console.warn(`[OACP] ⚠️ Payment collection error: ${payErr instanceof Error ? payErr.message : payErr}`);
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
