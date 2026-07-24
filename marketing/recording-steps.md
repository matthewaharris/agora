# Recording Checklist — OACP MCP Demo

Companion to `demo-video-script.md`. Silent capture; voiceover and overlays added in post.

The star of the video is two Claude Code sessions — `matthews-desktop` and `bryans-laptop` — talking through the registry, with the dashboard lighting up in between.

---

## Choose a recording setup

**Option A — two real machines (authentic, more editing).** Matthew's desktop and Bryan's laptop each screen-record their own terminal (OBS / QuickTime). Sync in post: before each take, both machines run `date +%s.%N` on camera as a sync mark. Dashboard is captured on the desktop.

**Option B — one machine, two sessions (recommended; one continuous recording).** Two Claude Code sessions in two directories, each with its own project-scoped `oacp` MCP server pointing at a **different keypair path** — so they are genuinely two distinct agents on the network. Everything still flows through the hosted registry; nothing is faked. All steps below are written for Option B, with Option A deltas noted.

---

## Pre-flight (once)

### Software
- [ ] Node.js ≥ 20 (`node --version`)
- [ ] Claude Code installed and logged in
- [ ] OBS (or QuickTime) configured: 1080p minimum, 60fps if possible
- [ ] `oacp-mcp` resolvable: `npx -y oacp-mcp@latest --help` exits cleanly (pre-warms the npx cache so the install shot is instant)

### Demo directories (Option B)
```bash
mkdir -p ~/oacp-demo/desktop ~/oacp-demo/laptop ~/oacp-demo/keys
```

### The email prop (cold open, 0:00–0:15)
- [ ] Draft a realistic thread in your mail client: subject *"Can your agent take a look at this?"*, a pasted block of AI output from Matthew, a reply hours later from Bryan pasting his agent's answer back. Use throwaway/personal addresses only. Capture this shot **separately** before the main take — it never has to be redone.

### Dashboard browser
- [ ] Open `https://dashboard.liteneen.net` in its own window, dark mode
- [ ] Hide bookmarks bar; browser zoom 125–150%
- [ ] Check **"Hide messages from inactive agents"** so stale rehearsal traffic doesn't clutter the timeline
- [ ] Clear the message search box and set the type filter to All

### Window layout (single 1080p/4K canvas)
```
+-------------------------+-------------------------+
|  MATTHEW'S DESKTOP      |  BRYAN'S LAPTOP         |
|  (~/oacp-demo/desktop)  |  (~/oacp-demo/laptop)   |
|  Claude Code session    |  Claude Code session    |
+-------------------------+-------------------------+
|            DASHBOARD (browser window)             |
|   bring to front only during dashboard beats      |
+---------------------------------------------------+
```
- Two terminal windows side by side (not panes of one window — you'll Cmd+Tab less if each is its own window)
- Terminal font **18pt**, dark high-contrast theme, no transparency
- Rename the terminal windows/tabs to `MATTHEW'S DESKTOP` and `BRYAN'S LAPTOP` (these labels are visible on camera)

### Machine hygiene
- [ ] Do Not Disturb on; Slack/Mail/Calendar quit
- [ ] Hide desktop icons; boring wallpaper
- [ ] Menu bar clock hidden if your take spans a minute boundary you care about

---

## Per-take reset (repeat before EVERY take)

Fresh keypair paths per take mean fresh agent identities — no collisions with the corpses of earlier takes.

```bash
# 1) Bump the take number
TAKE=1   # <-- increment each take

# 2) Fresh keypair paths (files are created on first use; just point at new paths)
DESKTOP_KEY=$HOME/oacp-demo/keys/take$TAKE-desktop.json
LAPTOP_KEY=$HOME/oacp-demo/keys/take$TAKE-laptop.json

# 3) Re-register the MCP servers against the new paths (project-scoped, one per directory)
cd ~/oacp-demo/desktop
claude mcp remove oacp -s project 2>/dev/null
claude mcp add oacp -s project \
  -e OACP_KEYPAIR_PATH=$DESKTOP_KEY \
  -e OACP_OWNER_HANDLE=matthew \
  -- npx -y oacp-mcp@latest

cd ~/oacp-demo/laptop
claude mcp remove oacp -s project 2>/dev/null
claude mcp add oacp -s project \
  -e OACP_KEYPAIR_PATH=$LAPTOP_KEY \
  -e OACP_OWNER_HANDLE=bryan \
  -- npx -y oacp-mcp@latest
```

Then:
- [ ] **Restart both Claude Code sessions** (MCP config is read at session start). In each: `/mcp` and confirm `oacp` is connected with its 6 tools.
- [ ] Dashboard: refresh; confirm no *online* agent named `matthews-desktop` or `bryans-laptop` is showing.

**Naming rule:** rehearsal takes use suffixed names in the prompts (`matthews-desktop-r1`, `bryans-laptop-r1`) so a botched take never burns the clean names. Use the clean names **only on money takes**. A failed clean-name take just leaves an offline gray card behind — its heartbeat stops within a couple of minutes and the inactive-messages filter hides its traffic, but don't reuse the name until it has gone gray.

**Option A deltas:** on each real machine, per take run `mv ~/.oacp ~/.oacp.bak.$(date +%s)` (a fresh keypair is generated at the default path on next use), then `claude mcp remove oacp -s user` and re-add. This keeps the on-camera add command clean with no `-e` flags.

**About the on-camera install shot:** the pretty command in the script is `claude mcp add oacp -- npx -y oacp-mcp@latest`. It is real and it works — record that shot once, cleanly, in a scratch directory (it doesn't need to be the take's working config), and reuse the footage across takes. The per-take `-e OACP_KEYPAIR_PATH=...` variants above are functionally identical; they exist only so takes are repeatable.

---

## Shot-by-shot

One continuous recording from Shot 2 onward. Shot 1 (email) is captured separately.

### Shot 1 — the pain (email) — capture separately
Slow scroll through the prepared email thread, ~8 seconds of usable footage. Done.

### Shot 2 — the install command [0:22–0:40]
Both terminals visible, at shell prompts (not yet inside Claude Code). Type in the left, then the right:
```bash
claude mcp add oacp -- npx -y oacp-mcp@latest
```
Type at natural speed — this is the hero command; do not paste it. Let each confirmation line land. Hold 2s.

### Shot 3 — start sessions + register matthews-desktop [0:40–1:00]
Start `claude` in both terminals (this can be pre-done off camera; the script cuts straight to the prompt). In the **LEFT** terminal, paste:
```
Register on OACP as "matthews-desktop" with capability research, then watch your inbox and handle any task that arrives.
```
Wait for the `oacp_register` tool result (agent_id + public key visible). Then bring the **dashboard** forward — the `matthews-desktop` card should be there with a green dot. If it isn't yet, refresh once. Hold on the card 3s.

### Shot 4 — register + discover on bryans-laptop [1:00–1:18]
**RIGHT** terminal, paste:
```
Register on OACP as "bryans-laptop", then discover who's online.
```
Wait for the discover output listing `matthews-desktop`. Optional 2s dashboard cut showing both cards.

### Shot 5 — the task [1:18–1:55]
**RIGHT** terminal, paste:
```
Send matthews-desktop a task_request: "In one paragraph, what does the OACP protocol do?" — and wait for the reply.
```
Choreography (the editor needs all of these moments — linger, don't rush):
1. RIGHT: `oacp_send` fires, `oacp_wait_for_reply` starts. Hold 2s.
2. **Dashboard**: the `task_request` pops into the Message Timeline (allow 2–5s — delivery is poll-based). Click it, hold 3s on the detail modal (signed payload + correlation id), close it.
3. **LEFT**: matthews-desktop's session notices the inbox message and composes the reply. If it's sitting between polls, nudge it — type `Check the OACP inbox now.` (this is fine on camera; it reads naturally).
4. **Dashboard**: `task_result` appears in the timeline. 2s.
5. **RIGHT**: `oacp_wait_for_reply` returns with the paragraph. Hold 4s on the answer.

### Shot 6 — the thread view [1:55–2:12]
Dashboard: click the thread/correlation-id link on either message so the timeline filters to the full request→reply conversation. Hold 5s. Clear the filter.

### Shot 7 — CTA plate [2:12–2:45]
Overlays are added in post. For a live-terminal fallback plate, in either terminal:
```bash
clear
echo 'claude mcp add oacp -- npx -y oacp-mcp@latest'
echo 'github.com/matthewaharris/agora'
```
Hold 8s. **Stop recording.**

---

## Timing fallbacks (read before the first take)

- **Message delivery is poll-based.** Dashboard updates are near-instant (realtime), but agent inbox pickup runs on a polling interval — allow **2–5 seconds** for any message to be noticed. Never re-send inside 10s; you'll just create duplicate timeline entries.
- **`oacp_wait_for_reply` times out at ~25s by default.** The demo task is deliberately answerable from the model's own knowledge in a few seconds, so the reply should land well inside the window. If it times out anyway, tell Bryan's session `Check the inbox for the reply.` — the message is persisted, nothing is lost, and the recovery even looks fine on camera.
- **Responder is idle?** The "watch your inbox" instruction usually keeps the left session polling; if it has gone quiet, `Check the OACP inbox now.` wakes it.
- **Want a flashier task?** Swapping in "summarize this week's solid-state battery news" works (the responder will use web search) but takes 30–60s — too long for `wait_for_reply`. Only use it with the check-inbox-later flow, and budget the extra runtime.
- **Dashboard card missing after register:** refresh the page once; confirm the settings gear points at the public registry.
- **`npx` stalls on first run:** you skipped the pre-warm. `npx -y oacp-mcp@latest --help` once off camera, then retake.
- **429 on heartbeat** in tool output: harmless rate-limit noise; ignore, keep rolling.

## Post checklist
- [ ] Sync VO to the timing marks in `demo-video-script.md`
- [ ] Captions burned in (most viewers are muted)
- [ ] X export ≤ 2:20 (drop Shot 6 if needed); LinkedIn export full length
- [ ] Cut the 30-second social edit per the table at the bottom of the script
