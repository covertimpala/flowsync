import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import { PendingSection } from '../components/PendingSection';
import type { PendingInbox, ScheduleResponse, TaskPriority } from '../types';

export function TodayPage() {
  const [schedule, setSchedule] = useState<ScheduleResponse | null>(null);
  const [pending, setPending] = useState<PendingInbox | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [asking, setAsking] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  async function load() {
    const [s, p] = await Promise.all([
      api.get<ScheduleResponse>('/api/schedule'),
      api.get<PendingInbox>('/api/pending'),
    ]);
    setSchedule(s);
    setPending(p);
  }

  useEffect(() => {
    load();
  }, []);

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    await api.post('/api/tasks', { title: newTitle.trim() });
    setNewTitle('');
    load();
  }

  async function toggleComplete(id: number, completed: boolean) {
    await api.patch(`/api/tasks/${id}`, { completed: !completed });
    load();
  }

  async function askAi() {
    setAsking(true);
    setAiError(null);
    try {
      await api.post('/api/ai/suggest');
      load();
    } catch (e) {
      setAiError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setAsking(false);
    }
  }

  if (!schedule || !pending) return <p>Loading…</p>;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ flex: 1 }}>Today</h1>
        <button className="btn" onClick={askAi} disabled={asking}>
          {asking ? 'Thinking…' : '✨ Ask AI for suggestions'}
        </button>
      </div>

      {aiError && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--danger)' }}>
          {aiError}
        </div>
      )}

      <PendingSection pending={pending} onChanged={load} />

      <div className="card" style={{ marginBottom: 20 }}>
        <h3>Timeline</h3>
        {schedule.events.length === 0 && schedule.planned.length === 0 && (
          <p style={{ color: 'var(--text-dim)' }}>Nothing scheduled yet.</p>
        )}
        {schedule.events.map((e) => (
          <TimelineRow key={`event-${e.id}`} time={fmtRange(e.start, e.end)} title={e.title} kind="Event" />
        ))}
        {schedule.planned.map((p) => (
          <TimelineRow
            key={`task-${p.task.id}`}
            time={fmtRange(p.start, p.end)}
            title={p.task.title}
            kind="Task"
            done={p.task.completed}
            onToggle={() => toggleComplete(p.task.id, p.task.completed)}
          />
        ))}
      </div>

      {schedule.unscheduled.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3>Couldn't fit today</h3>
          {schedule.unscheduled.map((t) => (
            <TimelineRow
              key={`unsched-${t.id}`}
              time={priorityLabel(t.priority)}
              title={t.title}
              kind="Task"
              done={t.completed}
              onToggle={() => toggleComplete(t.id, t.completed)}
            />
          ))}
        </div>
      )}

      <form className="card" onSubmit={addTask} style={{ display: 'flex', gap: 8 }}>
        <input
          style={{ flex: 1 }}
          placeholder="Add a task…"
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

function TimelineRow({
  time,
  title,
  kind,
  done,
  onToggle,
}: {
  time: string;
  title: string;
  kind: string;
  done?: boolean;
  onToggle?: () => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
      {onToggle ? (
        <input type="checkbox" checked={done} onChange={onToggle} />
      ) : (
        <span style={{ width: 13 }} />
      )}
      <span style={{ width: 150, color: 'var(--text-dim)', fontSize: 13 }}>{time}</span>
      <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>{kind}</span>
      <span style={{ textDecoration: done ? 'line-through' : 'none' }}>{title}</span>
    </div>
  );
}

function fmtRange(start: string, end: string) {
  const f = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${f(start)} – ${f(end)}`;
}

function priorityLabel(p: TaskPriority) {
  return `${p} priority`;
}
