import { useMemo, useState } from 'react';
import { AlertOctagon, CheckCircle2, Clock, Gauge, Route, Timer } from 'lucide-react';
import { useApp } from '../state/AppState.jsx';
import { deriveAlerts } from '../engine/alerts.js';
import { LATE_CAUSE, PRIORITIES } from '../engine/constants.js';
import AlertsPanel from '../components/AlertsPanel.jsx';
import { ConnectionUtilizationTable, TerminalThroughputTable } from '../components/UtilizationPanel.jsx';
import NetworkMap from '../components/NetworkMap.jsx';
import ShipmentDetail from '../components/ShipmentDetail.jsx';
import { Card, KpiCard } from '../components/ui.jsx';
import { useReference } from '../state/AppState.jsx';
import { fmtHours, fmtNum, fmtPct, fmtRatioPct, priorityLabel } from '../utils/format.js';

function StatusBar({ totals }) {
  const total = totals.shipments || 1;
  const part = (k, label) => totals[k] > 0 && (
    <span key={k} className={k === 'onTime' ? 'on_time' : k === 'late' ? 'late' : 'undeliverable'} style={{ flex: totals[k] / total }} title={`${label}: ${totals[k]} (${fmtNum((totals[k] / total) * 100)}%)`} />
  );
  return (
    <div>
      <div className="stacked" role="img" aria-label={`${totals.onTime} on time, ${totals.late} late, ${totals.undeliverable} undeliverable of ${totals.shipments}`}>
        {part('onTime', 'On time')}{part('late', 'Late')}{part('undeliverable', 'Undeliverable')}
      </div>
      <div className="legend" style={{ marginTop: 8 }}>
        <span><i className="sw on_time" />On time {totals.onTime}</span>
        <span><i className="sw late" />Late {totals.late}</span>
        <span><i className="sw undeliverable" />Undeliverable {totals.undeliverable}</span>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { scenario, run, result, input, stale } = useApp();
  const ref = useReference();
  const [selectedShipment, setSelectedShipment] = useState(null);
  const [selectedConn, setSelectedConn] = useState(null);
  const m = result.metrics;
  const alerts = useMemo(() => deriveAlerts(input, result), [input, result]);

  const lateCauses = useMemo(() => {
    const c = { [LATE_CAUSE.CONGESTION]: 0, [LATE_CAUSE.DISRUPTION]: 0, [LATE_CAUSE.DEADLINE_INFEASIBLE]: 0 };
    for (const s of result.shipments) if (s.lateCause) c[s.lateCause] += 1;
    return c;
  }, [result]);

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p>
            {scenario.name} — {input.terminals.length} terminals, {input.connections.length} connections, {input.shipments.length} shipments
            {input.disruptions.length > 0 && `, ${input.disruptions.length} disruption${input.disruptions.length === 1 ? '' : 's'}`}. {stale && 'Showing the last calculated results.'}
          </p>
        </div>
      </div>

      <div className="grid kpis">
        <KpiCard label="On-time delivery" icon={<CheckCircle2 size={14} aria-hidden="true" />} value={fmtPct(m.onTimePct)} sub={`${m.totals.onTime} of ${m.totals.shipments} shipments`} tone="good" />
        <KpiCard label="Late deliveries" icon={<Clock size={14} aria-hidden="true" />} value={m.totals.late} sub={`${fmtPct(m.latePct)} of shipments`} tone={m.totals.late ? 'late' : ''} />
        <KpiCard label="Undeliverable" icon={<AlertOctagon size={14} aria-hidden="true" />} value={m.totals.undeliverable} sub="no feasible route within 7 days" tone={m.totals.undeliverable ? 'bad' : ''} />
        <KpiCard label="Avg delivery delay" icon={<Timer size={14} aria-hidden="true" />} value={fmtHours(m.avgLateness)} sub={m.avgLatenessLateOnly === null ? 'delivered shipments' : `${fmtHours(m.avgLatenessLateOnly)} among late ones`} />
        <KpiCard label="Capacity utilization" icon={<Gauge size={14} aria-hidden="true" />} value={fmtRatioPct(m.utilization, 1)} sub={m.operatingWindow ? `hours ${m.operatingWindow.start}–${m.operatingWindow.end} · 7-day ${fmtRatioPct(m.horizonUtilization, 1)}` : 'no movements'} />
        <KpiCard label="Movements" icon={<Route size={14} aria-hidden="true" />} value={m.totalMovements} sub={`avg transit ${fmtHours(m.avgTransit)}`} />
      </div>

      <div className="grid two">
        <Card title="Network overview" actions={<span className="muted">Edge colour = utilization · ↑ departures ↓ arrivals</span>}>
          <NetworkMap terminals={input.terminals} connections={input.connections} disruptions={input.disruptions} metrics={m} selectedConnectionId={selectedConn} onSelectConnection={(id) => setSelectedConn((c) => (c === id ? null : id))} />
        </Card>
        <Card title="Operational alerts" actions={<span className="muted">{alerts.length}</span>} flush>
          <div style={{ maxHeight: 520, overflow: 'auto' }}>
            <AlertsPanel alerts={alerts} onSelectShipment={setSelectedShipment} onSelectConnection={setSelectedConn} />
          </div>
        </Card>
      </div>

      <div className="grid equal">
        <Card title="Delivery outcome">
          <StatusBar totals={m.totals} />
          <h3 style={{ margin: '16px 0 8px' }}>By priority</h3>
          <table className="t dense">
            <thead><tr><th>Priority</th><th className="r">Shipments</th><th className="r">On time</th><th className="r">Late</th><th className="r">Undeliverable</th></tr></thead>
            <tbody>
              {PRIORITIES.map((p) => {
                const b = m.byPriority[p.value];
                return <tr key={p.value}><td>{priorityLabel(p.value)}</td><td className="r">{b.total}</td><td className="r">{b.onTime}</td><td className="r">{b.late}</td><td className="r">{b.undeliverable}</td></tr>;
              })}
            </tbody>
          </table>
          {m.totals.late > 0 && (
            <p className="muted" style={{ marginTop: 12 }}>
              Why shipments are late: <strong>{lateCauses[LATE_CAUSE.CONGESTION]}</strong> congestion · <strong>{lateCauses[LATE_CAUSE.DISRUPTION]}</strong> disruption · <strong>{lateCauses[LATE_CAUSE.DEADLINE_INFEASIBLE]}</strong> deadline shorter than minimum transit.
            </p>
          )}
        </Card>
        <Card title="Terminal throughput" flush><TerminalThroughputTable metrics={m} /></Card>
      </div>

      <Card title="Connection utilization & bottlenecks" actions={<span className="muted">Utilization = movements ÷ capacity-slots in the operating window</span>} flush>
        <ConnectionUtilizationTable metrics={m} selectedId={selectedConn} onSelect={(id) => setSelectedConn((c) => (c === id ? null : id))} />
      </Card>

      {selectedShipment && <ShipmentDetail shipmentId={selectedShipment} run={run} refRun={ref?.run} refName={ref?.name} onClose={() => setSelectedShipment(null)} />}
    </main>
  );
}
