import { useState } from 'react';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { useApp } from '../../state/AppState.jsx';
import { previewRemoval } from '../../state/edits.js';
import { validateRecord } from '../../data/validation.js';
import DataTable from '../../components/DataTable.jsx';
import NetworkMap from '../../components/NetworkMap.jsx';
import { Card, Field, NumberField, SelectField, useConfirm } from '../../components/ui.jsx';

const num = (v) => (v === '' ? undefined : Number(v));
const bodyOf = (s) => ({ network: s.network, shipments: s.shipments, disruptions: s.disruptions });

function ErrorList({ errors }) {
  return errors.length > 0 ? <ul className="fail" role="alert" style={{ margin: 0 }}>{errors.map((m) => <li key={m}>{m}</li>)}</ul> : null;
}

function removalMessage(kind, id, removed) {
  const parts = [];
  if (removed.connections) parts.push(`${removed.connections} connection${removed.connections === 1 ? '' : 's'}`);
  if (removed.shipments) parts.push(`${removed.shipments} shipment${removed.shipments === 1 ? '' : 's'}`);
  if (removed.disruptions) parts.push(`${removed.disruptions} disruption${removed.disruptions === 1 ? '' : 's'}`);
  return parts.length ? `Removing ${kind} ${id} also removes ${parts.join(', ')} that depend on it.` : `Remove ${kind} ${id}?`;
}

function TerminalsCard({ scenario, dispatch, locked, confirm }) {
  const blank = { id: null, name: '', x: '', y: '' };
  const [form, setForm] = useState(blank);
  const [errors, setErrors] = useState([]);
  const n = scenario.network.terminals.length;
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = (e) => {
    e.preventDefault();
    const record = {
      ...(form.id ? { id: form.id } : {}),
      name: form.name.trim() || undefined,
      x: form.x === '' ? (10 + (n * 13) % 80) : num(form.x),
      y: form.y === '' ? (8 + (n * 17) % 50) : num(form.y),
    };
    const problems = validateRecord('terminal', { id: form.id ?? 'T_new', ...record }, scenario, { editingId: form.id });
    setErrors(problems);
    if (problems.length) return;
    dispatch({ type: 'record/upsert', scenarioId: scenario.id, kind: 'terminal', record });
    setForm(blank);
  };

  const columns = [
    { key: 'id', header: 'ID', render: (t) => <span className="mono">{t.id}</span> },
    { key: 'name', header: 'Name' },
    { key: 'x', header: 'Map X', align: 'r' },
    { key: 'y', header: 'Map Y', align: 'r' },
    {
      key: 'actions', header: '', sortable: false,
      render: (t) => (
        <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
          <button className="btn sm" disabled={locked} onClick={() => { setForm({ id: t.id, name: t.name, x: String(t.x), y: String(t.y) }); setErrors([]); }} aria-label={`Edit terminal ${t.id}`}><Pencil size={13} aria-hidden="true" />Edit</button>
          <button className="btn sm danger" disabled={locked} aria-label={`Delete terminal ${t.id}`}
            onClick={() => confirm({ title: `Delete terminal ${t.id}?`, message: removalMessage('terminal', t.id, previewRemoval(bodyOf(scenario), 'terminal', t.id)) }, () => dispatch({ type: 'record/remove', scenarioId: scenario.id, kind: 'terminal', id: t.id }))}><Trash2 size={13} aria-hidden="true" />Delete</button>
        </span>
      ),
    },
  ];

  return (
    <Card title={`Terminals (${n})`}>
      <form onSubmit={submit} className="stack" aria-label="Terminal form">
        <div className="form-grid">
          {form.id && <Field label="ID"><input type="text" value={form.id} disabled /></Field>}
          <Field label="Name"><input type="text" value={form.name} onChange={(e) => set('name')(e.target.value)} disabled={locked} placeholder="e.g. Granite Yard" maxLength={60} /></Field>
          <NumberField label="Map X (0–100)" value={form.x} onChange={set('x')} disabled={locked} hint="Blank = auto" />
          <NumberField label="Map Y (0–64)" value={form.y} onChange={set('y')} disabled={locked} hint="Blank = auto" />
          <span className="row">
            <button className="btn primary" type="submit" disabled={locked}>{form.id ? 'Save terminal' : <><Plus size={15} aria-hidden="true" />Add terminal</>}</button>
            {form.id && <button type="button" className="btn" onClick={() => { setForm(blank); setErrors([]); }}><X size={14} aria-hidden="true" />Cancel</button>}
          </span>
        </div>
        <ErrorList errors={errors} />
      </form>
      <div style={{ marginTop: 12 }}><DataTable columns={columns} rows={scenario.network.terminals} dense caption="Terminals" /></div>
    </Card>
  );
}

function ConnectionsCard({ scenario, dispatch, locked, confirm }) {
  const terminals = scenario.network.terminals;
  const blank = { id: null, from: '', to: '', travelTime: '2', capacity: '1', bidirectional: true };
  const [form, setForm] = useState(blank);
  const [errors, setErrors] = useState([]);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const options = terminals.map((t) => ({ value: t.id, label: `${t.id} ${t.name}` }));
  const from = form.from || terminals[0]?.id || '';
  const to = form.to || terminals[1]?.id || terminals[0]?.id || '';

  const submit = (e) => {
    e.preventDefault();
    const record = { ...(form.id ? { id: form.id } : {}), from, to, travelTime: num(form.travelTime), capacity: num(form.capacity), bidirectional: form.bidirectional };
    const problems = validateRecord('connection', { id: form.id ?? 'C_new', ...record }, scenario, { editingId: form.id });
    setErrors(problems);
    if (problems.length) return;
    dispatch({ type: 'record/upsert', scenarioId: scenario.id, kind: 'connection', record });
    setForm(blank);
  };

  const columns = [
    { key: 'id', header: 'ID', render: (c) => <span className="mono">{c.id}</span> },
    { key: 'from', header: 'From' },
    { key: 'to', header: 'To' },
    { key: 'travelTime', header: 'Travel time (h)', align: 'r' },
    { key: 'capacity', header: 'Capacity / hour', align: 'r' },
    { key: 'bidirectional', header: 'Direction', render: (c) => (c.bidirectional === false ? 'One-way' : 'Both (shared capacity)'), sortValue: (c) => String(c.bidirectional !== false) },
    {
      key: 'actions', header: '', sortable: false,
      render: (c) => (
        <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
          <button className="btn sm" disabled={locked} aria-label={`Edit connection ${c.id}`} onClick={() => { setForm({ id: c.id, from: c.from, to: c.to, travelTime: String(c.travelTime), capacity: String(c.capacity), bidirectional: c.bidirectional !== false }); setErrors([]); }}><Pencil size={13} aria-hidden="true" />Edit</button>
          <button className="btn sm danger" disabled={locked} aria-label={`Delete connection ${c.id}`}
            onClick={() => confirm({ title: `Delete connection ${c.id}?`, message: removalMessage('connection', c.id, previewRemoval(bodyOf(scenario), 'connection', c.id)) }, () => dispatch({ type: 'record/remove', scenarioId: scenario.id, kind: 'connection', id: c.id }))}><Trash2 size={13} aria-hidden="true" />Delete</button>
        </span>
      ),
    },
  ];

  return (
    <Card title={`Connections (${scenario.network.connections.length})`}>
      <form onSubmit={submit} className="stack" aria-label="Connection form">
        <div className="form-grid">
          {form.id && <Field label="ID"><input type="text" value={form.id} disabled /></Field>}
          <SelectField label="From" value={from} onChange={set('from')} options={options} disabled={locked || terminals.length === 0} />
          <SelectField label="To" value={to} onChange={set('to')} options={options} disabled={locked || terminals.length === 0} />
          <NumberField label="Travel time (h)" value={form.travelTime} onChange={set('travelTime')} min={1} disabled={locked} />
          <NumberField label="Capacity / hour" value={form.capacity} onChange={set('capacity')} min={1} disabled={locked} hint="Movements entering per hour" />
          <label className="checkbox" style={{ paddingBottom: 8 }}><input type="checkbox" checked={form.bidirectional} onChange={(e) => set('bidirectional')(e.target.checked)} disabled={locked} />Both directions share capacity</label>
          <span className="row">
            <button className="btn primary" type="submit" disabled={locked || terminals.length < 2}>{form.id ? 'Save connection' : <><Plus size={15} aria-hidden="true" />Add connection</>}</button>
            {form.id && <button type="button" className="btn" onClick={() => { setForm(blank); setErrors([]); }}><X size={14} aria-hidden="true" />Cancel</button>}
          </span>
        </div>
        <ErrorList errors={errors} />
      </form>
      <div style={{ marginTop: 12 }}><DataTable columns={columns} rows={scenario.network.connections} dense caption="Connections" /></div>
    </Card>
  );
}

export default function NetworkEditor() {
  const { scenario, dispatch } = useApp();
  const [confirm, dialog] = useConfirm();
  const locked = scenario.locked;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <Card title="Network preview"><NetworkMap terminals={scenario.network.terminals} connections={scenario.network.connections} disruptions={scenario.disruptions} label="Network preview" /></Card>
      <TerminalsCard scenario={scenario} dispatch={dispatch} locked={locked} confirm={confirm} />
      <ConnectionsCard scenario={scenario} dispatch={dispatch} locked={locked} confirm={confirm} />
      {dialog}
    </div>
  );
}
