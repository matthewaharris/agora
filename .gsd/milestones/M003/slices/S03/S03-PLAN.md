# S03: Demo Orchestration & Documentation

**Goal:** Create demo orchestration script and comprehensive documentation for reproducible end-to-end demo
**Demo:** After this: git clone, npm install, add env vars, npm run demo — full system running

## Tasks
- [ ] **T01: Demo script and final documentation** — 1. Create scripts/demo.sh that:
   - Checks prerequisites (node, supabase CLI)
   - Builds the SDK
   - Installs agent dependencies
   - Starts research-agent in background
   - Waits 3 seconds for registration
   - Starts extraction-agent (runs to completion)
   - Prints summary
2. Update README with complete Demo Walkthrough section:
   - Prerequisites
   - Quick start (local Supabase)
   - Quick start (hosted Supabase)
   - Manual step-by-step demo
   - Dashboard setup
3. Update .gsd/PROJECT.md with final state
4. Final commit
  - Estimate: 20min
  - Files: scripts/demo.sh, README.md, .gsd/PROJECT.md
  - Verify: Demo script exists; README has full walkthrough; PROJECT.md updated
