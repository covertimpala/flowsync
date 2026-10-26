from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, File, Header, HTTPException, UploadFile
from pydantic import BaseModel
from sqlmodel import Session, select

from ..db import get_session
from ..models import BudgetCategory, BudgetEntry, BudgetEntryType, PendingAction
from ..schemas import BudgetCategoryCreate, BudgetCategoryUpdate, BudgetEntryCreate, BudgetEntryUpdate
from ..security import require_api_key
from ..services.api_guard import json_safe, stage_or_run
from ..services.excel_import import ExcelImportError, ParsedImport, parse_workbook
from ..services.note_grouping import group_notes
from ..time_utils import as_naive_local

router = APIRouter(prefix="/api/budget", tags=["budget"], dependencies=[Depends(require_api_key)])

# Parsed-but-not-yet-committed imports, keyed by import_id. Local
# single-process app, so an in-memory cache is fine — it's just the gap
# between showing the preview and the user clicking "Import" (or not).
_pending_imports: dict[str, ParsedImport] = {}


@router.get("/categories", response_model=list[BudgetCategory])
def list_categories(include_hidden: bool = False, session: Session = Depends(get_session)):
    query = select(BudgetCategory)
    if not include_hidden:
        query = query.where(BudgetCategory.hidden == False)  # noqa: E712
    return session.exec(query.order_by(BudgetCategory.name)).all()


@router.post("/categories")
def create_category(
    body: BudgetCategoryCreate,
    x_client_name: Optional[str] = Header(default=None),
    session: Session = Depends(get_session),
):
    def apply() -> BudgetCategory:
        category = BudgetCategory(**body.model_dump())
        session.add(category)
        session.commit()
        session.refresh(category)
        return category

    result = stage_or_run(
        session, x_client_name,
        action_type="create_budget_category",
        description=f'Add budget category "{body.name}"',
        payload={"name": body.name, "monthly_limit_cents": body.monthly_limit_cents},
        direct=apply,
    )
    if isinstance(result, PendingAction):
        return {"pending": True, "action_id": result.id, "plan_id": result.plan_id, "description": result.description}
    return result


@router.patch("/categories/{category_id}")
def update_category(
    category_id: int,
    body: BudgetCategoryUpdate,
    x_client_name: Optional[str] = Header(default=None),
    session: Session = Depends(get_session),
):
    category = session.get(BudgetCategory, category_id)
    if not category:
        raise HTTPException(404, "Category not found")
    updates = body.model_dump(exclude_unset=True)

    def apply() -> BudgetCategory:
        for key, value in updates.items():
            setattr(category, key, value)
        session.add(category)
        session.commit()
        session.refresh(category)
        return category

    changed = ", ".join(updates) or "fields"
    result = stage_or_run(
        session, x_client_name,
        action_type="api_update_budget_category",
        description=f'Update budget category "{category.name}" ({changed})',
        payload={"category_id": category_id, "updates": updates},
        direct=apply,
    )
    if isinstance(result, PendingAction):
        return {"pending": True, "action_id": result.id, "plan_id": result.plan_id, "description": result.description}
    return result


@router.delete("/categories/{category_id}")
def delete_category(
    category_id: int,
    x_client_name: Optional[str] = Header(default=None),
    session: Session = Depends(get_session),
):
    category = session.get(BudgetCategory, category_id)
    if not category:
        return {"ok": True}

    def apply() -> dict:
        in_use = session.exec(select(BudgetEntry).where(BudgetEntry.category_id == category_id).limit(1)).first()
        if in_use:
            raise HTTPException(
                400,
                "This category still has entries filed under it — hide it instead, "
                "or delete those entries first.",
            )
        session.delete(category)
        session.commit()
        return {"ok": True}

    result = stage_or_run(
        session, x_client_name,
        action_type="api_delete_budget_category",
        description=f'Delete budget category "{category.name}"',
        payload={"category_id": category_id},
        direct=apply,
    )
    if isinstance(result, PendingAction):
        return {"pending": True, "action_id": result.id, "plan_id": result.plan_id, "description": result.description}
    return result


@router.get("/entries", response_model=list[BudgetEntry])
def list_entries(
    start: datetime, end: datetime, include_hidden: bool = False, session: Session = Depends(get_session)
):
    start, end = as_naive_local(start), as_naive_local(end)
    query = select(BudgetEntry).where(BudgetEntry.date >= start, BudgetEntry.date < end)
    if not include_hidden:
        query = query.where(BudgetEntry.hidden == False)  # noqa: E712
    return session.exec(query.order_by(BudgetEntry.date.desc())).all()


@router.patch("/entries/{entry_id}")
def update_entry(
    entry_id: int,
    body: BudgetEntryUpdate,
    x_client_name: Optional[str] = Header(default=None),
    session: Session = Depends(get_session),
):
    entry = session.get(BudgetEntry, entry_id)
    if not entry:
        raise HTTPException(404, "Entry not found")
    updates = body.model_dump(exclude_unset=True)

    def apply() -> BudgetEntry:
        for key, value in updates.items():
            setattr(entry, key, value)
        session.add(entry)
        session.commit()
        session.refresh(entry)
        return entry

    changed = ", ".join(updates) or "fields"
    result = stage_or_run(
        session, x_client_name,
        action_type="api_update_budget_entry",
        description=f'Update budget entry "{entry.note or entry.type.value}" (${entry.amount_cents / 100:.2f}) — {changed}',
        payload={"entry_id": entry_id, "updates": json_safe(updates)},
        direct=apply,
    )
    if isinstance(result, PendingAction):
        return {"pending": True, "action_id": result.id, "plan_id": result.plan_id, "description": result.description}
    return result


@router.get("/bounds")
def bounds(session: Session = Depends(get_session)) -> dict:
    """The earliest and latest entry dates in the database, so the
    frontend can offer an accurate "All time" range and know how far back
    there's anything to show."""
    rows = session.exec(select(BudgetEntry.date)).all()
    if not rows:
        return {"earliest": None, "latest": None}
    return {"earliest": min(rows).isoformat(), "latest": max(rows).isoformat()}


@router.post("/entries")
def create_entry(
    body: BudgetEntryCreate,
    x_client_name: Optional[str] = Header(default=None),
    session: Session = Depends(get_session),
):
    def apply() -> BudgetEntry:
        entry = BudgetEntry(**body.model_dump())
        session.add(entry)
        session.commit()
        session.refresh(entry)
        return entry

    result = stage_or_run(
        session, x_client_name,
        action_type="create_budget_entry",
        description=f'Add {body.type.value} of ${body.amount_cents / 100:.2f}' + (f' — "{body.note}"' if body.note else ""),
        payload={
            "category_id": body.category_id,
            "amount_cents": body.amount_cents,
            "type": body.type.value,
            "date": body.date.isoformat(),
            "note": body.note,
        },
        direct=apply,
    )
    if isinstance(result, PendingAction):
        return {"pending": True, "action_id": result.id, "plan_id": result.plan_id, "description": result.description}
    return result


@router.delete("/entries/{entry_id}")
def delete_entry(
    entry_id: int,
    x_client_name: Optional[str] = Header(default=None),
    session: Session = Depends(get_session),
):
    entry = session.get(BudgetEntry, entry_id)
    if not entry:
        return {"ok": True}

    def apply() -> dict:
        session.delete(entry)
        session.commit()
        return {"ok": True}

    result = stage_or_run(
        session, x_client_name,
        action_type="api_delete_budget_entry",
        description=f'Delete budget entry "{entry.note or entry.type.value}" (${entry.amount_cents / 100:.2f})',
        payload={"entry_id": entry_id},
        direct=apply,
    )
    if isinstance(result, PendingAction):
        return {"pending": True, "action_id": result.id, "plan_id": result.plan_id, "description": result.description}
    return result


@router.get("/summary")
def summary(start: datetime, end: datetime, session: Session = Depends(get_session)) -> dict:
    entries = list_entries(start=start, end=end, session=session)
    categories = session.exec(select(BudgetCategory).where(BudgetCategory.hidden == False)).all()  # noqa: E712

    by_category = []
    net = 0
    for cat in categories:
        spent = sum(e.amount_cents for e in entries if e.category_id == cat.id and e.type == BudgetEntryType.expense)
        by_category.append({
            "category": cat.model_dump(),
            "spent_cents": spent,
            "over_limit": cat.monthly_limit_cents > 0 and spent > cat.monthly_limit_cents,
        })
    for e in entries:
        net += e.amount_cents if e.type == BudgetEntryType.income else -e.amount_cents

    return {"by_category": by_category, "net_cents": net}


def _next_month(d: datetime) -> datetime:
    return datetime(d.year + (d.month == 12), d.month % 12 + 1, 1)


@router.get("/history")
def history(start: datetime, end: datetime, session: Session = Depends(get_session)) -> dict:
    """Spend/income bucketed over [start, end) for the trend chart — daily
    buckets for a short range (a month or less), weekly for a few months,
    monthly beyond that, so "this month" shows actual daily movement
    instead of a single flat monthly bar."""
    start, end = as_naive_local(start), as_naive_local(end)
    span_days = max(1, (end - start).days)
    granularity = "day" if span_days <= 31 else "week" if span_days <= 183 else "month"

    def bucket_key(dt: datetime) -> datetime:
        d = dt.replace(hour=0, minute=0, second=0, microsecond=0)
        if granularity == "day":
            return d
        if granularity == "week":
            return d - timedelta(days=d.weekday())  # Monday of that week
        return d.replace(day=1)

    # Pre-seed every bucket in range so empty days/weeks/months still show
    # as zero points rather than being skipped on the chart.
    buckets: dict[datetime, dict[str, int]] = {}
    cursor = bucket_key(start)
    last = bucket_key(end - timedelta(microseconds=1))
    while cursor <= last:
        buckets[cursor] = {"spent_cents": 0, "income_cents": 0}
        if granularity == "day":
            cursor += timedelta(days=1)
        elif granularity == "week":
            cursor += timedelta(days=7)
        else:
            cursor = _next_month(cursor)

    entries = session.exec(
        select(BudgetEntry).where(
            BudgetEntry.date >= start, BudgetEntry.date < end, BudgetEntry.hidden == False  # noqa: E712
        )
    ).all()
    for e in entries:
        b = bucket_key(e.date)
        bucket = buckets.setdefault(b, {"spent_cents": 0, "income_cents": 0})
        if e.type == BudgetEntryType.expense:
            bucket["spent_cents"] += e.amount_cents
        else:
            bucket["income_cents"] += e.amount_cents

    points = [
        {
            "date": b.isoformat(),
            "spent_cents": data["spent_cents"],
            "income_cents": data["income_cents"],
            "net_cents": data["income_cents"] - data["spent_cents"],
        }
        for b, data in sorted(buckets.items())
    ]
    return {"granularity": granularity, "points": points}


@router.get("/analytics")
def analytics(start: datetime, end: datetime, session: Session = Depends(get_session)) -> dict:
    """Average spend per day/week/month/year over the range (matching the
    pivot-table-style summary the original spreadsheet had), plus
    spend-by-year and the top grouped items by total spend."""
    start, end = as_naive_local(start), as_naive_local(end)
    entries = session.exec(
        select(BudgetEntry).where(
            BudgetEntry.date >= start, BudgetEntry.date < end, BudgetEntry.hidden == False  # noqa: E712
        )
    ).all()
    expenses = [e for e in entries if e.type == BudgetEntryType.expense]
    total_spent = sum(e.amount_cents for e in expenses)

    span_days = max(1, (end - start).days)
    averages = {
        "per_day_cents": round(total_spent / span_days),
        "per_week_cents": round(total_spent / span_days * 7),
        "per_month_cents": round(total_spent / span_days * 30.44),
        "per_year_cents": round(total_spent / span_days * 365.25),
    }

    by_year: dict[int, int] = {}
    for e in expenses:
        by_year[e.date.year] = by_year.get(e.date.year, 0) + e.amount_cents
    spend_by_year = [{"year": y, "spent_cents": c} for y, c in sorted(by_year.items())]

    groups = group_notes([(e.note, e.amount_cents) for e in expenses])
    top_items = [
        {"label": g.label, "count": g.count, "total_cents": g.total_cents, "variants": g.notes}
        for g in groups[:15]
    ]

    return {
        "total_spent_cents": total_spent,
        "entry_count": len(expenses),
        "averages": averages,
        "spend_by_year": spend_by_year,
        "top_items": top_items,
    }


class ImportCommitRequest(BaseModel):
    import_id: str
    default_category_name: str = "Imported"


@router.post("/import/preview")
async def import_preview(file: UploadFile = File(...)) -> dict:
    content = await file.read()
    try:
        parsed = parse_workbook(content)
    except ExcelImportError as e:
        raise HTTPException(400, str(e))

    _pending_imports[parsed.import_id] = parsed
    # Keep the cache small — this is a convenience buffer, not storage.
    if len(_pending_imports) > 20:
        _pending_imports.pop(next(iter(_pending_imports)))

    return {
        "import_id": parsed.import_id,
        "sheet": parsed.sheet,
        "header_row": parsed.header_row,
        "columns": parsed.columns,
        "total_rows_found": parsed.total_rows_found,
        "parsed_count": len(parsed.transactions),
        "skipped_rows": parsed.skipped_rows,
        "preview": parsed.preview(),
        "detected_categories": sorted({t.category for t in parsed.transactions if t.category}),
    }


@router.post("/import/commit")
def import_commit(body: ImportCommitRequest, session: Session = Depends(get_session)) -> dict:
    parsed = _pending_imports.get(body.import_id)
    if parsed is None:
        raise HTTPException(404, "That import has expired — upload the file again.")

    category_cache: dict[str, BudgetCategory] = {}

    def get_or_create_category(name: str) -> BudgetCategory:
        if name in category_cache:
            return category_cache[name]
        existing = session.exec(select(BudgetCategory).where(BudgetCategory.name == name)).first()
        category = existing or BudgetCategory(name=name)
        if not existing:
            session.add(category)
            session.commit()
            session.refresh(category)
        category_cache[name] = category
        return category

    created = 0
    for t in parsed.transactions:
        category = get_or_create_category(t.category or body.default_category_name)
        session.add(BudgetEntry(
            category_id=category.id,
            amount_cents=t.amount_cents,
            type=BudgetEntryType(t.type),
            date=t.date,
            note=t.note,
        ))
        created += 1
    session.commit()

    del _pending_imports[body.import_id]
    return {"created": created, "categories_used": list(category_cache.keys())}
