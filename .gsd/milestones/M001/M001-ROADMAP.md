# M001: 

## Vision
Stand up the OACP backend (Supabase schema + Edge Functions) and build the TypeScript SDK so that a single agent can register, heartbeat, and be discovered. This is the foundation everything else builds on.

## Slice Overview
| ID | Slice | Risk | Depends | Done | After this |
|----|-------|------|---------|------|------------|
| S01 | Supabase Schema & Project Setup | low | — | ✅ | supabase start runs clean; agents table exists with correct schema; Edge Function skeleton responds to health check |
| S02 | Registration, Heartbeat & Discovery API | medium | S01 | ⬜ | curl can register an agent, send heartbeats, and discover by capability tag; auto-offline works after 90s |
| S03 | OACP-SDK Core — Registration, Heartbeat, Discovery | medium | S02 | ⬜ | A TypeScript script using oacp-sdk registers an agent, starts auto-heartbeat, and discovers other agents |
