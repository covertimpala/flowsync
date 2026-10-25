import { CalendarDays, ListTodo, PiggyBank, Settings, Sparkles, Target } from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';

const LINKS = [
  { to: '/', label: 'Today', icon: ListTodo },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/habits', label: 'Habits', icon: Target },
  { to: '/budget', label: 'Budget', icon: PiggyBank },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function NavShell() {
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <nav
        style={{
          width: 216,
          borderRight: '1px solid var(--border-soft)',
          padding: '22px 14px',
          flexShrink: 0,
          background: 'var(--bg-elevated)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px 26px' }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: 'linear-gradient(135deg, var(--accent), #8aa5ff)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 14px -4px var(--accent-glow)',
            }}
          >
            <Sparkles size={15} color="white" strokeWidth={2.5} />
          </div>
          <span style={{ fontWeight: 700, fontSize: 16, letterSpacing: '-0.02em' }}>FlowSync</span>
        </div>

        {LINKS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            style={({ isActive }) => ({
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '9px 12px',
              borderRadius: 10,
              marginBottom: 2,
              textDecoration: 'none',
              fontSize: 14,
              fontWeight: isActive ? 600 : 500,
              color: isActive ? 'var(--text)' : 'var(--text-dim)',
              background: isActive ? 'var(--panel-2)' : 'transparent',
              border: isActive ? '1px solid var(--border)' : '1px solid transparent',
              transition: 'all 0.15s ease',
            })}
          >
            <Icon size={16} strokeWidth={2} />
            {label}
          </NavLink>
        ))}
      </nav>
      <main style={{ flex: 1, padding: '32px 36px', maxWidth: 1040 }}>
        <Outlet />
      </main>
    </div>
  );
}
