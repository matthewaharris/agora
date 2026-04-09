"""Tests for the OACP Python client."""

import json
from unittest.mock import MagicMock, patch

import pytest

from oacp.client import OACPClient, _canonicalize
from oacp.types import AgentCard, Message, DiscoverResult


# ── Canonicalization ──

def test_canonicalize_sorts_keys():
    obj = {"z": 1, "a": 2, "m": 3}
    result = _canonicalize(obj)
    assert result == '{"a":2,"m":3,"z":1}'


def test_canonicalize_no_whitespace():
    obj = {"key": "value", "nested": {"a": 1}}
    result = _canonicalize(obj)
    assert " " not in result
    assert "\n" not in result


def test_canonicalize_nested_sorting():
    obj = {"b": {"z": 1, "a": 2}, "a": 1}
    result = _canonicalize(obj)
    parsed = json.loads(result)
    assert list(parsed.keys()) == ["a", "b"]


# ── Types ──

def test_agent_card_from_dict():
    data = {
        "agent_id": "abc-123",
        "name": "test-agent",
        "capabilities": ["research"],
        "status": "online",
        "public_key": "deadbeef",
        "owner_handle": "matt",
        "metadata": {
            "action_specs": [{"name": "summarize", "price": 10}]
        },
    }
    card = AgentCard.from_dict(data)
    assert card.agent_id == "abc-123"
    assert card.name == "test-agent"
    assert card.capabilities == ["research"]
    assert card.status == "online"
    assert card.owner_handle == "matt"
    assert len(card.action_specs) == 1
    assert card.action_specs[0]["name"] == "summarize"


def test_agent_card_from_dict_minimal():
    data = {"agent_id": "x", "name": "y", "capabilities": [], "status": "offline", "public_key": ""}
    card = AgentCard.from_dict(data)
    assert card.agent_id == "x"
    assert card.action_specs == []
    assert card.owner_handle is None


def test_message_from_dict():
    data = {
        "message_id": "msg-1",
        "sender_agent_id": "a",
        "recipient_agent_id": "b",
        "message_type": "task_request",
        "payload": {"action": "test"},
        "correlation_id": "corr-1",
    }
    msg = Message.from_dict(data)
    assert msg.message_id == "msg-1"
    assert msg.message_type == "task_request"
    assert msg.payload["action"] == "test"
    assert msg.correlation_id == "corr-1"


def test_discover_result_from_dict():
    data = {
        "agents": [
            {"agent_id": "a1", "name": "agent-1", "capabilities": ["x"], "status": "online", "public_key": "pk"},
        ],
        "total": 1,
        "page": 1,
        "page_size": 20,
    }
    result = DiscoverResult.from_dict(data)
    assert result.total == 1
    assert len(result.agents) == 1
    assert result.agents[0].name == "agent-1"


def test_discover_result_empty():
    data = {"agents": [], "total": 0, "page": 1, "page_size": 20}
    result = DiscoverResult.from_dict(data)
    assert result.total == 0
    assert result.agents == []


# ── Client initialization ──

def test_client_generates_keypair():
    client = OACPClient(name="test", capabilities=["testing"])
    assert client.public_key is not None
    assert len(client.public_key) == 64  # 32 bytes hex-encoded
    client.close()


def test_client_default_registry():
    client = OACPClient(name="test", capabilities=["testing"])
    assert "supabase.co" in client._registry_url
    client.close()


def test_client_custom_registry():
    client = OACPClient(
        name="test",
        capabilities=["testing"],
        registry_url="https://custom.example.com",
        registry_key="custom-key",
    )
    assert client._registry_url == "https://custom.example.com"
    assert client._registry_key == "custom-key"
    client.close()


def test_client_not_registered_raises():
    client = OACPClient(name="test", capabilities=["testing"])
    with pytest.raises(RuntimeError, match="not registered"):
        client._auth_headers()
    client.close()


def test_client_signs_messages():
    client = OACPClient(name="test", capabilities=["testing"])
    sig = client._sign("hello world")
    assert isinstance(sig, str)
    assert len(sig) == 128  # 64 bytes hex-encoded
    client.close()


def test_client_different_keys_each_instance():
    c1 = OACPClient(name="a", capabilities=["x"])
    c2 = OACPClient(name="b", capabilities=["y"])
    assert c1.public_key != c2.public_key
    c1.close()
    c2.close()


# ── Registration (mocked HTTP) ──

@patch("oacp.client.httpx.Client")
def test_register_sets_agent_id(mock_client_cls):
    mock_resp = MagicMock()
    mock_resp.json.return_value = {"agent_id": "uuid-123", "registry_token": "tok-456"}
    mock_resp.raise_for_status = MagicMock()

    mock_http = MagicMock()
    mock_http.post.return_value = mock_resp
    mock_client_cls.return_value = mock_http

    client = OACPClient(name="test", capabilities=["research"], owner_handle="matt")
    agent_id = client.register()

    assert agent_id == "uuid-123"
    assert client.agent_id == "uuid-123"
    assert client._registry_token == "tok-456"

    # Verify the POST was called with correct body
    call_args = mock_http.post.call_args
    body = call_args[1]["json"]
    assert body["name"] == "test"
    assert body["capabilities"] == ["research"]
    assert body["owner_handle"] == "matt"
    assert "public_key" in body


# ── Discovery (mocked HTTP) ──

@patch("oacp.client.httpx.Client")
def test_discover_returns_agents(mock_client_cls):
    mock_resp = MagicMock()
    mock_resp.json.return_value = {
        "agents": [
            {"agent_id": "a1", "name": "agent-1", "capabilities": ["sentiment"], "status": "online", "public_key": "pk1"},
        ],
        "total": 1,
        "page": 1,
        "page_size": 20,
    }
    mock_resp.raise_for_status = MagicMock()

    mock_http = MagicMock()
    mock_http.get.return_value = mock_resp
    mock_client_cls.return_value = mock_http

    client = OACPClient(name="test", capabilities=["x"])
    result = client.discover(capability="sentiment")

    assert result.total == 1
    assert result.agents[0].name == "agent-1"


# ── Context manager ──

def test_context_manager():
    with OACPClient(name="test", capabilities=["x"]) as client:
        assert client.public_key is not None
    # Should not raise after exit
