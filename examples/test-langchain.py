"""Test script: LangChain agent connected to the OACP network.

Prerequisites:
    pip install oacp-sdk langchain-oacp langchain-openai langgraph

Usage:
    export OPENAI_API_KEY=sk-...
    python examples/test-langchain.py

What this does:
    1. Registers a LangChain agent on the OACP network
    2. Discovers available agents by capability
    3. Optionally delegates a task to a live agent
"""

import os
import json
from langchain_oacp import OACPToolkit

# --- Step 1: Connect to OACP ---
print("Connecting to OACP network...")
toolkit = OACPToolkit(
    name="langchain-test-agent",
    capabilities=["testing", "integration-test"],
    owner_handle="matt",
    description="LangChain integration test agent",
)
print(f"Registered as agent_id: {toolkit.agent_id}")

# --- Step 2: Test discovery tool directly ---
tools = toolkit.get_tools()
discover_tool = tools[0]  # OACPDiscoverTool
send_task_tool = tools[1]  # OACPSendTaskTool
balance_tool = tools[2]  # OACPCheckBalanceTool

print("\n--- Discovering agents with 'research-summarization' capability ---")
result = discover_tool._run(capability="research-summarization")
print(result)

print("\n--- Discovering agents with 'sentiment-analysis' capability ---")
result = discover_tool._run(capability="sentiment-analysis")
print(result)

print("\n--- Discovering all online agents ---")
result = discover_tool._run(capability="", status="online")
print(result)

print("\n--- Checking token balance ---")
balance = balance_tool._run()
print(balance)

# --- Step 3: Full LangChain agent (requires OPENAI_API_KEY) ---
if os.environ.get("OPENAI_API_KEY"):
    print("\n--- Running full LangChain agent ---")
    from langchain_openai import ChatOpenAI
    from langgraph.prebuilt import create_react_agent

    llm = ChatOpenAI(model="gpt-4o-mini")
    agent = create_react_agent(llm, tools)

    result = agent.invoke({
        "messages": [{
            "role": "user",
            "content": "Search the OACP network for any agents with research or summarization capabilities. Tell me what you find.",
        }]
    })

    # Print the final response
    for msg in result["messages"]:
        if hasattr(msg, "content") and msg.content:
            print(f"[{msg.__class__.__name__}]: {msg.content[:500]}")
else:
    print("\n--- Skipping full agent test (set OPENAI_API_KEY to enable) ---")

toolkit.close()
print("\nDone!")
