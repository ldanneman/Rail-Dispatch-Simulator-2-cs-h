import { useVerification } from '../state/AppState.jsx';
import { Banner, Card } from './ui.jsx';

/** Results of the independent schedule verifier, plus facts about how the scheduler arrived at the plan. */
export default function VerificationPanel({ run }) {
  const v = useVerification(run);
  const { result } = run;
  return (
    <Card title="Independent verification">
      <div className="stack">
        {v.ok ? (
          <Banner tone="ok">
            Verified: {v.checkedShipments} shipments and {v.checkedMovements} movements re-checked against the input — release times, route continuity, travel times,
            closures, per-slot capacity and the scheduler’s own reservation table. 0 violations.
          </Banner>
        ) : (
          <>
            <Banner tone="error">{v.violations.length} violation{v.violations.length === 1 ? '' : 's'} found.</Banner>
            <ul>{v.violations.slice(0, 50).map((x, i) => <li key={i}><code>{x.code}</code> — {x.message}</li>)}</ul>
          </>
        )}
        <dl className="kv">
          <div><dt>Scheduling passes</dt><dd>{result.passesUsed}</dd></div>
          <div><dt>Objective (weighted undeliverable, late, lateness-h)</dt><dd>{result.objective.join(' / ')}</dd></div>
          <div><dt>First shipments in priority order</dt><dd className="mono">{result.order.slice(0, 6).join(', ')}{result.order.length > 6 ? ' …' : ''}</dd></div>
          <div><dt>Planning horizon</dt><dd>{result.horizon} h (7 days)</dd></div>
        </dl>
      </div>
    </Card>
  );
}
