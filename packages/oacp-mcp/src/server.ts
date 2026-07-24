/**
 * OACP MCP Server — tool definitions
 *
 * Exposes the OACP registry (register / discover / send / inbox) as MCP tools
 * so any MCP client — Claude Code, Claude Desktop, Cursor — can join the
 * agent network without writing SDK code.
 *
 * Identity: the Ed25519 keypair is persisted (default ~/.oacp/keypair.json),
 * and the registry returns the same agent_id for the same public key, so an
 * interactive session keeps a stable identity across restarts.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as os from 'os';
import * as path from 'path';
import { OACPAgent, type MessageEnvelope, type MessageType } from 'oacp-sdk';

const MESSAGE_TYPES = ['task_request', 'task_ack', 'task_result', 'task_error', 'chat'] as const;

interface EnvConfig {
  name?: string;
  capabilities: string[];
  ownerHandle?: string;
  description?: string;
  keypairPath: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  apiBaseUrl?: string;
}

function readEnvConfig(): EnvConfig {
  return {
    name: process.env.OACP_AGENT_NAME,
    capabilities: (process.env.OACP_CAPABILITIES || '')
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean),
    ownerHandle: process.env.OACP_OWNER_HANDLE,
    description: process.env.OACP_DESCRIPTION,
    keypairPath:
      process.env.OACP_KEYPAIR_PATH || path.join(os.homedir(), '.oacp', 'keypair.json'),
    supabaseUrl: process.env.OACP_REGISTRY_URL,
    supabaseAnonKey: process.env.OACP_REGISTRY_ANON_KEY,
    apiBaseUrl: process.env.OACP_API_BASE_URL,
  };
}

function jsonResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function errorResult(message: string) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }, null, 2) }],
    isError: true,
  };
}

/** Trim an agent card down to what a model needs to act on. */
function compactAgentCard(a: Record<string, unknown>) {
  return {
    agent_id: a.agent_id,
    name: a.name,
    owner_handle: a.owner_handle,
    description: a.description,
    capabilities: a.capabilities,
    status: a.status,
    last_seen_at: a.last_seen_at,
    metadata: a.metadata,
  };
}

function compactMessage(m: MessageEnvelope) {
  // Sealed payloads the SDK could decrypt arrive already-unsealed with
  // was_sealed set. One still sealed here is one we can't open — replace
  // the ciphertext blob with a compact marker instead of dumping hex.
  const payload =
    (m.payload as Record<string, unknown> | undefined)?.sealed === true
      ? {
          sealed: true,
          note: 'End-to-end encrypted payload — this agent is not a designated reader, so it cannot be decrypted here.',
        }
      : m.payload;
  return {
    message_id: m.message_id,
    sender_agent_id: m.sender_agent_id,
    recipient_agent_id: m.recipient_agent_id,
    message_type: m.message_type,
    payload,
    ...(m.was_sealed ? { was_sealed: true } : {}),
    correlation_id: m.correlation_id,
    timestamp: m.timestamp,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function buildServer(): { server: McpServer; shutdown: () => Promise<void> } {
  const env = readEnvConfig();

  // The OACPAgent binds name/capabilities at construction, so we build it
  // lazily and rebuild it if oacp_register supplies a different identity.
  // The on-disk keypair keeps agent_id stable across rebuilds.
  let agent: OACPAgent | null = null;

  // Push delivery: a Supabase Realtime subscription wakes any pending
  // oacp_wait_for_reply the moment a message lands, instead of that call
  // discovering it on its next poll. The REST inbox stays authoritative —
  // push only shortcuts the wait, so filtering/ordering never depend on
  // the realtime channel being healthy.
  let pushWakers: Array<() => void> = [];

  function wakeWaiters(): void {
    const waiters = pushWakers;
    pushWakers = [];
    for (const wake of waiters) wake();
  }

  function nextPush(): { wait: Promise<void>; cancel: () => void } {
    let resolve!: () => void;
    const wait = new Promise<void>((r) => (resolve = r));
    pushWakers.push(resolve);
    return { wait, cancel: () => (pushWakers = pushWakers.filter((w) => w !== resolve)) };
  }

  function enablePush(a: OACPAgent): void {
    a.on('*', () => wakeWaiters());
  }

  function makeAgent(overrides?: {
    name?: string;
    capabilities?: string[];
    description?: string;
    ownerHandle?: string;
  }): OACPAgent {
    const name = overrides?.name || env.name;
    if (!name) {
      throw new Error(
        'No agent name configured. Call oacp_register with a name, or set OACP_AGENT_NAME in the MCP server env.',
      );
    }
    return new OACPAgent({
      name,
      capabilities: overrides?.capabilities?.length
        ? overrides.capabilities
        : env.capabilities.length
          ? env.capabilities
          : ['general'],
      description: overrides?.description || env.description,
      ownerHandle: overrides?.ownerHandle || env.ownerHandle,
      keypairPath: env.keypairPath,
      supabaseUrl: env.supabaseUrl,
      supabaseAnonKey: env.supabaseAnonKey,
      apiBaseUrl: env.apiBaseUrl,
      protocolsSupported: ['oacp', 'mcp'],
    });
  }

  /** Get a registered agent, auto-registering from env config when possible. */
  async function requireRegistered(): Promise<OACPAgent> {
    if (agent?.isRegistered()) return agent;
    if (!agent) agent = makeAgent(); // throws with guidance if no name is configured
    await agent.register();
    agent.startHeartbeat();
    enablePush(agent);
    return agent;
  }

  const server = new McpServer({ name: 'oacp', version: '0.5.0' });

  // ----------------------------------------------------------
  // oacp_register
  // ----------------------------------------------------------
  server.registerTool(
    'oacp_register',
    {
      title: 'Register on the OACP network',
      description:
        'Register this session as an agent on the OACP registry so other agents can discover and message it. ' +
        'Identity is tied to a persistent local keypair, so re-registering with the same machine keeps the same agent_id. ' +
        'Starts a background heartbeat that keeps the agent shown as online while this MCP server is running.',
      inputSchema: {
        name: z
          .string()
          .min(1)
          .max(80)
          .optional()
          .describe('Agent display name (defaults to OACP_AGENT_NAME env). Ask the user if unknown.'),
        capabilities: z
          .array(z.string())
          .optional()
          .describe("Capability tags to advertise, e.g. ['research', 'code-review']"),
        description: z.string().optional().describe('Short description of what this agent does'),
        owner_handle: z.string().optional().describe("Owner's handle, e.g. a name or email"),
      },
    },
    async ({ name, capabilities, description, owner_handle }) => {
      try {
        if (agent) {
          await agent.shutdown();
          agent = null;
        }
        agent = makeAgent({ name, capabilities, description, ownerHandle: owner_handle });
        const agentId = await agent.register();
        agent.startHeartbeat();
        enablePush(agent);
        return jsonResult({
          agent_id: agentId,
          public_key: agent.getPublicKey(),
          registry: agent.getApiBaseUrl(),
          note: 'Registered and heartbeating. Other agents can now discover and message this agent.',
        });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  // ----------------------------------------------------------
  // oacp_status
  // ----------------------------------------------------------
  server.registerTool(
    'oacp_status',
    {
      title: 'OACP identity & connection status',
      description:
        "Show this session's OACP identity: agent_id, public key, registration state, registry URL, and token balance. " +
        'Use this first to check whether the agent is already registered.',
      inputSchema: {},
    },
    async () => {
      try {
        const a = agent ?? (env.name ? (agent = makeAgent()) : null);
        if (!a) {
          return jsonResult({
            registered: false,
            registry: env.apiBaseUrl || env.supabaseUrl || 'OACP public registry (default)',
            keypair_path: env.keypairPath,
            note: 'Not registered. Call oacp_register with a name to join the network. oacp_discover works without registering.',
          });
        }
        let balance: number | null = null;
        if (a.isRegistered()) {
          try {
            balance = await a.getBalance();
          } catch {
            // balance endpoint optional — ignore
          }
        }
        return jsonResult({
          registered: a.isRegistered(),
          agent_id: a.getAgentId(),
          public_key: a.getPublicKey(),
          registry: a.getApiBaseUrl(),
          keypair_path: env.keypairPath,
          token_balance: balance,
        });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  // ----------------------------------------------------------
  // oacp_discover
  // ----------------------------------------------------------
  server.registerTool(
    'oacp_discover',
    {
      title: 'Discover agents on the OACP network',
      description:
        'Search the OACP registry for other agents by capability, status, or owner. ' +
        "Works without registering. Returns agent cards with agent_id (needed for oacp_send), capabilities, and the actions they advertise in metadata.action_specs.",
      inputSchema: {
        capability: z.string().optional().describe("Filter by capability tag, e.g. 'research'"),
        status: z.enum(['online', 'offline', 'busy']).optional().describe('Filter by status'),
        owner_handle: z.string().optional().describe('Filter by owner handle'),
        page: z.number().int().min(1).optional(),
        page_size: z.number().int().min(1).max(100).optional().describe('Results per page (default 20)'),
      },
    },
    async ({ capability, status, owner_handle, page, page_size }) => {
      try {
        // Discovery is unauthenticated — use any agent instance, registered or not.
        const a = agent ?? new OACPAgent({
          name: 'oacp-mcp-observer',
          capabilities: [],
          keypairPath: env.keypairPath,
          supabaseUrl: env.supabaseUrl,
          supabaseAnonKey: env.supabaseAnonKey,
          apiBaseUrl: env.apiBaseUrl,
        });
        const res = await a.discover({ capability, status, owner_handle, page, page_size });
        return jsonResult({
          total: res.total,
          page: res.page,
          agents: res.agents.map((c) => compactAgentCard(c as unknown as Record<string, unknown>)),
        });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  // ----------------------------------------------------------
  // oacp_send
  // ----------------------------------------------------------
  server.registerTool(
    'oacp_send',
    {
      title: 'Send a message to an OACP agent',
      description:
        'Send a signed message to another agent by agent_id (find it with oacp_discover). ' +
        "Use message_type 'task_request' to ask an agent to do something (payload should include an 'action' or 'task' field matching the recipient's action_specs), " +
        "'task_result' to answer a request you received (pass the request's correlation_id or message_id as correlation_id), and 'task_error' to report failure. " +
        "Use message_type 'chat' for a conversation (Agent DM): payload is { text: \"...\" }, and the correlation_id is the conversation thread — reuse the same one for every turn. " +
        'Registers this session automatically if needed. After sending, use oacp_wait_for_reply (same correlation_id) to get the response.',
      inputSchema: {
        recipient_agent_id: z.string().uuid().describe('Target agent_id from oacp_discover'),
        message_type: z.enum(MESSAGE_TYPES).default('task_request'),
        payload: z
          .record(z.unknown())
          .describe("Message payload, e.g. { action: 'summarize-text', task: 'Summarize …' }"),
        correlation_id: z
          .string()
          .optional()
          .describe('Thread ID linking a reply to the original request. Reuse the incoming message_id or correlation_id when replying.'),
        seal: z
          .boolean()
          .optional()
          .describe(
            'End-to-end encrypt the payload (RFC 001 sealed payloads): only the recipient and this agent can read it — the registry relays ciphertext. Use for confidential content. The envelope (sender, recipient, type, thread) stays visible for routing and the kill switch.',
          ),
      },
    },
    async ({ recipient_agent_id, message_type, payload, correlation_id, seal }) => {
      try {
        const a = await requireRegistered();
        // Every message gets a correlation_id so both sides can track the
        // thread — generated here if the caller didn't supply one.
        const threadId = correlation_id || crypto.randomUUID();
        const messageId = await a.send(
          recipient_agent_id,
          message_type as MessageType,
          payload as Record<string, unknown>,
          { correlationId: threadId, seal },
        );
        return jsonResult({
          message_id: messageId,
          correlation_id: threadId,
          ...(seal ? { sealed: true } : {}),
          note:
            (seal ? 'Sent sealed — payload is end-to-end encrypted; the registry cannot read it. ' : '') +
            (message_type === 'task_request'
              ? `Call oacp_wait_for_reply with correlation_id "${threadId}" to wait for the response.`
              : 'Sent.'),
        });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  // ----------------------------------------------------------
  // oacp_check_inbox
  // ----------------------------------------------------------
  server.registerTool(
    'oacp_check_inbox',
    {
      title: 'Check OACP messages',
      description:
        "Fetch this agent's messages from the registry (inbox by default; direction 'outbox' shows sent messages). " +
        'Messages persist in the registry, so tasks that arrived while this session was offline show up here. ' +
        "Use 'since' (ISO timestamp) to only fetch new messages. To answer a task_request, reply with oacp_send using message_type 'task_result' and the request's correlation_id (or message_id).",
      inputSchema: {
        direction: z.enum(['inbox', 'outbox']).default('inbox'),
        message_type: z.enum(MESSAGE_TYPES).optional().describe('Filter by message type'),
        correlation_id: z.string().optional().describe('Filter to one conversation thread'),
        since: z.string().optional().describe('ISO 8601 timestamp — only messages after this time'),
        limit: z.number().int().min(1).max(100).optional().describe('Max messages (default 20)'),
      },
    },
    async ({ direction, message_type, correlation_id, since, limit }) => {
      try {
        const a = await requireRegistered();
        const res = await a.getMessages({
          direction,
          messageType: message_type as MessageType | undefined,
          correlationId: correlation_id,
          since,
          limit: limit ?? 20,
        });
        return jsonResult({
          total: res.total,
          messages: res.messages.map(compactMessage),
        });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  // ----------------------------------------------------------
  // oacp_wait_for_reply
  // ----------------------------------------------------------
  server.registerTool(
    'oacp_wait_for_reply',
    {
      title: 'Wait for an OACP message',
      description:
        'Block until a new inbox message arrives (optionally filtered by correlation_id and/or message_type), or until the timeout. ' +
        'Delivery is push-based (Supabase Realtime) when available, so replies arrive near-instantly; a background poll covers the fallback. ' +
        'Use after oacp_send with a task_request to collect the task_result. ' +
        'Returns { timed_out: true } if nothing arrives — the reply may still come later; check again with oacp_check_inbox. ' +
        'Keep timeout_seconds under your MCP client tool timeout (default 25s).',
      inputSchema: {
        correlation_id: z.string().optional().describe('Only match messages in this thread'),
        message_type: z.enum(MESSAGE_TYPES).optional().describe('Only match this message type'),
        timeout_seconds: z.number().int().min(5).max(600).default(25),
        since: z
          .string()
          .optional()
          .describe(
            'ISO 8601 timestamp — also return matching messages that arrived after this time but before this call. ' +
            'Defaults to call start (only new arrivals). Pass an earlier timestamp when the message may already be waiting.',
          ),
      },
    },
    async ({ correlation_id, message_type, timeout_seconds, since }) => {
      try {
        const a = await requireRegistered();
        const startedAt = since || new Date().toISOString();
        const deadline = Date.now() + timeout_seconds * 1000;

        while (Date.now() < deadline) {
          // Arm the push waker BEFORE polling — a message landing during
          // the poll wakes the next race instead of falling in the gap.
          const push = nextPush();
          try {
            const res = await a.getMessages({
              direction: 'inbox',
              correlationId: correlation_id,
              messageType: message_type as MessageType | undefined,
              since: startedAt,
              limit: 10,
            });
            if (res.messages.length > 0) {
              return jsonResult({
                timed_out: false,
                messages: res.messages.map(compactMessage),
              });
            }
            // With live push, polling is only a safety net; without it,
            // fall back to the old tight cadence.
            const pollMs = a.isRealtimeConnected() ? 10_000 : 2500;
            await Promise.race([
              push.wait,
              sleep(Math.min(pollMs, Math.max(0, deadline - Date.now()))),
            ]);
          } finally {
            push.cancel();
          }
        }

        return jsonResult({
          timed_out: true,
          waited_seconds: timeout_seconds,
          note: 'No message arrived. The other agent may be offline or still working — check later with oacp_check_inbox (messages persist).',
        });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  // ----------------------------------------------------------
  // oacp_attach_owner
  // ----------------------------------------------------------
  server.registerTool(
    'oacp_attach_owner',
    {
      title: 'Attach this agent to its owner\'s Liteneen account',
      description:
        "Link this agent to the human owner's Liteneen account using a single-use attach code from the dashboard " +
        '(the owner signs in at https://dashboard.liteneen.net and clicks "Attach an agent" to get one; codes expire in 15 minutes). ' +
        "After attaching, the owner's single account key can decrypt ALL their attached agents' sealed conversations in the dashboard — no per-machine key links needed. " +
        'Ask your human for the code; never guess one.',
      inputSchema: {
        code: z.string().min(4).max(32).describe('The attach code shown in the dashboard, e.g. "KQ4-7NF"'),
      },
    },
    async ({ code }) => {
      try {
        const a = await requireRegistered();
        const res = await a.attachOwner(code.trim());
        return jsonResult({
          ...res,
          note: 'Attached. Sealed messages from this agent now include the account owner as a reader; the owner sees them decrypted at dashboard.liteneen.net while signed in.',
        });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  // ----------------------------------------------------------
  // oacp_dashboard_link
  // ----------------------------------------------------------
  server.registerTool(
    'oacp_dashboard_link',
    {
      title: 'Get a dashboard link that can decrypt sealed threads',
      description:
        "Generate a link to the Liteneen dashboard that lets THIS AGENT'S OWNER read the sealed (end-to-end encrypted) conversations this agent participates in. " +
        'The link carries the owner decryption key in the URL fragment (#…), which browsers never send to any server — the dashboard stores it locally and decrypts sealed payloads in the browser. ' +
        'Share this link ONLY with the agent\'s owner; anyone holding it can read this agent\'s sealed threads. ' +
        'Optionally scope the view to one conversation with thread_id.',
      inputSchema: {
        thread_id: z
          .string()
          .optional()
          .describe('Open the dashboard focused on this conversation (correlation_id)'),
      },
    },
    async ({ thread_id }) => {
      try {
        const a = await requireRegistered();
        const owner = a.getOwnerKeypair();
        const base = process.env.OACP_DASHBOARD_URL || 'https://dashboard.liteneen.net';
        const query = thread_id ? `?thread=${encodeURIComponent(thread_id)}` : '';
        const url = `${base}/${query}#okey=${owner.secretKey}`;
        return jsonResult({
          url,
          note:
            'For the owner\'s eyes only — the fragment after # contains their sealed-thread decryption key and never leaves their browser. ' +
            'Opening the link once imports the key (stored in browser localStorage); after that, plain dashboard visits can decrypt too. ' +
            'Only messages sealed after this agent upgraded to owner-key sealing (oacp-sdk 0.5.0) include an owner slot.',
        });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  // ----------------------------------------------------------
  // oacp_thread_control
  // ----------------------------------------------------------
  server.registerTool(
    'oacp_thread_control',
    {
      title: 'Pause, resume, or end a conversation thread',
      description:
        'Control a conversation thread (correlation_id) on the registry — the human-oversight kill switch. ' +
        "'pause' blocks all further messages on the thread until 'resume'; 'end' shuts it down permanently (cannot be reactivated). " +
        'Only participants of the thread can control it. The registry rejects sends on paused/ended threads, so this stops the OTHER agent too, not just this one. ' +
        "Use when the human asks to stop/pause a conversation, or proactively when a conversation seems to need human review. 'status' just reports the current state.",
      inputSchema: {
        correlation_id: z.string().describe('The conversation thread to control'),
        action: z.enum(['pause', 'resume', 'end', 'status']).describe('pause | resume | end (final) | status (read-only)'),
      },
    },
    async ({ correlation_id, action }) => {
      try {
        const a = await requireRegistered();
        if (action === 'status') {
          const res = await a.getThreadStatus(correlation_id);
          return jsonResult(res);
        }
        const status = action === 'pause' ? 'paused' : action === 'resume' ? 'active' : 'ended';
        const res = await a.setThreadStatus(correlation_id, status);
        return jsonResult({
          ...res,
          note:
            status === 'ended'
              ? 'Thread ended permanently — the registry will reject all further messages on it, from both sides.'
              : status === 'paused'
                ? 'Thread paused — the registry blocks sends on it until a participant resumes.'
                : 'Thread resumed — messages can flow again.',
        });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  // ----------------------------------------------------------
  // Prompts — surfaced as slash commands in MCP clients
  // (Claude Code: /mcp__oacp__listen, /mcp__oacp__chat)
  // ----------------------------------------------------------
  server.registerPrompt(
    'listen',
    {
      title: 'Listen for OACP messages',
      description: 'Sit in a receive loop: wait for incoming OACP messages, surface each one to the human, and reply as directed.',
      argsSchema: {},
    },
    () => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: [
              'Act as my OACP inbox listener. Follow this loop until I say stop:',
              '1. Ensure we are registered (oacp_status; oacp_register if needed).',
              '2. First, oacp_check_inbox for anything that arrived while we were away — surface each unhandled message to me before continuing.',
              '3. Then loop: call oacp_wait_for_reply with timeout_seconds: 55 and no correlation_id filter.',
              '4. When a message arrives: show me who sent it (look up the sender with oacp_discover if unknown), the type, and the payload. For chat messages, draft a reply and CHECK WITH ME before sending it (oacp_send, same correlation_id). For task_requests, tell me what is being asked and ask whether to do it.',
              '5. On timeout with no message, just continue the loop silently — do not narrate empty polls.',
              '6. If I say "pause thread" or "end thread", use oacp_thread_control on that correlation_id.',
              'Start now.',
            ].join('\n'),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'chat',
    {
      title: 'Open a chat with another agent',
      description: 'Find an agent by owner handle or name and start a supervised conversation with it.',
      argsSchema: {
        with_agent: z.string().describe("Who to chat with — an owner_handle (e.g. 'bryan'), agent name, or agent_id"),
        opener: z.string().optional().describe('What the first message should say or be about'),
      },
    },
    ({ with_agent, opener }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: [
              `Open an OACP chat with the agent identified by "${with_agent}".`,
              '1. Ensure we are registered (oacp_status; oacp_register if needed).',
              `2. Find them: oacp_discover by owner_handle "${with_agent}" first; if no match, search by name/agent_id. If several match, ask me which.`,
              `3. Send the first chat message (message_type "chat", payload {"text": ...})${opener ? ` — it should say: ${opener}` : ' — introduce yourself on my behalf and ask what they are working on'}. Note the correlation_id: that is our conversation thread.`,
              '4. Then hold the conversation: oacp_wait_for_reply (same correlation_id, message_type "chat", timeout_seconds: 55, and looping on timeouts without narrating). When a reply arrives, show it to me, draft a response, and CHECK WITH ME before sending. Reuse the same correlation_id on every turn.',
              '5. If I say "pause the thread" or "end the thread", use oacp_thread_control.',
              'Start now.',
            ].join('\n'),
          },
        },
      ],
    }),
  );

  const shutdown = async () => {
    wakeWaiters();
    if (agent) {
      await agent.shutdown();
      agent = null;
    }
  };

  return { server, shutdown };
}
