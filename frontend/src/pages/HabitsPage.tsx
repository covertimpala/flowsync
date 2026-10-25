import { Flame, Gift, Star } from 'lucide-react';
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

  const unredeemedRewards = rewards.filter((r) => !r.redeemed);
  const redeemedRewards = rewards.filter((r) => r.redeemed);
  const bestStreak = habits.reduce((max, h) => Math.max(max, h.best_streak), 0);
  const activeStreaks = habits.filter((h) => h.current_streak > 0).length;

  return (
    <div>
      <h1>Habits</h1>
      <p className="page-subtitle">Daily check-ins, streaks, and the rewards you've earned</p>

      <div className="grid-3" style={{ marginBottom: 20 }}>
        <div className="stat-tile">
          <div className="label">Available points</div>
          <div className="value" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Star size={18} color="var(--warning)" fill="var(--warning)" /> {points}
          </div>
        </div>
        <div className="stat-tile">
          <div className="label">Active streaks</div>
          <div className="value">{activeStreaks} / {habits.length}</div>
        </div>
        <div className="stat-tile">
          <div className="label">Best streak ever</div>
          <div className="value" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Flame size={18} color="var(--danger)" /> {bestStreak}
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div>
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-title">Daily habits</div>
            {habits.length === 0 && <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>No habits yet — add one below.</p>}
            {habits.map((h) => (
              <div
                key={h.id}
                className="row"
                style={{
                  justifyContent: 'space-between',
                  padding: '12px 14px',
                  marginBottom: 8,
                  background: 'var(--panel-2)',
                  borderRadius: 10,
                }}
              >
                <div>
                  <div style={{ fontWeight: 500 }}>{h.name}</div>
                  <div className="row" style={{ marginTop: 4, gap: 10, color: 'var(--text-dim)', fontSize: 12 }}>
                    <span className="row" style={{ gap: 3 }}>
                      <Flame size={12} color={h.current_streak > 0 ? 'var(--danger)' : 'var(--text-faint)'} />
                      {h.current_streak} day streak
                    </span>
                    <span>best {h.best_streak}</span>
                    <span>+{h.points_per_completion}pts</span>
                  </div>
                </div>
                <button className="btn btn-primary" style={{ whiteSpace: 'nowrap' }} onClick={() => complete(h.id)}>
                  Done today
                </button>
              </div>
            ))}
          </div>

          <form className="card" onSubmit={addHabit} style={{ display: 'flex', gap: 8 }}>
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
        </div>

        <div>
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-title">Rewards</div>
            {rewards.length === 0 && <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>No rewards set up yet.</p>}
            {unredeemedRewards.map((r) => (
              <div
                key={r.id}
                className="row"
                style={{ justifyContent: 'space-between', padding: '10px 14px', marginBottom: 6, background: 'var(--panel-2)', borderRadius: 10 }}
              >
                <span className="row" style={{ gap: 8 }}>
                  <Gift size={15} color="var(--text-dim)" /> {r.name}
                </span>
                <span className="row">
                  <span style={{ color: 'var(--text-dim)', fontSize: 13 }}>{r.point_cost} pts</span>
                  <button className="btn" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => redeem(r.id)}>
                    Redeem
                  </button>
                </span>
              </div>
            ))}
            {redeemedRewards.length > 0 && (
              <>
                <div style={{ fontSize: 11, color: 'var(--text-faint)', margin: '10px 0 6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Redeemed
                </div>
                {redeemedRewards.map((r) => (
                  <div key={r.id} className="row" style={{ justifyContent: 'space-between', padding: '6px 14px', opacity: 0.6 }}>
                    <span>{r.name}</span>
                    <span className="badge badge-success">Redeemed</span>
                  </div>
                ))}
              </>
            )}
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
              Add
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
