"""Settings from the environment. Values are never logged; only names appear in errors."""

import os
from dataclasses import dataclass
from enum import StrEnum


class Environment(StrEnum):
    DEVELOPMENT = "development"
    TEST = "test"
    PRODUCTION = "production"


@dataclass(frozen=True)
class Settings:
    environment: Environment
    service_token: str | None
    log_level: str

    @classmethod
    def from_env(cls) -> "Settings":
        token = os.environ.get("ENGINE_SERVICE_TOKEN") or None
        return cls(
            environment=Environment(os.environ.get("ENGINE_ENV", "production")),
            service_token=token,
            log_level=os.environ.get("ENGINE_LOG_LEVEL", "INFO").upper(),
        )
