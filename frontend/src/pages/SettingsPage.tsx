import { useEffect, useState } from 'react';
import { api, currentApiKey } from '../api/client';

export function SettingsPage() {
  const [apiKey, setApiKey] = useState('');
  const [ollamaStatus, setOllamaStatus] = useState<{ available: boolean; host: string; model: string } | null>(
    null,
  );
  const [host, setHost] = useState('');
  const [model, setModel] = useState('');
  const [saved, setSaved] = useState(false);

  async function load() {
    const [key, status] = await Promise.all([
      currentApiKey(),
      api.get<{ available: boolean; host: string; model: string }>('/api/ai/status'),
    ]);
    setApiKey(key);
    setOllamaStatus(status);
    setHost(status.host);
    setModel(status.model);
  }

  useEffect(() => {
    load();
  }, []);

  async function regenerate() {
    const res = await api.post<{ api_key: string }>('/api/settings/api-key/regenerate');
    setApiKey(res.api_key);
  }

  async function saveOllama(e: React.FormEvent) {
    e.preventDefault();
    await api.put('/api/ai/settings', { host, model });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    load();
  }

  return (
    <div>
      <h1>Settings</h1>
      <p className="page-subtitle">API access, and the local AI model used for suggestions</p>

      <div className="grid-2">
        <div className="card">
          <div className="card-title">API access for other applications</div>
          <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>
            Any application can read/write FlowSync data by sending this key as an{' '}
            <code>X-API-Key</code> header. Items it creates land in the Pending inbox on the Today
            page — include an <code>X-Client-Name</code> header so you know where they came from.
            Nothing it submits becomes real until you accept it there.
          </p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <code
              style={{
                flex: 1,
                padding: '8px 10px',
                background: 'var(--panel-2)',
                borderRadius: 6,
                overflowWrap: 'break-word',
                fontSize: 12,
              }}
            >
              {apiKey}
            </code>
            <button className="btn btn-danger" onClick={regenerate}>
              Regenerate
            </button>
          </div>
        </div>

        <form className="card" onSubmit={saveOllama}>
          <div className="card-title">AI suggestions (Ollama)</div>
          <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>
            Status:{' '}
            {ollamaStatus?.available ? (
              <span style={{ color: 'var(--success)' }}>reachable</span>
            ) : (
              <span style={{ color: 'var(--danger)' }}>not reachable</span>
            )}
          </p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <label style={{ width: 80 }}>Host</label>
            <input style={{ flex: 1 }} value={host} onChange={(e) => setHost(e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <label style={{ width: 80 }}>Model</label>
            <input style={{ flex: 1 }} value={model} onChange={(e) => setModel(e.target.value)} />
          </div>
          <button className="btn btn-primary" type="submit">
            {saved ? 'Saved' : 'Save'}
          </button>
        </form>
      </div>
    </div>
  );
}
