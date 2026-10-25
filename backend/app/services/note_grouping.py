"""Groups budget entry notes that are "the same purchase" written slightly
differently — "kjøttdeig" vs "svinekjøttdeig", a typo, a plural — so
analytics like "top items" aggregate them instead of listing near-duplicates
as unrelated one-off rows.

No ML, no extra dependency: stdlib difflib.SequenceMatcher similarity plus
a substring check (catches "X" being a shorter/longer variant of "Y", which
SequenceMatcher alone under-scores for very different lengths), greedily
assigned to whichever existing cluster matches best, in descending order of
how common each note already is — so a cluster's label ends up being its
most frequent member, not whichever note happened to appear first.
"""

from __future__ import annotations

from dataclasses import dataclass
from difflib import SequenceMatcher

SIMILARITY_THRESHOLD = 0.6


@dataclass
class NoteGroup:
    label: str
    notes: list[str]
    count: int
    total_cents: int


def _normalize(note: str) -> str:
    return " ".join(note.strip().lower().split())


def _similar(a: str, b: str) -> bool:
    if a == b:
        return True
    if len(a) >= 4 and len(b) >= 4 and (a in b or b in a):
        return True
    return SequenceMatcher(None, a, b).ratio() >= SIMILARITY_THRESHOLD


def group_notes(entries: list[tuple[str | None, int]]) -> list[NoteGroup]:
    """`entries` is a list of (note, amount_cents) for expense rows. Notes
    that are None/blank are skipped — there's nothing to group them by.
    Returns groups sorted by total spend, descending."""
    per_note: dict[str, dict] = {}
    for note, amount in entries:
        if not note or not note.strip():
            continue
        key = _normalize(note)
        bucket = per_note.setdefault(key, {"original": note, "count": 0, "total_cents": 0})
        bucket["count"] += 1
        bucket["total_cents"] += amount

    # Most-frequent-first so a cluster's representative label is whichever
    # spelling actually shows up most, and so bigger clusters form first
    # rather than being split by whichever note happened to come first.
    ordered = sorted(per_note.items(), key=lambda kv: kv[1]["count"], reverse=True)

    clusters: list[dict] = []  # each: {key, original, count, total_cents, members: [original,...]}
    for key, data in ordered:
        match = next((c for c in clusters if _similar(key, c["key"])), None)
        if match is None:
            clusters.append({
                "key": key,
                "original": data["original"],
                "count": data["count"],
                "total_cents": data["total_cents"],
                "members": [data["original"]],
            })
        else:
            match["count"] += data["count"]
            match["total_cents"] += data["total_cents"]
            match["members"].append(data["original"])

    groups = [
        NoteGroup(label=c["original"], notes=c["members"], count=c["count"], total_cents=c["total_cents"])
        for c in clusters
    ]
    groups.sort(key=lambda g: g.total_cents, reverse=True)
    return groups
