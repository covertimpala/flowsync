from fastapi import Header, HTTPException, Request

from .config import get_or_create_api_key


async def require_api_key(x_api_key: str | None = Header(default=None)) -> None:
    """Every /api/* route (used by both the first-party web UI and any
    external application) requires this header. The web UI fetches the key
    once from /api/settings/bootstrap (localhost-only, no key needed) and
    attaches it to every request after that — see frontend/src/api/client.ts.
    An external application gets its key from the Settings page and does
    the same."""
    if x_api_key != get_or_create_api_key():
        raise HTTPException(status_code=401, detail="Missing or invalid X-API-Key header")


async def require_localhost(request: Request) -> None:
    host = request.client.host if request.client else None
    if host not in ("127.0.0.1", "::1", "localhost"):
        raise HTTPException(status_code=403, detail="This endpoint only answers requests from localhost")
