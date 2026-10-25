import { Plus, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import { DayTimeline } from '../components/DayTimeline';
import { PendingSection } from '../components/PendingSection';
import { celebrateTaskCompletion } from '../lib/celebrate';
import type { PendingInbox, ScheduleResponse, TaskCategory } from '../types';

const CATEGORY_PALETTE = ['#6c8dfa', '#45c586', '#e3a648', '#c89bf8', '#68d4f5', '#f0565c', '#f0a868'];

export function TodayPage() {
  const [schedule, setSchedule] = useState<ScheduleResponse | null>(null);
  const [pending, setPending] = useState<PendingInbox | null>(null);
  const [categories, setCategories] = useState<TaskCategory[]>([]);
  const [newTitle, setNewTitle] = useState('');
  const [newDueDate, setNewDueDate] = useState('');
  const [newCategoryId, setNewCategoryId] = useState<number | ''>('');
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [asking, setAsking] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  async function load() {
    const [s, p, c] = await Promise.all([
      api.get<ScheduleResponse>('/api/schedule'),
      api.get<PendingInbox>('/api/pending'),
      api.get<TaskCategory[]>('/api/tasks/categories'),
    ]);
    setSchedule(s);
    setPending(p);
    setCategories(c);
  }

  async function checkOverdueThenLoad() {
    // Deterministic scheduling heuristic, not Ollama-backed — safe (and
    // cheap) to run on every visit to this page, not just on "Ask AI".
    try {
      await api.post('/api/ai/check-overdue');
    } catch {
      // Non-critical — the rest of the page still works without it.
    }
    load();
  }

  useEffect(() => {
    checkOverdueThenLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    await api.post('/api/tasks', {
      title: newTitle.trim(),
      category_id: newCategoryId === '' ? null : newCategoryId,
      due_date: newDueDate ? new Date(newDueDate).toISOString() : null,
    });
    setNewTitle('');
    setNewDueDate('');
    load();
  }

  async function addCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!newCategoryName.trim()) return;
    const color = CATEGORY_PALETTE[categories.length % CATEGORY_PALETTE.length];
    const created = await api.post<TaskCategory>('/api/tasks/categories', { name: newCategoryName.trim(), color });
    setNewCategoryName('');
    setAddingCategory(false);
    setCategories((prev) => [...prev, created]);
    setNewCategoryId(created.id);
  }

  async function toggleComplete(id: number, completed: boolean, origin: { x: number; y: number }) {
    const completing = !completed;
    await api.patch(`/api/tasks/${id}`, { completed: completing });
    if (completing) celebrateTaskCompletion(origin);
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

  const categoryById = new Map(categories.map((c) => [c.id, c]));

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 20 }}>
        <div style={{ flex: 1 }}>
          <h1>Today</h1>
          <p className="page-subtitle" style={{ marginBottom: 0 }}>
            {new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <button className="btn btn-primary" onClick={askAi} disabled={asking}>
          <Sparkles size={14} /> {asking ? 'Thinking…' : 'Ask AI for suggestions'}
        </button>
      </div>

      {aiError && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--danger)' }}>
          {aiError}
        </div>
      )}

      <PendingSection pending={pending} onChanged={load} />

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-title">Timeline</div>
        <DayTimeline
          schedule={schedule}
          categoryById={categoryById}
          onToggleTask={toggleComplete}
          emptyLabel="Nothing scheduled yet."
        />
      </div>

      <form className="card" onSubmit={addTask} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          style={{ flex: 1, minWidth: 160 }}
          placeholder="Add a task…"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
        />
        <input
          type="date"
          value={newDueDate}
          onChange={(e) => setNewDueDate(e.target.value)}
          title="Due date (optional)"
          style={{ colorScheme: 'dark' }}
        />
        <select
          value={newCategoryId}
          onChange={(e) => setNewCategoryId(e.target.value ? Number(e.target.value) : '')}
          style={{ maxWidth: 140 }}
        >
          <option value="">No category</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {addingCategory ? (
          <>
            <input
              autoFocus
              placeholder="Category name"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              style={{ width: 130 }}
              onKeyDown={(e) => e.key === 'Escape' && setAddingCategory(false)}
            />
            <button type="button" className="btn" onClick={addCategory}>
              Add
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-ghost" onClick={() => setAddingCategory(true)} title="New category">
            <Plus size={16} />
          </button>
        )}
        <button className="btn btn-primary" type="submit">
          Add
        </button>
      </form>
    </div>
  );
}
