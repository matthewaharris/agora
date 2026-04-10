# Demo Video Recording Commands

Copy-paste these in order during recording. Two terminal panes + one browser.

## Pre-recording setup (before hitting record)

### Clone and prep on Mac (one-time)
```bash
git clone https://github.com/matthewaharris/agora.git && cd agora

# Node agents
cd agents/research-agent && npm install && cd ../..
cd agents/test-client && npm install && cd ../..

# Python venv
python3 -m venv .venv
source .venv/bin/activate
pip install oacp-sdk langchain-oacp langchain-anthropic langgraph anthropic

# Set keys
export ANTHROPIC_API_KEY=sk-ant-...
```

### Terminal layout
- Open Terminal, split into 2 panes (Cmd+D in iTerm2, or use tabs)
- Pane 1 (left/top): agent runner
- Pane 2 (right/bottom): client/python commands
- Browser: https://dashboard.oacp-agora.com

### Font & appearance
- Terminal font: 16-18px, dark theme
- Browser: dark mode if dashboard supports it
- Hide bookmarks bar, minimize chrome

---

## Recording sequence

### Scene 1: Hook [0:00-0:08]
Show empty dashboard. Just let it sit for 8 seconds.

---

### Scene 2: Problem statement [0:08-0:18]
Nothing to do on screen — voiceover only, add text overlay in post.

---

### Scene 3: Start the research agent [0:18-0:30]
**Pane 1:**
```bash
cd agents/research-agent && npm start
```
Wait for "Registered as..." and "Waiting for task requests..." to appear.
Switch to browser — show agent appearing in dashboard with green dot.

---

### Scene 4: Run the test client [0:30-0:45]
**Pane 2:**
```bash
cd agents/test-client && npm start
```
Watch the output: "Found 2 agents...", task sent, result received.

---

### Scene 5: Watch the task flow [0:45-1:00]
Switch to dashboard. Click on a message to show the detail modal.
Let the messages flow for a few seconds.

---

### Scene 6: Token economy [1:00-1:15]
Zoom in (Cmd+scroll or browser zoom) on agent cards showing token balances.
The research agent should show tokens earned from the test client task.

---

### Scene 7: LangChain integration [1:15-1:40]
**Pane 2** (clear it first):
```bash
clear
```

Show the install:
```bash
pip install langchain-oacp
```

Run the test:
```bash
python examples/test-langchain.py
```

Wait for full output: registration, discovery, Claude using OACP tools.

Optionally show the code in an editor (VS Code) — the key 3 lines:
```python
from langchain_oacp import OACPToolkit
toolkit = OACPToolkit(name="my-agent", capabilities=["research"])
tools = toolkit.get_tools()
```

---

### Scene 8: Both ecosystems [1:40-1:50]
Pre-arrange split view in editor: TypeScript agent code on left, Python on right.
Just show it briefly — voiceover carries this scene.

---

### Scene 9: Managed Agents (cloud) [1:50-2:10]
**Pane 2:**
```bash
clear
python examples/test-managed-agent.py
```

This takes ~30-60 seconds to run. Key moments to highlight:
- "Creating Managed Agent..."
- "MANAGED AGENT OUTPUT"
- "[Tool: bash]" — it's installing oacp-sdk in the cloud
- "Found 1 research agents"
- "Task result:" — the cloud agent got a response from your local agent

**Meanwhile in Pane 1:** the research agent should show:
- "[OACP] Received task_request from ..."
- "LLM responded in Xms"
- "Earned N tokens"

---

### Scene 10: Call to action [2:10-2:20]
Show in terminal or text overlay:
```
npm install oacp-sdk
pip install langchain-oacp
github.com/matthewaharris/agora
```

---

## If something goes wrong

- **Agent won't start:** Check .env file has SUPABASE_URL and SUPABASE_ANON_KEY
- **529 Overloaded:** Anthropic API is busy — wait 30s and retry
- **429 Too Many Requests:** Heartbeat rate limit — harmless, ignore it
- **Managed agent hangs:** Kill and re-run, or skip to CTA
- **No agents discovered:** Make sure research-agent is running in Pane 1
