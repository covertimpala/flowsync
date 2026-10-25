from datetime import datetime


def as_naive_local(dt: datetime) -> datetime:
    """FlowSync stores every timestamp as naive *local* wall-clock time
    (see models.py). The frontend sends `Date.toISOString()` values, which
    are timezone-aware UTC — e.g. local midnight becomes "...T22:00:00Z" in
    UTC+2. Blindly stripping tzinfo from that would keep the UTC clock
    numbers and silently misinterpret them as local time, shifting every
    range by the timezone offset. Converting to the system's local
    timezone first, then dropping tzinfo, is what actually round-trips
    back to the local wall-clock moment the frontend meant.

    A datetime that's already naive (no tzinfo) is assumed to already be
    local time and is returned unchanged.
    """
    if dt.tzinfo is None:
        return dt
    return dt.astimezone().replace(tzinfo=None)
