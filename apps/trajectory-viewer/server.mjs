/**
 * Trajectory viewer — a local page for reading recorded agent runs.
 *
 * This is the agent OWNER's view, not part of the public dashboard. It reads
 * the fleet host's trajectory database with that database's service-role key,
 * so the key stays in this process and the page is served on this machine
 * only (127.0.0.1). Do not deploy it.
 *
 * Run (from the repo root; needs TRAJECTORY_DB_URL and TRAJECTORY_DB_KEY in .env):
 *   node apps/trajectory-viewer/server.mjs
 * then open http://127.0.0.1:4317
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const HERE = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(HERE, '../../.env') });

const PORT = Number(process.env.PORT || process.env.TRAJECTORY_VIEWER_PORT || 4317);
const DB_URL = (process.env.TRAJECTORY_DB_URL || '').replace(/\/+$/, '');
const DB_KEY = process.env.TRAJECTORY_DB_KEY || '';

async function query(params) {
  if (!DB_URL || !DB_KEY) {
    throw Object.assign(new Error('TRAJECTORY_DB_URL and TRAJECTORY_DB_KEY are not set in .env'), { status: 503 });
  }
  const res = await fetch(`${DB_URL}/rest/v1/trajectory_events?${params}`, {
    headers: { apikey: DB_KEY, Authorization: `Bearer ${DB_KEY}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw Object.assign(new Error(`Trajectory database answered ${res.status}`), { status: 502 });
  return res.json();
}

/** One summary row per run, newest first, built from the events that carry run-level facts. */
async function listRuns() {
  const rows = await query(
    'select=run_id,trace_id,ts,type,attrs&type=in.(run.started,run.ended,policy.applied)&order=ts.desc&limit=900',
  );
  const runs = new Map();
  for (const row of rows) {
    const run = runs.get(row.run_id) ?? { run_id: row.run_id, trace_id: row.trace_id, ended: false };
    const a = row.attrs ?? {};
    if (row.type === 'run.started') {
      Object.assign(run, { started_at: row.ts, label: a.label ?? null, model: a['gen_ai.request.model'] ?? null });
    } else if (row.type === 'run.ended') {
      Object.assign(run, {
        ended: true,
        stop_reason: a.stop_reason,
        tool_calls: a.tool_calls,
        model_turns: a.model_turns,
        tokens_used: a.tokens_used,
        duration_ms: a.duration_ms,
      });
    } else {
      Object.assign(run, { verdict: a.verdict, verdict_reported: a.verdict_reported, verdict_changed: a.changed });
    }
    runs.set(row.run_id, run);
  }
  return [...runs.values()]
    .filter((run) => run.started_at)
    .sort((a, b) => (a.started_at < b.started_at ? 1 : -1));
}

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

const server = createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (req.method !== 'GET') return json(res, 405, { error: 'Read-only' });

    if (pathname === '/api/runs') return json(res, 200, await listRuns());

    const match = pathname.match(/^\/api\/runs\/([0-9a-f-]{36})$/i);
    if (match) return json(res, 200, await query(`run_id=eq.${match[1]}&order=seq`));

    if (pathname === '/') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        // Recorded content is other people's text. The page only ever inserts it as text, and
        // this policy means that even a mistake there could not run or load anything.
        'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'",
      });
      return res.end(await readFile(join(HERE, 'index.html')));
    }
    json(res, 404, { error: 'Not found' });
  } catch (err) {
    json(res, err.status ?? 500, { error: err.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Trajectory viewer: http://127.0.0.1:${PORT}`);
  if (!DB_URL || !DB_KEY) console.log('Warning: TRAJECTORY_DB_URL / TRAJECTORY_DB_KEY are not set; the page will show an error.');
});
