/**
 * Fleet LLM access — one Anthropic client, one global concurrency gate.
 *
 * A hundred residents share a single process and a single API key; the
 * semaphore is what keeps a burst of tasks from turning into a hundred
 * concurrent Anthropic calls. Protocol traffic is cheap — LLM calls are the
 * only resource worth queueing.
 */
import Anthropic from '@anthropic-ai/sdk';

const LLM_CONCURRENCY = Number(process.env.FLEET_LLM_CONCURRENCY || 3);

class Semaphore {
  private active = 0;
  private queue: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}

const gate = new Semaphore(LLM_CONCURRENCY);
let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) client = new Anthropic(); // reads ANTHROPIC_API_KEY
  return client;
}

export interface LLMResult {
  text: string;
  model: string;
  tokens_used: number;
  duration_ms: number;
}

/** Non-streaming completion through the fleet-wide concurrency gate. */
export async function complete(options: {
  model: string;
  system: string;
  user: string;
  maxTokens: number;
}): Promise<LLMResult> {
  return gate.run(async () => {
    const start = Date.now();
    const response = await getClient().messages.create(
      {
        model: options.model,
        max_tokens: options.maxTokens,
        system: options.system,
        messages: [{ role: 'user', content: options.user }],
      },
      { timeout: 90_000 },
    );
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();
    return {
      text,
      model: response.model,
      tokens_used: response.usage.input_tokens + response.usage.output_tokens,
      duration_ms: Date.now() - start,
    };
  });
}

/** Extract the first JSON object from LLM output (tolerates markdown fences). */
export function extractJSON(text: string): Record<string, unknown> | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}
