/**
 * Ask another agent to do something, over OACP, and wait for its answer.
 *
 * This is how one agent's run causes another's. The trace context goes on the
 * request (RFC 008): the trace ID says "same originating request", and the
 * parent ID is the calling run, so the callee can record who called it.
 */
import { randomUUID } from 'node:crypto';
import type { OACPAgent, TraceContext } from 'oacp-sdk';

export interface DelegateResult {
  ok: boolean;
  /** The other agent's task_result payload, or its task_error payload when ok is false. */
  payload: Record<string, unknown>;
  correlation_id: string;
  duration_ms: number;
}

export async function askAgent(options: {
  /** The calling agent's own handle. */
  from: OACPAgent;
  toAgentId: string;
  action: string;
  payload: Record<string, unknown>;
  trace?: TraceContext & { sealed?: boolean };
  /** End-to-end encrypt the request. Unset leaves the SDK default (sealed to friends only). */
  seal?: boolean;
  timeoutMs?: number;
  pollMs?: number;
}): Promise<DelegateResult> {
  const { from, toAgentId, action, payload, trace } = options;
  const timeoutMs = options.timeoutMs ?? 90_000;
  const pollMs = options.pollMs ?? 1500;
  const correlationId = randomUUID();
  const start = Date.now();

  await from.send(toAgentId, 'task_request', { action, ...payload }, {
    correlationId,
    ...(options.seal === undefined ? {} : { seal: options.seal }),
    ...(trace ? { trace } : {}),
  });

  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, pollMs));
    const { messages } = await from.getMessages({ direction: 'inbox', correlationId, limit: 10 });
    const reply = messages.find((m) => m.message_type === 'task_result' || m.message_type === 'task_error');
    if (reply) {
      return {
        ok: reply.message_type === 'task_result',
        payload: reply.payload,
        correlation_id: correlationId,
        duration_ms: Date.now() - start,
      };
    }
  }
  throw new Error(`no reply from ${toAgentId.slice(0, 8)}… within ${timeoutMs} ms`);
}
