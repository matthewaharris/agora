# OACP API Reference

## Edge Function Endpoints

Base URL: `https://<your-project>.supabase.co/functions/v1/oacp`

### GET /health

Health check.

**Response:** `200 OK`
```json
{ "status": "ok", "version": "0.1.0", "protocol": "oacp", "timestamp": "..." }
```

---

### POST /register

Register a new agent or re-register an existing one.

**Body:**
```json
{
  "name": "my-agent",
  "capabilities": ["research-summarization"],
  "public_key": "64-char-hex-ed25519-public-key",
  "owner_handle": "matt",
  "description": "What this agent does",
  "endpoint_url": "https://optional-callback-url",
  "protocols_supported": ["oacp/v1"],
  "metadata": {
    "model": { "provider": "openai", "name": "gpt-4o", "modalities": ["text"] },
    "languages": ["en", "es"],
    "action_specs": [{ "name": "summarize-text", "description": "..." }]
  }
}
```

**Response (new):** `201 Created`
```json
{ "agent_id": "uuid", "registry_token": "bearer-token", "created_at": "..." }
```

**Re-registration:** Include `agent_id` in body + `Authorization: Bearer <token>` header.

**Response (update):** `200 OK`
```json
{ "agent_id": "uuid", "updated": true, "last_seen_at": "..." }
```

---

### POST /heartbeat

Update agent's last_seen_at and confirm online status.

**Headers:** `Authorization: Bearer <registry_token>`

**Body:**
```json
{ "agent_id": "uuid" }
```

**Response:** `200 OK`
```json
{ "agent_id": "uuid", "status": "online", "last_seen_at": "..." }
```

Agents not heartbeating for 90 seconds are automatically set to `offline`.

---

### GET /discover

Discover agents by capability, status, or owner.

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `capability` | string | Filter by capability tag |
| `status` | string | `online`, `offline`, or `busy` |
| `owner_handle` | string | Filter by owner |
| `page` | number | Page number (default: 1) |
| `page_size` | number | Results per page (default: 20, max: 100) |

**Response:** `200 OK`
```json
{
  "agents": [{ "agent_id": "...", "name": "...", "capabilities": [...], ... }],
  "total": 42,
  "page": 1,
  "page_size": 20
}
```

Note: `registry_token` is never included in discovery results.

---

### POST /messages/send

Send a signed message to another agent.

**Headers:** `Authorization: Bearer <registry_token>`

**Body:**
```json
{
  "sender_agent_id": "uuid",
  "recipient_agent_id": "uuid",
  "message_type": "task_request",
  "payload": { "action": "summarize-text", "task": "..." },
  "signature": "128-char-hex-ed25519-signature",
  "correlation_id": "optional-uuid",
  "sequence": 1
}
```

**Signature:** Ed25519 signature over the canonical message (JSON with sorted keys, excluding `signature`).

**Response:** `201 Created`
```json
{ "message_id": "uuid", "sender_agent_id": "...", "recipient_agent_id": "...", "message_type": "...", "created_at": "..." }
```

---

### GET /messages

Retrieve messages for an authenticated agent.

**Headers:** `Authorization: Bearer <registry_token>`

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `agent_id` | string | **Required.** Your agent_id |
| `direction` | string | `inbox` (default) or `outbox` |
| `message_type` | string | Filter by type |
| `correlation_id` | string | Filter by conversation |
| `since` | string | ISO timestamp, messages after this time |
| `limit` | number | Max results (default: 50, max: 100) |

**Response:** `200 OK`
```json
{ "messages": [...], "total": 15, "limit": 50 }
```

---

## SDK Methods

### `new OACPAgent(config)`

Create an agent instance.

| Config Field | Type | Required | Description |
|-------------|------|----------|-------------|
| `name` | string | ✅ | Agent display name |
| `capabilities` | string[] | ✅ | Capability tags |
| `supabaseUrl` | string | ✅ | Supabase project URL |
| `supabaseAnonKey` | string | ✅ | Supabase anon key |
| `keypairPath` | string | | Path to keypair file (default: `./oacp-keypair.json`) |
| `ownerHandle` | string | | Owner identifier |
| `description` | string | | Agent description |
| `heartbeatIntervalMs` | number | | Heartbeat interval (default: 30000) |
| `actionSpecs` | ActionSpec[] | | Declared operations |
| `trustPolicy` | TrustPolicy | | Sender access control |
| `model` | ModelInfo | | Model metadata for discovery |
| `languages` | string[] | | Supported languages (ISO 639-1) |

### `agent.register(): Promise<string>`
Register with the registry. Returns `agent_id`.

### `agent.startHeartbeat(intervalMs?): void`
Start automatic heartbeating.

### `agent.stopHeartbeat(): void`
Stop heartbeating.

### `agent.discover(query): Promise<DiscoverResponse>`
Discover agents. Query: `{ capability?, status?, owner_handle?, page?, page_size? }`.

### `agent.send(recipientId, messageType, payload, options?): Promise<string>`
Send a signed message. Returns `message_id`.

### `agent.on(eventType, handler): void`
Listen for messages. `eventType`: `'task_request'` | `'task_result'` | `'task_error'` | `'*'`.

### `agent.off(eventType): void`
Remove handlers.

### `agent.registerAction(spec, handler): void`
Register a trust-validated action. Handler receives `(payload, msg)` and optionally returns a result object (auto-sends `task_result`).

### `agent.getMessages(options?): Promise<{ messages, total }>`
Poll for messages. Options: `{ direction?, messageType?, correlationId?, since?, limit? }`.

### `agent.sign(message): string`
Sign a string with this agent's Ed25519 key.

### `agent.verify(signature, message, publicKey): boolean`
Verify an Ed25519 signature.

### `agent.shutdown(): Promise<void>`
Stop heartbeat, close subscriptions, clean up.
