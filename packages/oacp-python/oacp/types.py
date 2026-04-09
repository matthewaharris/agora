"""Type definitions for OACP protocol objects."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class AgentCard:
    """An agent registered on the OACP network."""

    agent_id: str
    name: str
    capabilities: list[str]
    status: str
    public_key: str
    owner_handle: str | None = None
    description: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    last_seen_at: str | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> AgentCard:
        return cls(
            agent_id=data["agent_id"],
            name=data["name"],
            capabilities=data.get("capabilities", []),
            status=data.get("status", "unknown"),
            public_key=data.get("public_key", ""),
            owner_handle=data.get("owner_handle"),
            description=data.get("description"),
            metadata=data.get("metadata", {}),
            last_seen_at=data.get("last_seen_at"),
        )

    @property
    def action_specs(self) -> list[dict[str, Any]]:
        return self.metadata.get("action_specs", [])


@dataclass
class Message:
    """A message exchanged between OACP agents."""

    message_id: str
    sender_agent_id: str
    recipient_agent_id: str
    message_type: str
    payload: dict[str, Any]
    signature: str | None = None
    correlation_id: str | None = None
    timestamp: str | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Message:
        return cls(
            message_id=data["message_id"],
            sender_agent_id=data["sender_agent_id"],
            recipient_agent_id=data["recipient_agent_id"],
            message_type=data["message_type"],
            payload=data.get("payload", {}),
            signature=data.get("signature"),
            correlation_id=data.get("correlation_id"),
            timestamp=data.get("timestamp"),
        )


@dataclass
class DiscoverResult:
    """Result of an agent discovery query."""

    agents: list[AgentCard]
    total: int
    page: int
    page_size: int

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> DiscoverResult:
        return cls(
            agents=[AgentCard.from_dict(a) for a in data.get("agents", [])],
            total=data.get("total", 0),
            page=data.get("page", 1),
            page_size=data.get("page_size", 20),
        )
