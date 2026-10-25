from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .db import init_db
from .routers import ai, budget, calendar_oauth, events, habits, pending, schedule, settings, tasks

app = FastAPI(title="FlowSync API", version="0.1.0")

# The React dev server (Vite, default 5173) and a future production build
# served from somewhere else on localhost both need this. Since everything
# here runs on localhost under a per-install API key (see security.py),
# a permissive localhost CORS policy doesn't widen the real trust boundary.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    init_db()


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


for router in (tasks.router, events.router, habits.router, budget.router, pending.router, ai.router, calendar_oauth.router, schedule.router, settings.router):
    app.include_router(router)
