from sqlalchemy import text
from sqlmodel import Session, SQLModel, create_engine

from .config import DATABASE_URL

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})


def _add_missing_columns() -> None:
    """`SQLModel.metadata.create_all` only creates tables that don't exist
    yet — it never alters an existing table, so adding a field to a model
    (like Task.category_id) would silently vanish against a database that
    was created before that field existed. This is FlowSync's one-person
    answer to a schema migration tool: for every known table, add whatever
    columns the model declares that the actual table is missing. Safe
    because every field added after a table's first release is, and must
    stay, nullable or defaulted — there's no data to backfill it with."""
    with engine.connect() as conn:
        for table in SQLModel.metadata.sorted_tables:
            existing = {row[1] for row in conn.execute(text(f'PRAGMA table_info("{table.name}")'))}
            if not existing:
                continue  # table doesn't exist yet — create_all will make it whole
            for column in table.columns:
                if column.name in existing:
                    continue
                col_type = column.type.compile(engine.dialect)
                conn.execute(text(f'ALTER TABLE "{table.name}" ADD COLUMN "{column.name}" {col_type}'))
        conn.commit()


def init_db() -> None:
    from . import models  # noqa: F401  (ensures tables are registered)

    SQLModel.metadata.create_all(engine)
    _add_missing_columns()


def get_session():
    # expire_on_commit=False: several routes commit partway through a
    # request (e.g. persisting an auto-planned task's slot) and then go on
    # to serialize objects fetched earlier in the same request. The
    # default would mark those objects "expired" at commit, and FastAPI's
    # response serialization doesn't know to re-fetch them — they'd come
    # back from the API as empty objects even though they exist in the DB.
    with Session(engine, expire_on_commit=False) as session:
        yield session
