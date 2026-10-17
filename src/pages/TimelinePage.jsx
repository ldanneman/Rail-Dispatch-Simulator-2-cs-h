import { useMemo, useState } from 'react';
import { useApp, useReference } from '../state/AppState.jsx';
import { PRIORITIES } from '../engine/constants.js';
import { compareIds } from '../engine/ids.js';
import TimelineChart, { TimelineLegend } from '../components/TimelineChart.jsx';
import ShipmentDetail from '../components/ShipmentDetail.jsx';
import { Card, Field, Segmented } from '../components/ui.jsx';

const MAX_SHIPMENT_ROWS = 120;

export default function TimelinePage() {
  const { scenario, run, input, result } = useApp();
  const ref = useReference();
  const [mode, setMode] = useState('connection');
  const [px, setPx] = useState(10);
  const [full, setFull] = useState(false);
  const [showOnTime, setShowOnTime] = useState(true);
  const [showLate, setShowLate] = useState(true);
  const [priority, setPriority] = useState('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return result.shipments.filter((s) => {
      if (s.legs.length === 0) return false;
      if (s.status === 'on_time' && !showOnTime) return false;
      if (s.status === 'late' && !showLate) return false;
      if (priority !== 'all' && s.priority !== Number(priority)) return false;
      if (q && !s.id.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [result, showOnTime, showLate, priority, query]);

  const ordered = useMemo(() => (mode === 'shipment' ? [...filtered].sort((a, b) => a.departure - b.departure || compareIds(a.id, b.id)) : filtered), [filtered, mode]);
  const shown = mode === 'shipment' ? ordered.slice(0, MAX_SHIPMENT_ROWS) : ordered;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Timeline</h1>
          <p>{scenario.name}. Every scheduled movement on an hourly axis (hour 0 = start of the plan). Bars span departure to arrival; select one to open the shipment.</p>
        </div>
      </div>
      <Card>
        <div className="row" style={{ gap: 16 }}>
          <Segmented label="Group timeline by" value={mode} onChange={setMode} options={[{ value: 'connection', label: 'By connection' }, { value: 'shipment', label: 'By shipment' }]} />
          <Field label="Zoom"><input type="range" min="4" max="24" value={px} onChange={(e) => setPx(Number(e.target.value))} aria-label="Timeline zoom" /></Field>
          <label className="checkbox"><input type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} />Full 7-day horizon</label>
          <label className="checkbox"><input type="checkbox" checked={showOnTime} onChange={(e) => setShowOnTime(e.target.checked)} />On time</label>
          <label className="checkbox"><input type="checkbox" checked={showLate} onChange={(e) => setShowLate(e.target.checked)} />Late</label>
          <Field label="Priority">
            <select value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="Timeline priority filter">
              <option value="all">Any</option>
              {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </Field>
          {mode === 'shipment' && <Field label="Shipment id"><input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. S01" aria-label="Filter timeline by shipment id" /></Field>}
        </div>
      </Card>
      <Card flush={false} actions={<TimelineLegend mode={mode} />} title={`${filtered.length} shipment${filtered.length === 1 ? '' : 's'} with movements`}>
        <TimelineChart shipments={shown} connections={input.connections} disruptions={input.disruptions} mode={mode} px={px} fullRange={full} onSelectShipment={setSelected} />
        {mode === 'shipment' && ordered.length > MAX_SHIPMENT_ROWS && <p className="muted" style={{ marginTop: 8 }}>Showing the first {MAX_SHIPMENT_ROWS} of {ordered.length} shipments (by departure). Filter to narrow the list.</p>}
        {result.metrics.totals.undeliverable > 0 && <p className="muted" style={{ marginTop: 8 }}>{result.metrics.totals.undeliverable} undeliverable shipment{result.metrics.totals.undeliverable === 1 ? ' has' : 's have'} no movements and are not drawn; see the Shipments page for the reasons.</p>}
      </Card>
      {selected && <ShipmentDetail shipmentId={selected} run={run} refRun={ref?.run} refName={ref?.name} onClose={() => setSelected(null)} />}
    </main>
  );
}
