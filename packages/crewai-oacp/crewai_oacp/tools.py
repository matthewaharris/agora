"""CrewAI tools for interacting with the OACP agent network."""

from __future__ import annotations

import json
from typing import Any, Optional

from crewai.tools import BaseTool
from pydantic import BaseModel, Field

from oacp import OACPClient


class DiscoverInput(BaseModel):
    """Input for discovering agents on the OACP network."""

    capability: str = Field(description="The capability to search for, e.g. 'drug-interaction-analysis', 'code-review', 'sentiment-analysis'")
    status: Optional[str] = Field(default="online", description="Agent status filter: 'online', 'offline', or 'busy'")


class SendTaskInput(BaseModel):
    """Input for sending a task to an OACP agent."""

    agent_id: str = Field(description="The agent_id of the target agent (from discover results)")
    action: str = Field(description="The action name to invoke on the target agent (from its action_specs)")
    payload: str = Field(description="JSON string of the task payload matching the action's input schema")


class CheckBalanceInput(BaseModel):
    """Input for checking token balance."""

    pass


class OACPDiscoverTool(BaseTool):
    """Search the OACP network for agents by capability."""

    name: str = "OACP Discover"
    description: str = (
        "Search the OACP agent network to find specialized AI agents by capability. "
        "Returns a list of agents with their IDs, capabilities, action specs, and status. "
        "Use this to find the right agent before sending a task."
    )
    args_schema: type[BaseModel] = DiscoverInput
    oacp_client: Any = Field(exclude=True)

    model_config = {"arbitrary_types_allowed": True}

    def _run(self, capability: str, status: str = "online") -> str:
        result = self.oacp_client.discover(capability=capability, status=status)

        if not result.agents:
            return f"No agents found with capability '{capability}' (status={status})."

        agents_info = []
        for agent in result.agents:
            info = {
                "agent_id": agent.agent_id,
                "name": agent.name,
                "capabilities": agent.capabilities,
                "status": agent.status,
                "description": agent.description,
                "actions": [
                    {"name": a["name"], "description": a.get("description", ""), "price": a.get("price", 0)}
                    for a in agent.action_specs
                ],
            }
            agents_info.append(info)

        return json.dumps(
            {"found": len(agents_info), "total": result.total, "agents": agents_info},
            indent=2,
        )


class OACPSendTaskTool(BaseTool):
    """Send a task to an OACP agent and get the result."""

    name: str = "OACP Send Task"
    description: str = (
        "Send a task to a specific OACP agent and wait for the result. "
        "Requires an agent_id (from discover), an action name, and a JSON payload. "
        "The remote agent processes the task and returns structured results."
    )
    args_schema: type[BaseModel] = SendTaskInput
    oacp_client: Any = Field(exclude=True)
    task_timeout: float = Field(default=30.0, exclude=True)

    model_config = {"arbitrary_types_allowed": True}

    def _run(self, agent_id: str, action: str, payload: str) -> str:
        try:
            payload_dict = json.loads(payload)
        except json.JSONDecodeError:
            return f"Error: payload must be valid JSON. Got: {payload[:200]}"

        try:
            result = self.oacp_client.send_task(
                agent_id, action, payload_dict, timeout=self.task_timeout
            )
            return json.dumps(result, indent=2)
        except TimeoutError:
            return f"Error: Agent {agent_id} did not respond within {self.task_timeout}s."
        except RuntimeError as e:
            return f"Error: {e}"


class OACPCheckBalanceTool(BaseTool):
    """Check this agent's OACP token balance."""

    name: str = "OACP Check Balance"
    description: str = (
        "Check the current OACP token balance for this agent. "
        "Tokens are earned by completing tasks and spent when requesting work."
    )
    args_schema: type[BaseModel] = CheckBalanceInput
    oacp_client: Any = Field(exclude=True)

    model_config = {"arbitrary_types_allowed": True}

    def _run(self) -> str:
        balance = self.oacp_client.get_balance()
        return json.dumps({"balance": balance, "unit": "OACP tokens"})
