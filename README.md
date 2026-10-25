# FlowSync

One calendar, one schedule, one todo list. FlowSync pulls your calendars
together, builds your day around them, tracks habits and rewards you for
keeping them, and tracks your budget — with a local Ollama model (and any
other application) able to propose changes that stay in a Pending inbox
until you accept them.

**Windows only for now** (Android client planned later). A Python backend
runs locally and serves a REST API; a React web UI talks to it over
`localhost` in your browser.

## Architecture

```
backend/   FastAPI + SQLite (SQLModel). Owns all data and business logic:
             scheduling, habit streaks/points, budget math, the Ollama
             suggestion engine, and Google/Outlook OAuth sync.
frontend/  React + TypeScript (Vite). A thin client over the REST API —
             no business logic lives here.
```

Everything — your tasks, events, habits, budget, and OAuth tokens — lives
in one SQLite file at `~/.flowsync/flowsync.db`. Nothing leaves your
machine except direct calls to Google's/Microsoft's calendar APIs (if you
connect them) and to your own local Ollama server.

### Why a backend + API instead of just a desktop app

The whole point of this version is that **FlowSync isn't the only thing
allowed to add to your schedule.** Any script, automation, or other local
app can call the same REST API your own web UI uses — a cron job, a
personal assistant, a note-taking app, whatever you build next. Three
origins for every task/event/habit:

- **local** — created in the FlowSync web UI. Confirmed immediately.
- **ai** — created by the Ollama suggestion engine (`POST /api/ai/suggest`).
  Lands as **pending**.
- **api** — created by an external application that sent its own
  `X-Client-Name` header. Lands as **pending**.

### AI Assistant

Beyond the suggestion engine, the **Assistant** page takes a free-text
instruction ("mark my grocery run as done and log a $40 expense") and
turns it into a reviewable plan — a list of concrete actions
(`POST /api/ai/command`) that sits untouched until you click **Accept**
(or **Deny**, or remove individual actions first). The model never
writes directly to the database; `PendingAction` rows are the only thing
it can create, and `services/action_executor.py` is the only thing that
turns an accepted one into a real change.

Local models with a "thinking" mode (Qwen3 and similar) are called with
`think: false` for this and the suggestion engine — both want structured
JSON back, not visible chain-of-thought, and leaving thinking on risks
the model spending its whole token budget on hidden reasoning and
returning nothing at all for a multi-part instruction.

Pending items show up in the **Pending** inbox at the top of the Today
page with Accept/Deny buttons — nothing an AI or another app proposes
becomes real until a person approves it. Accepting a pending calendar
event also gives you the option to push it to your connected Google/
Outlook calendar, or just keep it local.

## Setup

### Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --port 8000
```

[Install Ollama](https://ollama.com/download) and pull a model if you
haven't already — the default is `qwen3.5:4b`, but any instruction-
following model works (change it in the app's Settings page, or via
`PUT /api/ai/settings`):

```bash
ollama serve
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open the URL it prints (default `http://localhost:5173`). The frontend
proxies `/api/*` to the backend on port 8000 — see `vite.config.ts`.

## Using the API from another application

1. Open FlowSync's **Settings** page and copy the API key.
2. Send it as `X-API-Key` on every request, plus `X-Client-Name: <your
   app's name>` so people know where a pending item came from:

```bash
curl -X POST http://localhost:8000/api/tasks \
  -H "X-API-Key: <your key>" \
  -H "X-Client-Name: my-script" \
  -H "Content-Type: application/json" \
  -d '{"title": "Follow up with Sam", "priority": "high"}'
```

That task lands in the Pending inbox, not directly on the schedule — see
`backend/app/routers/pending.py` for the accept/deny endpoints. Full route
list: start the backend and visit `http://localhost:8000/docs` for the
interactive OpenAPI docs FastAPI generates automatically.

## Connecting Google Calendar / Outlook

Both use the OAuth 2.0 **device code** flow (RFC 8628): FlowSync shows you
a short code, you enter it at a URL in any browser, and the backend polls
until you approve it — no redirect URI or embedded browser needed.

**Google Calendar:**
1. [Google Cloud Console](https://console.cloud.google.com/) → create a
   project → **APIs & Services → Library** → enable the **Google Calendar
   API**.
2. **APIs & Services → Credentials → Create Credentials → OAuth client
   ID** → type **TVs and Limited Input devices** (required for device-code
   flow). Configure the consent screen first if prompted (External, your
   own email as a test user is enough).
3. Paste the **Client ID** into FlowSync's Calendar page under Google
   Calendar, then **Connect**.

**Outlook / Microsoft 365:**
1. [Azure Portal → App registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade)
   → **New registration** (any account type).
2. **Authentication → Advanced settings** → turn **Allow public client
   flows** to **Yes**.
3. **API permissions → Add a permission → Microsoft Graph → Delegated** →
   add `Calendars.ReadWrite` and `offline_access` → grant consent.
4. Paste the **Application (client) ID** into FlowSync's Calendar page
   under Outlook, then **Connect**.

Tokens are stored in the same local SQLite file as everything else — not
OS-level encrypted storage. Fine for a single-user local app; moving to an
OS keychain is a reasonable follow-up if that matters to you.

## License

Not yet chosen — add one before accepting external contributions.
