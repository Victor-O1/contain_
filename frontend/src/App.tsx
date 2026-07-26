import React from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { ThemeProvider, useTheme } from './hooks/useTheme';
import Dashboard from './components/Dashboard';
import ContainerDetail from './components/ContainerDetail';
import Admin from './components/Admin';
import Compiler from './components/Compiler';

function NavLink({ to, children }: { to: string; children: React.ReactNode }) {
  const { pathname } = useLocation();
  const active = to === '/' ? pathname === '/' : pathname.startsWith(to);
  return (
    <Link to={to} className={`nav-link${active ? ' active' : ''}`}>
      <span className="nav-marker">{active ? '>' : ' '}</span> {children}
    </Link>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const { theme, toggle } = useTheme();
  return (
    <div className="app-shell">
      <div className="sidebar">
        <div className="brand">
          <span className="brand-bracket">[</span>SANDBOX<span className="brand-accent">::CTRL</span><span className="brand-bracket">]</span>
          <span className="cursor-blink">_</span>
        </div>
        <div className="brand-sub">// local docker control plane</div>

        <nav className="nav-list">
          <NavLink to="/">dashboard</NavLink>
          <NavLink to="/compiler">compiler</NavLink>
          <NavLink to="/admin">admin</NavLink>
        </nav>

        <div className="sidebar-footer">
          <div className="status-line">
            <span className="status-dot" /> local-operator <span style={{ color: 'var(--text-dim)' }}>(no auth)</span>
          </div>
          <button className="btn secondary" onClick={toggle} style={{ width: '100%' }}>
            {theme === 'dark' ? '[ light_mode ]' : '[ dark_mode ]'}
          </button>
        </div>
      </div>
      <div className="main">{children}</div>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <Shell>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/compiler" element={<Compiler />} />
          <Route path="/containers/:id" element={<ContainerDetail />} />
          <Route path="/admin" element={<Admin />} />
        </Routes>
      </Shell>
    </ThemeProvider>
  );
}
