/**
 * Read-only GitHub tools for the agent harness.
 *
 * Every tool is bound, by closure, to ONE repository and ONE commit chosen by
 * the resident. The model supplies only a path or a search phrase, so text in
 * a pull request cannot point the agent at a different repository.
 *
 * Tool output is file content written by strangers. It is wrapped in tags and
 * the resident's system prompt tells the model to treat it as data.
 */
import type { AgentTool } from './harness.js';

const LINES_PER_READ = 300;
const MAX_SEARCH_RESULTS = 10;

export interface RepoRef {
  owner: string;
  repo: string;
  /** Commit SHA the tools read from (the PR's head commit). */
  sha: string;
}

function cleanPath(raw: unknown): string {
  if (typeof raw !== 'string') throw new Error('path must be a string');
  const path = raw.trim().replace(/^\.\//, '').replace(/\/+$/, '');
  if (path.length > 300) throw new Error('path is too long');
  if (path.startsWith('/')) throw new Error('path must be relative to the repository root');
  if (path.split('/').some((part) => part === '..')) throw new Error('path must not contain ".."');
  return path;
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

export function createGithubReadTools(ref: RepoRef, githubToken?: string): AgentTool[] {
  const base = `https://api.github.com/repos/${ref.owner}/${ref.repo}`;

  const get = async (url: string, accept: string): Promise<Response> => {
    const headers: Record<string, string> = { 'User-Agent': 'oacp-pr-review-agent', Accept: accept };
    if (githubToken) headers['Authorization'] = `Bearer ${githubToken}`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
    if (res.status === 404) throw new Error('Not found at this commit');
    if (res.status === 403 || res.status === 429) {
      throw new Error('GitHub rate limit reached; no more repository reads are possible right now');
    }
    if (!res.ok) throw new Error(`GitHub API error (${res.status})`);
    return res;
  };

  const readFile: AgentTool = {
    name: 'read_file',
    description:
      `Read a file from the repository at the pull request's head commit. Returns up to ${LINES_PER_READ} numbered lines starting at start_line. ` +
      'Use it to check how changed code is defined or used outside the diff.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to the repository root, e.g. src/auth/session.ts' },
        start_line: { type: 'integer', description: 'First line to return (1-based). Defaults to 1.' },
      },
      required: ['path'],
    },
    run: async (input) => {
      const path = cleanPath(input.path);
      if (!path) throw new Error('path is required');
      const startLine = Math.max(1, Math.floor(Number(input.start_line ?? 1)) || 1);
      const res = await get(`${base}/contents/${encodePath(path)}?ref=${ref.sha}`, 'application/vnd.github.raw+json');
      const lines = (await res.text()).split('\n');
      if (startLine > lines.length) throw new Error(`File has only ${lines.length} lines`);
      const slice = lines.slice(startLine - 1, startLine - 1 + LINES_PER_READ);
      const lastLine = startLine + slice.length - 1;
      const numbered = slice.map((line, i) => `${startLine + i}\t${line}`).join('\n');
      const more =
        lastLine < lines.length
          ? `\n[lines ${startLine}-${lastLine} of ${lines.length}; call again with start_line=${lastLine + 1} for more]`
          : '';
      return `<file_content path="${path}">\n${numbered}\n</file_content>${more}`;
    },
  };

  const listDirectory: AgentTool = {
    name: 'list_directory',
    description:
      "List the files and folders in a repository directory at the pull request's head commit. Use an empty path for the repository root.",
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path relative to the repository root; "" for the root' },
      },
      required: ['path'],
    },
    run: async (input) => {
      const path = cleanPath(input.path);
      const res = await get(`${base}/contents/${encodePath(path)}?ref=${ref.sha}`, 'application/vnd.github+json');
      const body = (await res.json()) as unknown;
      if (!Array.isArray(body)) throw new Error('That path is a file, not a directory; use read_file');
      const entries = (body as Array<{ name: string; type: string; size: number }>)
        .map((entry) => (entry.type === 'dir' ? `${entry.name}/` : `${entry.name} (${entry.size} bytes)`))
        .join('\n');
      return `<directory_listing path="${path || '/'}">\n${entries}\n</directory_listing>`;
    },
  };

  const tools = [readFile, listDirectory];

  // GitHub's code search needs authentication, so the tool only exists when
  // the owner has configured a token.
  if (githubToken) {
    tools.push({
      name: 'search_code',
      description:
        "Search this repository's code for a word or phrase, e.g. a function name. Searches the DEFAULT branch, so results may not include code added by this pull request. Returns matching file paths with short excerpts.",
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Word or phrase to search for' },
        },
        required: ['query'],
      },
      run: async (input) => {
        if (typeof input.query !== 'string') throw new Error('query must be a string');
        // Drop search qualifiers so the model cannot widen the search beyond this repository.
        const query = input.query.replace(/\b\w+:\S+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
        if (!query) throw new Error('query is empty');
        const q = encodeURIComponent(`${query} repo:${ref.owner}/${ref.repo}`);
        const res = await get(
          `https://api.github.com/search/code?q=${q}&per_page=${MAX_SEARCH_RESULTS}`,
          'application/vnd.github.text-match+json',
        );
        const body = (await res.json()) as {
          total_count: number;
          items: Array<{ path: string; text_matches?: Array<{ fragment: string }> }>;
        };
        if (body.items.length === 0) return `No matches for "${query}" on the default branch.`;
        const hits = body.items
          .map((item) => {
            const fragment = item.text_matches?.[0]?.fragment?.trim().slice(0, 300) ?? '';
            return `${item.path}\n${fragment}`;
          })
          .join('\n---\n');
        return `<search_results query="${query}" shown="${body.items.length}" total="${body.total_count}">\n${hits}\n</search_results>`;
      },
    });
  }

  return tools;
}
