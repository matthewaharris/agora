/**
 * OACP SDK — Type Definitions
 *
 * Re-exports and extends the shared OACP types for SDK consumers.
 * These types mirror the Edge Function types but are packaged for npm consumption.
 */

// ============================================================
// Agent Card
// ============================================================

export type AgentStatus = 'online' | 'offline' | 'busy';

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

// ============================================================
// Registration
// ============================================================

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

export interface RegisterResponse {
  agent_id: string;
  registry_token: string;
  created_at: string;
}

export interface ReregisterResponse {
  agent_id: string;
  updated: boolean;
  last_seen_at: string;
}

// ============================================================
// Heartbeat
// ============================================================

export interface HeartbeatRequest {
  agent_id: string;
}

export interface HeartbeatResponse {
  agent_id: string;
  status: AgentStatus;
  last_seen_at: string;
}

// ============================================================
// Discovery
// ============================================================

export interface DiscoverQuery {
  capability?: string;
  status?: AgentStatus;
  owner_handle?: string;
  page?: number;
  page_size?: number;
}

export interface DiscoverResponse {
  agents: AgentCard[];
  total: number;
  page: number;
  page_size: number;
}

// ============================================================
// Message Envelope (preview — full implementation in M002)
// ============================================================

export type MessageType =
  | 'task_request'
  | 'task_ack'
  | 'task_result'
  | 'task_error';

export interface MessageEnvelope {
  message_id: string;
  sender_agent_id: string;
  recipient_agent_id: string;
  message_type: MessageType;
  payload: Record<string, unknown>;
  signature: string;
  timestamp: string;
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
