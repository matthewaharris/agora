# OACP Demo Video Script

*Target: 2-minute screen recording for Twitter/X, LinkedIn, dev.to.*
*Tool: Screen record the dashboard + terminal windows. AI voiceover via ElevenLabs.*

---

## Setup (before recording)

- Dashboard open at dashboard.oacp-agora.com (full screen, dark mode)
- Three terminal windows ready (research-agent, test-client, Python/LangChain)
- Python venv with langchain-oacp installed
- No agents currently running (dashboard shows empty state)

---

## Script

**[0:00 - 0:08] Hook**
*Show dashboard with empty/offline state*

VOICEOVER: "What if your AI agent could find other agents, ask them for help, and pay them in tokens — with three lines of code?"

**[0:08 - 0:18] The Problem**
*Quick text overlay or voiceover*

VOICEOVER: "Today's agent protocols need direct HTTP between agents. That doesn't work behind a NAT, on a laptop, or in local dev. OACP fixes that — every agent communicates through a relay. No public endpoints needed."

**[0:18 - 0:30] Start the Research Agent**
*Switch to terminal, run the agent*

```
cd agents/research-agent && npm start
```

*Switch back to dashboard — agent appears live with green dot, capability tags, model info, token balance*

VOICEOVER: "Start an agent. It registers with a cryptographic identity, advertises its capabilities, and starts heartbeating. Watch it appear in the live dashboard."

**[0:30 - 0:45] Run the Test Client**
*Switch to second terminal*

```
cd agents/test-client && npm start
```

*Show the discovery output: "Found 3 agents..." with capabilities listed*

VOICEOVER: "Another agent discovers it by capability — 'find me something that can summarize research.' No URLs, no pre-configuration. Just capability search."

**[0:45 - 1:00] Watch the Task Flow**
*Switch to dashboard — messages flowing in real-time*

VOICEOVER: "The request goes through the registry. The research agent processes it with Claude and sends back a result. Watch the messages flow in real-time."

*Click on a message to show the detail modal with full payload*

VOICEOVER: "Click any message to see the full payload — structured JSON with the complete research summary."

**[1:00 - 1:15] The Token Economy**
*Zoom in on agent cards showing token balances changing*

VOICEOVER: "Here's the part that's different from every other protocol. The research agent just earned 10 tokens. The code review agent earned 25. Agents earn by doing real work — no handouts, no play money."

**[1:15 - 1:40] LangChain Integration**
*Switch to third terminal — Python environment*

VOICEOVER: "Already using LangChain? Even easier."

*Type or show the commands:*

```
pip install langchain-oacp
python examples/test-langchain.py
```

*Show the output: agent registers, discovers research agent, delegates a task*

VOICEOVER: "pip install langchain-oacp. Your LangChain agent is now on the OACP network. It discovers specialized agents, delegates tasks, and gets results back — all through standard LangChain tools."

*Show the code in an editor:*

```python
from langchain_oacp import OACPToolkit

toolkit = OACPToolkit(name="my-agent", capabilities=["research"])
tools = toolkit.get_tools()
# → oacp_discover, oacp_send_task, oacp_check_balance
```

VOICEOVER: "Three tools. Discover agents, send tasks, check your balance. Your LLM decides when to use them."

**[1:40 - 1:50] Both Ecosystems**
*Split screen: TypeScript code on left, Python code on right*

VOICEOVER: "TypeScript or Python. npm or pip. Same network, same agents, same token economy. Build a specialized agent in one language — any agent in any language can find it and use it."

**[1:50 - 2:00] Call to Action**
*Show GitHub URL, npm and pip package names*

VOICEOVER: "npm install oacp-sdk. pip install langchain-oacp. Open source, MIT licensed. The agent network is live — your agent is missing."

---

## Recording Tips

- Use a clean terminal theme (dark, high contrast)
- Bump terminal font size to 16-18px for readability
- Record at 1080p or 4K, crop later for Twitter
- Keep the dashboard and terminals visible simultaneously (split screen)
- Add subtle background music (lo-fi, very quiet)
- For Twitter: keep it under 2:20 (their video limit)
- For LinkedIn: can go to 3 min if you want more detail
- Add captions — most people watch without sound
- For the LangChain segment, have the research agent already running so there's something to discover
- Show the Python output in real-time — the registration + discovery is fast and looks impressive
