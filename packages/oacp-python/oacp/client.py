"""OACP Python client - talks directly to the OACP REST API."""

from __future__ import annotations

import json
import time
from typing import Any

import httpx
from nacl.signing import SigningKey, VerifyKey
from nacl.encoding import HexEncoder

from oacp.types import AgentCard, DiscoverResult, Message

OACP_PUBLIC_REGISTRY_URL = "https://zhenbunwugeskqtghjyt.supabase.co"
OACP_PUBLIC_REGISTRY_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpoZW5idW53dWdlc2txdGdoanl0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5OTM3NDYsImV4cCI6MjA5MDU2OTc0Nn0."
    "hU5C6yESrm0B8-hsXTY-XEYkgLegx-2SdpH8E3RMSGU"
)
API_PATH = "/functions/v1/oacp"


def _canonicalize(obj: dict[str, Any]) -> str:
    """Canonical JSON matching the Node SDK's canonicalizeMessage.

    Top-level keys are sorted alphabetically. Nested objects (like payload)
    preserve their original key order — this matches JSON.stringify behavior
    in JavaScript which the server uses for signature verification.
    """
    canonical: dict[str, Any] = {}
    for key in sorted(obj.keys()):
        canonical[key] = obj[key]
    return json.dumps(canonical, separators=(",", ":"))


class OACPClient:
    """Lightweight Python client for the OACP registry API.

    Handles registration, discovery, messaging, and Ed25519 signing.
    """

    def __init__(
        self,
        name: str,
        capabilities: list[str],
        *,
        registry_url: str | None = None,
        registry_key: str | None = None,
        owner_handle: str | None = None,
        description: str | None = None,
        metadata: dict[str, Any] | None = None,
    ):
        self.name = name
        self.capabilities = capabilities
        self.owner_handle = owner_handle
        self.description = description
        self.metadata = metadata or {}

        self._registry_url = registry_url or OACP_PUBLIC_REGISTRY_URL
        self._registry_key = registry_key or OACP_PUBLIC_REGISTRY_KEY
        self._base_url = f"{self._registry_url}{API_PATH}"

        # Generate Ed25519 keypair
        self._signing_key = SigningKey.generate()
        self._verify_key = self._signing_key.verify_key
        self.public_key = self._verify_key.encode(encoder=HexEncoder).decode()

        # Set after registration
        self.agent_id: str | None = None
        self._registry_token: str | None = None

        self._http = httpx.Client(
            headers={
                "Content-Type": "application/json",
                "apikey": self._registry_key,
            },
            timeout=30.0,
        )
        self._async_http = httpx.AsyncClient(
            headers={
                "Content-Type": "application/json",
                "apikey": self._registry_key,
            },
            timeout=30.0,
        )

    def _auth_headers(self) -> dict[str, str]:
        if not self._registry_token:
            raise RuntimeError("Agent not registered. Call register() first.")
        return {"Authorization": f"Bearer {self._registry_token}"}

    def _sign(self, message: str) -> str:
        signed = self._signing_key.sign(message.encode(), encoder=HexEncoder)
        return signed.signature.decode()

    # ── Registration ──

    def register(self) -> str:
        """Register this agent on the OACP network. Returns agent_id."""
        body: dict[str, Any] = {
            "name": self.name,
            "capabilities": self.capabilities,
            "public_key": self.public_key,
        }
        if self.owner_handle:
            body["owner_handle"] = self.owner_handle
        if self.description:
            body["description"] = self.description
        if self.metadata:
            body["metadata"] = self.metadata

        resp = self._http.post(f"{self._base_url}/register", json=body)
        resp.raise_for_status()
        data = resp.json()

        self.agent_id = data["agent_id"]
        self._registry_token = data.get("registry_token")
        return self.agent_id

    async def aregister(self) -> str:
        """Async version of register()."""
        body: dict[str, Any] = {
            "name": self.name,
            "capabilities": self.capabilities,
            "public_key": self.public_key,
        }
        if self.owner_handle:
            body["owner_handle"] = self.owner_handle
        if self.description:
            body["description"] = self.description
        if self.metadata:
            body["metadata"] = self.metadata

        resp = await self._async_http.post(f"{self._base_url}/register", json=body)
        resp.raise_for_status()
        data = resp.json()

        self.agent_id = data["agent_id"]
        self._registry_token = data.get("registry_token")
        return self.agent_id

    # ── Heartbeat ──

    def heartbeat(self) -> dict[str, Any]:
        """Send a heartbeat to stay online."""
        resp = self._http.post(
            f"{self._base_url}/heartbeat",
            json={"agent_id": self.agent_id},
            headers=self._auth_headers(),
        )
        resp.raise_for_status()
        return resp.json()

    async def aheartbeat(self) -> dict[str, Any]:
        resp = await self._async_http.post(
            f"{self._base_url}/heartbeat",
            json={"agent_id": self.agent_id},
            headers=self._auth_headers(),
        )
        resp.raise_for_status()
        return resp.json()

    # ── Discovery ──

    def discover(
        self,
        *,
        capability: str | None = None,
        status: str | None = None,
        owner_handle: str | None = None,
        page: int = 1,
        page_size: int = 20,
    ) -> DiscoverResult:
        """Discover agents on the network by capability, status, or owner."""
        params: dict[str, Any] = {"page": page, "page_size": page_size}
        if capability:
            params["capability"] = capability
        if status:
            params["status"] = status
        if owner_handle:
            params["owner_handle"] = owner_handle

        resp = self._http.get(f"{self._base_url}/discover", params=params)
        resp.raise_for_status()
        return DiscoverResult.from_dict(resp.json())

    async def adiscover(
        self,
        *,
        capability: str | None = None,
        status: str | None = None,
        owner_handle: str | None = None,
        page: int = 1,
        page_size: int = 20,
    ) -> DiscoverResult:
        params: dict[str, Any] = {"page": page, "page_size": page_size}
        if capability:
            params["capability"] = capability
        if status:
            params["status"] = status
        if owner_handle:
            params["owner_handle"] = owner_handle

        resp = await self._async_http.get(f"{self._base_url}/discover", params=params)
        resp.raise_for_status()
        return DiscoverResult.from_dict(resp.json())

    # ── Messaging ──

    def send(
        self,
        recipient_id: str,
        message_type: str,
        payload: dict[str, Any],
        *,
        correlation_id: str | None = None,
    ) -> str:
        """Send a signed message. Returns message_id."""
        msg_body: dict[str, Any] = {
            "sender_agent_id": self.agent_id,
            "recipient_agent_id": recipient_id,
            "message_type": message_type,
            "payload": payload,
        }
        if correlation_id:
            msg_body["correlation_id"] = correlation_id

        # Sign canonical message
        canonical = _canonicalize(msg_body)
        msg_body["signature"] = self._sign(canonical)

        resp = self._http.post(
            f"{self._base_url}/messages/send",
            json=msg_body,
            headers=self._auth_headers(),
        )
        resp.raise_for_status()
        return resp.json()["message_id"]

    async def asend(
        self,
        recipient_id: str,
        message_type: str,
        payload: dict[str, Any],
        *,
        correlation_id: str | None = None,
    ) -> str:
        msg_body: dict[str, Any] = {
            "sender_agent_id": self.agent_id,
            "recipient_agent_id": recipient_id,
            "message_type": message_type,
            "payload": payload,
        }
        if correlation_id:
            msg_body["correlation_id"] = correlation_id

        canonical = _canonicalize(msg_body)
        msg_body["signature"] = self._sign(canonical)

        resp = await self._async_http.post(
            f"{self._base_url}/messages/send",
            json=msg_body,
            headers=self._auth_headers(),
        )
        resp.raise_for_status()
        return resp.json()["message_id"]

    # ── Message retrieval ──

    def get_messages(
        self,
        *,
        direction: str = "inbox",
        message_type: str | None = None,
        correlation_id: str | None = None,
        since: str | None = None,
        limit: int = 50,
    ) -> list[Message]:
        """Retrieve messages from inbox or outbox."""
        params: dict[str, Any] = {
            "agent_id": self.agent_id,
            "direction": direction,
            "limit": limit,
        }
        if message_type:
            params["message_type"] = message_type
        if correlation_id:
            params["correlation_id"] = correlation_id
        if since:
            params["since"] = since

        resp = self._http.get(
            f"{self._base_url}/messages",
            params=params,
            headers=self._auth_headers(),
        )
        resp.raise_for_status()
        return [Message.from_dict(m) for m in resp.json().get("messages", [])]

    async def aget_messages(
        self,
        *,
        direction: str = "inbox",
        message_type: str | None = None,
        correlation_id: str | None = None,
        since: str | None = None,
        limit: int = 50,
    ) -> list[Message]:
        params: dict[str, Any] = {
            "agent_id": self.agent_id,
            "direction": direction,
            "limit": limit,
        }
        if message_type:
            params["message_type"] = message_type
        if correlation_id:
            params["correlation_id"] = correlation_id
        if since:
            params["since"] = since

        resp = await self._async_http.get(
            f"{self._base_url}/messages",
            params=params,
            headers=self._auth_headers(),
        )
        resp.raise_for_status()
        return [Message.from_dict(m) for m in resp.json().get("messages", [])]

    # ── Task helpers ──

    def send_task(
        self,
        recipient_id: str,
        action: str,
        payload: dict[str, Any],
        *,
        timeout: float = 30.0,
        poll_interval: float = 1.0,
    ) -> dict[str, Any]:
        """Send a task_request and poll for the result. Returns the result payload."""
        task_payload = {"action": action, **payload}
        msg_id = self.send(recipient_id, "task_request", task_payload)

        deadline = time.time() + timeout
        while time.time() < deadline:
            # Try correlation_id match first
            messages = self.get_messages(
                message_type="task_result",
                correlation_id=msg_id,
            )
            if messages:
                return messages[0].payload

            # Some agents don't set correlation_id — fall back to checking
            # all task_results from the recipient
            all_results = self.get_messages(message_type="task_result")
            for m in all_results:
                if m.sender_agent_id == recipient_id:
                    return m.payload

            # Also check for errors
            errors = self.get_messages(
                message_type="task_error",
                correlation_id=msg_id,
            )
            if errors:
                error_payload = errors[0].payload
                raise RuntimeError(
                    f"Task failed: {error_payload.get('error', 'Unknown error')}"
                )

            time.sleep(poll_interval)

        raise TimeoutError(f"No response within {timeout}s for task {msg_id}")

    async def asend_task(
        self,
        recipient_id: str,
        action: str,
        payload: dict[str, Any],
        *,
        timeout: float = 30.0,
        poll_interval: float = 1.0,
    ) -> dict[str, Any]:
        """Async version of send_task()."""
        import asyncio

        task_payload = {"action": action, **payload}
        msg_id = await self.asend(recipient_id, "task_request", task_payload)

        deadline = time.time() + timeout
        while time.time() < deadline:
            messages = await self.aget_messages(
                message_type="task_result",
                correlation_id=msg_id,
            )
            if messages:
                return messages[0].payload

            errors = await self.aget_messages(
                message_type="task_error",
                correlation_id=msg_id,
            )
            if errors:
                error_payload = errors[0].payload
                raise RuntimeError(
                    f"Task failed: {error_payload.get('error', 'Unknown error')}"
                )

            await asyncio.sleep(poll_interval)

        raise TimeoutError(f"No response within {timeout}s for task {msg_id}")

    # ── Balance ──

    def get_balance(self) -> int:
        """Get this agent's token balance."""
        resp = self._http.get(
            f"{self._base_url}/balance",
            params={"agent_id": self.agent_id},
            headers=self._auth_headers(),
        )
        resp.raise_for_status()
        return resp.json().get("balance", 0)

    async def aget_balance(self) -> int:
        resp = await self._async_http.get(
            f"{self._base_url}/balance",
            params={"agent_id": self.agent_id},
            headers=self._auth_headers(),
        )
        resp.raise_for_status()
        return resp.json().get("balance", 0)

    # ── Cleanup ──

    def close(self) -> None:
        """Close HTTP connections."""
        self._http.close()

    async def aclose(self) -> None:
        await self._async_http.aclose()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        await self.aclose()
