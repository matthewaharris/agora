/**
 * The brainstorm's GitHub side: read earlier issues, open today's.
 *
 * Uses a token that should be limited to Issues (read and write) on the one
 * repository named in BRAINSTORM_GITHUB_REPO.
 */
import { TITLE_PREFIX } from './session.js';

export interface PastIssue {
  number: number;
  title: string;
  body: string;
  created_at: string;
  /** Comments written by the repository's owner. */
  ownerReplies: string[];
}

export interface IssueTracker {
  /** Recent brainstorm issues, newest first. Throws when GitHub cannot be read. */
  recent(limit: number): Promise<PastIssue[]>;
  create(title: string, body: string): Promise<{ number: number; url: string }>;
}

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function isValidRepo(value: string | undefined): value is string {
  return !!value && REPO.test(value);
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export function githubIssues(options: { repo: string; token: string; fetch?: FetchLike }): IssueTracker {
  const { repo, token } = options;
  const call = options.fetch ?? fetch;
  const api = `https://api.github.com/repos/${repo}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'oacp-fleet-host',
    'Content-Type': 'application/json',
  };

  const request = async (url: string, init?: RequestInit): Promise<unknown> => {
    const res = await call(url, { ...init, headers });
    // Status only: an error body must never carry a credential into the logs.
    if (!res.ok) throw new Error(`GitHub ${init?.method ?? 'GET'} ${new URL(url).pathname} failed (${res.status})`);
    return res.json();
  };

  return {
    async recent(limit) {
      const rows = (await request(
        `${api}/issues?state=all&sort=created&direction=desc&per_page=30`,
      )) as Array<Record<string, unknown>>;
      const issues = rows
        .filter((r) => !r.pull_request && String(r.title ?? '').startsWith(TITLE_PREFIX))
        .slice(0, limit);
      const out: PastIssue[] = [];
      for (const r of issues) {
        let ownerReplies: string[] = [];
        if (Number(r.comments) > 0) {
          const comments = (await request(
            `${api}/issues/${r.number}/comments?per_page=20`,
          )) as Array<Record<string, unknown>>;
          ownerReplies = comments
            .filter((c) => c.author_association === 'OWNER')
            .map((c) => String(c.body ?? ''));
        }
        out.push({
          number: Number(r.number),
          title: String(r.title ?? ''),
          body: String(r.body ?? ''),
          created_at: String(r.created_at ?? ''),
          ownerReplies,
        });
      }
      return out;
    },
    async create(title, body) {
      const created = (await request(`${api}/issues`, {
        method: 'POST',
        body: JSON.stringify({ title, body }),
      })) as Record<string, unknown>;
      return { number: Number(created.number), url: String(created.html_url ?? '') };
    },
  };
}
