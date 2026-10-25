import { Eye, EyeOff, FileSpreadsheet, Trash2, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
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
import type { BudgetCategory, BudgetEntry, BudgetSummary } from '../types';

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
// Local calendar date as YYYY-MM-DD for a <input type="date">'s value —
// not toISOString(), which is UTC-based and can land on the wrong day
// near midnight depending on the timezone offset.
const toDateInputValue = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
const CHART_COLORS = ['#6c8dfa', '#45c586', '#e3a648', '#c89bf8', '#68d4f5', '#f0565c', '#8aa5ff', '#f0a868'];

type Timescale = 'month' | '3m' | '6m' | '12m' | 'all' | 'custom';

const TIMESCALE_OPTIONS: { value: Timescale; label: string }[] = [
  { value: 'month', label: 'This month' },
  { value: '3m', label: '3 months' },
  { value: '6m', label: '6 months' },
  { value: '12m', label: '12 months' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom' },
];

type HistoryGranularity = 'day' | 'week' | 'month';

interface HistoryPoint {
  date: string;
  spent_cents: number;
  income_cents: number;
  net_cents: number;
}

interface AnalyticsData {
  total_spent_cents: number;
  entry_count: number;
  averages: {
    per_day_cents: number;
    per_week_cents: number;
    per_month_cents: number;
    per_year_cents: number;
  };
  spend_by_year: { year: number; spent_cents: number }[];
  top_items: { label: string; count: number; total_cents: number; variants: string[] }[];
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
  const [historyGranularity, setHistoryGranularity] = useState<HistoryGranularity>('day');
  const [entries, setEntries] = useState<BudgetEntry[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [bounds, setBounds] = useState<{ earliest: string | null; latest: string | null }>({
    earliest: null,
    latest: null,
  });
  const [newCategory, setNewCategory] = useState('');
  const [newLimit, setNewLimit] = useState(0);
  const [showHiddenCategories, setShowHiddenCategories] = useState(false);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [entryCategory, setEntryCategory] = useState<number | null>(null);
  const [entryAmount, setEntryAmount] = useState(0);
  const [entryType, setEntryType] = useState<'expense' | 'income'>('expense');
  const [entryDate, setEntryDate] = useState(() => toDateInputValue(new Date()));
  const [entryNote, setEntryNote] = useState('');

  const [timescale, setTimescale] = useState<Timescale>('month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [transactionFilter, setTransactionFilter] = useState<number | 'all'>('all');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  const [importing, setImporting] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importCategoryName, setImportCategoryName] = useState('Imported');
  const [importError, setImportError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const range = useMemo(() => {
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    let start: Date;
    let label: string;

    if (timescale === 'month') {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      label = now.toLocaleString([], { month: 'long', year: 'numeric' });
    } else if (timescale === '3m' || timescale === '6m' || timescale === '12m') {
      const n = timescale === '3m' ? 3 : timescale === '6m' ? 6 : 12;
      start = new Date(now.getFullYear(), now.getMonth() - (n - 1), 1);
      label = `Last ${n} months`;
    } else if (timescale === 'all') {
      start = bounds.earliest ? new Date(bounds.earliest) : new Date(now.getFullYear(), now.getMonth(), 1);
      label = 'All time';
    } else {
      start = customStart ? new Date(customStart) : new Date(now.getFullYear(), now.getMonth(), 1);
      const customEndDate = customEnd ? new Date(customEnd) : end;
      label = 'Custom range';
      return { start, end: customEndDate, label };
    }
    return { start, end, label };
  }, [timescale, customStart, customEnd, bounds.earliest, now.getFullYear(), now.getMonth(), now.getDate()]);

  async function load() {
    const startIso = range.start.toISOString();
    const endIso = range.end.toISOString();
    const [s, c, h, e, b, a] = await Promise.all([
      api.get<BudgetSummary>(`/api/budget/summary?start=${startIso}&end=${endIso}`),
      api.get<BudgetCategory[]>('/api/budget/categories?include_hidden=true'),
      api.get<{ granularity: HistoryGranularity; points: HistoryPoint[] }>(
        `/api/budget/history?start=${startIso}&end=${endIso}`,
      ),
      api.get<BudgetEntry[]>(`/api/budget/entries?start=${startIso}&end=${endIso}&include_hidden=true`),
      api.get<{ earliest: string | null; latest: string | null }>('/api/budget/bounds'),
      api.get<AnalyticsData>(`/api/budget/analytics?start=${startIso}&end=${endIso}`),
    ]);
    setSummary(s);
    setCategories(c);
    setHistory(h.points);
    setHistoryGranularity(h.granularity);
    setEntries(e);
    setBounds(b);
    setAnalytics(a);
    if (!entryCategory) {
      const firstVisible = c.find((cat) => !cat.hidden) ?? c[0];
      if (firstVisible) setEntryCategory(firstVisible.id);
    }
  }

  useEffect(() => {
    setPage(0);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.start.getTime(), range.end.getTime()]);

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
      date: new Date(entryDate).toISOString(),
      note: entryNote.trim() || null,
    });
    setEntryAmount(0);
    setEntryNote('');
    setEntryDate(toDateInputValue(new Date()));
    load();
  }

  async function toggleHiddenCategory(id: number, hidden: boolean) {
    await api.patch(`/api/budget/categories/${id}`, { hidden: !hidden });
    load();
  }

  async function deleteCategory(id: number) {
    setCategoryError(null);
    try {
      await api.delete(`/api/budget/categories/${id}`);
      load();
    } catch (err) {
      setCategoryError(err instanceof ApiError ? err.message : String(err));
    }
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

  async function deleteEntry(id: number) {
    await api.delete(`/api/budget/entries/${id}`);
    load();
  }

  async function toggleHidden(id: number, hidden: boolean) {
    await api.patch(`/api/budget/entries/${id}`, { hidden: !hidden });
    load();
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

  const spansMultipleYears =
    history.length > 0 && new Date(history[0].date).getFullYear() !== new Date(history[history.length - 1].date).getFullYear();
  const trendData = history.map((p) => {
    const d = new Date(p.date);
    let label: string;
    if (historyGranularity === 'day') {
      label = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } else if (historyGranularity === 'week') {
      label = `Wk of ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
    } else {
      label = spansMultipleYears
        ? `${MONTH_NAMES[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`
        : MONTH_NAMES[d.getMonth()];
    }
    return { label, Spent: p.spent_cents / 100, Income: p.income_cents / 100 };
  });
  const trendTitle =
    historyGranularity === 'day' ? 'Daily trend' : historyGranularity === 'week' ? 'Weekly trend' : 'Monthly trend';

  const visibleEntries = entries.filter((e) => !e.hidden);
  const totalSpent = visibleEntries.filter((e) => e.type === 'expense').reduce((a, e) => a + e.amount_cents, 0);
  const totalIncome = visibleEntries.filter((e) => e.type === 'income').reduce((a, e) => a + e.amount_cents, 0);
  const categoryById = new Map(categories.map((c) => [c.id, c]));

  const earliestLabel = bounds.earliest ? new Date(bounds.earliest).toLocaleDateString() : null;
  const latestLabel = bounds.latest ? new Date(bounds.latest).toLocaleDateString() : null;

  const filteredEntries = entries
    .filter((e) => showHidden || !e.hidden)
    .filter((e) => transactionFilter === 'all' || e.category_id === transactionFilter);
  const totalPages = Math.max(1, Math.ceil(filteredEntries.length / PAGE_SIZE));
  const pagedEntries = filteredEntries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const hiddenCount = entries.filter((e) => e.hidden).length;

  const yearData = (analytics?.spend_by_year ?? []).map((p) => ({ year: String(p.year), Spent: p.spent_cents / 100 }));

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1>Budget</h1>
          <p className="page-subtitle" style={{ marginBottom: 0 }}>
            {range.label} · {entries.length} entries
            {earliestLabel && latestLabel && (
              <span style={{ color: 'var(--text-faint)' }}> · data from {earliestLabel} to {latestLabel}</span>
            )}
          </p>
        </div>
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

      {timescale === 'custom' && (
        <div className="row" style={{ marginBottom: 20 }}>
          <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
          <span style={{ color: 'var(--text-dim)' }}>to</span>
          <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
        </div>
      )}

      <div className="grid-3" style={{ marginTop: 20, marginBottom: 20 }}>
        <div className="stat-tile">
          <div className="label">Net ({range.label.toLowerCase()})</div>
          <div className="value" style={{ color: summary.net_cents >= 0 ? 'var(--success)' : 'var(--danger)' }}>
            {money(summary.net_cents)}
          </div>
        </div>
        <div className="stat-tile">
          <div className="label">Spent</div>
          <div className="value">{money(totalSpent)}</div>
        </div>
        <div className="stat-tile">
          <div className="label">Income</div>
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
          <div className="card-title">{trendTitle}</div>
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
              <XAxis
                dataKey="label"
                stroke="var(--text-faint)"
                fontSize={12}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
                minTickGap={24}
              />
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

      {analytics && (
        <>
          <div className="grid-3" style={{ marginBottom: 20 }}>
            <div className="stat-tile">
              <div className="label">Avg. per day</div>
              <div className="value">{money(analytics.averages.per_day_cents)}</div>
            </div>
            <div className="stat-tile">
              <div className="label">Avg. per week</div>
              <div className="value">{money(analytics.averages.per_week_cents)}</div>
            </div>
            <div className="stat-tile">
              <div className="label">Avg. per year</div>
              <div className="value">{money(analytics.averages.per_year_cents)}</div>
            </div>
          </div>

          <div className="grid-2" style={{ marginBottom: 20 }}>
            {yearData.length > 1 && (
              <div className="card">
                <div className="card-title">Spend by year</div>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={yearData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" vertical={false} />
                    <XAxis dataKey="year" stroke="var(--text-faint)" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="var(--text-faint)" fontSize={12} tickLine={false} axisLine={false} width={40} />
                    <Tooltip
                      contentStyle={{ background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 8 }}
                      formatter={(v: number) => `$${v.toFixed(2)}`}
                    />
                    <Bar dataKey="Spent" fill="#6c8dfa" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            <div className="card" style={yearData.length <= 1 ? { gridColumn: '1 / -1' } : undefined}>
              <div className="card-title">Top items</div>
              <p style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: -6, marginBottom: 10 }}>
                Similar notes (typos, variants) are grouped together automatically.
              </p>
              {analytics.top_items.length === 0 ? (
                <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>No notes to group yet.</p>
              ) : (
                <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                  {analytics.top_items.map((item) => (
                    <div key={item.label} className="row" style={{ justifyContent: 'space-between', padding: '5px 0' }}>
                      <span style={{ fontSize: 13 }} title={item.variants.join(', ')}>
                        {item.label}
                        {item.variants.length > 1 && (
                          <span style={{ color: 'var(--text-faint)', fontSize: 11 }}> (+{item.variants.length - 1} variant{item.variants.length > 2 ? 's' : ''})</span>
                        )}
                      </span>
                      <span style={{ fontSize: 13, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                        {item.count}× · {money(item.total_cents)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

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
            {categories.filter((c) => !c.hidden).map((c) => (
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
          <input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
          <input
            placeholder="Note (optional)"
            value={entryNote}
            onChange={(e) => setEntryNote(e.target.value)}
          />
          <button className="btn btn-primary" type="submit">Add entry</button>
        </form>

        <div>
          <form className="card" onSubmit={addCategory} style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
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

          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
              <div className="card-title" style={{ marginBottom: 0 }}>Manage categories</div>
              {categories.some((c) => c.hidden) && (
                <label className="row" style={{ fontSize: 12, color: 'var(--text-dim)', gap: 5, cursor: 'pointer' }}>
                  <input type="checkbox" checked={showHiddenCategories} onChange={(e) => setShowHiddenCategories(e.target.checked)} />
                  Show hidden
                </label>
              )}
            </div>
            {categoryError && <p style={{ color: 'var(--danger)', fontSize: 12, marginTop: -4 }}>{categoryError}</p>}
            {categories
              .filter((c) => showHiddenCategories || !c.hidden)
              .map((c) => (
                <div key={c.id} className="row" style={{ justifyContent: 'space-between', padding: '5px 0', opacity: c.hidden ? 0.5 : 1 }}>
                  <span style={{ fontSize: 13 }}>{c.name}</span>
                  <div className="row" style={{ gap: 2 }}>
                    <button
                      className="btn btn-ghost"
                      style={{ padding: '2px 6px' }}
                      title={c.hidden ? 'Unhide' : 'Hide'}
                      onClick={() => toggleHiddenCategory(c.id, c.hidden)}
                    >
                      {c.hidden ? <Eye size={13} /> : <EyeOff size={13} />}
                    </button>
                    <button
                      className="btn btn-ghost"
                      style={{ padding: '2px 6px' }}
                      title="Delete"
                      onClick={() => deleteCategory(c.id)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>
            All entries ({filteredEntries.length}
            {hiddenCount > 0 && !showHidden && ` of ${entries.length}`})
          </div>
          <div className="row">
            {hiddenCount > 0 && (
              <label className="row" style={{ fontSize: 13, color: 'var(--text-dim)', gap: 6, cursor: 'pointer' }}>
                <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />
                Show {hiddenCount} hidden
              </label>
            )}
            <select value={transactionFilter} onChange={(e) => { setTransactionFilter(Number(e.target.value) || 'all'); setPage(0); }}>
              <option value="all">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>

        {filteredEntries.length === 0 ? (
          <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>No entries in this range.</p>
        ) : (
          <>
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-dim)', fontSize: 12 }}>
                  <th style={{ padding: '6px 8px' }}>Date</th>
                  <th style={{ padding: '6px 8px' }}>Category</th>
                  <th style={{ padding: '6px 8px' }}>Type</th>
                  <th style={{ padding: '6px 8px' }}>Note</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>Amount</th>
                  <th style={{ padding: '6px 8px' }}></th>
                </tr>
              </thead>
              <tbody>
                {pagedEntries.map((e) => (
                  <tr key={e.id} style={{ borderTop: '1px solid var(--border-soft)', opacity: e.hidden ? 0.45 : 1 }}>
                    <td style={{ padding: '6px 8px', color: 'var(--text-dim)' }}>
                      {new Date(e.date).toLocaleDateString()}
                    </td>
                    <td style={{ padding: '6px 8px' }}>{categoryById.get(e.category_id)?.name ?? '—'}</td>
                    <td style={{ padding: '6px 8px' }}>
                      <span className={`badge ${e.type === 'income' ? 'badge-success' : ''}`}>{e.type}</span>
                    </td>
                    <td style={{ padding: '6px 8px', color: 'var(--text-dim)' }}>{e.note ?? ''}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600 }}>
                      {e.type === 'income' ? '+' : '−'}{money(e.amount_cents)}
                    </td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                      <div className="row" style={{ justifyContent: 'flex-end', gap: 2 }}>
                        <button
                          className="btn btn-ghost"
                          style={{ padding: '2px 6px' }}
                          title={e.hidden ? 'Unhide' : 'Hide'}
                          onClick={() => toggleHidden(e.id, e.hidden)}
                        >
                          {e.hidden ? <Eye size={13} /> : <EyeOff size={13} />}
                        </button>
                        <button
                          className="btn btn-ghost"
                          style={{ padding: '2px 8px', fontSize: 12 }}
                          onClick={() => deleteEntry(e.id)}
                        >
                          ✕
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {totalPages > 1 && (
              <div className="row" style={{ justifyContent: 'center', marginTop: 14 }}>
                <button className="btn" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </button>
                <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                  Page {page + 1} of {totalPages}
                </span>
                <button className="btn" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
