from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlmodel import Session, select

from ..db import get_session
from ..models import ItemStatus, Task, TaskCategory, TaskOrigin
from ..schemas import TaskCategoryCreate, TaskCreate, TaskUpdate
from ..security import require_api_key

router = APIRouter(prefix="/api/tasks", tags=["tasks"], dependencies=[Depends(require_api_key)])


@router.get("/categories", response_model=list[TaskCategory])
def list_categories(session: Session = Depends(get_session)):
    return session.exec(select(TaskCategory).order_by(TaskCategory.name)).all()


@router.post("/categories", response_model=TaskCategory)
def create_category(body: TaskCategoryCreate, session: Session = Depends(get_session)):
    category = TaskCategory(**body.model_dump())
    session.add(category)
    session.commit()
    session.refresh(category)
    return category


@router.delete("/categories/{category_id}")
def delete_category(category_id: int, session: Session = Depends(get_session)):
    category = session.get(TaskCategory, category_id)
    if category:
        session.delete(category)
        session.commit()
    return {"ok": True}


@router.get("", response_model=list[Task])
def list_tasks(include_pending: bool = False, session: Session = Depends(get_session)):
    query = select(Task)
    if not include_pending:
        query = query.where(Task.status == ItemStatus.confirmed)
    return session.exec(query.order_by(Task.due_date)).all()


@router.post("", response_model=Task)
def create_task(
    body: TaskCreate,
    x_client_name: Optional[str] = Header(default=None),
    session: Session = Depends(get_session),
):
    """Confirmed immediately when created from the first-party web UI
    (no X-Client-Name header). An external application should send
    `X-Client-Name: <its own name>` — the task is created `pending` so a
    person reviews it in the Pending inbox before it's treated as real."""
    is_external = x_client_name is not None
    task = Task(
        **body.model_dump(),
        origin=TaskOrigin.api if is_external else TaskOrigin.local,
        status=ItemStatus.pending if is_external else ItemStatus.confirmed,
        created_by=x_client_name,
    )
    session.add(task)
    session.commit()
    session.refresh(task)
    return task


@router.patch("/{task_id}", response_model=Task)
def update_task(task_id: int, body: TaskUpdate, session: Session = Depends(get_session)):
    task = session.get(Task, task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    updates = body.model_dump(exclude_unset=True)
    if "completed" in updates:
        updates["completed_at"] = datetime.now() if updates["completed"] else None
    for key, value in updates.items():
        setattr(task, key, value)
    session.add(task)
    session.commit()
    session.refresh(task)
    return task


@router.delete("/{task_id}")
def delete_task(task_id: int, session: Session = Depends(get_session)):
    task = session.get(Task, task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    session.delete(task)
    session.commit()
    return {"ok": True}
