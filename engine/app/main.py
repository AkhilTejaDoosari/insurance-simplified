"""FastAPI application factory."""

import logging
import re
import time
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import FastAPI, Request, Response
from fastapi.openapi.utils import get_openapi
from pydantic.json_schema import models_json_schema

from app import __version__
from app.api import extract, health
from app.core.config import Settings
from app.core.logging import configure_logging, trace_id_var
from app.schemas import CONTRACT_VERSION
from app.schemas.chat import ChatAnswer
from app.schemas.comparison import Comparison
from app.schemas.contacts import Contact
from app.schemas.document import Document
from app.schemas.extraction import Extraction
from app.schemas.facts import Fact
from app.schemas.jobs import Job
from app.schemas.plans import PlanFamily
from app.schemas.scoring import MatchScore, Need

# Every contract model is published in the OpenAPI file, even before a route uses it,
# so the web app's generated types cover the whole contract from day one.
CONTRACT_MODELS: tuple[type[Any], ...] = (
    Document,
    Fact,
    PlanFamily,
    Comparison,
    Need,
    MatchScore,
    ChatAnswer,
    Contact,
    Job,
    Extraction,
)

_TRACE_ID = re.compile(r"^[A-Za-z0-9-]{8,64}$")
log = logging.getLogger("engine.http")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    configure_logging(settings.log_level)
    app = FastAPI(
        title="Insurance Simplified engine",
        version=CONTRACT_VERSION,
        summary=f"Engine {__version__}",
    )
    app.state.settings = settings
    app.include_router(health.router)
    app.include_router(extract.router)

    @app.middleware("http")
    async def trace(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        incoming = request.headers.get("x-trace-id", "")
        trace_id = incoming if _TRACE_ID.match(incoming) else uuid.uuid4().hex
        token = trace_id_var.set(trace_id)
        started = time.perf_counter()
        try:
            response = await call_next(request)
            response.headers["x-trace-id"] = trace_id
            log.info(
                "request",
                extra={
                    "method": request.method,
                    "route": request.url.path,
                    "status": response.status_code,
                    "ms": round((time.perf_counter() - started) * 1000, 1),
                },
            )
            return response
        finally:
            trace_id_var.reset(token)

    def openapi() -> dict[str, Any]:
        if app.openapi_schema:
            return app.openapi_schema
        schema = get_openapi(title=app.title, version=app.version, routes=app.routes)
        _, defs = models_json_schema(
            [(m, "validation") for m in CONTRACT_MODELS],
            ref_template="#/components/schemas/{model}",
        )
        components = schema.setdefault("components", {}).setdefault("schemas", {})
        components.update(defs.get("$defs", {}))
        app.openapi_schema = schema
        return schema

    app.openapi = openapi  # type: ignore[method-assign]
    return app


app = create_app()
