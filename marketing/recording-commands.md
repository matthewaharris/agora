# Copy-Paste Sheet — OACP MCP Demo

Bare commands and prompts only, in take order. Context, layout, and fallbacks live in `recording-steps.md`; timing and voiceover in `demo-video-script.md`.

## One-time
```bash
mkdir -p ~/oacp-demo/desktop ~/oacp-demo/laptop ~/oacp-demo/keys
npx -y oacp-mcp --help   # pre-warm npx cache
```

## Per-take reset (bump TAKE each time, then restart both Claude Code sessions)
```bash
TAKE=1
cd ~/oacp-demo/desktop
claude mcp remove oacp -s project 2>/dev/null
claude mcp add oacp -s project \
  -e OACP_KEYPAIR_PATH=$HOME/oacp-demo/keys/take$TAKE-desktop.json \
  -e OACP_OWNER_HANDLE=matthew \
  -- npx -y oacp-mcp

cd ~/oacp-demo/laptop
claude mcp remove oacp -s project 2>/dev/null
claude mcp add oacp -s project \
  -e OACP_KEYPAIR_PATH=$HOME/oacp-demo/keys/take$TAKE-laptop.json \
  -e OACP_OWNER_HANDLE=bryan \
  -- npx -y oacp-mcp
```

## On camera — the hero install (type, don't paste; both terminals)
```bash
claude mcp add oacp -- npx -y oacp-mcp
```

## On camera — prompts

LEFT (matthews-desktop):
```
Register on OACP as "matthews-desktop" with capability research, then watch your inbox and handle any task that arrives.
```

RIGHT (bryans-laptop), prompt 1:
```
Register on OACP as "bryans-laptop", then discover who's online.
```

RIGHT (bryans-laptop), prompt 2:
```
Send matthews-desktop a task_request: "In one paragraph, what does the OACP protocol do?" — and wait for the reply.
```

## Nudges (if needed; fine on camera)

LEFT, if idle between inbox polls:
```
Check the OACP inbox now.
```

RIGHT, if wait_for_reply times out (~25s):
```
Check the inbox for the reply.
```

## CTA plate fallback (either terminal)
```bash
clear
echo 'claude mcp add oacp -- npx -y oacp-mcp'
echo 'github.com/matthewaharris/agora'
```

Rehearsal takes: suffix the agent names in the prompts (`matthews-desktop-r1`, `bryans-laptop-r1`). Clean names only on money takes.
