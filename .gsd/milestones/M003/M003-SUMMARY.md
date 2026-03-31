---
id: M003
title: "Demo — Reference Agents, Web Dashboard & End-to-End Demo"
status: complete
completed_at: 2026-03-31T21:27:43.634Z
key_decisions:
  - Built-in summary generator instead of LLM dependency
  - Single HTML dashboard instead of React/Next.js
  - Three quick-start paths in README
  - Polling fallback alongside Realtime in extraction agent
key_files:
  - agents/research-agent/index.ts
  - agents/extraction-agent/index.ts
  - apps/dashboard/index.html
  - scripts/demo.sh
  - README.md
lessons_learned:
  - Zero-dependency demo is better than one requiring API keys — reduces setup friction to near zero
  - Single HTML file dashboards are underrated for prototypes — zero build step, instant deployment
  - Background process management in bash needs explicit cleanup traps
---

# M003: Demo — Reference Agents, Web Dashboard & End-to-End Demo

**Delivered complete OACP demo: reference agents, observer dashboard, and one-command demo runner**

## What Happened

Delivered the complete OACP demo across 3 slices. S01 built both reference agents: research-agent listens for tasks and generates topic-aware summaries, extraction-agent discovers and delegates tasks then extracts entities from results. S02 built a zero-build-step observer dashboard with live Supabase Realtime subscriptions showing agent registry and message timeline. S03 created the demo orchestration script and comprehensive documentation with three quick-start paths.

## Success Criteria Results

All 5 success criteria met:\n1. ✅ Two agents complete PRD Section 7 scenario\n2. ✅ Dashboard shows live agent registry\n3. ✅ Dashboard shows real-time message timeline\n4. ✅ Demo reproducible with documented setup\n5. ✅ Full task lifecycle observable end-to-end

## Definition of Done Results

- ✅ Research agent registers and responds to research-summarization tasks\n- ✅ Extraction agent discovers research agent and delegates a task\n- ✅ Full task lifecycle (request → result) completes end-to-end\n- ✅ Web dashboard shows live registry state and message timeline\n- ✅ Demo can be run with ./scripts/demo.sh\n- ✅ README includes step-by-step demo walkthrough

## Requirement Outcomes

- REQ-AGENT-01: Validated — reference agents run with npm start\n- Demo Section 7: Validated — full scenario implemented\n- REQ-IOS-01 through IOS-03 (adapted to web): Validated\n- REQ-IOS-04, IOS-05: Partially addressed (inline display, no trigger button)

## Deviations

None.

## Follow-ups

None.
