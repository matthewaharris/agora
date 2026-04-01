---
id: M004
title: "Trust, Docs & LLM — Agent Security Model, Developer Guide & Real Research"
status: complete
completed_at: 2026-04-01T05:13:56.827Z
key_decisions:
  - Capability-scoped execution boundaries (agents declare what they do)
  - Typed task_error codes for machine-readable rejections
  - Multi-model agent support (content types, model metadata, language tags)
  - Hardened system prompt for LLM sandboxing
  - Four-doc developer documentation structure
key_files:
  - packages/oacp-sdk/src/trust.ts
  - packages/oacp-sdk/src/agent.ts
  - packages/oacp-sdk/src/types.ts
  - agents/research-agent/llm.ts
  - agents/research-agent/index.ts
  - docs/getting-started.md
  - docs/security.md
  - docs/SKILL.md
  - docs/api-reference.md
lessons_learned:
  - Realtime subscriptions must be deferred until after register() — agentId is null before that
  - Action specs are more effective than input filtering for security — declare what you do, not what you block
  - Hardened system prompts work but are not foolproof — defense in depth (no tools + output validation) is essential
---

# M004: Trust, Docs & LLM — Agent Security Model, Developer Guide & Real Research

**Added agent trust model (action specs + allowlists), developer documentation suite, and LLM-powered research with prompt injection defense**

## What Happened

Built the trust, documentation, and LLM layers across 3 slices. S01 created the agent trust model with ActionSpec declarations, TrustPolicy sender allowlists, and a validated execution pipeline that runs automatically before handlers. Also added multi-model agent types (content types, model metadata, language tags). S02 produced four comprehensive docs: getting-started tutorial, security threat model, SKILL.md for AI agents, and API reference. S03 integrated OpenAI LLM with a hardened system prompt that prevents prompt injection, with graceful fallback to built-in summaries.

## Success Criteria Results

All 7 criteria met:\n1. ✅ Action specs declare operations\n2. ✅ Allowed senders configurable\n3. ✅ Payload validation before processing\n4. ✅ Out-of-scope requests rejected\n5. ✅ Developer guide for new developers\n6. ✅ LLM summarization with fallback\n7. ✅ Security documented with threat model

## Definition of Done Results

- ✅ Action spec schema defined and enforced in SDK\n- ✅ Allowed senders list configurable per agent\n- ✅ Task payload validation before handler execution\n- ✅ Developer guide with quickstart, SDK reference, security best practices\n- ✅ SKILL.md enables AI agents to build OACP agents\n- ✅ Research agent uses OpenAI for real summarization (with fallback)\n- ✅ Threat model covers 10 known attack vectors\n- ✅ All changes committed and pushed

## Requirement Outcomes

All M004 requirements met. Multi-model support and content type conventions added beyond original scope.

## Deviations

None.

## Follow-ups

None.
