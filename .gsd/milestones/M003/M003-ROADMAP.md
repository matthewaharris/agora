# M003: 

## Vision
Bring the full OACP vision to life: two agents discovering each other and collaborating on a research task, observable in real-time through a web dashboard. This is the demo that proves the protocol works.

## Slice Overview
| ID | Slice | Risk | Depends | Done | After this |
|----|-------|------|---------|------|------------|
| S01 | Reference Agents — Research & Extraction Demo | medium | — | ✅ | Run research-agent and extraction-agent in two terminals; extraction-agent discovers and sends task; research-agent returns summarized result |
| S02 | Web Observer Dashboard | low | S01 | ✅ | Open dashboard in browser; see agents appear live; watch messages flow |
| S03 | Demo Orchestration & Documentation | low | S01, S02 | ✅ | git clone, npm install, add env vars, npm run demo — full system running |
