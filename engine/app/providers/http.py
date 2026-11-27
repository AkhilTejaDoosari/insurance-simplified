"""The one HTTP path to model providers: HTTPS only, bounded retries, no body in errors.

Standard library only (no new dependency). Error messages carry status codes and
reason names, never response bodies or request content: both can echo the document.
"""

import json
import threading
import time
import urllib.error
import urllib.request
from typing import Any
from urllib.parse import urlparse

RETRYABLE = frozenset({408, 409, 429, 500, 502, 503, 504, 529})
_LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})


class ProviderError(RuntimeError):
    """A provider call failed. ``status`` is the HTTP status (0: no response)."""

    def __init__(self, provider: str, status: int, reason: str) -> None:
        super().__init__(f"{provider}: {reason} (status {status})")
        self.provider = provider
        self.status = status
        self.reason = reason


def require_secure(url: str, provider: str) -> None:
    """Document content leaves the engine only over TLS (local test servers excepted)."""
    parsed = urlparse(url)
    if parsed.scheme == "https":
        return
    if parsed.scheme == "http" and parsed.hostname in _LOCAL_HOSTS:
        return
    raise ProviderError(provider, 0, "insecure_transport_refused")


class RateLimiter:
    """Minimum spacing between calls (NVIDIA's free tier allows 40 requests a minute)."""

    def __init__(self, min_interval_s: float) -> None:
        self.min_interval_s = min_interval_s
        self._last = 0.0
        self._lock = threading.Lock()

    def wait(self) -> None:
        with self._lock:
            delay = self._last + self.min_interval_s - time.monotonic()
            if delay > 0:
                time.sleep(delay)
            self._last = time.monotonic()


def post_json(
    provider: str,
    url: str,
    headers: dict[str, str],
    body: dict[str, Any],
    *,
    timeout_s: float,
    max_attempts: int = 3,
    base_delay_s: float = 1.5,
    limiter: RateLimiter | None = None,
) -> dict[str, Any]:
    require_secure(url, provider)
    data = json.dumps(body).encode()
    last: ProviderError | None = None
    for attempt in range(1, max_attempts + 1):
        if limiter:
            limiter.wait()
        req = urllib.request.Request(  # noqa: S310 - scheme checked by require_secure
            url, data=data, method="POST", headers={"content-type": "application/json", **headers}
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout_s) as res:  # noqa: S310
                parsed: Any = json.loads(res.read())
                if not isinstance(parsed, dict):
                    raise ProviderError(provider, res.status, "response_not_an_object")
                return parsed
        except urllib.error.HTTPError as exc:
            last = ProviderError(provider, exc.code, "http_error")
            if exc.code not in RETRYABLE or attempt == max_attempts:
                raise last from None
            retry_after = exc.headers.get("retry-after") if exc.headers else None
            delay = _retry_after(retry_after) or base_delay_s * 2 ** (attempt - 1)
        except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
            last = ProviderError(provider, 0, type(exc).__name__)
            if attempt == max_attempts:
                raise last from None
            delay = base_delay_s * 2 ** (attempt - 1)
        except json.JSONDecodeError:
            raise ProviderError(provider, 200, "response_not_json") from None
        time.sleep(delay)
    raise last or ProviderError(provider, 0, "no_attempt")  # pragma: no cover


def get_json(provider: str, url: str, headers: dict[str, str], timeout_s: float) -> Any:
    require_secure(url, provider)
    req = urllib.request.Request(url, headers=headers)  # noqa: S310
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as res:  # noqa: S310
            return json.loads(res.read())
    except urllib.error.HTTPError as exc:
        raise ProviderError(provider, exc.code, "http_error") from None
    except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
        raise ProviderError(provider, 0, type(exc).__name__) from None


def _retry_after(value: str | None) -> float | None:
    try:
        seconds = float(value) if value else 0.0
    except ValueError:
        return None
    return min(seconds, 60.0) if seconds > 0 else None
