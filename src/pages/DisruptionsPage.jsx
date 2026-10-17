import { useMemo, useState } from 'react';
import { GitBranch, RefreshCw, Trash2 } from 'lucide-react';
import { useApp, useReference } from '../state/AppState.jsx';
import { listScenarios } from '../state/reducer.js';
import { describeDisruption } from '../engine/diagnose.js';
import { BASELINE_ID } from '../state/scenarioModel.js';
import DisruptionForm from '../components/DisruptionForm.jsx';
import ImpactReport from '../components/ImpactReport.jsx';
import MetricComparison from '../components/MetricComparison.jsx';
import ShipmentDetail from '../components/ShipmentDetail.jsx';
import DataTable from '../components/DataTable.jsx';
import { Banner, Card, Field } from '../components/ui.jsx';

const TYPE_LABEL = { closure: 'Closure', travel_time: 'Travel time', capacity: 'Capacity', release_delay: 'Release delay' };

export default function DisruptionsPage() {
  const { state, dispatch, scenario, run, stale } = useApp();
  const defaultRef = useReference();
  const [override, setOverride] = useState(null);
  const [selected, setSelected] = useState(null);

  const choices = listScenarios(state).filter((s) => s.id !== scenario.id && state.runs[s.id]);
  const refId = override && choices.some((s) => s.id === override) ? override : defaultRef?.id;
  const refScenario = choices.find((s) => s.id === refId);
  const refRun = refScenario ? state.runs[refScenario.id] : null;
  const locked = scenario.locked;

  const columns = useMemo(() => [
    { key: 'id', header: 'ID', render: (d) => <span className="mono">{d.id}</span> },
    { key: 'type', header: 'Type', render: (d) => TYPE_LABEL[d.type] },
    { key: 'effect', header: 'Effect', sortValue: (d) => describeDisruption(d), render: (d) => describeDisruption(d) },
    { key: 'note', header: 'Note', render: (d) => d.note ?? '' },
    {
      key: 'actions', header: '', sortable: false,
      render: (d) => <button className="btn sm danger" disabled={locked} onClick={() => dispatch({ type: 'record/remove', scenarioId: scenario.id, kind: 'disruption', id: d.id })} aria-label={`Remove disruption ${d.id}`}><Trash2 size={14} aria-hidden="true" />Remove</button>,
    },
  ], [locked, dispatch, scenario.id]);

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Disruptions</h1>
          <p>Close connections, slow them down, cut their capacity or delay shipments’ release. Each change re-runs the scheduler, which reroutes shipments where an alternative exists. The baseline stays untouched; disruptions live in what-if scenarios.</p>
        </div>
        <label className="checkbox"><input type="checkbox" checked={state.settings.autoRecalc} onChange={(e) => dispatch({ type: 'settings/update', settings: { autoRecalc: e.target.checked } })} />Recalculate automatically after each change</label>
      </div>

      {locked && (
        <Banner tone="info" actions={<button className="btn primary" onClick={() => dispatch({ type: 'scenario/fork', sourceId: BASELINE_ID, name: 'What-if: disruptions' })}><GitBranch size={15} aria-hidden="true" />Create what-if scenario</button>}>
          The baseline is read-only. Create a what-if scenario (a fork of the baseline) to add disruptions.
        </Banner>
      )}
      {stale && (
        <Banner tone="warning" actions={<button className="btn primary" onClick={() => dispatch({ type: 'scenario/run', id: scenario.id })}><RefreshCw size={15} aria-hidden="true" />Recalculate</button>}>
          Inputs changed since the last calculation, so the impact below still shows the previous schedule.
        </Banner>
      )}

      <Card title="Add a disruption to this scenario"><DisruptionForm scenario={scenario} dispatch={dispatch} disabled={locked} /></Card>

      <Card title={`Active disruptions (${scenario.disruptions.length})`} flush>
        <DataTable columns={columns} rows={scenario.disruptions} dense empty="No disruptions in this scenario." caption="Disruptions" />
      </Card>

      <Card title="Impact" actions={
        choices.length > 0 && (
          <Field label="Compare against">
            <select value={refId ?? ''} onChange={(e) => setOverride(e.target.value)} aria-label="Reference scenario">
              {choices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
        )
      }>
        {!refRun ? (
          <p className="muted">Select a what-if scenario to see how its disruptions change deliveries compared with the baseline.</p>
        ) : (
          <div className="stack">
            <MetricComparison refRun={refRun} run={run} refName={refScenario.name} name={scenario.name} />
            <ImpactReport refRun={refRun} run={run} refName={refScenario.name} name={scenario.name} onSelectShipment={setSelected} />
          </div>
        )}
      </Card>
      {selected && <ShipmentDetail shipmentId={selected} run={run} refRun={refRun} refName={refScenario?.name} onClose={() => setSelected(null)} />}
    </main>
  );
}
