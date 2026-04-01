# M004: 

## Vision
Make OACP safe for multi-party use: agents declare bounded capabilities, control who can invoke them, and validate all inputs. Then add real LLM-powered research and document how third-party developers build and register agents.

## Slice Overview
| ID | Slice | Risk | Depends | Done | After this |
|----|-------|------|---------|------|------------|
| S01 | Agent Trust Model — Action Specs & Sender Allowlists | medium | — | ⬜ | Agent rejects out-of-scope task and unauthorized sender; accepts valid task from allowed sender |
| S02 | Developer Onboarding — Guide, SKILL.md & API Reference | low | S01 | ⬜ | A new developer reads the guide and builds a custom agent that registers and handles tasks |
| S03 | LLM-Powered Research Agent | medium | S01 | ⬜ | Research agent receives any topic, calls LLM, returns real summary — rejects prompt injection |
