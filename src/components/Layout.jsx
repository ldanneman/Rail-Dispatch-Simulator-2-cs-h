import { useEffect } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { BarChart3, BookOpen, CalendarRange, FlaskConical, GitCompare, LayoutDashboard, Package, RefreshCw, TrainFront, TriangleAlert, Lock, ShieldCheck, ShieldAlert, X } from 'lucide-react';
import { useApp, useVerification } from '../state/AppState.jsx';
import { listScenarios } from '../state/reducer.js';
import { Banner } from './ui.jsx';

const NAV = [
  ['/', 'Dashboard', LayoutDashboard, true],
  ['/shipments', 'Shipments', Package],
  ['/timeline', 'Timeline', CalendarRange],
  ['/disruptions', 'Disruptions', TriangleAlert],
  ['/compare', 'Compare', GitCompare],
  ['/lab', 'Test Lab', FlaskConical],
  ['/about', 'Assumptions', BookOpen],
];

function Notices() {
  const { state, dispatch } = useApp();
  useEffect(() => {
    const timers = state.notices
      .filter((n) => n.level === 'info' || n.level === 'ok')
      .map((n) => setTimeout(() => dispatch({ type: 'notice/dismiss', id: n.id }), 7000));
    return () => timers.forEach(clearTimeout);
  }, [state.notices, dispatch]);
  if (!state.notices.length) return null;
  return (
    <div className="notices" aria-live="polite">
      {state.notices.map((n) => (
        <Banner key={n.id} tone={n.level === 'warning' ? 'warning' : n.level === 'error' ? 'error' : n.level === 'ok' ? 'ok' : 'info'}
          actions={<button className="btn icon ghost" aria-label="Dismiss message" onClick={() => dispatch({ type: 'notice/dismiss', id: n.id })}><X size={16} /></button>}>
          {n.text}
        </Banner>
      ))}
    </div>
  );
}

function RunStatus() {
  const { scenario, run, stale, dispatch } = useApp();
  const verification = useVerification(run);
  return (
    <div className="row" style={{ gap: 8 }}>
      {stale ? (
        <>
          <span className="badge warning"><TriangleAlert size={13} aria-hidden="true" />Inputs changed since last run</span>
          <button className="btn sm primary" onClick={() => dispatch({ type: 'scenario/run', id: scenario.id })}><RefreshCw size={14} aria-hidden="true" />Recalculate</button>
        </>
      ) : (
        <span className="badge good">Results current</span>
      )}
      {verification && (verification.ok ? (
        <span className="badge good" title={`${verification.checkedShipments} shipments and ${verification.checkedMovements} movements re-checked by the independent verifier`}><ShieldCheck size={13} aria-hidden="true" />Schedule verified</span>
      ) : (
        <span className="badge undeliverable" title={verification.violations.map((v) => v.message).join('\n')}><ShieldAlert size={13} aria-hidden="true" />{verification.violations.length} violation{verification.violations.length === 1 ? '' : 's'}</span>
      ))}
    </div>
  );
}

export default function AppLayout() {
  const { state, dispatch, scenario } = useApp();
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark"><TrainFront size={17} aria-hidden="true" /></span><span>Rail Dispatch<br /><span className="faint" style={{ fontWeight: 500, fontSize: 12 }}>Simulator</span></span></div>
        <nav className="nav" aria-label="Main">
          {NAV.map(([to, label, Icon, end]) => (
            <NavLink key={to} to={to} end={end}><Icon size={17} aria-hidden="true" />{label}</NavLink>
          ))}
        </nav>
        <div className="sidebar-foot"><BarChart3 size={13} style={{ verticalAlign: -2 }} aria-hidden="true" /> All figures are computed by the scheduling engine from the scenario shown above.</div>
      </aside>
      <div className="main">
        <header className="topbar">
          <label className="row" style={{ gap: 8 }}>
            <span className="muted">Scenario</span>
            <select aria-label="Active scenario" style={{ width: 'auto', minWidth: 200 }} value={state.activeId} onChange={(e) => dispatch({ type: 'scenario/select', id: e.target.value })}>
              {listScenarios(state).map((s) => <option key={s.id} value={s.id}>{s.name}{s.locked ? ' (read-only)' : ''}</option>)}
            </select>
          </label>
          {scenario.locked && <span className="badge info"><Lock size={12} aria-hidden="true" />Immutable baseline</span>}
          <span className="spacer" />
          <RunStatus />
        </header>
        <Outlet />
      </div>
      <Notices />
    </div>
  );
}
