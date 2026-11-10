/**
 * Agent harness — the tool loop shared by fleet residents.
 *
 * One run = repeated model turns. Each turn the model either answers (run
 * ends) or asks for tools; the harness executes them and feeds the results
 * back. The model decides when it is done, inside two hard caps: a tool-call
 * limit and a total token budget. When a cap is hit the harness skips any
 * pending tool calls, says so, and forces one final turn with tools disabled.
 *
 * The harness knows nothing about what the agent is for. The resident
 * supplies the prompt, the tools and the limits. See
 * docs/decisions/001-agent-harness.md.
 */
import type Anthropic from '@anthropic-ai/sdk';

export interface AgentTool {
  name: string;
  description: string;
  inputSchema: Anthropic.Tool.InputSchema;
  /** Return text for the model. Throw to report a failure the model can react to. */
  run(input: Record<string, unknown>): Promise<string>;
}

export interface AgentLimits {
  /** Maximum tool calls across the whole run. */
  maxSteps: number;
  /** Maximum tokens processed across the whole run (input + output, cached or not). */
  maxTotalTokens: number;
  /** Output cap for a single model turn. */
  maxTokensPerTurn: number;
}

export type StopReason =
  | 'completed' // the model finished on its own
  | 'step_cap' // tool-call limit reached; final answer forced
  | 'token_budget' // token budget reached; final answer forced
  | 'output_truncated' // a turn hit maxTokensPerTurn
  | 'refused'; // the model declined

export interface StepRecord {
  step: number;
  tool: string;
  input: Record<string, unknown>;
  ok: boolean;
  /** Present when ok is false: the tool's error, or why the harness skipped it. */
  error?: string;
  output_chars: number;
  duration_ms: number;
}

export interface AgentRun {
  text: string;
  stopReason: StopReason;
  steps: StepRecord[];
  modelTurns: number;
  tokens_used: number;
  model: string;
  duration_ms: number;
}

export type ModelCall = (
  params: Anthropic.MessageCreateParamsNonStreaming,
) => Promise<Anthropic.Message>;

/** Tool output beyond this is cut, with a note the model can see. */
const MAX_TOOL_OUTPUT_CHARS = 30_000;

const FINALIZE_NOTE: Record<'step_cap' | 'token_budget', string> = {
  step_cap: 'The tool-call limit for this task has been reached.',
  token_budget: 'The token budget for this task has been reached.',
};

function turnTokens(usage: Anthropic.Usage): number {
  return (
    usage.input_tokens +
    usage.output_tokens +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0)
  );
}

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
}

export async function runAgent(options: {
  model: string;
  system: string;
  user: string;
  tools: AgentTool[];
  limits: AgentLimits;
  callModel: ModelCall;
}): Promise<AgentRun> {
  const { model, system, tools, limits, callModel } = options;
  const start = Date.now();
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const toolParams: Anthropic.Tool[] = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }));

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: options.user }];
  const steps: StepRecord[] = [];
  let tokensUsed = 0;
  let modelTurns = 0;
  let servedModel = model;

  const turn = async (allowTools: boolean): Promise<Anthropic.Message> => {
    const response = await callModel({
      model,
      max_tokens: limits.maxTokensPerTurn,
      system,
      messages,
      tools: toolParams,
      tool_choice: allowTools ? { type: 'auto' } : { type: 'none' },
      // The system prompt and task text repeat on every turn; cache them.
      cache_control: { type: 'ephemeral' },
    });
    modelTurns++;
    tokensUsed += turnTokens(response.usage);
    servedModel = response.model;
    return response;
  };

  const finish = (text: string, stopReason: StopReason): AgentRun => ({
    text,
    stopReason,
    steps,
    modelTurns,
    tokens_used: tokensUsed,
    model: servedModel,
    duration_ms: Date.now() - start,
  });

  const record = (
    call: Anthropic.ToolUseBlock,
    outcome: { ok: boolean; output: string; duration_ms: number },
  ): Anthropic.ToolResultBlockParam => {
    steps.push({
      step: steps.length + 1,
      tool: call.name,
      input: call.input as Record<string, unknown>,
      ok: outcome.ok,
      ...(outcome.ok ? {} : { error: outcome.output }),
      output_chars: outcome.output.length,
      duration_ms: outcome.duration_ms,
    });
    return {
      type: 'tool_result',
      tool_use_id: call.id,
      content: outcome.output,
      ...(outcome.ok ? {} : { is_error: true }),
    };
  };

  const execute = async (call: Anthropic.ToolUseBlock) => {
    const began = Date.now();
    const tool = byName.get(call.name);
    if (!tool) {
      return { ok: false, output: `Unknown tool: ${call.name}`, duration_ms: 0 };
    }
    try {
      let output = await tool.run(call.input as Record<string, unknown>);
      if (output.length > MAX_TOOL_OUTPUT_CHARS) {
        output =
          output.slice(0, MAX_TOOL_OUTPUT_CHARS) +
          `\n[output cut at ${MAX_TOOL_OUTPUT_CHARS} characters; ask for a narrower range]`;
      }
      return { ok: true, output, duration_ms: Date.now() - began };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, output: message, duration_ms: Date.now() - began };
    }
  };

  for (;;) {
    const response = await turn(true);
    if (response.stop_reason === 'refusal') return finish(textOf(response), 'refused');
    if (response.stop_reason === 'max_tokens') return finish(textOf(response), 'output_truncated');

    const calls = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    );
    if (calls.length === 0) return finish(textOf(response), 'completed');

    messages.push({ role: 'assistant', content: response.content });

    // Decide which calls may run. Every tool_use needs a tool_result, so
    // calls beyond a cap still get an answer: an error saying they were skipped.
    const overBudget = tokensUsed >= limits.maxTotalTokens;
    const room = overBudget ? 0 : Math.max(0, limits.maxSteps - steps.length);
    const capped: 'step_cap' | 'token_budget' | null = overBudget
      ? 'token_budget'
      : calls.length >= room
        ? 'step_cap'
        : null;

    const outcomes = await Promise.all(
      calls.map((call, i) =>
        i < room
          ? execute(call)
          : Promise.resolve({
              ok: false,
              output: `Not run: ${FINALIZE_NOTE[capped ?? 'step_cap']}`,
              duration_ms: 0,
            }),
      ),
    );
    // All results go back in ONE user message, in call order.
    const results: Anthropic.ContentBlockParam[] = calls.map((call, i) => record(call, outcomes[i]));

    if (capped) {
      results.push({
        type: 'text',
        text: `${FINALIZE_NOTE[capped]} No more tools are available. Give your final answer now from what you have, and say that the work was cut short.`,
      });
      messages.push({ role: 'user', content: results });
      const final = await turn(false);
      return finish(textOf(final), final.stop_reason === 'refusal' ? 'refused' : capped);
    }

    messages.push({ role: 'user', content: results });
  }
}
