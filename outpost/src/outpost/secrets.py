"""Connector secret envelopes.

Production: AWS KMS GenerateDataKey with encryption context {tenant_id, connector_id}, AES-GCM on the
payload, ciphertext = encrypted data key || nonce || payload. The tenant's key policy grants Decrypt
only with that context. DevEnvelope exists so the skeleton runs without KMS and is refused outside dev.
"""

from __future__ import annotations

import base64
import json
from typing import Any, Protocol
from uuid import UUID


class Envelope(Protocol):
    def seal(self, tenant_id: UUID, connector_id: UUID, payload: dict[str, Any]) -> tuple[bytes, str, dict]: ...
    def open(self, tenant_id: UUID, connector_id: UUID, ciphertext: bytes, context: dict) -> dict[str, Any]: ...


class DevEnvelope:
    """Base64 with a context check. NOT encryption. Refused unless settings.is_dev."""

    kms_key_arn = "arn:aws:kms:dev:000000000000:key/dev-not-encrypted"

    def seal(self, tenant_id: UUID, connector_id: UUID, payload: dict[str, Any]) -> tuple[bytes, str, dict]:
        context = {"tenant_id": str(tenant_id), "connector_id": str(connector_id)}
        blob = base64.b64encode(json.dumps({"ctx": context, "payload": payload}).encode())
        return blob, self.kms_key_arn, context

    def open(self, tenant_id: UUID, connector_id: UUID, ciphertext: bytes, context: dict) -> dict[str, Any]:
        data = json.loads(base64.b64decode(ciphertext))
        if data["ctx"] != {"tenant_id": str(tenant_id), "connector_id": str(connector_id)} or data["ctx"] != context:
            raise PermissionError("encryption context mismatch")
        return data["payload"]
