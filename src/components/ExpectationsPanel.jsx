import { useMemo } from 'react';
import { checkExpectations } from '../data/expectations.js';
import DataTable from './DataTable.jsx';
import { Banner, Card } from './ui.jsx';

/** Compares the scenario's documented `expected` results with what the engine actually produced. */
export default function ExpectationsPanel({ scenario, run, stale }) {
  const rows = useMemo(() => checkExpectations(scenario.expected, run.result), [scenario.expected, run]);
  const failed = rows.filter((r) => !r.pass).length;
  const columns = [
    { key: 'shipmentId', header: 'Shipment', render: (r) => <span className="mono">{r.shipmentId}</span> },
    { key: 'field', header: 'Check' },
    { key: 'expected', header: 'Expected', render: (r) => String(r.expected) },
    { key: 'actual', header: 'Actual', render: (r) => String(r.actual) },
    { key: 'pass', header: 'Result', sortValue: (r) => Number(r.pass), render: (r) => (r.pass ? <span className="pass">✔ Pass</span> : <span className="fail">✘ Mismatch</span>) },
  ];
  return (
    <Card title="Expected results">
      {!scenario.expected ? (
        <p className="muted">This scenario has no documented expected results. Presets such as “Reference: three terminals” and imported files with an <code>expected</code> block do.</p>
      ) : (
        <div className="stack">
          {scenario.expected.notes && <p className="muted" style={{ margin: 0 }}>{scenario.expected.notes}</p>}
          {stale && <Banner tone="warning">Inputs were edited after the last run; these checks compare the previous schedule. Recalculate to re-check.</Banner>}
          <Banner tone={failed ? 'error' : 'ok'}>{failed ? `${failed} of ${rows.length} checks do not match the expectation.` : `All ${rows.length} checks match the documented expected results.`}</Banner>
          <div className="card"><DataTable columns={columns} rows={rows} rowKey={(r) => `${r.shipmentId}-${r.field}`} dense pageSize={20} caption="Expectation checks" /></div>
        </div>
      )}
    </Card>
  );
}
