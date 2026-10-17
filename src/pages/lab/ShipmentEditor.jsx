import { useMemo, useState } from 'react';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { useApp } from '../../state/AppState.jsx';
import { previewRemoval } from '../../state/edits.js';
import { validateRecord } from '../../data/validation.js';
import { PRIORITIES } from '../../engine/constants.js';
import DataTable from '../../components/DataTable.jsx';
import { Card, Field, NumberField, PriorityBadge, SelectField, StatusBadge, useConfirm } from '../../components/ui.jsx';

const num = (v) => (v === '' ? undefined : Number(v));

export default function ShipmentEditor() {
  const { scenario, dispatch, run, stale } = useApp();
  const [confirm, dialog] = useConfirm();
  const locked = scenario.locked;
  const terminals = scenario.network.terminals;
  const blank = { id: null, origin: '', destination: '', release: '0', deadline: '24', priority: '2', cargo: '' };
  const [form, setForm] = useState(blank);
  const [errors, setErrors] = useState([]);
  const [query, setQuery] = useState('');
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const options = terminals.map((t) => ({ value: t.id, label: `${t.id} ${t.name}` }));
  const origin = form.origin || terminals[0]?.id || '';
  const destination = form.destination || terminals[1]?.id || terminals[0]?.id || '';

  const outcome = useMemo(() => new Map((run?.result.shipments ?? []).map((s) => [s.id, s])), [run]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return scenario.shipments.filter((s) => !q || [s.id, s.origin, s.destination, s.cargo].some((v) => v && String(v).toLowerCase().includes(q)));
  }, [scenario.shipments, query]);

  const submit = (e) => {
    e.preventDefault();
    const record = {
      ...(form.id ? { id: form.id } : {}),
      origin,
      destination,
      release: num(form.release),
      deadline: num(form.deadline),
      priority: num(form.priority),
      ...(form.cargo.trim() ? { cargo: form.cargo.trim() } : {}),
    };
    const problems = validateRecord('shipment', { id: form.id ?? 'S_new', ...record }, scenario, { editingId: form.id });
    setErrors(problems);
    if (problems.length) return;
    dispatch({ type: 'record/upsert', scenarioId: scenario.id, kind: 'shipment', record });
    setForm(blank);
  };

  const columns = [
    { key: 'id', header: 'ID', render: (s) => <span className="mono">{s.id}</span> },
    { key: 'origin', header: 'Origin' },
    { key: 'destination', header: 'Destination' },
    { key: 'release', header: 'Release (h)', align: 'r' },
    { key: 'deadline', header: 'Deadline (h)', align: 'r' },
    { key: 'priority', header: 'Priority', render: (s) => <PriorityBadge priority={s.priority} /> },
    { key: 'cargo', header: 'Cargo', render: (s) => s.cargo ?? '' },
    {
      key: 'outcome', header: stale ? 'Last result' : 'Result', sortValue: (s) => outcome.get(s.id)?.arrival ?? null,
      render: (s) => {
        const o = outcome.get(s.id);
        return o ? <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><StatusBadge status={o.status} />{o.arrival !== null && <span className="num">h{o.arrival}</span>}</span> : <span className="faint">not run</span>;
      },
    },
    {
      key: 'actions', header: '', sortable: false,
      render: (s) => (
        <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
          <button className="btn sm" disabled={locked} aria-label={`Edit shipment ${s.id}`} onClick={() => { setForm({ id: s.id, origin: s.origin, destination: s.destination, release: String(s.release), deadline: String(s.deadline), priority: String(s.priority), cargo: s.cargo ?? '' }); setErrors([]); window.scrollTo?.({ top: 0 }); }}><Pencil size={13} aria-hidden="true" />Edit</button>
          <button className="btn sm danger" disabled={locked} aria-label={`Delete shipment ${s.id}`}
            onClick={() => {
              const removed = previewRemoval({ network: scenario.network, shipments: scenario.shipments, disruptions: scenario.disruptions }, 'shipment', s.id);
              confirm({ title: `Delete shipment ${s.id}?`, message: removed.disruptions ? `This also removes ${removed.disruptions} release-delay disruption(s) for it.` : 'This cannot be undone (use “Reset scenario” to restore the original inputs).' }, () => dispatch({ type: 'record/remove', scenarioId: scenario.id, kind: 'shipment', id: s.id }));
            }}><Trash2 size={13} aria-hidden="true" />Delete</button>
        </span>
      ),
    },
  ];

  return (
    <div className="stack" style={{ gap: 16 }}>
      <Card title={form.id ? `Edit shipment ${form.id}` : 'Add shipment'}>
        <form onSubmit={submit} className="stack" aria-label="Shipment form">
          <div className="form-grid">
            <SelectField label="Origin" value={origin} onChange={set('origin')} options={options} disabled={locked || terminals.length === 0} />
            <SelectField label="Destination" value={destination} onChange={set('destination')} options={options} disabled={locked || terminals.length === 0} />
            <NumberField label="Release (hour)" value={form.release} onChange={set('release')} min={0} disabled={locked} hint="Earliest departure" />
            <NumberField label="Deadline (hour)" value={form.deadline} onChange={set('deadline')} min={0} disabled={locked} hint="Delivery due by" />
            <SelectField label="Priority" value={form.priority} onChange={set('priority')} disabled={locked} options={PRIORITIES.map((p) => ({ value: String(p.value), label: `${p.value} – ${p.label}` }))} />
            <Field label="Cargo (optional)"><input type="text" value={form.cargo} onChange={(e) => set('cargo')(e.target.value)} disabled={locked} maxLength={40} /></Field>
            <span className="row">
              <button className="btn primary" type="submit" disabled={locked || terminals.length < 2}>{form.id ? 'Save shipment' : <><Plus size={15} aria-hidden="true" />Add shipment</>}</button>
              {form.id && <button type="button" className="btn" onClick={() => { setForm(blank); setErrors([]); }}><X size={14} aria-hidden="true" />Cancel</button>}
            </span>
          </div>
          {errors.length > 0 && <ul className="fail" role="alert" style={{ margin: 0 }}>{errors.map((m) => <li key={m}>{m}</li>)}</ul>}
        </form>
      </Card>
      <Card title={`Shipments (${rows.length}${rows.length !== scenario.shipments.length ? ` of ${scenario.shipments.length}` : ''})`} actions={<input type="search" placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search shipments to edit" style={{ width: 200 }} />} flush>
        <DataTable columns={columns} rows={rows} pageSize={20} dense initialSort={{ key: 'id', dir: 1 }} empty="No shipments in this scenario." caption="Editable shipments" />
      </Card>
      {dialog}
    </div>
  );
}
