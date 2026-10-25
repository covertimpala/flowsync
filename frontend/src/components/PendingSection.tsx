import { useState } from 'react';
import { api } from '../api/client';
import type { PendingInbox, TaskOrigin } from '../types';

function OriginBadge({ origin }: { origin: TaskOrigin | 'google' | 'outlook' | 'ics' | 'local' }) {
  if (origin === 'ai') return <span className="badge badge-ai">AI suggestion</span>;
  if (origin === 'api') return <span className="badge badge-api">from API</span>;
  return null;
}

/** The single inbox for everything the AI suggestion engine or an external
 * application proposed — nothing in it is real until accepted. Shown at
 * the top of the Today page. */
export function PendingSection({
  pending,
  onChanged,
}: {
  pending: PendingInbox;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  const total = pending.tasks.length + pending.events.length + pending.habits.length + pending.reschedules.length;
  if (total === 0) return null;

  async function accept(kind: 'task' | 'event' | 'habit', id: number, pushToCalendar = false) {
    setBusy(`${kind}-${id}`);
    try {
      await api.post(`/api/pending/${kind}/${id}/accept`, {
        push_to_calendar: pushToCalendar,
        calendar_provider: pushToCalendar ? 'google' : null,
      });
      onChanged();
    } finally {
      setBusy(null);
    }
  }

  async function deny(kind: 'task' | 'event' | 'habit', id: number) {
    setBusy(`${kind}-${id}`);
    try {
      await api.post(`/api/pending/${kind}/${id}/deny`);
      onChanged();
    } finally {
      setBusy(null);
    }
  }

  async function resolveReschedule(id: number, action: 'accept' | 'deny') {
    setBusy(`reschedule-${id}`);
    try {
      await api.post(`/api/pending/reschedule/${id}/${action}`);
      onChanged();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <h3>Pending ({total})</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {pending.tasks.map((t) => (
          <Row key={`task-${t.id}`} busy={busy === `task-${t.id}`}>
            <OriginBadge origin={t.origin} />
            <span>{t.title}</span>
            {t.created_by && <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>via {t.created_by}</span>}
            <Actions
              onAccept={() => accept('task', t.id)}
              onDeny={() => deny('task', t.id)}
            />
          </Row>
        ))}
        {pending.events.map((e) => (
          <Row key={`event-${e.id}`} busy={busy === `event-${e.id}`}>
            <OriginBadge origin={e.source} />
            <span>{e.title}</span>
            <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>
              {new Date(e.start).toLocaleString()}
            </span>
            <Actions
              onAccept={() => accept('event', e.id, false)}
              onAcceptExtra={{ label: 'Accept + sync to calendar', onClick: () => accept('event', e.id, true) }}
              onDeny={() => deny('event', e.id)}
            />
          </Row>
        ))}
        {pending.habits.map((h) => (
          <Row key={`habit-${h.id}`} busy={busy === `habit-${h.id}`}>
            <OriginBadge origin={h.origin} />
            <span>{h.name}</span>
            <Actions
              onAccept={() => accept('habit', h.id)}
              onDeny={() => deny('habit', h.id)}
            />
          </Row>
        ))}
        {pending.reschedules.map((r) => (
          <Row key={`reschedule-${r.id}`} busy={busy === `reschedule-${r.id}`}>
            <span className="badge badge-ai">Overdue</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span>{r.task_title}</span>
              <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>{r.reason}</span>
            </div>
            <Actions
              onAccept={() => resolveReschedule(r.id, 'accept')}
              onDeny={() => resolveReschedule(r.id, 'deny')}
            />
          </Row>
        ))}
      </div>
    </div>
  );
}

function Row({ children, busy }: { children: React.ReactNode; busy: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 10px',
        background: 'var(--panel-2)',
        borderRadius: 8,
        opacity: busy ? 0.5 : 1,
      }}
    >
      {children}
    </div>
  );
}

function Actions({
  onAccept,
  onDeny,
  onAcceptExtra,
}: {
  onAccept: () => void;
  onDeny: () => void;
  onAcceptExtra?: { label: string; onClick: () => void };
}) {
  return (
    <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
      <button className="btn btn-danger" onClick={onDeny}>
        Deny
      </button>
      {onAcceptExtra && (
        <button className="btn" onClick={onAcceptExtra.onClick}>
          {onAcceptExtra.label}
        </button>
      )}
      <button className="btn btn-primary" onClick={onAccept}>
        Accept
      </button>
    </div>
  );
}
