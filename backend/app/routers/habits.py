from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlmodel import Session, select

from ..db import get_session
from ..models import Habit, HabitLog, ItemStatus, Reward, TaskOrigin
from ..schemas import HabitCreate, RewardCreate
from ..security import require_api_key
from ..services.habit_rewards import mark_completed

router = APIRouter(prefix="/api/habits", tags=["habits"], dependencies=[Depends(require_api_key)])


@router.get("", response_model=list[Habit])
def list_habits(include_pending: bool = False, session: Session = Depends(get_session)):
    query = select(Habit).where(Habit.archived == False)  # noqa: E712
    if not include_pending:
        query = query.where(Habit.status == ItemStatus.confirmed)
    return session.exec(query.order_by(Habit.name)).all()


@router.post("", response_model=Habit)
def create_habit(
    body: HabitCreate,
    x_client_name: Optional[str] = Header(default=None),
    session: Session = Depends(get_session),
):
    is_external = x_client_name is not None
    habit = Habit(
        **body.model_dump(),
        origin=TaskOrigin.api if is_external else TaskOrigin.local,
        status=ItemStatus.pending if is_external else ItemStatus.confirmed,
        created_by=x_client_name,
    )
    session.add(habit)
    session.commit()
    session.refresh(habit)
    return habit


@router.post("/{habit_id}/complete", response_model=Habit)
def complete_habit(habit_id: int, session: Session = Depends(get_session)):
    habit = session.get(Habit, habit_id)
    if not habit:
        raise HTTPException(404, "Habit not found")

    today = datetime.now()
    already = session.exec(
        select(HabitLog).where(
            HabitLog.habit_id == habit_id,
            HabitLog.completed_on >= today.replace(hour=0, minute=0, second=0, microsecond=0),
        )
    ).first()
    if already:
        return habit

    last_log = session.exec(
        select(HabitLog).where(HabitLog.habit_id == habit_id).order_by(HabitLog.completed_on.desc())
    ).first()
    previous = last_log.completed_on if last_log else None

    session.add(HabitLog(habit_id=habit_id, completed_on=today))
    mark_completed(habit, today, previous)
    session.add(habit)
    session.commit()
    session.refresh(habit)
    return habit


def _available_points(session: Session) -> int:
    earned = 0
    for habit in session.exec(select(Habit)).all():
        log_count = len(session.exec(select(HabitLog).where(HabitLog.habit_id == habit.id)).all())
        earned += log_count * habit.points_per_completion
    spent = sum(r.point_cost for r in session.exec(select(Reward).where(Reward.redeemed == True)).all())  # noqa: E712
    return earned - spent


@router.get("/points")
def available_points(session: Session = Depends(get_session)) -> dict:
    return {"points": _available_points(session)}


@router.get("/rewards", response_model=list[Reward])
def list_rewards(session: Session = Depends(get_session)):
    return session.exec(select(Reward).order_by(Reward.point_cost)).all()


@router.post("/rewards", response_model=Reward)
def create_reward(body: RewardCreate, session: Session = Depends(get_session)):
    reward = Reward(**body.model_dump())
    session.add(reward)
    session.commit()
    session.refresh(reward)
    return reward


@router.post("/rewards/{reward_id}/redeem", response_model=Reward)
def redeem_reward(reward_id: int, session: Session = Depends(get_session)):
    reward = session.get(Reward, reward_id)
    if not reward:
        raise HTTPException(404, "Reward not found")
    points = _available_points(session)
    if points < reward.point_cost:
        raise HTTPException(400, f"Need {reward.point_cost - points} more points")
    reward.redeemed = True
    session.add(reward)
    session.commit()
    session.refresh(reward)
    return reward
