/**
 * Lexical retrieval over a markdown corpus — deliberately embedding-free.
 *
 * v1 constraint: retrieval must be deterministic and dependency-light so a
 * cited passage can be re-derived exactly (its sha256 digest is committed in
 * an RFC 007 assertion). Chunks are heading-scoped sections capped at
 * ~1500 chars; scoring is keyword overlap with a title boost.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface Chunk {
  /** Corpus-relative file path, e.g. "docs/rfc/001-...md". */
  file: string;
  /** The heading the passage sits under. */
  heading: string;
  text: string;
}

export interface Hit {
  chunk: Chunk;
  score: number;
  /** Unique query terms found in the chunk (body or heading). */
  matched: string[];
}

const MAX_CHUNK_CHARS = 1500;

const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'her', 'was',
  'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how', 'its', 'may',
  'new', 'now', 'old', 'see', 'two', 'way', 'who', 'did', 'yes', 'with',
  'this', 'that', 'from', 'they', 'been', 'have', 'were', 'what', 'when',
  'where', 'which', 'while', 'will', 'would', 'could', 'should', 'does', 'why',
  'about', 'after', 'again', 'also', 'any', 'because', 'before', 'between',
  'both', 'each', 'few', 'more', 'most', 'other', 'over', 'same', 'some',
  'such', 'than', 'then', 'there', 'these', 'those', 'through', 'under',
  'until', 'very', 'into', 'only', 'own', 'too', 'just', 'don', 'doesn',
  'them', 'their', 'your', 'ours', 'mine', 'itself', 'being', 'a', 'an', 'is',
  'it', 'in', 'on', 'of', 'to', 'as', 'at', 'by', 'or', 'be', 'do', 'if',
  'me', 'my', 'no', 'so', 'up', 'us', 'we', 'he', 'she', 'i',
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

/** Split one markdown document into heading-scoped chunks of ≤~1500 chars. */
export function chunkMarkdown(file: string, content: string): Chunk[] {
  const chunks: Chunk[] = [];
  const lines = content.split('\n');
  let heading = path.basename(file);
  let buffer: string[] = [];

  const flush = () => {
    const text = buffer.join('\n').trim();
    buffer = [];
    if (!text) return;
    // Long sections split at paragraph boundaries, same heading throughout —
    // a citation names the section, not our internal chunk arithmetic.
    if (text.length <= MAX_CHUNK_CHARS) {
      chunks.push({ file, heading, text });
      return;
    }
    let part = '';
    for (const para of text.split(/\n\n+/)) {
      if (part && part.length + para.length + 2 > MAX_CHUNK_CHARS) {
        chunks.push({ file, heading, text: part.trim() });
        part = '';
      }
      part += (part ? '\n\n' : '') + para;
    }
    if (part.trim()) chunks.push({ file, heading, text: part.trim() });
  };

  for (const line of lines) {
    const match = line.match(/^#{1,3}\s+(.+?)\s*$/);
    if (match) {
      flush();
      heading = match[1];
    } else {
      buffer.push(line);
    }
  }
  flush();
  return chunks;
}

/** Load and chunk a corpus. Paths are relative to rootDir; directories are
 * expanded to their .md files (sorted, deterministic). */
export function loadCorpus(rootDir: string, paths: string[]): Chunk[] {
  const files: string[] = [];
  for (const rel of paths) {
    const abs = path.resolve(rootDir, rel);
    if (fs.statSync(abs).isDirectory()) {
      for (const entry of fs.readdirSync(abs).sort()) {
        if (entry.endsWith('.md')) files.push(path.join(rel, entry));
      }
    } else {
      files.push(rel);
    }
  }
  return files.flatMap((rel) =>
    chunkMarkdown(rel, fs.readFileSync(path.resolve(rootDir, rel), 'utf8')),
  );
}

/**
 * Rank chunks against a question: per unique query term, occurrences in the
 * body count (capped at 3 — saturation, not spam), a heading match counts 3.
 * Chunks matching fewer than two distinct terms (one, for one-term queries)
 * are dropped — that floor is the out-of-corpus refusal boundary.
 */
export function retrieve(chunks: Chunk[], question: string, k = 4): Hit[] {
  const terms = [...new Set(tokenize(question))];
  if (terms.length === 0) return [];
  const minMatched = Math.min(2, terms.length);

  const hits: Hit[] = [];
  for (const chunk of chunks) {
    const bodyCounts = new Map<string, number>();
    for (const token of tokenize(chunk.text)) {
      bodyCounts.set(token, (bodyCounts.get(token) ?? 0) + 1);
    }
    const headingTokens = new Set(tokenize(chunk.heading));

    let score = 0;
    const matched: string[] = [];
    for (const term of terms) {
      const inBody = Math.min(bodyCounts.get(term) ?? 0, 3);
      const inHeading = headingTokens.has(term) ? 3 : 0;
      if (inBody + inHeading > 0) matched.push(term);
      score += inBody + inHeading;
    }
    if (matched.length >= minMatched) hits.push({ chunk, score, matched });
  }

  hits.sort(
    (a, b) =>
      b.score - a.score ||
      a.chunk.file.localeCompare(b.chunk.file) ||
      a.chunk.heading.localeCompare(b.chunk.heading),
  );
  return hits.slice(0, k);
}
