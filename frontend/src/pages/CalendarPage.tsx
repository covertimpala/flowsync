import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { CalendarEvent, DeviceCodeInfo } from '../types';

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function CalendarPage() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [newTitle, setNewTitle] = useState('');
  const [icsText, setIcsText] = useState('');
  const [showIcsBox, setShowIcsBox] = useState(false);
  const [googleStatus, setGoogleStatus] = useState<{ has_client_id: boolean; connected: boolean } | null>(null);
  const [outlookStatus, setOutlookStatus] = useState<{ has_client_id: boolean; connected: boolean } | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [deviceCode, setDeviceCode] = useState<DeviceCodeInfo | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  async function load() {
    const start = startOfToday();
    const end = new Date(start.getTime() + 14 * 24 * 60 * 60 * 1000);
    const qs = `start=${start.toISOString()}&end=${end.toISOString()}`;
    const [ev, g, o] = await Promise.all([
      api.get<CalendarEvent[]>(`/api/events?${qs}`),
      api.get(`/api/calendar/google/status`),
      api.get(`/api/calendar/outlook/status`),
    ]);
    setEvents(ev);
    setGoogleStatus(g as any);
    setOutlookStatus(o as any);
  }

  useEffect(() => {
    load();
  }, []);

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

  return (
    <div>
      <h1>Calendar</h1>
      <p className="page-subtitle">Local events, plus anything synced from Google or Outlook</p>

      <div className="card" style={{ marginBottom: 20 }}>
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
        <div className="card-title">Next 14 days</div>
        {events.length === 0 && <p style={{ color: 'var(--text-dim)' }}>No events.</p>}
        {events.map((e) => (
          <div key={e.id} style={{ display: 'flex', gap: 10, padding: '6px 0', alignItems: 'center' }}>
            <span className="badge">{e.source}</span>
            <span style={{ color: 'var(--text-dim)', fontSize: 13, width: 160 }}>
              {new Date(e.start).toLocaleString()}
            </span>
            <span>{e.title}</span>
          </div>
        ))}
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
        <span className="badge" style={{ color: 'var(--success)' }}>
          Connected
        </span>
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
