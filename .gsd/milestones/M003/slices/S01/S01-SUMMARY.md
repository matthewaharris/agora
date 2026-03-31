---
id: S01
parent: M003
milestone: M003
provides:
  - Running research-agent for dashboard to observe
  - Running extraction-agent for dashboard to observe
  - npm run agent:research and agent:extraction scripts
requires:
  []
affects:
  - S02
  - S03
key_files:
  - agents/research-agent/index.ts
  - agents/extraction-agent/index.ts
key_decisions:
  - Zero LLM dependency for demo
  - Polling fallback for Realtime
  - Entity extraction is pattern-based
patterns_established:
  - Reference agent pattern: register → heartbeat → on() → process → send()
  - Polling fallback alongside Realtime for reliability
observability_surfaces:
  - Console logs with emoji markers for each lifecycle stage
  - Timing-aware processing simulation
drill_down_paths:
  - .gsd/milestones/M003/slices/S01/tasks/T01-SUMMARY.md
  - .gsd/milestones/M003/slices/S01/tasks/T02-SUMMARY.md
  - .gsd/milestones/M003/slices/S01/tasks/T03-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-03-31T21:22:47.080Z
blocker_discovered: false
---

# S01: Reference Agents — Research & Extraction Demo

**Built research-agent and extraction-agent implementing the full PRD Section 7 demo scenario**

## What Happened

Built both reference agents implementing the PRD Section 7 demo. Research-agent registers with 'research-summarization', listens for tasks, generates topic-aware summaries, and sends results back. Extraction-agent registers with 'data-extraction', discovers research agents, sends task requests, receives results, and extracts entities. Both agents have graceful shutdown, dotenv config, and polling fallback.

## Verification

Both agent scripts have correct structure. npm scripts wired up. Git commit succeeded.

## Requirements Advanced

- REQ-AGENT-01 — Research agent processes tasks and returns results

## Requirements Validated

None.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

Used built-in summary generation instead of LLM API for zero-dependency demo.

## Known Limitations

Summaries are pre-built (no LLM). Entity extraction is simple pattern matching.

## Follow-ups

Optional: add LLM integration (OpenAI/Anthropic) for production-quality research summaries.

## Files Created/Modified

- `agents/research-agent/index.ts` — Research agent with task processing and topic-aware summaries
- `agents/research-agent/package.json` — Research agent package with oacp-sdk file: dependency
- `agents/extraction-agent/index.ts` — Extraction agent with discovery, delegation, and entity extraction
- `agents/extraction-agent/package.json` — Extraction agent package
- `package.json` — Added agent:research and agent:extraction scripts
