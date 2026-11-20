/**
 * Trajectories — the append-only record of one agent run.
 *
 * Every model turn, tool call, limit and policy decision becomes one event,
 * written as it happens. Events are inserted and never changed. See
 * docs/decisions/002-trajectories.md.
 *
 * Each event has two parts with different lifetimes:
 *   attrs    small facts the platform measured (names, timings, token counts).
 *            Kept. Attribute names follow the OpenTelemetry GenAI conventions.
 *   content  what was said: prompts, model output, tool results. This can be
 *            other people's code, so a store deletes it after an expiry and
 *            keeps only the attrs.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import type { AgentTool, ModelCall } from './harness.js';

export type TrajectoryEventType =
  'run.started' | 'model.turn' | 'tool.call' | 'limit.hit' | 'run.ended' | 'policy.applied';

export interface TrajectoryEvent {
  run_id: string;
  /** W3C trace ID (32 hex). Shared by every run that belongs to one piece of work. */
  trace_id: string;
  /** The run that caused this one, when another agent's run sent the task. */
  parent_run_id?: string;
  /** Position in the run, starting at 1. (run_id, seq) is unique. */
  seq: number;
  ts: string;
  type: TrajectoryEventType;
  attrs: Record<string, unknown>;
  content?: unknown;
}

/** Where events go. A store only ever appends. */
export interface TrajectoryStore {
  append(event: TrajectoryEvent): Promise<void>;
}

/**
 * What to do when the store cannot be written:
 *   required  stop. A run with no record is not allowed to continue.
 *   buffered  keep going and hold events in memory until the store returns.
 *             Events are lost if the process dies first.
 */
export type TrajectoryMode = 'required' | 'buffered';

export class TrajectoryUnavailableError extends Error {
  constructor(cause: unknown) {
    super(`Trajectory store unavailable: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'TrajectoryUnavailableError';
  }
}

export interface TraceContext {
  trace_id: string;
  parent_run_id?: string;
}

export interface Recorder {
  readonly run_id: string;
  readonly trace_id: string;
  record(type: TrajectoryEventType, attrs: Record<string, unknown>, content?: unknown): Promise<void>;
  /** Try to write anything still buffered. Returns how many events were never stored. */
  close(): Promise<{ unsaved: number }>;
}

const MAX_BUFFERED_EVENTS = 500;

export function createRecorder(options: {
  store: TrajectoryStore;
  mode: TrajectoryMode;
  /** Continue an existing trace (a task that arrived from another agent's run). */
  trace?: TraceContext;
}): Recorder {
  const { store, mode } = options;
  const run_id = randomUUID();
  const trace_id = options.trace?.trace_id ?? randomBytes(16).toString('hex');
  const pending: TrajectoryEvent[] = [];
  let seq = 0;
  let overflowed = 0;

  // Events must reach the store in order, so a later event never jumps a buffered one.
  const flush = async (): Promise<void> => {
    while (pending.length > 0) {
      await store.append(pending[0]);
      pending.shift();
    }
  };

  return {
    run_id,
    trace_id,
    async record(type, attrs, content) {
      const event: TrajectoryEvent = {
        run_id,
        trace_id,
        ...(options.trace?.parent_run_id ? { parent_run_id: options.trace.parent_run_id } : {}),
        seq: ++seq,
        ts: new Date().toISOString(),
        type,
        attrs,
        ...(content === undefined ? {} : { content }),
      };
      pending.push(event);
      try {
        await flush();
      } catch (err) {
        if (mode === 'required') {
          pending.length = 0;
          throw new TrajectoryUnavailableError(err);
        }
        if (pending.length > MAX_BUFFERED_EVENTS) {
          pending.shift();
          overflowed++;
        }
      }
    },
    async close() {
      try {
        await flush();
      } catch {
        // Still down. Whatever is pending is lost when the process moves on.
      }
      return { unsaved: pending.length + overflowed };
    },
  };
}

// ── Stores ────────────────────────────────────────────────────────────────

/** Keeps events in an array. For tests. */
export function memoryStore(): TrajectoryStore & { events: TrajectoryEvent[] } {
  const events: TrajectoryEvent[] = [];
  return {
    events,
    append: async (event) => {
      events.push(structuredClone(event));
    },
  };
}

/** One JSON-lines file per run in `dir`. For local development; it has no expiry. */
export function jsonlFileStore(dir: string): TrajectoryStore {
  let ready: Promise<unknown> | null = null;
  return {
    append: async (event) => {
      ready ??= mkdir(dir, { recursive: true });
      await ready;
      await appendFile(join(dir, `${event.run_id}.jsonl`), `${JSON.stringify(event)}\n`);
    },
  };
}

export async function readJsonlRun(path: string): Promise<TrajectoryEvent[]> {
  const text = await readFile(path, 'utf8');
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TrajectoryEvent);
}

const DEFAULT_CONTENT_DAYS = 30;

/**
 * The trajectory_events table in the fleet host's own Supabase project,
 * written through its REST API (agents/fleet-host/db/001_trajectory_events.sql).
 *
 * `key` is that project's service-role key. It grants full access to the
 * trajectory database only; it is not a registry credential.
 */
/**
 * Headers that present a Supabase API key.
 *
 * Legacy keys are JWTs and go in both headers. The newer secret keys
 * (`sb_secret_...`) are not JWTs: Supabase wants them on `apikey` only, and a
 * non-JWT bearer value can be rejected as "Invalid JWT".
 */
export function supabaseKeyHeaders(key: string): Record<string, string> {
  return key.startsWith('eyJ') ? { apikey: key, Authorization: `Bearer ${key}` } : { apikey: key };
}

export function postgresStore(options: {
  url: string;
  key: string;
  /** Days before an event's content is cleared. */
  contentDays?: number;
  fetchImpl?: typeof fetch;
}): TrajectoryStore {
  const { key, fetchImpl = fetch } = options;
  const days = options.contentDays ?? DEFAULT_CONTENT_DAYS;
  // A retried write may already have landed. The same (run_id, seq) twice is ignored, not an error.
  const endpoint = `${options.url.replace(/\/+$/, '')}/rest/v1/trajectory_events?on_conflict=run_id,seq`;
  return {
    append: async (event) => {
      const hasContent = event.content !== undefined;
      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          ...supabaseKeyHeaders(key),
          'Content-Type': 'application/json',
          Prefer: 'resolution=ignore-duplicates,return=minimal',
        },
        body: JSON.stringify({
          run_id: event.run_id,
          seq: event.seq,
          trace_id: event.trace_id,
          parent_run_id: event.parent_run_id ?? null,
          ts: event.ts,
          type: event.type,
          attrs: event.attrs,
          content: hasContent ? event.content : null,
          content_expires_at: hasContent
            ? new Date(Date.parse(event.ts) + days * 86_400_000).toISOString()
            : null,
        }),
        signal: AbortSignal.timeout(5_000),
      });
      // The response body can name the key or the row; only the status is reported.
      if (!res.ok) throw new Error(`trajectory database answered ${res.status}`);
    },
  };
}

/** Read one run's events back from the trajectory database, in order. */
export async function readDatabaseRun(options: {
  url: string;
  key: string;
  runId: string;
  fetchImpl?: typeof fetch;
}): Promise<TrajectoryEvent[]> {
  const { key, fetchImpl = fetch } = options;
  if (!/^[0-9a-f-]{36}$/i.test(options.runId)) throw new Error('run ID must be a UUID');
  const res = await fetchImpl(
    `${options.url.replace(/\/+$/, '')}/rest/v1/trajectory_events?run_id=eq.${options.runId}&order=seq`,
    { headers: supabaseKeyHeaders(key), signal: AbortSignal.timeout(10_000) },
  );
  if (!res.ok) throw new Error(`trajectory database answered ${res.status}`);
  const rows = (await res.json()) as Array<TrajectoryEvent & { content: unknown }>;
  // The database stores "no content" as NULL; in an event that means the field is absent.
  return rows.map(({ content, ...row }) => (content === null ? row : { ...row, content }));
}

/**
 * The store this process is configured to use, or null when none is.
 * With no store configured, runs are not recorded at all.
 *   TRAJECTORY_DB_URL + TRAJECTORY_DB_KEY   the fleet host's trajectory database
 *   TRAJECTORY_CONTENT_DAYS                 days before content is cleared (default 30)
 *   TRAJECTORY_DIR                          one JSON-lines file per run (local development)
 */
export function storeFromEnv(): TrajectoryStore | null {
  const { TRAJECTORY_DB_URL: url, TRAJECTORY_DB_KEY: key, TRAJECTORY_DIR: dir } = process.env;
  if (url && key) {
    const days = Number(process.env.TRAJECTORY_CONTENT_DAYS);
    return postgresStore({ url, key, contentDays: days > 0 ? days : undefined });
  }
  return dir ? jsonlFileStore(dir) : null;
}

export function modeFromEnv(value: string | undefined): TrajectoryMode {
  return value === 'buffered' ? 'buffered' : 'required';
}

// ── Replay ────────────────────────────────────────────────────────────────

/**
 * Tools that answer from a recorded run instead of the outside world.
 *
 * Each returns what the same tool returned (or threw) for the same input in
 * the recording. If the model asks for something the recording never saw, the
 * tool fails and says so: a replay must not quietly reach the network.
 */
export function createReplayTools(events: TrajectoryEvent[]): AgentTool[] {
  const started = events.find((e) => e.type === 'run.started');
  const definitions = (started?.content as { tools?: Array<Omit<AgentTool, 'run'>> } | undefined)?.tools;
  if (!definitions) {
    throw new Error(
      'This run has no recorded tool definitions (content missing or expired); it cannot be replayed',
    );
  }

  const key = (name: string, input: unknown) => `${name}:${JSON.stringify(input)}`;
  const recorded = new Map<string, Array<{ ok: boolean; output: string }>>();
  for (const event of events) {
    if (event.type !== 'tool.call' || event.attrs.skipped) continue;
    const output = (event.content as { output?: unknown } | undefined)?.output;
    if (typeof output !== 'string') continue;
    const k = key(String(event.attrs['gen_ai.tool.name']), event.attrs.input);
    const list = recorded.get(k) ?? [];
    list.push({ ok: event.attrs.ok === true, output });
    recorded.set(k, list);
  }

  return definitions.map((definition) => ({
    ...definition,
    run: async (input) => {
      const list = recorded.get(key(definition.name, input));
      // The same call made twice replays in order; after that the last answer repeats.
      const hit = list && (list.length > 1 ? list.shift() : list[0]);
      if (!hit) throw new Error('Not in the recording: this call was never made in the original run');
      if (!hit.ok) throw new Error(hit.output);
      return hit.output;
    },
  }));
}

/**
 * A model that answers from a recorded run instead of calling the provider.
 *
 * Together with createReplayTools this makes a full replay: nothing leaves the
 * process, it costs nothing, and it gives the same result every time. Use it
 * to check what a changed harness or policy does with a run that already
 * happened.
 *
 * Each turn is checked against the recording. If the harness now sends a
 * different request than it did originally, the replay stops and says where,
 * because the recorded answer would no longer be an answer to that request.
 */
export function createReplayModel(events: TrajectoryEvent[]): ModelCall {
  const turns = events.filter((e) => e.type === 'model.turn');
  let next = 0;
  return async (params) => {
    const event = turns[next++];
    if (!event) {
      throw new Error(
        `Replay diverged: the harness asked for turn ${next}, but only ${turns.length} were recorded`,
      );
    }
    const response = (event.content as { response?: Anthropic.ContentBlock[] } | undefined)?.response;
    if (!response) throw new Error(`Turn ${next} has no recorded response (content missing or expired)`);

    const toolsAllowed = params.tool_choice?.type !== 'none';
    if (params.messages.length !== event.attrs.messages_sent || toolsAllowed !== event.attrs.tools_allowed) {
      throw new Error(
        `Replay diverged at turn ${next}: recorded ${event.attrs.messages_sent} message(s) with tools ` +
          `${event.attrs.tools_allowed ? 'on' : 'off'}, now ${params.messages.length} with tools ${toolsAllowed ? 'on' : 'off'}`,
      );
    }

    const output = Number(event.attrs['gen_ai.usage.output_tokens'] ?? 0);
    const finish = (event.attrs['gen_ai.response.finish_reasons'] as Anthropic.Message['stop_reason'][])[0];
    // Only the fields the harness reads are rebuilt. Token counts match the recording's totals.
    return {
      id: `replay-${event.run_id}-${event.seq}`,
      type: 'message',
      role: 'assistant',
      model: String(event.attrs['gen_ai.response.model']),
      content: response,
      stop_reason: finish,
      stop_sequence: null,
      usage: { input_tokens: Number(event.attrs.tokens_this_turn) - output, output_tokens: output },
    } as Anthropic.Message;
  };
}
