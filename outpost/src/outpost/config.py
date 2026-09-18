from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Settings:
    app_dsn: str
    provisioner_dsn: str
    admin_dsn: str | None
    jwt_secret: str
    jwt_issuer: str = "outpost"
    token_ttl_seconds: int = 900
    env: str = "dev"

    @classmethod
    def from_env(cls) -> Settings:
        return cls(
            app_dsn=os.environ["OUTPOST_APP_DSN"],
            provisioner_dsn=os.environ["OUTPOST_PROVISIONER_DSN"],
            admin_dsn=os.environ.get("OUTPOST_ADMIN_DSN") or None,
            jwt_secret=os.environ["OUTPOST_JWT_SECRET"],
            jwt_issuer=os.environ.get("OUTPOST_JWT_ISSUER", "outpost"),
            token_ttl_seconds=int(os.environ.get("OUTPOST_TOKEN_TTL", "900")),
            env=os.environ.get("OUTPOST_ENV", "dev"),
        )

    @property
    def is_dev(self) -> bool:
        return self.env == "dev"
