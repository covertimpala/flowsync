import { NavLink, Outlet } from 'react-router-dom';

const LINKS = [
  { to: '/', label: 'Today' },
  { to: '/calendar', label: 'Calendar' },
  { to: '/habits', label: 'Habits' },
  { to: '/budget', label: 'Budget' },
  { to: '/settings', label: 'Settings' },
];

export function NavShell() {
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <nav
        style={{
          width: 200,
          borderRight: '1px solid var(--border)',
          padding: '20px 12px',
          flexShrink: 0,
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 18, padding: '0 8px 20px' }}>FlowSync</div>
        {LINKS.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            style={({ isActive }) => ({
              display: 'block',
              padding: '8px 10px',
              borderRadius: 6,
              marginBottom: 2,
              textDecoration: 'none',
              color: isActive ? 'white' : 'var(--text-dim)',
              background: isActive ? 'var(--accent-dim)' : 'transparent',
            })}
          >
            {link.label}
          </NavLink>
        ))}
      </nav>
      <main style={{ flex: 1, padding: 28, maxWidth: 960 }}>
        <Outlet />
      </main>
    </div>
  );
}
