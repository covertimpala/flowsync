"""Heuristic importer for "whatever spreadsheet you already have" — no
fixed template required. Real personal finance spreadsheets are messy: a
transaction log, a sidebar info box, and a pivot table summary can all sit
on the same sheet, and the money column is rarely obviously named (is
"amount" a price or a quantity?). This module finds the actual transaction
table inside that mess and guesses which columns are date/amount/
description/category by header text and by sampling the data itself.

It is a heuristic, not a general spreadsheet-understanding AI — it won't
get every layout right. That's why importing is two steps: `parse_workbook`
never touches the database, so the caller always shows the user what was
detected (sheet, column mapping, a preview of rows, how many rows were
skipped) before anything is committed.
"""

from __future__ import annotations

import io
import re
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

import openpyxl

# Column-name keywords, best match first. A header containing an earlier
# keyword outranks one containing a later keyword.
_AMOUNT_KEYWORDS = [
    "total individual cost", "line total", "total cost", "total amount",
    "amount spent", "cost", "price", "expense", "value", "debit", "credit",
    "total", "amount",
]
_AMOUNT_DEPRIORITIZED = {"amount", "quantity", "qty", "count", "units", "number", "no"}
_DATE_KEYWORDS = ["timestamp", "date", "time"]
_CATEGORY_KEYWORDS = ["category", "type", "group", "tag", "account"]
_DESCRIPTION_KEYWORDS = ["description", "memo", "note", "item", "name", "food", "merchant", "payee"]
_INCOME_PATTERN = re.compile(r"income|credit|deposit|salary|refund", re.IGNORECASE)
_EXPENSE_PATTERN = re.compile(r"expense|debit|purchase|spend", re.IGNORECASE)

MAX_SCAN_ROWS = 3000
MAX_SCAN_COLS = 80


@dataclass
class ParsedTransaction:
    date: datetime
    amount_cents: int
    type: str  # "expense" | "income"
    note: str | None
    category: str | None


@dataclass
class ParsedImport:
    import_id: str
    sheet: str
    header_row: int
    columns: dict[str, str | None]  # role -> original header text
    total_rows_found: int
    skipped_rows: int
    transactions: list[ParsedTransaction] = field(default_factory=list)

    def preview(self, n: int = 10) -> list[dict]:
        return [
            {
                "date": t.date.isoformat(),
                "amount_cents": t.amount_cents,
                "type": t.type,
                "note": t.note,
                "category": t.category,
            }
            for t in self.transactions[:n]
        ]


class ExcelImportError(Exception):
    pass


def _norm(header: Any) -> str:
    return str(header).strip().lower().rstrip(":") if header is not None else ""


def _grid_for_sheet(ws) -> list[list[Any]]:
    rows = []
    for row in ws.iter_rows(
        min_row=1,
        max_row=min(ws.max_row, MAX_SCAN_ROWS),
        max_col=min(ws.max_column, MAX_SCAN_COLS),
        values_only=True,
    ):
        rows.append(list(row))
    return rows


def _find_header_runs(grid: list[list[Any]]) -> list[tuple[int, int, int]]:
    """Returns (row_idx, col_start, col_end) for every contiguous run of
    >=2 non-empty string cells — a candidate header row."""
    runs = []
    for r, row in enumerate(grid):
        c = 0
        while c < len(row):
            if isinstance(row[c], str) and row[c].strip():
                start = c
                while c < len(row) and isinstance(row[c], str) and row[c].strip():
                    c += 1
                if c - start >= 2:
                    runs.append((r, start, c - 1))
            else:
                c += 1
    return runs


def _score_candidate(grid: list[list[Any]], row: int, col_start: int, col_end: int) -> int:
    """How many of the rows below this header look like data continuing
    under it — the real heuristic that tells a transaction log (hundreds
    of rows) apart from a small info box or pivot summary (a handful)."""
    width = col_end - col_start + 1
    data_rows = 0
    blank_streak = 0
    for r in range(row + 1, min(len(grid), row + 1 + 2000)):
        line = grid[r][col_start : col_end + 1]
        non_empty = sum(1 for v in line if v is not None and v != "")
        if non_empty >= max(1, width // 2):
            data_rows += 1
            blank_streak = 0
        else:
            blank_streak += 1
            if blank_streak > 3:
                break
    return data_rows


def _best_table(grid: list[list[Any]]) -> tuple[int, int, int] | None:
    candidates = _find_header_runs(grid)
    if not candidates:
        return None
    scored = [(c, _score_candidate(grid, *c)) for c in candidates]
    scored.sort(key=lambda x: x[1], reverse=True)
    best, best_score = scored[0]
    if best_score < 3:
        return None
    return best


def _table_end_row(grid: list[list[Any]], header_row: int, col_start: int, col_end: int) -> int:
    width = col_end - col_start + 1
    blank_streak = 0
    end = header_row
    for r in range(header_row + 1, len(grid)):
        line = grid[r][col_start : col_end + 1]
        non_empty = sum(1 for v in line if v is not None and v != "")
        if non_empty >= max(1, width // 2):
            end = r
            blank_streak = 0
        else:
            blank_streak += 1
            if blank_streak > 3:
                break
    return end


def _is_number(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _is_datelike(v: Any) -> bool:
    return isinstance(v, (datetime, date))


def _classify_columns(
    grid: list[list[Any]], header_row: int, col_start: int, col_end: int, end_row: int
) -> dict[str, int | None]:
    headers = {c: _norm(grid[header_row][c]) for c in range(col_start, col_end + 1)}
    sample_rows = list(range(header_row + 1, min(end_row + 1, header_row + 1 + 100)))

    def column_values(c: int) -> list[Any]:
        return [grid[r][c] for r in sample_rows if r < len(grid)]

    date_col = None
    for c, h in headers.items():
        if any(kw in h for kw in _DATE_KEYWORDS):
            date_col = c
            break
    if date_col is None:
        for c in headers:
            vals = column_values(c)
            if vals and sum(_is_datelike(v) for v in vals) / len(vals) > 0.5:
                date_col = c
                break

    amount_col = None
    best_rank = -1
    for c, h in headers.items():
        if c == date_col:
            continue
        vals = column_values(c)
        if not vals or sum(_is_number(v) for v in vals) / len(vals) <= 0.5:
            continue
        rank = 0
        for i, kw in enumerate(_AMOUNT_KEYWORDS):
            if kw in h:
                rank = max(rank, len(_AMOUNT_KEYWORDS) - i)
        if rank == 0 and h in _AMOUNT_DEPRIORITIZED:
            rank = 1
        if rank > best_rank:
            best_rank = rank
            amount_col = c

    category_col = None
    for c, h in headers.items():
        if c in (date_col, amount_col) and any(kw in h for kw in _CATEGORY_KEYWORDS) is False:
            continue
        if any(kw in h for kw in _CATEGORY_KEYWORDS):
            category_col = c
            break

    description_col = None
    for c, h in headers.items():
        if c in (date_col, amount_col, category_col):
            continue
        if any(kw in h for kw in _DESCRIPTION_KEYWORDS):
            description_col = c
            break
    if description_col is None:
        best_len = -1.0
        for c, h in headers.items():
            if c in (date_col, amount_col, category_col):
                continue
            vals = [v for v in column_values(c) if isinstance(v, str)]
            if not vals:
                continue
            avg_len = sum(len(v) for v in vals) / len(vals)
            if avg_len > best_len:
                best_len = avg_len
                description_col = c

    type_col = None
    for c, h in headers.items():
        if "type" in h or "debit" in h or "credit" in h:
            type_col = c
            break

    return {
        "date": date_col,
        "amount": amount_col,
        "description": description_col,
        "category": category_col,
        "type": type_col,
    }


def parse_workbook(file_bytes: bytes) -> ParsedImport:
    try:
        wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True, read_only=True)
    except Exception as e:  # noqa: BLE001 — surfaced to the user as-is
        raise ExcelImportError(f"Couldn't open that file as an Excel workbook: {e}")

    best = None  # (sheet_name, grid, header_row, col_start, col_end, score)
    for sheet_name in wb.sheetnames:
        grid = _grid_for_sheet(wb[sheet_name])
        table = _best_table(grid)
        if table is None:
            continue
        header_row, col_start, col_end = table
        score = _score_candidate(grid, header_row, col_start, col_end)
        if best is None or score > best[5]:
            best = (sheet_name, grid, header_row, col_start, col_end, score)

    if best is None:
        raise ExcelImportError(
            "Couldn't find a table that looks like a list of transactions in this file."
        )

    sheet_name, grid, header_row, col_start, col_end, _ = best
    end_row = _table_end_row(grid, header_row, col_start, col_end)
    columns = _classify_columns(grid, header_row, col_start, col_end, end_row)

    if columns["date"] is None or columns["amount"] is None:
        raise ExcelImportError(
            "Found a table, but couldn't confidently tell which column is the date and "
            "which is the amount. Try a simpler export (one transaction per row, a date "
            "column, and an amount column)."
        )

    headers = {c: grid[header_row][c] for c in range(col_start, col_end + 1)}
    transactions: list[ParsedTransaction] = []
    skipped = 0

    for r in range(header_row + 1, end_row + 1):
        if r >= len(grid):
            break
        row = grid[r]
        raw_date = row[columns["date"]]
        raw_amount = row[columns["amount"]]

        if not _is_datelike(raw_date) or not _is_number(raw_amount):
            skipped += 1
            continue

        amount = float(raw_amount)
        tx_type = "expense"
        if columns["type"] is not None:
            raw_type = str(row[columns["type"]] or "")
            if _INCOME_PATTERN.search(raw_type):
                tx_type = "income"
            elif _EXPENSE_PATTERN.search(raw_type):
                tx_type = "expense"
        elif amount < 0:
            tx_type = "expense"

        note = None
        if columns["description"] is not None:
            raw_note = row[columns["description"]]
            note = str(raw_note).strip()[:200] if raw_note is not None else None

        category = None
        if columns["category"] is not None:
            raw_cat = row[columns["category"]]
            category = str(raw_cat).strip() if raw_cat is not None else None

        dt = raw_date if isinstance(raw_date, datetime) else datetime.combine(raw_date, datetime.min.time())
        transactions.append(
            ParsedTransaction(
                date=dt,
                amount_cents=round(abs(amount) * 100),
                type=tx_type,
                note=note,
                category=category,
            )
        )

    return ParsedImport(
        import_id=str(uuid.uuid4()),
        sheet=sheet_name,
        header_row=header_row + 1,  # 1-indexed for display
        columns={role: (str(headers[c]) if c is not None else None) for role, c in columns.items()},
        total_rows_found=end_row - header_row,
        skipped_rows=skipped,
        transactions=transactions,
    )
