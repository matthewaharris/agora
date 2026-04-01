---
id: S03
parent: M004
milestone: M004
provides:
  - LLM-powered summarization
  - Prompt injection defense pattern
requires:
  - slice: S01
    provides: Action spec trust pipeline
affects:
  []
key_files:
  - agents/research-agent/llm.ts
  - agents/research-agent/index.ts
key_decisions:
  - Hardened system prompt
  - No tools/function-calling
  - Graceful fallback
patterns_established:
  - Hardened system prompt pattern for LLM sandboxing
  - LLM with graceful fallback to deterministic behavior
observability_surfaces:
  - LLM call duration and token count logged
  - Model mode (LLM vs built-in) shown on startup
drill_down_paths:
  - .gsd/milestones/M004/slices/S03/tasks/T01-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-04-01T05:10:59.799Z
blocker_discovered: false
---

# S03: LLM-Powered Research Agent

**LLM-powered research agent with sandboxed system prompt and built-in fallback**

## What Happened

Integrated LLM-powered summarization into the research agent with a defense-in-depth approach: hardened system prompt prevents prompt injection, no tools or function calling limits the blast radius, and graceful fallback to built-in summaries ensures the demo works without an API key.

## Verification

LLM module exists with hardened prompt. Fallback logic works. Pushed to GitHub.

## Requirements Advanced

None.

## Requirements Validated

None.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

Used raw fetch instead of openai SDK to minimize dependencies.

## Known Limitations

Only OpenAI supported currently. Anthropic/Claude support would be a follow-up.

## Follow-ups

Add Anthropic Claude as alternative LLM provider.

## Files Created/Modified

- `agents/research-agent/llm.ts` — OpenAI chat completion with hardened system prompt
- `agents/research-agent/index.ts` — LLM integration with graceful fallback
- `agents/research-agent/.env.example` — Documents OPENAI_API_KEY and OPENAI_MODEL
