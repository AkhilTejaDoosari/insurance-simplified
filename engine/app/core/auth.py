"""Service-to-service auth: only the web app may call /v1 routes."""

import hmac
from typing import Annotated

from fastapi import Depends, Header, HTTPException, Request

from app.core.config import Settings


def get_settings(request: Request) -> Settings:
    settings: Settings = request.app.state.settings
    return settings


def require_service_token(
    settings: Annotated[Settings, Depends(get_settings)],
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    if settings.service_token is None:
        raise HTTPException(503, detail={"code": "NOT_CONFIGURED"})
    expected = f"Bearer {settings.service_token}"
    if authorization is None or not hmac.compare_digest(authorization, expected):
        raise HTTPException(401, detail={"code": "SERVICE_AUTH_REQUIRED"})
