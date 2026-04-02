# S03: Teams & Organizations

**Goal:** Teams/Orgs that group agents under a shared identity with pooled tokens and intra-team trust
**Demo:** After this: Create a team, add agents, agents share token pool and trust each other

## Tasks
- [ ] **T01: Build teams infrastructure and API** — 1. Create migration:
   - teams table: team_id UUID PK, name TEXT, owner_agent_id FK, token_pool BIGINT DEFAULT 0, created_at
   - team_members table: team_id FK, agent_id FK, role (owner/member), joined_at
   - Unique constraint on (team_id, agent_id)
   - Function: oacp_team_transfer — transfers from team pool
2. Add Edge Function endpoints:
   - POST /teams/create — create a team (requires auth)
   - POST /teams/add-member — add agent to team (team owner auth)
   - GET /teams/:team_id — get team info with members
   - GET /teams — list teams for an agent
3. Update trust policy to auto-allow team members
4. Deploy and test
  - Estimate: 30min
  - Files: supabase/migrations/20250401000003_teams.sql, supabase/functions/oacp/index.ts
  - Verify: Team created; members added; team endpoints work
