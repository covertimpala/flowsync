import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { DayTimeline } from '../components/DayTimeline';
import { celebrateTaskCompletion } from '../lib/celebrate';
import type { ScheduleRangeResponse, TaskCategory } from '../types';

function startOfDay(d: Date) {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}
function toDateParam(d: Date) {
  // Local calendar date, not toISOString()'s UTC date — that shifts by a
  // day whenever the local offset crosses midnight relative to UTC.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const WINDOW_DAYS = 7;

/** A multi-day agenda — what the auto-planner has lined up across the
 * coming week, not just today. Same per-day rendering as the Today page
 * (DayTimeline), one card per day. */
export function SchedulePage() {
  const [weekOffset, setWeekOffset] = useState(0);
  const [data, setData] = useState<ScheduleRangeResponse | null>(null);
  const [categories, setCategories] = useState<TaskCategory[]>([]);

  const start = new Date(startOfDay(new Date()).getTime() + weekOffset * WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + (WINDOW_DAYS - 1) * 24 * 60 * 60 * 1000);

  async function load() {
    const [s, c] = await Promise.all([
      api.get<ScheduleRangeResponse>(`/api/schedule/range?start=${toDateParam(start)}&end=${toDateParam(end)}`),
      api.get<TaskCategory[]>('/api/tasks/categories'),
    ]);
    setData(s);
    setCategories(c);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekOffset]);

  async function toggleTask(id: number, completed: boolean, origin: { x: number; y: number }) {
    const completing = !completed;
    await api.patch(`/api/tasks/${id}`, { completed: completing });
    if (completing) celebrateTaskCompletion(origin);
    load();
  }

  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const label =
    weekOffset === 0
      ? 'This week'
      : `${start.toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1>Schedule</h1>
          <p className="page-subtitle" style={{ marginBottom: 0 }}>
            Everything the auto-planner has lined up — {label.toLowerCase()}
          </p>
        </div>
        <div className="row" style={{ gap: 2 }}>
          <button className="btn btn-ghost" onClick={() => setWeekOffset((o) => o - 1)} aria-label="Previous week">
            <ChevronLeft size={16} />
          </button>
          <button className="btn btn-ghost" onClick={() => setWeekOffset(0)} disabled={weekOffset === 0}>
            This week
          </button>
          <button className="btn btn-ghost" onClick={() => setWeekOffset((o) => o + 1)} aria-label="Next week">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {!data ? (
        <p style={{ color: 'var(--text-dim)' }}>Loading…</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {data.days.map((day) => {
            const date = new Date(day.date + 'T00:00:00');
            const isToday = toDateParam(date) === toDateParam(new Date());
            return (
              <div key={day.date} className="card" style={isToday ? { borderColor: 'var(--accent)' } : undefined}>
                <div className="row" style={{ marginBottom: 10 }}>
                  <span style={{ fontWeight: 600 }}>
                    {date.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}
                  </span>
                  {isToday && <span className="badge badge-success">Today</span>}
                </div>
                <DayTimeline
                  schedule={day}
                  categoryById={categoryById}
                  onToggleTask={toggleTask}
                  emptyLabel="Nothing scheduled."
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
