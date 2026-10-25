import secrets
from pathlib import Path

# Everything FlowSync stores lives under one folder in the user's home
# directory, so backing up/wiping "all of FlowSync" is a single folder.
DATA_DIR = Path.home() / ".flowsync"
DATA_DIR.mkdir(parents=True, exist_ok=True)

DB_PATH = DATA_DIR / "flowsync.db"
DATABASE_URL = f"sqlite:///{DB_PATH}"

API_KEY_PATH = DATA_DIR / "api_key.txt"


def get_or_create_api_key() -> str:
    """The key external applications must send as `X-API-Key` to call the
    API. Generated once on first run and reused — regenerate via
    POST /api/settings/api-key/regenerate if it ever leaks."""
    if API_KEY_PATH.exists():
        return API_KEY_PATH.read_text().strip()
    key = secrets.token_urlsafe(32)
    API_KEY_PATH.write_text(key)
    return key


def regenerate_api_key() -> str:
    key = secrets.token_urlsafe(32)
    API_KEY_PATH.write_text(key)
    return key
