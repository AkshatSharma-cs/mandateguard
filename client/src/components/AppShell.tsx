import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Activity, BookOpen, ClipboardCheck, FileClock, LayoutDashboard, Menu, Settings, X } from 'lucide-react';
import { api } from '../api';
import { BrandLockup } from './Brand';
import { StatusBadge } from './UI';

const nav = [
  { to: '/dashboard', label: 'Overview', Icon: LayoutDashboard },
  { to: '/mandates/new', label: 'Mandates', Icon: ClipboardCheck },
  { to: '/agent-lab', label: 'Agent Lab', Icon: Activity },
  { to: '/catalogue', label: 'Catalogue', Icon: BookOpen },
  { to: '/audit', label: 'Audit Log', Icon: FileClock },
  { to: '/settings', label: 'Settings', Icon: Settings },
];
export function AppShell() {
  const [open, setOpen] = useState(false); const [connected, setConnected] = useState<boolean | null>(null); const location = useLocation();
  useEffect(() => {
    let alive = true;
    const checkConnection = () => api.health().then(() => { if (alive) setConnected(true); }).catch(() => { if (alive) setConnected(false); });
    checkConnection();
    const timer = window.setInterval(checkConnection, 5000);
    window.addEventListener('online', checkConnection);
    return () => { alive = false; window.clearInterval(timer); window.removeEventListener('online', checkConnection); };
  }, []);
  const title = nav.find((item) => location.pathname === item.to || (item.to !== '/mandates/new' && location.pathname.startsWith(`${item.to}/`)))?.label ?? 'MandateGuard';
  return <div className="app-frame">
    {open && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setOpen(false)} />}
    <header className="topbar">
      <div className="header-inner">
        <BrandLockup />
        <button className="icon-button mobile-menu" aria-label="Open navigation" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{open ? <X size={20} /> : <Menu size={20} />}</button>
        <nav className={`header-nav ${open ? 'header-nav-open' : ''}`} aria-label="Main navigation">{nav.filter(({ label }) => ['Overview', 'Mandates', 'Agent Lab', 'Audit Log'].includes(label)).map(({ to, label }) => <NavLink key={to} to={to} onClick={() => setOpen(false)} className={({ isActive }) => `nav-link ${isActive || (to === '/mandates/new' && location.pathname.startsWith('/mandates/')) ? 'nav-active' : ''}`}>{label === 'Agent Lab' ? 'Console' : label === 'Audit Log' ? 'Security tests' : label === 'Mandates' ? 'How it works' : label}</NavLink>)}</nav>
        <div className="topbar-right"><span className={`api-indicator ${connected === false ? 'api-offline' : ''}`}><span className="api-dot" />{connected === null ? 'Checking API' : connected ? 'API connected' : 'API unavailable'}</span><StatusBadge status="SANDBOX" /><Link className="button button-primary header-action" to="/agent-lab">Open console</Link></div>
      </div>
    </header>
    <main className="main-area">
      <div className="content-area"><Outlet /></div>
      <footer className="app-footer">MandateGuard is an independent hackathon project. It uses the PayPal sandbox and is not affiliated with or endorsed by PayPal.</footer>
    </main>
  </div>;
}
