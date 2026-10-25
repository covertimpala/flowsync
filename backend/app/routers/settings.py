from fastapi import APIRouter, Depends

from ..config import get_or_create_api_key, regenerate_api_key
from ..security import require_api_key, require_localhost

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("/bootstrap", dependencies=[Depends(require_localhost)])
def bootstrap() -> dict:
    """The *only* unauthenticated endpoint, and only reachable from
    localhost. The first-party web UI calls this once on load to fetch the
    API key, then attaches it to every other request — see
    frontend/src/api/client.ts. An external application instead gets its
    key from this same value shown on the Settings page."""
    return {"api_key": get_or_create_api_key()}


@router.post("/api-key/regenerate", dependencies=[Depends(require_api_key)])
def regenerate() -> dict:
    return {"api_key": regenerate_api_key()}
