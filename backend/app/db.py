from sqlmodel import Session, SQLModel, create_engine

from .config import DATABASE_URL

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})


def init_db() -> None:
    from . import models  # noqa: F401  (ensures tables are registered)

    SQLModel.metadata.create_all(engine)


def get_session():
    with Session(engine) as session:
        yield session
