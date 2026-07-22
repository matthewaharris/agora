/**
 * OACP Shared Types
 *
 * Type definitions for Agent Cards, Message Envelopes, and API contracts.
 * Used by both Edge Functions and the oacp-sdk.
 */

// ============================================================
// Agent Card
// ============================================================

/** Status values for an agent's presence state */
export type AgentStatus = 'online' | 'offline' | 'busy';

/** The Agent Card — machine-readable descriptor of agent identity and capabilities */
export interface AgentCard {
  agent_id: string;
  name: string;
  owner_handle?: string;
  description?: string;
  endpoint_url?: string;
  capabilities: string[];
  status: AgentStatus;
  public_key: string;
  protocols_supported: string[];
  metadata: Record<string, unknown>;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Payload for POST /oacp/register */
export interface RegisterRequest {
  name: string;
  owner_handle?: string;
  description?: string;
  endpoint_url?: string;
  capabilities: string[];
  public_key: string;
  protocols_supported?: string[];
  metadata?: Record<string, unknown>;
}

/** Response from POST /oacp/register */
export interface RegisterResponse {
  agent_id: string;
  registry_token: string;
  created_at: string;
}

/** Payload for POST /oacp/heartbeat */
export interface HeartbeatRequest {
  agent_id: string;
}

/** Query parameters for GET /oacp/discover */
export interface DiscoverQuery {
  capability?: string;
  status?: AgentStatus;
  owner_handle?: string;
  page?: number;
  page_size?: number;
}

/** Response from GET /oacp/discover */
export interface DiscoverResponse {
  agents: Omit<AgentCard, 'registry_token'>[];
  total: number;
  page: number;
  page_size: number;
}

// ============================================================
// Message Envelope
// ============================================================

/** Types of messages in the OACP protocol */
export type MessageType =
  | 'task_request'
  | 'task_ack'
  | 'task_result'
  | 'task_error'
  | 'chat';

/** The OACP Message Envelope — structured container for inter-agent communication */
export interface MessageEnvelope {
  message_id: string;
  sender_agent_id: string;
  recipient_agent_id: string;
  message_type: MessageType;
  payload: Record<string, unknown>;
  signature: string;
  timestamp: string;
  /** Optional correlation ID to link request/ack/result in a task lifecycle */
  correlation_id?: string;
  /** Monotonic sequence number for ordering within a conversation */
  sequence?: number;
}

/** Payload for POST /oacp/messages/send */
export interface SendMessageRequest {
  recipient_agent_id: string;
  message_type: MessageType;
  payload: Record<string, unknown>;
  signature: string;
  correlation_id?: string;
  sequence?: number;
}

// ============================================================
// API Error
// ============================================================

export interface ApiError {
  error: string;
  details?: Record<string, unknown>;
}
