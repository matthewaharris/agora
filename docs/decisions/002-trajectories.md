# Decision 002 — Trajectories

**Date:** 2026-11-10 · **Phase:** 2 (Trajectories) · **Status:** accepted
**Decided by:** Matthew. His reasoning is quoted under each decision.

## Context

After phase 1, a run's steps exist only in the memory of the process that ran it. They are
returned with the result and then lost. A crashed run leaves nothing. Two capped runs of the same
review took different paths, and only the printed output showed it.

A trajectory is the ordered record of one run: every model turn, tool call, limit and policy
decision, written as it happens and never changed. Debugging, replay and evals all read it.

## Decisions

### 1. Content: stored in full, with an expiry

Each event has two parts. `attrs` holds small measured facts (tool name, input, timing, token
counts) and is kept. `content` holds what was said (prompts, model output, tool results) and is
deleted after an expiry, leaving the attrs.

- **Matthew's reasoning:** keep the full context of every run, and give users peace of mind that
  it is not held long term.
- Replay and evals need the content. Without it a failure cannot be reproduced. Which run will
  need debugging is not known in advance, so all of them are kept for the window in which
  problems surface.
- Content can be other people's code: public repository files for `review-pr`, pasted private
  diffs for `review-diff`. An expiry bounds how long the platform holds it.
- **Rejected:** metadata only (no replay), and full content kept forever.
- **Not yet decided:** the expiry length, and whether `review-diff` content is stored at all.

### 2. Trace context across agents: cleartext by default, sealable

When one agent's run sends an OACP message, the receiving agent's run should join the same
trace. The trace ID travels in the cleartext envelope by default, so the registry and observers
can link the runs. A sender can choose to carry it inside the sealed payload instead, so only the
two agents can link them.

- **Matthew's reasoning:** open by default, with privacy available to those who want it, as
  Venmo does with transactions. Caution from that same example: most people never change a
  default, so the default must be defensible on its own.
- It is defensible here because the trace ID reveals only that two runs are linked, not what
  they said. Cleartext fits OACP's position that agent traffic is observable. Sealing covers the case where
  who is working with whom is itself sensitive.
- Rule that follows: a receiver that got the trace context sealed must not repeat it in cleartext
  on its replies or onward messages. Otherwise one hop undoes the sender's choice.
- **Rejected:** deferring cross-agent linking entirely.
- **Not built yet.** This changes the wire format, so it needs an RFC in the oacp repo. The
  recorder already accepts an incoming trace ID and parent run ID.

### 3. Store failure: stop the run by default, buffering as an option

If the trajectory store cannot be written, the default is to stop: a run that cannot be recorded
does not continue. An agent's owner can set that agent to `buffered`, which keeps running and
holds events in memory until the store returns.

- **Matthew's reasoning:** the point of the platform is to record agent work and be able to
  replay it.
- An unrecorded run is worse than no run: it cannot be audited, disputed, debugged or costed, and
  a refusal is visible where a missing record is not.
- Store down at the start: the run is refused before any model call, so it costs nothing.
- Store fails part-way: no further model turn or tool call starts. The run ends with
  `stop_reason: trajectory_unavailable`.
- `buffered` holds at most 500 events and reports how many were never saved. They are lost if
  the process dies first.
- The mode is set by the agent's owner, per agent. A sender cannot ask for it.
- **Rejected:** running anyway and dropping events silently.

### 4. Where the store lives: a separate database owned by the fleet host

Decided 2026-11-11. Trajectories go in their own Supabase project, not the registry's.

- The registry was deliberately built as "a notary, not a vault"
  (`20260803000000_assertions_disputes.sql`): it holds digests, not evidence. Full-content
  trajectories are evidence, and they belong to the agent's owner, not to the registry.
- The fleet host keeps reaching the registry with the public anon key only. Its new credential
  (`TRAJECTORY_DB_URL`, `TRAJECTORY_DB_KEY`) opens the trajectory database and nothing else.
- Append-only is enforced by a database trigger, so it holds for the service role too: no deletes,
  and the only update allowed is clearing `content`.
- Content is cleared 30 days after the event by default (`TRAJECTORY_CONTENT_DAYS`). The length
  is a placeholder until decision 1's open point is settled.
- **Rejected:** a separate schema in the registry's project (the registry's database would then
  hold other people's code), and files on the host (Render's disk is wiped on every deploy).

With no store configured, runs are not recorded, so the deployed fleet host behaves as before.

## What was built

- `runtime/trajectory.ts`: event shape, recorder with the two failure modes, the two stores, and
  replay tools that answer from a recording and refuse any call the recording never saw.
- `runtime/trajectory.ts` `postgresStore` and `db/001_trajectory_events.sql`: the database store,
  the table, the append-only trigger and the daily content-expiry job.
- `runtime/harness.ts`: emits `run.started`, `model.turn`, `tool.call`, `limit.hit`, `run.ended`.
- `residents/pr-review.ts`: emits `policy.applied`; returns `run_id` and `trace_id`.
- `scripts/replay-run.mjs`: re-runs the live model against a recorded run's tool results.
- Attribute names follow the OpenTelemetry GenAI conventions where one exists (`gen_ai.*`).

## Still to do in this phase

- Create the trajectory project, apply `agents/fleet-host/db/001_trajectory_events.sql`, and do a
  live run against it. The store and SQL are written and tested locally, not yet against Supabase.
- The trace-context RFC and SDK change (decision 2).
- The trajectory timeline view in the dashboard.
