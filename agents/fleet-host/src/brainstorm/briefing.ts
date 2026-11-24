/**
 * What the two brainstorming residents are told before they talk.
 *
 * Three sources, all read fresh each day:
 *   - the protocol's own documents (an outline, one entry per document)
 *   - who is on the network right now (the public directory)
 *   - earlier brainstorm issues and the owner's replies to them
 *
 * The second and third are written by other people and agents, so they are
 * passed to the model as quoted material, never as instructions.
 *
 * A fourth is optional: the owner's standing theme (see issues.ts). It comes
 * from the owner alone and sets the subject of the sessions.
 */
import type { AgentCard } from 'oacp-sdk';
import type { Chunk } from '../retrieval.js';
import type { PastIssue } from './issues.js';

const oneLine = (s: string, max: number): string => s.replace(/\s+/g, ' ').trim().slice(0, max);

/** One entry per document: its first section, shortened. */
export function protocolOutline(chunks: Chunk[], maxChars = 6000): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  let used = 0;
  for (const chunk of chunks) {
    if (seen.has(chunk.file)) continue;
    seen.add(chunk.file);
    const line = `- ${chunk.file} — ${chunk.heading}: ${oneLine(chunk.text, 320)}`;
    if (used + line.length > maxChars) break;
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join('\n');
}

/** The public directory, shortened to what matters for ideas. */
export function networkSnapshot(cards: AgentCard[], total: number, maxAgents = 40): string {
  const online = cards.filter((c) => c.status === 'online').length;
  const lines = [`${total} agent(s) registered; ${online} of the ${cards.length} listed here are online.`];
  for (const card of cards.slice(0, maxAgents)) {
    const actions = (card.metadata?.action_specs ?? []).map((a) => a.name).join(', ');
    lines.push(
      `- ${oneLine(card.name, 60)} [${card.status}] capabilities: ${card.capabilities.slice(0, 6).join(', ') || 'none'}` +
        (actions ? `; actions: ${oneLine(actions, 120)}` : '') +
        (card.description ? ` — ${oneLine(card.description, 140)}` : ''),
    );
  }
  return lines.join('\n');
}

/** Earlier issues: what was proposed, and what the owner said about it. */
export function historyText(issues: PastIssue[], maxChars = 4000): string {
  if (issues.length === 0) return 'No earlier brainstorms.';
  const blocks: string[] = [];
  let used = 0;
  for (const issue of issues) {
    const proposals = [...issue.body.matchAll(/^### \d+\. (.+)$/gm)].map((m) => m[1].trim());
    const dropped = [...issue.body.matchAll(/^- \*\*(.+?)\*\*/gm)].map((m) => m[1].trim());
    const lines = [oneLine(issue.title, 160)];
    for (const p of proposals) lines.push(`  proposed: ${oneLine(p, 140)}`);
    for (const d of dropped) lines.push(`  dropped: ${oneLine(d, 140)}`);
    for (const reply of issue.ownerReplies) lines.push(`  owner replied: ${oneLine(reply, 500)}`);
    const block = lines.join('\n');
    if (used + block.length > maxChars) break;
    blocks.push(block);
    used += block.length + 1;
  }
  return blocks.join('\n');
}

export function buildBriefing(parts: { outline: string; snapshot: string; history: string; theme?: string | null }): string {
  const theme = parts.theme?.trim();
  return [
    'Liteneen is the public reference network for OACP, the Open Agent Communication Protocol. Agents register in its registry, find each other in a public directory, and exchange signed messages. Its owner, Matt, runs it and decides what gets built.',
    ...(theme ? ['', '<owner_theme>', theme, '</owner_theme>'] : []),
    '',
    '<protocol_documents>',
    parts.outline,
    '</protocol_documents>',
    '',
    '<network_directory>',
    parts.snapshot,
    '</network_directory>',
    '',
    '<earlier_brainstorms>',
    parts.history,
    '</earlier_brainstorms>',
  ].join('\n');
}
