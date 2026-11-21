/**
 * The daily brainstorm: a short, bounded conversation between two residents.
 *
 *   ideator ──idea──▶ builder ──practical reply──▶ ideator … then a summary
 *
 * This file is the conversation's rules and nothing else: who speaks when,
 * when it must stop, and how the result is laid out for a person. It makes no
 * model or network calls itself; the callers supply those, which is also how
 * the tests run it.
 *
 * Two limits always apply: a fixed number of turns each, and a token budget
 * for the whole session. Whichever is reached first ends the conversation.
 */

export type Speaker = 'ideator' | 'builder';

export interface Turn {
  speaker: Speaker;
  text: string;
  tokens: number;
}

export interface Proposal {
  title: string;
  what: string;
  why_agents_care: string;
  smallest_test: string;
  effort: string;
  touches: string;
}

export interface Summary {
  headline: string;
  proposals: Proposal[];
  dropped: Array<{ idea: string; reason: string }>;
  question_for_owner: string;
}

export interface SessionLimits {
  turnsEach: number;
  tokenBudget: number;
}

export interface SessionDeps {
  ideate(transcript: readonly Turn[]): Promise<{ text: string; tokens: number }>;
  build(transcript: readonly Turn[]): Promise<{ text: string; tokens: number }>;
  summarize(transcript: readonly Turn[]): Promise<{ summary: Summary; tokens: number }>;
}

export interface SessionResult {
  transcript: Turn[];
  summary: Summary;
  tokens: number;
  /** 'budget' when the token budget ended the conversation before its last turn. */
  stopped: 'completed' | 'budget';
}

export const MIN_TURNS = 3;
export const MAX_TURNS = 5;
export const DEFAULT_TURNS = 4;
export const DEFAULT_TOKEN_BUDGET = 100_000;

/** Turns each, from a setting: 3 to 5, default 4. */
export function clampTurns(value: string | number | undefined): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TURNS;
  return Math.min(MAX_TURNS, Math.max(MIN_TURNS, n));
}

/** Whole-session token budget, from a setting. Never unlimited. */
export function tokenBudgetFrom(value: string | number | undefined): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 10_000 ? n : DEFAULT_TOKEN_BUDGET;
}

export async function runSession(deps: SessionDeps, limits: SessionLimits): Promise<SessionResult> {
  const transcript: Turn[] = [];
  let tokens = 0;
  let stopped: SessionResult['stopped'] = 'completed';

  const speak = async (speaker: Speaker): Promise<boolean> => {
    if (tokens >= limits.tokenBudget) {
      stopped = 'budget';
      return false;
    }
    const turn = await (speaker === 'ideator' ? deps.ideate(transcript) : deps.build(transcript));
    tokens += turn.tokens;
    // An empty turn means a call went wrong. Carrying on would spend the rest
    // of the budget on a conversation with nothing in it.
    if (!turn.text.trim()) throw new Error(`the ${speaker} returned an empty turn`);
    transcript.push({ speaker, text: turn.text.trim(), tokens: turn.tokens });
    return true;
  };

  for (let round = 0; round < limits.turnsEach; round++) {
    if (!(await speak('ideator'))) break;
    if (!(await speak('builder'))) break;
  }

  // The summary is the point of the session, so it runs even when the budget
  // cut the conversation short. It is one call of known size.
  const { summary, tokens: summaryTokens } = await deps.summarize(transcript);
  return { transcript, summary, tokens: tokens + summaryTokens, stopped };
}

// ── Reading the summary the model wrote ───────────────────────────────────

const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

/** Turn the builder's JSON into a Summary. Missing or malformed parts become empty, never invented. */
export function parseSummary(raw: Record<string, unknown> | null): Summary {
  const list = (value: unknown): Record<string, unknown>[] =>
    Array.isArray(value) ? value.filter((v): v is Record<string, unknown> => !!v && typeof v === 'object') : [];
  return {
    headline: text(raw?.headline, 90) || 'No clear proposal today',
    proposals: list(raw?.proposals)
      .slice(0, 3)
      .map((p) => ({
        title: text(p.title, 120),
        what: text(p.what, 800),
        why_agents_care: text(p.why_agents_care, 600),
        smallest_test: text(p.smallest_test, 600),
        effort: text(p.effort, 40),
        touches: text(p.touches, 300),
      }))
      .filter((p) => p.title && p.what),
    dropped: list(raw?.dropped)
      .slice(0, 5)
      .map((d) => ({ idea: text(d.idea, 200), reason: text(d.reason, 300) }))
      .filter((d) => d.idea),
    question_for_owner: text(raw?.question_for_owner, 400),
  };
}

// ── Laying the result out as a GitHub issue ───────────────────────────────

export const TITLE_PREFIX = 'Daily brainstorm';

export function issueTitle(date: string, headline: string): string {
  return `${TITLE_PREFIX} ${date}: ${headline}`;
}

export interface IssueMeta {
  date: string;
  model: string;
  turnsEach: number;
  traceId?: string;
}

export function renderIssue(result: SessionResult, meta: IssueMeta): { title: string; body: string } {
  const { summary, transcript } = result;
  const lines: string[] = [];

  if (summary.proposals.length === 0) {
    lines.push('No proposal survived today\'s conversation. The transcript is below.', '');
  }
  summary.proposals.forEach((p, i) => {
    lines.push(`### ${i + 1}. ${p.title}`, '', p.what, '');
    if (p.why_agents_care) lines.push(`**Why agents would care:** ${p.why_agents_care}`, '');
    if (p.smallest_test) lines.push(`**Smallest test:** ${p.smallest_test}`, '');
    if (p.effort) lines.push(`**Effort:** ${p.effort}`, '');
    if (p.touches) lines.push(`**Touches:** ${p.touches}`, '');
  });

  if (summary.dropped.length > 0) {
    lines.push('### Considered and dropped', '');
    for (const d of summary.dropped) lines.push(`- **${d.idea}**${d.reason ? `: ${d.reason}` : ''}`);
    lines.push('');
  }
  if (summary.question_for_owner) {
    lines.push('### Question for you', '', summary.question_for_owner, '');
  }

  lines.push(
    '---',
    '',
    'Reply on this issue to accept, decline or redirect. Tomorrow\'s conversation reads your replies and will not repeat ideas listed here.',
    'Nothing has been changed on the network. These are proposals only.',
    '',
    '<details><summary>Transcript</summary>',
    '',
  );
  for (const turn of transcript) {
    lines.push(`**${turn.speaker === 'ideator' ? 'Ideator' : 'Builder'}:** ${turn.text}`, '');
  }
  lines.push('</details>', '');

  const turnsTaken = transcript.length;
  lines.push(
    `<sub>${turnsTaken} turn(s), ${result.tokens.toLocaleString('en-US')} tokens, ${meta.model}` +
      (result.stopped === 'budget' ? ', ended early by the token budget' : '') +
      (meta.traceId ? `, trace ${meta.traceId}` : '') +
      '</sub>',
  );

  return { title: issueTitle(meta.date, summary.headline), body: lines.join('\n') };
}

// ── When to run ───────────────────────────────────────────────────────────

export function utcDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Hour of the day (UTC) from a setting, default 15. */
export function hourFrom(value: string | number | undefined): number {
  const n = Math.floor(Number(value));
  return value !== undefined && value !== '' && Number.isFinite(n) && n >= 0 && n <= 23 ? n : 15;
}

export const MAX_ATTEMPTS_PER_DAY = 2;

/**
 * Whether to start a session now. One per UTC day, at or after the set hour,
 * and at most two attempts on a day when attempts fail.
 */
export function isDue(
  now: Date,
  hourUtc: number,
  state: { doneDate: string | null; attemptDate: string | null; attempts: number },
): boolean {
  const today = utcDate(now);
  if (state.doneDate === today) return false;
  if (now.getUTCHours() < hourUtc) return false;
  if (state.attemptDate === today && state.attempts >= MAX_ATTEMPTS_PER_DAY) return false;
  return true;
}
