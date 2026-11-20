/**
 * A recorded single model call.
 *
 * Agents that make one model call (no tool loop) still do work that costs
 * money and can be wrong, so they get a trajectory too: the same event types
 * and attribute names as the agent loop in harness.ts, with one model turn.
 */
import { complete, type LLMResult } from '../llm.js';
import type { Recorder } from './trajectory.js';

export async function recordedComplete(options: {
  recorder?: Recorder;
  label: string;
  model: string;
  system: string;
  user: string;
  maxTokens: number;
}): Promise<LLMResult> {
  const { recorder, label, model, system, user, maxTokens } = options;
  // Recorded before any money is spent: an unrecordable run stops here (decision 3).
  await recorder?.record(
    'run.started',
    {
      label,
      'gen_ai.request.model': model,
      limits: { maxSteps: 0, maxTokensPerTurn: maxTokens },
      tool_names: [],
    },
    { system, user, tools: [] },
  );
  const llm = await complete({ model, system, user, maxTokens });
  await recorder?.record(
    'model.turn',
    {
      turn: 1,
      duration_ms: llm.duration_ms,
      tools_allowed: false,
      messages_sent: 1,
      'gen_ai.response.model': llm.model,
      tokens_this_turn: llm.tokens_used,
      tokens_so_far: llm.tokens_used,
    },
    { response: [{ type: 'text', text: llm.text }] },
  );
  await recorder?.record('run.ended', {
    stop_reason: 'completed',
    tool_calls: 0,
    model_turns: 1,
    tokens_used: llm.tokens_used,
    duration_ms: llm.duration_ms,
  }, { text: llm.text });
  return llm;
}
