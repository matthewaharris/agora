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
import { TrajectoryUnavailableError, type Recorder } from './trajectory.js';

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
  | 'refused' // the model declined
  | 'trajectory_unavailable'; // the run could not be recorded, so it was stopped

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

export type ModelCall = (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>;

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
  /** When given, every step is written to the trajectory as it happens. */
  recorder?: Recorder;
  /** Short human-readable name for this run in the trajectory, e.g. what is being reviewed. */
  label?: string;
}): Promise<AgentRun> {
  const { model, system, tools, limits, callModel, recorder } = options;
  const start = Date.now();
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const toolParams: Anthropic.Tool[] = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }));

  // Written before any model call. If a required store is down this throws,
  // and the run is refused before it has cost anything.
  await recorder?.record(
    'run.started',
    {
      ...(options.label ? { label: options.label } : {}),
      'gen_ai.request.model': model,
      limits,
      tool_names: tools.map((tool) => tool.name),
    },
    {
      system,
      user: options.user,
      tools: tools.map(({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema,
      })),
    },
  );

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: options.user }];
  const steps: StepRecord[] = [];
  let tokensUsed = 0;
  let modelTurns = 0;
  let servedModel = model;

  const turn = async (allowTools: boolean): Promise<Anthropic.Message> => {
    const began = Date.now();
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
    await recorder?.record(
      'model.turn',
      {
        turn: modelTurns,
        duration_ms: Date.now() - began,
        tools_allowed: allowTools,
        messages_sent: messages.length,
        'gen_ai.response.model': response.model,
        'gen_ai.response.finish_reasons': [response.stop_reason],
        'gen_ai.usage.input_tokens': response.usage.input_tokens,
        'gen_ai.usage.output_tokens': response.usage.output_tokens,
        tokens_this_turn: turnTokens(response.usage),
        tokens_so_far: tokensUsed,
      },
      { response: response.content },
    );
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
      return {
        ok: false,
        output: `Unknown tool: ${call.name}`,
        duration_ms: 0,
      };
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

  const loop = async (): Promise<AgentRun> => {
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
      for (const [i, call] of calls.entries()) {
        await recorder?.record(
          'tool.call',
          {
            step: steps.length - calls.length + i + 1,
            'gen_ai.tool.name': call.name,
            'gen_ai.tool.call.id': call.id,
            input: call.input,
            ok: outcomes[i].ok,
            skipped: i >= room,
            duration_ms: outcomes[i].duration_ms,
            output_chars: outcomes[i].output.length,
          },
          { output: outcomes[i].output },
        );
      }

      if (capped) {
        await recorder?.record('limit.hit', {
          limit: capped,
          steps: steps.length,
          tokens_so_far: tokensUsed,
        });
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
  };

  let run: AgentRun;
  try {
    run = await loop();
  } catch (err) {
    if (!(err instanceof TrajectoryUnavailableError)) throw err;
    // The store failed part-way. Work that cannot be recorded is not continued.
    return finish('', 'trajectory_unavailable');
  }
  try {
    await recorder?.record(
      'run.ended',
      {
        stop_reason: run.stopReason,
        model_turns: run.modelTurns,
        tool_calls: run.steps.length,
        tokens_used: run.tokens_used,
        duration_ms: run.duration_ms,
      },
      { text: run.text },
    );
  } catch (err) {
    if (!(err instanceof TrajectoryUnavailableError)) throw err;
    return { ...run, stopReason: 'trajectory_unavailable' };
  }
  return run;
}
