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
    columns the model declares that the actual table is missing.

    SQLite's ALTER TABLE ADD COLUMN leaves every *existing* row's new
    column NULL, regardless of the model's Python-level default — so a
    bool field like `hidden: bool = False` silently becomes NULL, not
    False, on old rows. That's not just cosmetic: a query filtering
    `hidden == False` never matches SQL NULL, so old rows vanish from
    every list; and a non-Optional enum field like Task.recurrence fails
    to validate as NULL when a row is serialized back out. So every added
    column with a plain scalar default gets backfilled on the rows that
    were just given it.
    """
    with engine.connect() as conn:
        for table in SQLModel.metadata.sorted_tables:
            existing = {row[1] for row in conn.execute(text(f'PRAGMA table_info("{table.name}")'))}
            if not existing:
                continue  # table doesn't exist yet — create_all will make it whole
            for column in table.columns:
                if column.name not in existing:
                    col_type = column.type.compile(engine.dialect)
                    conn.execute(text(f'ALTER TABLE "{table.name}" ADD COLUMN "{column.name}" {col_type}'))

                # Backfill unconditionally, not just for columns just added
                # above — a column added by an earlier run of this same
                # (previously buggy) migration can already have NULLs
                # sitting in the database that this run needs to fix too.
                default = column.default
                if default is not None and getattr(default, "is_scalar", False):
                    value = default.arg
                    if isinstance(value, bool):
                        value = int(value)
                    conn.execute(
                        text(f'UPDATE "{table.name}" SET "{column.name}" = :val WHERE "{column.name}" IS NULL'),
                        {"val": value},
                    )
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
