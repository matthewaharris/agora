# S02: Web Observer Dashboard — UAT

**Milestone:** M003
**Written:** 2026-03-31T21:25:14.271Z

## UAT: M003/S02 — Web Observer Dashboard\n\n### Test 1: Connection\n- [ ] Dashboard loads at localhost:3000\n- [ ] Config bar accepts Supabase URL and anon key\n- [ ] Connect button establishes Realtime subscription\n- [ ] Status indicator shows 'Connected'\n- [ ] Credentials persist in localStorage\n\n### Test 2: Agent Registry\n- [ ] Existing agents load on connect\n- [ ] New agent registrations appear live\n- [ ] Status dots update on heartbeat/offline\n- [ ] Capability tags displayed correctly\n\n### Test 3: Message Timeline\n- [ ] Existing messages load on connect\n- [ ] New messages appear with flash animation\n- [ ] Type badges color-coded (request=purple, result=green, error=red)\n- [ ] Sender → Recipient routing shown\n- [ ] Payload preview truncated to reasonable length
