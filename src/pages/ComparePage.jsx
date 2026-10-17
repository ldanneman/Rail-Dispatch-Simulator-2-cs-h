import { useMemo, useState } from 'react';
import { useApp } from '../state/AppState.jsx';
import { listScenarios } from '../state/reducer.js';
import { BASELINE_ID } from '../state/scenarioModel.js';
import ImpactReport from '../components/ImpactReport.jsx';
import MetricComparison from '../components/MetricComparison.jsx';
import ShipmentDetail from '../components/ShipmentDetail.jsx';
import DataTable from '../components/DataTable.jsx';
import { Banner, Card, Field } from '../components/ui.jsx';
import { fmtRatioPct } from '../utils/format.js';

export default function ComparePage() {
  const { state, scenario } = useApp();
  const all = listScenarios(state).filter((s) => state.runs[s.id]);
  const defaultB = scenario.id !== BASELINE_ID ? scenario.id : (state.scenarios.at(-1)?.id ?? BASELINE_ID);
  const [aId, setA] = useState(BASELINE_ID);
  const [bId, setB] = useState(defaultB);
  const [selected, setSelected] = useState(null);
  const a = all.find((s) => s.id === aId) ?? all[0];
  const b = all.find((s) => s.id === bId) ?? all[0];
  const ra = state.runs[a.id];
  const rb = state.runs[b.id];

  const connRows = useMemo(() => {
    const mb = new Map(rb.result.metrics.connections.map((c) => [c.id, c]));
    return ra.result.metrics.connections.filter((c) => mb.has(c.id)).map((c) => ({ id: c.id, link: `${c.from}–${c.to}`, a: c, b: mb.get(c.id) }));
  }, [ra, rb]);
  const connColumns = [
    { key: 'id', header: 'Connection', render: (r) => <span className="mono">{r.id}</span> },
    { key: 'link', header: 'Link' },
    { key: 'ma', header: 'Movements A', align: 'r', sortValue: (r) => r.a.movements, render: (r) => r.a.movements },
    { key: 'mb', header: 'Movements B', align: 'r', sortValue: (r) => r.b.movements, render: (r) => r.b.movements },
    { key: 'ua', header: 'Utilization A', align: 'r', sortValue: (r) => r.a.utilization, render: (r) => fmtRatioPct(r.a.utilization) },
    { key: 'ub', header: 'Utilization B', align: 'r', sortValue: (r) => r.b.utilization, render: (r) => fmtRatioPct(r.b.utilization) },
    { key: 'pa', header: 'Peak A', align: 'r', sortValue: (r) => r.a.peakLoad, render: (r) => fmtRatioPct(r.a.peakLoad) },
    { key: 'pb', header: 'Peak B', align: 'r', sortValue: (r) => r.b.peakLoad, render: (r) => fmtRatioPct(r.b.peakLoad) },
  ];

  const staleOf = (s) => state.runs[s.id].rev !== s.rev;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Scenario comparison</h1>
          <p>Compare any two scenarios, typically the immutable baseline against a disrupted what-if. Shipments are matched by id; every number comes from each scenario’s own schedule.</p>
        </div>
      </div>
      <Card>
        <div className="row" style={{ gap: 16 }}>
          <Field label="Scenario A (reference)"><select value={a.id} onChange={(e) => setA(e.target.value)} aria-label="Scenario A">{all.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Field label="Scenario B"><select value={b.id} onChange={(e) => setB(e.target.value)} aria-label="Scenario B">{all.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        </div>
      </Card>
      {all.length < 2 && <Banner tone="info">Only the baseline exists so far. Create a scenario from the Disruptions page or the Test Lab to compare it with the baseline.</Banner>}
      {a.id === b.id && all.length > 1 && <Banner tone="info">Both sides are the same scenario, so nothing differs. Pick two different scenarios.</Banner>}
      {(staleOf(a) || staleOf(b)) && <Banner tone="warning">A scenario has been edited since it was last calculated; its figures are from the previous run. Recalculate it from the header.</Banner>}
      <Card title="Headline metrics"><MetricComparison refRun={ra} run={rb} refName={`A: ${a.name}`} name={`B: ${b.name}`} /></Card>
      <Card title="Shipment-level differences"><ImpactReport refRun={ra} run={rb} refName={a.name} name={b.name} onSelectShipment={setSelected} /></Card>
      <Card title="Connection utilization" flush><DataTable columns={connColumns} rows={connRows} dense initialSort={{ key: 'ub', dir: -1 }} caption="Connection utilization in both scenarios" /></Card>
      {selected && <ShipmentDetail shipmentId={selected} run={rb} refRun={ra} refName={a.name} onClose={() => setSelected(null)} />}
    </main>
  );
}
