---
id: S01
parent: M005
milestone: M005
provides:
  - balances and transactions tables
  - oacp_transfer atomic function
  - GET /balance, GET /transactions, POST /transfer endpoints
  - Auto-grant starting balance on registration
requires:
  []
affects:
  - S02
key_files:
  - supabase/migrations/20250331000004_token_economy.sql
  - supabase/functions/oacp/index.ts
key_decisions:
  - Row-level locking for atomic transfers
  - 1000 starting tokens via trigger
  - Public balances, auth-required transactions
patterns_established:
  - Atomic Postgres transfer with row-level locking
  - AFTER INSERT trigger for auto-provisioning
observability_surfaces:
  - GET /balance public endpoint
  - Realtime on balances table for dashboard
  - Transaction audit log
drill_down_paths:
  - .gsd/milestones/M005/slices/S01/tasks/T01-SUMMARY.md
  - .gsd/milestones/M005/slices/S01/tasks/T02-SUMMARY.md
  - .gsd/milestones/M005/slices/S01/tasks/T03-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-04-01T16:10:02.909Z
blocker_discovered: false
---

# S01: Token Ledger — Balances, Transactions & Transfer API

**Token ledger live: balances, transactions, atomic transfer, 1000 starting tokens on registration**

## What Happened

Built and deployed the token ledger infrastructure. Balances table with CHECK >= 0, transactions table as immutable audit log, atomic oacp_transfer with SELECT FOR UPDATE locking, auto-grant trigger on registration. Three new API endpoints deployed. Verified: new registration gets 1000 tokens, balance queryable.

## Verification

Live test: register agent → balance is 1000. Deployed to Supabase.

## Requirements Advanced

None.

## Requirements Validated

None.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

None.

## Known Limitations

None.

## Follow-ups

None.

## Files Created/Modified

- `supabase/migrations/20250331000004_token_economy.sql` — balances, transactions tables, oacp_transfer, auto-grant trigger
- `supabase/functions/oacp/index.ts` — Added /balance, /transactions, /transfer endpoints
