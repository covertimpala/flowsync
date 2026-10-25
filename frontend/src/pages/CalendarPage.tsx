import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api/client';
import { TaskCheckbox } from '../components/TaskCheckbox';
import { celebrateTaskCompletion } from '../lib/celebrate';
import type { CalendarEvent, DeviceCodeInfo, Task } from '../types';

function startOfDay(d: Date) {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

type Timescale = 'week' | 'month' | '3m' | 'all' | 'custom';

const TIMESCALE_OPTIONS: { value: Timescale; label: string }[] = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: '3m', label: '3 months' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom' },
];

export function CalendarPage() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [tasksWithDueDates, setTasksWithDueDates] = useState<Task[]>([]);
  const [bounds, setBounds] = useState<{ earliest: string | null; latest: string | null }>({
    earliest: null,
    latest: null,
  });
  const [newTitle, setNewTitle] = useState('');
  const [icsText, setIcsText] = useState('');
  const [showIcsBox, setShowIcsBox] = useState(false);
  const [googleStatus, setGoogleStatus] = useState<{ has_client_id: boolean; connected: boolean } | null>(null);
  const [outlookStatus, setOutlookStatus] = useState<{ has_client_id: boolean; connected: boolean } | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [deviceCode, setDeviceCode] = useState<DeviceCodeInfo | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const [timescale, setTimescaleRaw] = useState<Timescale>('week');
  const [offset, setOffset] = useState(0);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  function setTimescale(t: Timescale) {
    setTimescaleRaw(t);
    setOffset(0);
  }

  const range = useMemo(() => {
    const today = startOfDay(new Date());

    if (timescale === 'all') {
      const start = bounds.earliest ? startOfDay(new Date(bounds.earliest)) : today;
      const end = bounds.latest
        ? new Date(startOfDay(new Date(bounds.latest)).getTime() + 24 * 60 * 60 * 1000)
        : new Date(today.getTime() + 24 * 60 * 60 * 1000);
      return { start, end, label: 'All time', canNavigate: false };
    }

    if (timescale === 'custom') {
      const start = customStart ? new Date(customStart) : today;
      const end = customEnd ? new Date(new Date(customEnd).getTime() + 24 * 60 * 60 * 1000) : new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
      return { start, end, label: 'Custom range', canNavigate: false };
    }

    if (timescale === 'month') {
      const base = new Date(today.getFullYear(), today.getMonth() + offset, 1);
      const start = base;
      const end = new Date(base.getFullYear(), base.getMonth() + 1, 1);
      return { start, end, label: base.toLocaleString([], { month: 'long', year: 'numeric' }), canNavigate: true };
    }

    if (timescale === '3m') {
      const start = new Date(today.getFullYear(), today.getMonth() + offset * 3, 1);
      const end = new Date(start.getFullYear(), start.getMonth() + 3, 1);
      const label = `${start.toLocaleString([], { month: 'short' })} – ${new Date(end.getTime() - 1).toLocaleString([], { month: 'short', year: 'numeric' })}`;
      return { start, end, label, canNavigate: true };
    }

    // week
    const start = new Date(today.getTime() + offset * 7 * 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
    const label =
      offset === 0
        ? 'This week'
        : `${start.toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${new Date(end.getTime() - 1).toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
    return { start, end, label, canNavigate: true };
  }, [timescale, offset, customStart, customEnd, bounds]);

  async function load() {
    const qs = `start=${range.start.toISOString()}&end=${range.end.toISOString()}`;
    const [ev, tasks, g, o, b] = await Promise.all([
      api.get<CalendarEvent[]>(`/api/events?${qs}`),
      api.get<Task[]>('/api/tasks'),
      api.get(`/api/calendar/google/status`),
      api.get(`/api/calendar/outlook/status`),
      api.get<{ earliest: string | null; latest: string | null }>('/api/events/bounds'),
    ]);
    setEvents(ev);
    setTasksWithDueDates(
      tasks.filter((t) => t.due_date && new Date(t.due_date) >= range.start && new Date(t.due_date) < range.end),
    );
    setGoogleStatus(g as any);
    setOutlookStatus(o as any);
    setBounds(b);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.start.getTime(), range.end.getTime()]);

  async function addEvent(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    const start = new Date();
    start.setMinutes(0, 0, 0);
    start.setHours(start.getHours() + 1);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    await api.post('/api/events', {
      title: newTitle.trim(),
      start: start.toISOString(),
      end: end.toISOString(),
    });
    setNewTitle('');
    load();
  }

  async function deleteEvent(id: number) {
    await api.delete(`/api/events/${id}`);
    load();
  }

  async function toggleTask(id: number, completed: boolean, origin: { x: number; y: number }) {
    const completing = !completed;
    await api.patch(`/api/tasks/${id}`, { completed: completing });
    if (completing) celebrateTaskCompletion(origin);
    load();
  }

  async function importIcs() {
    if (!icsText.trim()) return;
    const imported = await api.post<CalendarEvent[]>('/api/events/import-ics', { ics_text: icsText });
    setIcsText('');
    setShowIcsBox(false);
    setSyncMessage(`Imported ${imported.length} events`);
    load();
  }

  async function connect(provider: 'google' | 'outlook') {
    setConnecting(provider);
    try {
      const code = await api.post<DeviceCodeInfo>(`/api/calendar/${provider}/connect/start`);
      setDeviceCode(code);
      window.open(code.verification_uri, '_blank');
      await api.post(`/api/calendar/${provider}/connect/finish`, code);
      setDeviceCode(null);
      await syncNow();
      load();
    } catch (e) {
      setSyncMessage(e instanceof ApiError ? e.message : String(e));
      setDeviceCode(null);
    } finally {
      setConnecting(null);
    }
  }

  async function syncNow() {
    const result = await api.post<{ synced: Record<string, number> }>('/api/calendar/sync');
    const total = Object.values(result.synced).reduce((a, b) => a + b, 0);
    setSyncMessage(`Synced ${total} events`);
    load();
  }

  async function setClientId(provider: 'google' | 'outlook', clientId: string) {
    if (!clientId.trim()) return;
    await api.put(`/api/calendar/${provider}/client-id`, { client_id: clientId.trim() });
    load();
  }

  type DayItem = { kind: 'event'; event: CalendarEvent; time: string } | { kind: 'task'; task: Task; time: string };

  const groups = useMemo(() => {
    const byDay = new Map<string, DayItem[]>();
    for (const e of events) {
      const key = new Date(e.start).toDateString();
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key)!.push({ kind: 'event', event: e, time: e.start });
    }
    for (const t of tasksWithDueDates) {
      const key = new Date(t.due_date!).toDateString();
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key)!.push({ kind: 'task', task: t, time: t.due_date! });
    }
    for (const items of byDay.values()) {
      items.sort((a, b) => a.time.localeCompare(b.time));
    }
    return Array.from(byDay.entries()).sort(([a], [b]) => new Date(a).getTime() - new Date(b).getTime());
  }, [events, tasksWithDueDates]);

  const earliestLabel = bounds.earliest ? new Date(bounds.earliest).toLocaleDateString() : null;
  const latestLabel = bounds.latest ? new Date(bounds.latest).toLocaleDateString() : null;

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1>Calendar</h1>
          <p className="page-subtitle" style={{ marginBottom: 0 }}>
            {events.length} events
            {tasksWithDueDates.length > 0 && `, ${tasksWithDueDates.length} task due date${tasksWithDueDates.length === 1 ? '' : 's'}`} ·{' '}
            {range.label}
            {earliestLabel && latestLabel && (
              <span style={{ color: 'var(--text-faint)' }}> · data from {earliestLabel} to {latestLabel}</span>
            )}
          </p>
        </div>
        <div className="row">
          {range.canNavigate && (
            <div className="row" style={{ gap: 2 }}>
              <button className="btn btn-ghost" onClick={() => setOffset((o) => o - 1)} aria-label="Previous">
                <ChevronLeft size={16} />
              </button>
              <button className="btn btn-ghost" onClick={() => setOffset(0)} disabled={offset === 0}>
                Today
              </button>
              <button className="btn btn-ghost" onClick={() => setOffset((o) => o + 1)} aria-label="Next">
                <ChevronRight size={16} />
              </button>
            </div>
          )}
          <div className="row" style={{ background: 'var(--panel-2)', padding: 4, borderRadius: 10, border: '1px solid var(--border-soft)' }}>
            {TIMESCALE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className="btn btn-ghost"
                style={{
                  padding: '6px 12px',
                  fontSize: 13,
                  background: timescale === opt.value ? 'var(--accent)' : 'transparent',
                  color: timescale === opt.value ? 'white' : 'var(--text-dim)',
                  fontWeight: timescale === opt.value ? 600 : 500,
                }}
                onClick={() => setTimescale(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {timescale === 'custom' && (
        <div className="row" style={{ marginTop: 16, marginBottom: 4 }}>
          <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
          <span style={{ color: 'var(--text-dim)' }}>to</span>
          <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
        </div>
      )}

      <div className="card" style={{ marginTop: 20, marginBottom: 20 }}>
        <div className="card-title">Connect a calendar</div>
        <ProviderRow
          name="Google Calendar"
          status={googleStatus}
          busy={connecting === 'google'}
          onConnect={() => connect('google')}
          onClientId={(id) => setClientId('google', id)}
        />
        <ProviderRow
          name="Outlook / Microsoft 365"
          status={outlookStatus}
          busy={connecting === 'outlook'}
          onConnect={() => connect('outlook')}
          onClientId={(id) => setClientId('outlook', id)}
        />
        <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
          <button className="btn" onClick={syncNow}>
            Sync now
          </button>
          <button className="btn" onClick={() => setShowIcsBox((v) => !v)}>
            Paste .ics instead
          </button>
        </div>
        {syncMessage && <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>{syncMessage}</p>}

        {showIcsBox && (
          <div style={{ marginTop: 10 }}>
            <textarea
              style={{ width: '100%', minHeight: 100 }}
              placeholder="Paste .ics content here"
              value={icsText}
              onChange={(e) => setIcsText(e.target.value)}
            />
            <button className="btn btn-primary" style={{ marginTop: 6 }} onClick={importIcs}>
              Import
            </button>
          </div>
        )}

        {deviceCode && (
          <div className="card" style={{ marginTop: 10, background: 'var(--panel-2)' }}>
            <p>
              A browser tab opened to <code>{deviceCode.verification_uri}</code> — enter this code:
            </p>
            <p style={{ fontSize: 22, fontWeight: 700 }}>{deviceCode.user_code}</p>
            <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>Waiting for approval…</p>
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-title">Events &amp; task due dates</div>
        {groups.length === 0 ? (
          <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>Nothing in this range.</p>
        ) : (
          <div style={{ maxHeight: 480, overflowY: 'auto' }}>
            {groups.map(([day, items]) => (
              <div key={day} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)', marginBottom: 6 }}>
                  {new Date(day).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                </div>
                {items.map((item) =>
                  item.kind === 'event' ? (
                    <div key={`event-${item.event.id}`} className="row" style={{ padding: '6px 0' }}>
                      <span style={{ width: 20 }} />
                      <span className="badge">{item.event.source}</span>
                      <span style={{ color: 'var(--text-dim)', fontSize: 13, width: 80 }}>
                        {item.event.all_day
                          ? 'All day'
                          : new Date(item.event.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span style={{ flex: 1 }}>{item.event.title}</span>
                      {item.event.location && (
                        <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>{item.event.location}</span>
                      )}
                      <button className="btn btn-ghost" style={{ padding: '2px 6px' }} onClick={() => deleteEvent(item.event.id)}>
                        <X size={13} />
                      </button>
                    </div>
                  ) : (
                    <div key={`task-${item.task.id}`} className="row" style={{ padding: '6px 0' }}>
                      <TaskCheckbox
                        checked={item.task.completed}
                        onToggle={(_, origin) => toggleTask(item.task.id, item.task.completed, origin)}
                      />
                      <span className="badge badge-ai">Task due</span>
                      <span style={{ color: 'var(--text-dim)', fontSize: 13, width: 80 }}>
                        {new Date(item.task.due_date!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span
                        style={{
                          flex: 1,
                          textDecoration: item.task.completed ? 'line-through' : 'none',
                          color: item.task.completed ? 'var(--text-dim)' : 'var(--text)',
                        }}
                      >
                        {item.task.title}
                      </span>
                    </div>
                  ),
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <form className="card" onSubmit={addEvent} style={{ display: 'flex', gap: 8 }}>
        <input
          style={{ flex: 1 }}
          placeholder="Add an event (starts next hour)…"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
        />
        <button className="btn btn-primary" type="submit">
          Add
        </button>
      </form>
    </div>
  );
}

function ProviderRow({
  name,
  status,
  busy,
  onConnect,
  onClientId,
}: {
  name: string;
  status: { has_client_id: boolean; connected: boolean } | null;
  busy: boolean;
  onConnect: () => void;
  onClientId: (id: string) => void;
}) {
  const [clientId, setClientId] = useState('');

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0' }}>
      <span style={{ width: 200 }}>{name}</span>
      {status?.connected ? (
        <span className="badge badge-success">Connected</span>
      ) : status?.has_client_id ? (
        <button className="btn" onClick={onConnect} disabled={busy}>
          {busy ? 'Connecting…' : 'Connect'}
        </button>
      ) : (
        <>
          <input
            placeholder="OAuth client id"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            style={{ width: 260 }}
          />
          <button className="btn" onClick={() => onClientId(clientId)}>
            Save
          </button>
        </>
      )}
    </div>
  );
}
