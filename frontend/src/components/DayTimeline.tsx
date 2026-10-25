import { TaskCheckbox } from './TaskCheckbox';
import type { ScheduleResponse, TaskCategory, TaskPriority } from '../types';

/** Renders one day's combined events + planned/unscheduled tasks — the
 * "Timeline" + "Couldn't fit" cards, shared between the Today page (one
 * day) and the Schedule page (one of these per day in a range). */
export function DayTimeline({
  schedule,
  categoryById,
  onToggleTask,
  emptyLabel = 'Nothing scheduled.',
}: {
  schedule: ScheduleResponse;
  categoryById: Map<number, TaskCategory>;
  onToggleTask: (taskId: number, completed: boolean, origin: { x: number; y: number }) => void;
  emptyLabel?: string;
}) {
  const nothing = schedule.events.length === 0 && schedule.planned.length === 0 && schedule.unscheduled.length === 0;

  if (nothing) {
    return <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>{emptyLabel}</p>;
  }

  return (
    <div>
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
          dueDate={p.task.due_date}
          category={p.task.category_id ? categoryById.get(p.task.category_id) : undefined}
          onToggle={(origin) => onToggleTask(p.task.id, p.task.completed, origin)}
        />
      ))}
      {schedule.unscheduled.map((t) => (
        <TimelineRow
          key={`unsched-${t.id}`}
          time={t.completed ? 'Completed' : priorityLabel(t.priority)}
          title={t.title}
          kind="Task"
          done={t.completed}
          dueDate={t.due_date}
          category={t.category_id ? categoryById.get(t.category_id) : undefined}
          onToggle={(origin) => onToggleTask(t.id, t.completed, origin)}
        />
      ))}
    </div>
  );
}

function TimelineRow({
  time,
  title,
  kind,
  done,
  onToggle,
  category,
  dueDate,
}: {
  time: string;
  title: string;
  kind: string;
  done?: boolean;
  onToggle?: (origin: { x: number; y: number }) => void;
  category?: TaskCategory;
  dueDate?: string | null;
}) {
  const overdue = !done && !!dueDate && new Date(dueDate) < new Date();

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0' }}>
      {onToggle ? (
        <TaskCheckbox checked={!!done} onToggle={(_, origin) => onToggle(origin)} />
      ) : (
        <span style={{ width: 20 }} />
      )}
      <span style={{ width: 150, color: 'var(--text-dim)', fontSize: 13 }}>{time}</span>
      <span style={{ color: 'var(--text-dim)', fontSize: 11, width: 40 }}>{kind}</span>
      <span style={{ textDecoration: done ? 'line-through' : 'none', color: done ? 'var(--text-dim)' : 'var(--text)', flex: 1 }}>
        {title}
      </span>
      {dueDate && !done && (
        <span className={`badge ${overdue ? 'badge-danger' : ''}`}>
          Due {new Date(dueDate).toLocaleDateString([], { month: 'short', day: 'numeric' })}
        </span>
      )}
      {category && (
        <span
          className="badge"
          style={{ color: category.color, borderColor: category.color + '55', background: category.color + '15' }}
        >
          {category.name}
        </span>
      )}
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
