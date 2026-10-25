import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Habit, Reward } from '../types';

export function HabitsPage() {
  const [habits, setHabits] = useState<Habit[]>([]);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [points, setPoints] = useState(0);
  const [newHabit, setNewHabit] = useState('');
  const [newReward, setNewReward] = useState('');
  const [newRewardCost, setNewRewardCost] = useState(50);

  async function load() {
    const [h, r, p] = await Promise.all([
      api.get<Habit[]>('/api/habits'),
      api.get<Reward[]>('/api/habits/rewards'),
      api.get<{ points: number }>('/api/habits/points'),
    ]);
    setHabits(h);
    setRewards(r);
    setPoints(p.points);
  }

  useEffect(() => {
    load();
  }, []);

  async function addHabit(e: React.FormEvent) {
    e.preventDefault();
    if (!newHabit.trim()) return;
    await api.post('/api/habits', { name: newHabit.trim() });
    setNewHabit('');
    load();
  }

  async function complete(id: number) {
    await api.post(`/api/habits/${id}/complete`);
    load();
  }

  async function addReward(e: React.FormEvent) {
    e.preventDefault();
    if (!newReward.trim()) return;
    await api.post('/api/habits/rewards', { name: newReward.trim(), point_cost: newRewardCost });
    setNewReward('');
    load();
  }

  async function redeem(id: number) {
    await api.post(`/api/habits/rewards/${id}/redeem`);
    load();
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ flex: 1 }}>Habits</h1>
        <span className="badge" style={{ fontSize: 14, padding: '4px 12px' }}>
          ⭐ {points} pts
        </span>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        {habits.length === 0 && <p style={{ color: 'var(--text-dim)' }}>No habits yet.</p>}
        {habits.map((h) => (
          <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}>
            <span style={{ flex: 1 }}>{h.name}</span>
            <span style={{ color: 'var(--text-dim)', fontSize: 13 }}>
              streak {h.current_streak} · best {h.best_streak} · +{h.points_per_completion}pts
            </span>
            <button className="btn btn-primary" onClick={() => complete(h.id)}>
              Done today
            </button>
          </div>
        ))}
      </div>

      <form className="card" onSubmit={addHabit} style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <input
          style={{ flex: 1 }}
          placeholder="e.g. Drink water"
          value={newHabit}
          onChange={(e) => setNewHabit(e.target.value)}
        />
        <button className="btn btn-primary" type="submit">
          Add habit
        </button>
      </form>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3>Rewards</h3>
        {rewards.map((r) => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
            <span style={{ flex: 1 }}>{r.name}</span>
            <span style={{ color: 'var(--text-dim)', fontSize: 13 }}>{r.point_cost} pts</span>
            {r.redeemed ? (
              <span className="badge" style={{ color: 'var(--success)' }}>
                Redeemed
              </span>
            ) : (
              <button className="btn" onClick={() => redeem(r.id)}>
                Redeem
              </button>
            )}
          </div>
        ))}
      </div>

      <form className="card" onSubmit={addReward} style={{ display: 'flex', gap: 8 }}>
        <input
          style={{ flex: 1 }}
          placeholder="e.g. Takeout night"
          value={newReward}
          onChange={(e) => setNewReward(e.target.value)}
        />
        <input
          type="number"
          style={{ width: 90 }}
          value={newRewardCost}
          onChange={(e) => setNewRewardCost(Number(e.target.value))}
        />
        <button className="btn btn-primary" type="submit">
          Add reward
        </button>
      </form>
    </div>
  );
}
