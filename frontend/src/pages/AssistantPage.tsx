import { Check, Send, Sparkles, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { ProposedAction } from '../types';

type TurnStatus = 'loading' | 'plan' | 'empty' | 'error' | 'accepted' | 'denied';

interface ActionResult {
  action_id: number;
  ok: boolean;
  result?: Record<string, unknown>;
  error?: string;
}

interface Turn {
  id: string;
  instruction: string;
  status: TurnStatus;
  planId?: string;
  actions?: ProposedAction[];
  error?: string;
  results?: ActionResult[];
}

const ACTION_LABELS: Record<string, string> = {
  create_task: 'New task',
  complete_task: 'Complete task',
  update_task: 'Update task',
  delete_task: 'Delete task',
  create_event: 'New event',
  delete_event: 'Delete event',
  create_habit: 'New habit',
  complete_habit: 'Complete habit',
  create_budget_entry: 'New budget entry',
  create_budget_category: 'New budget category',
};

export function AssistantPage() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  function scrollToBottom() {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const instruction = input.trim();
    if (!instruction || busy) return;
    setInput('');
    setBusy(true);

    const id = `${Date.now()}`;
    setTurns((prev) => [...prev, { id, instruction, status: 'loading' }]);
    scrollToBottom();

    try {
      const res = await api.post<{ plan_id: string | null; actions: ProposedAction[] }>('/api/ai/command', {
        text: instruction,
      });
      setTurns((prev) =>
        prev.map((t) =>
          t.id === id
            ? res.actions.length === 0
              ? { ...t, status: 'empty' }
              : { ...t, status: 'plan', planId: res.plan_id ?? undefined, actions: res.actions }
            : t,
        ),
      );
    } catch (e) {
      const message = e instanceof ApiError ? e.message : String(e);
      setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, status: 'error', error: message } : t)));
    } finally {
      setBusy(false);
      scrollToBottom();
    }
  }

  async function removeAction(turnId: string, actionId: number) {
    await api.delete(`/api/ai/command/action/${actionId}`);
    setTurns((prev) =>
      prev.map((t) => (t.id === turnId ? { ...t, actions: t.actions?.filter((a) => a.id !== actionId) } : t)),
    );
  }

  async function acceptPlan(turnId: string, planId: string) {
    const res = await api.post<{ results: ActionResult[] }>(`/api/ai/command/${planId}/accept`);
    setTurns((prev) => prev.map((t) => (t.id === turnId ? { ...t, status: 'accepted', results: res.results } : t)));
  }

  async function denyPlan(turnId: string, planId: string) {
    await api.post(`/api/ai/command/${planId}/deny`);
    setTurns((prev) => prev.map((t) => (t.id === turnId ? { ...t, status: 'denied' } : t)));
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px)' }}>
      <h1>Assistant</h1>
      <p className="page-subtitle">
        Type what you want done — it proposes a plan, and nothing happens until you accept it.
      </p>

      <div style={{ flex: 1, overflowY: 'auto', marginBottom: 16, paddingRight: 4 }}>
        {turns.length === 0 && (
          <div className="card" style={{ color: 'var(--text-dim)', fontSize: 13 }}>
            Try things like "add a task to call the dentist next Tuesday", "mark my grocery run as
            done and log a $40 expense", or "create a daily habit to stretch".
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {turns.map((t) => (
            <div key={t.id}>
              <div
                style={{
                  alignSelf: 'flex-end',
                  background: 'var(--accent)',
                  color: 'white',
                  borderRadius: 12,
                  padding: '8px 14px',
                  marginBottom: 8,
                  maxWidth: '80%',
                  marginLeft: 'auto',
                  fontSize: 14,
                }}
              >
                {t.instruction}
              </div>

              {t.status === 'loading' && (
                <div className="row" style={{ color: 'var(--text-dim)', fontSize: 13 }}>
                  <Sparkles size={14} /> Thinking…
                </div>
              )}

              {t.status === 'error' && (
                <div className="card" style={{ borderColor: 'var(--danger)', fontSize: 13, color: 'var(--danger)' }}>
                  {t.error}
                </div>
              )}

              {t.status === 'empty' && (
                <div className="card" style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                  No changes needed for that.
                </div>
              )}

              {t.status === 'plan' && t.actions && t.planId && (
                <div className="card">
                  <div className="card-title">Proposed plan ({t.actions.length})</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                    {t.actions.map((a) => (
                      <div
                        key={a.id}
                        className="row"
                        style={{ justifyContent: 'space-between', padding: '8px 10px', background: 'var(--panel-2)', borderRadius: 8 }}
                      >
                        <span className="row">
                          <span className="badge badge-ai">{ACTION_LABELS[a.action_type] ?? a.action_type}</span>
                          <span style={{ fontSize: 13 }}>{a.description}</span>
                        </span>
                        <button className="btn btn-ghost" style={{ padding: '2px 6px' }} onClick={() => removeAction(t.id, a.id)}>
                          <X size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="row">
                    <button className="btn btn-danger" onClick={() => denyPlan(t.id, t.planId!)}>
                      Deny all
                    </button>
                    <button className="btn btn-primary" onClick={() => acceptPlan(t.id, t.planId!)} disabled={t.actions.length === 0}>
                      <Check size={14} /> Accept {t.actions.length > 1 ? `all ${t.actions.length}` : ''}
                    </button>
                  </div>
                </div>
              )}

              {t.status === 'accepted' && (
                <div className="card">
                  <div className="card-title" style={{ marginBottom: 8 }}>Done</div>
                  {(t.results ?? []).map((r) => (
                    <div key={r.action_id} className="row" style={{ fontSize: 13, padding: '3px 0' }}>
                      {r.ok ? (
                        <span className="badge badge-success">
                          <Check size={11} /> Applied
                        </span>
                      ) : (
                        <span className="badge badge-danger">
                          <X size={11} /> {r.error}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {t.status === 'denied' && (
                <div className="card" style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                  Plan denied — nothing was changed.
                </div>
              )}
            </div>
          ))}
        </div>
        <div ref={bottomRef} />
      </div>

      <form className="card" onSubmit={submit} style={{ display: 'flex', gap: 8 }}>
        <input
          style={{ flex: 1 }}
          placeholder="Tell the assistant what to do…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
        />
        <button className="btn btn-primary" type="submit" disabled={busy || !input.trim()}>
          <Send size={14} />
        </button>
      </form>
    </div>
  );
}
