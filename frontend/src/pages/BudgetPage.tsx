import { FileSpreadsheet, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ApiError, currentApiKey } from '../api/client';
import { api } from '../api/client';
import type { BudgetCategory, BudgetSummary } from '../types';

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
const CHART_COLORS = ['#6c8dfa', '#45c586', '#e3a648', '#c89bf8', '#68d4f5', '#f0565c', '#8aa5ff', '#f0a868'];

interface HistoryPoint {
  year: number;
  month: number;
  spent_cents: number;
  income_cents: number;
  net_cents: number;
}

interface ImportPreview {
  import_id: string;
  sheet: string;
  header_row: number;
  columns: Record<string, string | null>;
  total_rows_found: number;
  parsed_count: number;
  skipped_rows: number;
  preview: { date: string; amount_cents: number; type: string; note: string | null; category: string | null }[];
  detected_categories: string[];
}

export function BudgetPage() {
  const now = new Date();
  const [summary, setSummary] = useState<BudgetSummary | null>(null);
  const [categories, setCategories] = useState<BudgetCategory[]>([]);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [newCategory, setNewCategory] = useState('');
  const [newLimit, setNewLimit] = useState(0);
  const [entryCategory, setEntryCategory] = useState<number | null>(null);
  const [entryAmount, setEntryAmount] = useState(0);
  const [entryType, setEntryType] = useState<'expense' | 'income'>('expense');

  const [importing, setImporting] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importCategoryName, setImportCategoryName] = useState('Imported');
  const [importError, setImportError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function load() {
    const [s, c, h] = await Promise.all([
      api.get<BudgetSummary>(`/api/budget/summary?year=${now.getFullYear()}&month=${now.getMonth() + 1}`),
      api.get<BudgetCategory[]>('/api/budget/categories'),
      api.get<{ points: HistoryPoint[] }>('/api/budget/history?months=6'),
    ]);
    setSummary(s);
    setCategories(c);
    setHistory(h.points);
    if (!entryCategory && c.length) setEntryCategory(c[0].id);
  }

  useEffect(() => {
    load();
  }, []);

  async function addCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!newCategory.trim()) return;
    await api.post('/api/budget/categories', { name: newCategory.trim(), monthly_limit_cents: newLimit * 100 });
    setNewCategory('');
    setNewLimit(0);
    load();
  }

  async function addEntry(e: React.FormEvent) {
    e.preventDefault();
    if (!entryCategory || entryAmount <= 0) return;
    await api.post('/api/budget/entries', {
      category_id: entryCategory,
      amount_cents: Math.round(entryAmount * 100),
      type: entryType,
      date: new Date().toISOString(),
    });
    setEntryAmount(0);
    load();
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportError(null);
    setImportPreview(null);
    try {
      const apiKey = await currentApiKey();
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/budget/import/preview', {
        method: 'POST',
        headers: { 'X-API-Key': apiKey },
        body: form,
      });
      if (!res.ok) throw new ApiError(res.status, await res.text());
      const data: ImportPreview = await res.json();
      setImportPreview(data);
    } catch (err) {
      setImportError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function commitImport() {
    if (!importPreview) return;
    setCommitting(true);
    try {
      await api.post('/api/budget/import/commit', {
        import_id: importPreview.import_id,
        default_category_name: importCategoryName || 'Imported',
      });
      setImportPreview(null);
      load();
    } catch (err) {
      setImportError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setCommitting(false);
    }
  }

  if (!summary) return <p style={{ color: 'var(--text-dim)' }}>Loading…</p>;

  const pieData = summary.by_category
    .filter((cs) => cs.spent_cents > 0)
    .map((cs) => ({ name: cs.category.name, value: cs.spent_cents / 100 }));

  const trendData = history.map((p) => ({
    label: `${MONTH_NAMES[p.month - 1]}`,
    Spent: p.spent_cents / 100,
    Income: p.income_cents / 100,
  }));

  const totalIncome = summary.by_category.length ? history[history.length - 1]?.income_cents ?? 0 : 0;

  return (
    <div>
      <h1>Budget</h1>
      <p className="page-subtitle">{now.toLocaleString([], { month: 'long', year: 'numeric' })}</p>

      <div className="grid-3" style={{ marginBottom: 20 }}>
        <div className="stat-tile">
          <div className="label">Net this month</div>
          <div className="value" style={{ color: summary.net_cents >= 0 ? 'var(--success)' : 'var(--danger)' }}>
            {money(summary.net_cents)}
          </div>
        </div>
        <div className="stat-tile">
          <div className="label">Spent this month</div>
          <div className="value">
            {money(summary.by_category.reduce((a, c) => a + c.spent_cents, 0))}
          </div>
        </div>
        <div className="stat-tile">
          <div className="label">Income this month</div>
          <div className="value">{money(totalIncome)}</div>
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: 20 }}>
        <div className="card">
          <div className="card-title">Spend by category</div>
          {pieData.length === 0 ? (
            <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>No expenses recorded this month.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2}>
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} stroke="none" />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 8 }}
                  formatter={(v: number) => `$${v.toFixed(2)}`}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card">
          <div className="card-title">6-month trend</div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={trendData}>
              <defs>
                <linearGradient id="spentGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f0565c" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#f0565c" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="incomeGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#45c586" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#45c586" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" vertical={false} />
              <XAxis dataKey="label" stroke="var(--text-faint)" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="var(--text-faint)" fontSize={12} tickLine={false} axisLine={false} width={40} />
              <Tooltip
                contentStyle={{ background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 8 }}
                formatter={(v: number) => `$${v.toFixed(2)}`}
              />
              <Area type="monotone" dataKey="Spent" stroke="#f0565c" fill="url(#spentGrad)" strokeWidth={2} />
              <Area type="monotone" dataKey="Income" stroke="#45c586" fill="url(#incomeGrad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-title">Import a spreadsheet</div>
        <p style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: -6 }}>
          Any .xlsx/.xlsm file — FlowSync finds the transaction table itself and guesses the
          date/amount/description columns. Nothing is saved until you confirm below.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xlsm,.xls"
          onChange={handleFileSelected}
          style={{ display: 'none' }}
        />
        <button className="btn" onClick={() => fileInputRef.current?.click()} disabled={importing}>
          <Upload size={14} /> {importing ? 'Reading file…' : 'Choose spreadsheet'}
        </button>

        {importError && (
          <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 10 }}>{importError}</p>
        )}

        {importPreview && (
          <div style={{ marginTop: 16, padding: 14, background: 'var(--panel-2)', borderRadius: 10 }}>
            <div className="row" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
              <FileSpreadsheet size={16} color="var(--text-dim)" />
              <strong>{importPreview.sheet}</strong>
              <span className="badge">{importPreview.parsed_count} rows parsed</span>
              {importPreview.skipped_rows > 0 && (
                <span className="badge badge-danger">{importPreview.skipped_rows} skipped</span>
              )}
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 10 }}>
              Detected columns — date: <code>{importPreview.columns.date}</code>, amount:{' '}
              <code>{importPreview.columns.amount}</code>
              {importPreview.columns.description && (
                <>
                  , description: <code>{importPreview.columns.description}</code>
                </>
              )}
              {importPreview.columns.category && (
                <>
                  , category: <code>{importPreview.columns.category}</code>
                </>
              )}
            </p>

            <div style={{ maxHeight: 180, overflowY: 'auto', marginBottom: 12 }}>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--text-dim)' }}>
                    <th style={{ padding: '4px 8px' }}>Date</th>
                    <th style={{ padding: '4px 8px' }}>Amount</th>
                    <th style={{ padding: '4px 8px' }}>Type</th>
                    <th style={{ padding: '4px 8px' }}>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {importPreview.preview.map((row, i) => (
                    <tr key={i} style={{ borderTop: '1px solid var(--border-soft)' }}>
                      <td style={{ padding: '4px 8px' }}>{new Date(row.date).toLocaleDateString()}</td>
                      <td style={{ padding: '4px 8px' }}>{money(row.amount_cents)}</td>
                      <td style={{ padding: '4px 8px' }}>{row.type}</td>
                      <td style={{ padding: '4px 8px', color: 'var(--text-dim)' }}>{row.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {importPreview.detected_categories.length === 0 && (
              <div className="row" style={{ marginBottom: 10 }}>
                <span style={{ fontSize: 13 }}>No category column found — file everything under:</span>
                <input value={importCategoryName} onChange={(e) => setImportCategoryName(e.target.value)} style={{ width: 160 }} />
              </div>
            )}

            <div className="row">
              <button className="btn btn-primary" onClick={commitImport} disabled={committing}>
                {committing ? 'Importing…' : `Import ${importPreview.parsed_count} entries`}
              </button>
              <button className="btn btn-ghost" onClick={() => setImportPreview(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
        {summary.by_category.map((cs, i) => (
          <div key={cs.category.id} className="card" style={{ padding: 16 }}>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
              <span className="row">
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 99,
                    background: CHART_COLORS[i % CHART_COLORS.length],
                    display: 'inline-block',
                  }}
                />
                {cs.category.name}
              </span>
              <span style={{ fontSize: 13 }}>
                {money(cs.spent_cents)}
                {cs.category.monthly_limit_cents > 0 && (
                  <span style={{ color: 'var(--text-dim)' }}> / {money(cs.category.monthly_limit_cents)}</span>
                )}
              </span>
            </div>
            {cs.category.monthly_limit_cents > 0 && (
              <div className="progress-track">
                <div
                  className={`progress-fill ${cs.over_limit ? 'danger' : ''}`}
                  style={{ width: `${Math.min(100, (cs.spent_cents / cs.category.monthly_limit_cents) * 100)}%` }}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="grid-2">
        <form className="card" onSubmit={addEntry} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>Add entry</div>
          <select value={entryCategory ?? ''} onChange={(e) => setEntryCategory(Number(e.target.value))}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select value={entryType} onChange={(e) => setEntryType(e.target.value as 'expense' | 'income')}>
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </select>
          <input
            type="number"
            placeholder="Amount"
            value={entryAmount || ''}
            onChange={(e) => setEntryAmount(Number(e.target.value))}
          />
          <button className="btn btn-primary" type="submit">Add entry</button>
        </form>

        <form className="card" onSubmit={addCategory} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>Add category</div>
          <input placeholder="Name" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} />
          <input
            type="number"
            placeholder="Monthly limit (optional)"
            value={newLimit || ''}
            onChange={(e) => setNewLimit(Number(e.target.value))}
          />
          <button className="btn" type="submit">Add category</button>
        </form>
      </div>
    </div>
  );
}
