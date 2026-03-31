# M002: 

## Vision
Complete the communication layer: agents can send structured, signed messages to each other through the Supabase message bus, with the SDK providing a clean event-driven API.

## Slice Overview
| ID | Slice | Risk | Depends | Done | After this |
|----|-------|------|---------|------|------------|
| S01 | Messages Table & Send Endpoint | medium | — | ✅ | curl POST to /oacp/messages/send stores message and triggers Realtime event visible in Supabase dashboard |
| S02 | SDK Messaging — send(), on(), Signature Verification | medium | S01 | ✅ | Two agent scripts exchange a task_request/task_result cycle using agent.send() and agent.on() |
