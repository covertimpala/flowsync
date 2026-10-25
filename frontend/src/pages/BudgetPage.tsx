import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { BudgetCategory, BudgetSummary } from '../types';

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function BudgetPage() {
  const now = new Date();
  const [summary, setSummary] = useState<BudgetSummary | null>(null);
  const [categories, setCategories] = useState<BudgetCategory[]>([]);
  const [newCategory, setNewCategory] = useState('');
  const [newLimit, setNewLimit] = useState(0);
  const [entryCategory, setEntryCategory] = useState<number | null>(null);
  const [entryAmount, setEntryAmount] = useState(0);
  const [entryType, setEntryType] = useState<'expense' | 'income'>('expense');

  async function load() {
    const [s, c] = await Promise.all([
      api.get<BudgetSummary>(`/api/budget/summary?year=${now.getFullYear()}&month=${now.getMonth() + 1}`),
      api.get<BudgetCategory[]>('/api/budget/categories'),
    ]);
    setSummary(s);
    setCategories(c);
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

  if (!summary) return <p>Loading…</p>;

  return (
    <div>
      <h1>Budget — {now.toLocaleString([], { month: 'long', year: 'numeric' })}</h1>

      <div className="card" style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between' }}>
        <strong>Net this month</strong>
        <strong style={{ color: summary.net_cents >= 0 ? 'var(--success)' : 'var(--danger)' }}>
          {money(summary.net_cents)}
        </strong>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
        {summary.by_category.map((cs) => (
          <div key={cs.category.id} className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span>{cs.category.name}</span>
              <span>
                {money(cs.spent_cents)}
                {cs.category.monthly_limit_cents > 0 && ` / ${money(cs.category.monthly_limit_cents)}`}
              </span>
            </div>
            {cs.category.monthly_limit_cents > 0 && (
              <div style={{ background: 'var(--panel-2)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${Math.min(100, (cs.spent_cents / cs.category.monthly_limit_cents) * 100)}%`,
                    background: cs.over_limit ? 'var(--danger)' : 'var(--accent)',
                  }}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      <form className="card" onSubmit={addEntry} style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <select value={entryCategory ?? ''} onChange={(e) => setEntryCategory(Number(e.target.value))}>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
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
          style={{ width: 100 }}
        />
        <button className="btn btn-primary" type="submit">
          Add entry
        </button>
      </form>

      <form className="card" onSubmit={addCategory} style={{ display: 'flex', gap: 8 }}>
        <input
          style={{ flex: 1 }}
          placeholder="New category"
          value={newCategory}
          onChange={(e) => setNewCategory(e.target.value)}
        />
        <input
          type="number"
          placeholder="Monthly limit"
          value={newLimit || ''}
          onChange={(e) => setNewLimit(Number(e.target.value))}
          style={{ width: 120 }}
        />
        <button className="btn" type="submit">
          Add category
        </button>
      </form>
    </div>
  );
}
