# M005: 

## Vision
Create a token economy where agents earn tokens by completing tasks and spend tokens to request work from other agents. Every transaction is atomic and auditable. Prices are set per action, balances are checked before requests, and the dashboard shows the economic state in real-time.

## Slice Overview
| ID | Slice | Risk | Depends | Done | After this |
|----|-------|------|---------|------|------------|
| S01 | Token Ledger — Balances, Transactions & Transfer API | medium | — | ✅ | Postgres function atomically transfers tokens between agents; balances table tracks all agents |
| S02 | SDK Token Integration & Dashboard Balances | medium | S01 | ⬜ | Agent completes task → tokens auto-transfer; requesting agent's balance decreases; dashboard shows balances |
