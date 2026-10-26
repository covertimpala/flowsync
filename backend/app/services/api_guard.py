"""Extends the "nothing an external app does becomes real until a person
approves it" pattern from creation (see routers/tasks.py etc.) to editing
and deleting existing items.

A request from the FlowSync web UI never carries X-Client-Name, so it
behaves exactly as before — applied immediately. A request carrying that
header is from some other application holding the API key, and is staged
as a PendingAction for a person to review in the main Pending inbox
instead of taking effect.
"""

import json
import uuid
from datetime import datetime
from typing import Callable, TypeVar

from sqlmodel import Session

from ..models import ItemStatus, PendingAction

T = TypeVar("T")


def json_safe(d: dict) -> dict:
    """datetime values survive a PendingAction's payload_json round trip
    (set aside now, parsed back with datetime.fromisoformat() once
    accepted) only if they're turned into ISO strings going in — plain
    json.dumps(default=str) would use str(datetime) instead, which isn't
    guaranteed to be what fromisoformat() expects."""
    return {k: (v.isoformat() if isinstance(v, datetime) else v) for k, v in d.items()}


def stage_or_run(
    session: Session,
    x_client_name: str | None,
    action_type: str,
    description: str,
    payload: dict,
    direct: Callable[[], T],
) -> T | PendingAction:
    if x_client_name is None:
        return direct()
    action = PendingAction(
        plan_id=str(uuid.uuid4()),
        action_type=action_type,
        description=description,
        payload_json=json.dumps(payload, default=str),
        status=ItemStatus.pending,
        created_at=datetime.now(),
        created_by=x_client_name,
    )
    session.add(action)
    session.commit()
    session.refresh(action)
    return action
