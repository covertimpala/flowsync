from datetime import datetime

from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from ..db import get_session
from ..models import BudgetCategory, BudgetEntry, BudgetEntryType
from ..schemas import BudgetCategoryCreate, BudgetEntryCreate
from ..security import require_api_key

router = APIRouter(prefix="/api/budget", tags=["budget"], dependencies=[Depends(require_api_key)])


@router.get("/categories", response_model=list[BudgetCategory])
def list_categories(session: Session = Depends(get_session)):
    return session.exec(select(BudgetCategory).order_by(BudgetCategory.name)).all()


@router.post("/categories", response_model=BudgetCategory)
def create_category(body: BudgetCategoryCreate, session: Session = Depends(get_session)):
    category = BudgetCategory(**body.model_dump())
    session.add(category)
    session.commit()
    session.refresh(category)
    return category


@router.get("/entries", response_model=list[BudgetEntry])
def list_entries(year: int, month: int, session: Session = Depends(get_session)):
    start = datetime(year, month, 1)
    end = datetime(year + (month == 12), (month % 12) + 1, 1)
    return session.exec(
        select(BudgetEntry).where(BudgetEntry.date >= start, BudgetEntry.date < end).order_by(BudgetEntry.date.desc())
    ).all()


@router.post("/entries", response_model=BudgetEntry)
def create_entry(body: BudgetEntryCreate, session: Session = Depends(get_session)):
    entry = BudgetEntry(**body.model_dump())
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return entry


@router.delete("/entries/{entry_id}")
def delete_entry(entry_id: int, session: Session = Depends(get_session)):
    entry = session.get(BudgetEntry, entry_id)
    if entry:
        session.delete(entry)
        session.commit()
    return {"ok": True}


@router.get("/summary")
def summary(year: int, month: int, session: Session = Depends(get_session)) -> dict:
    entries = list_entries(year, month, session)
    categories = session.exec(select(BudgetCategory)).all()

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
