import { useState } from 'react';
import { Plus } from 'lucide-react';
import { DISRUPTION, HORIZON_HOURS } from '../engine/constants.js';
import { validateRecord } from '../data/validation.js';
import { Field, NumberField, SelectField } from './ui.jsx';

const TYPES = [
  { value: DISRUPTION.CLOSURE, label: 'Close a connection' },
  { value: DISRUPTION.TRAVEL_TIME, label: 'Increase travel time' },
  { value: DISRUPTION.CAPACITY, label: 'Reduce capacity' },
  { value: DISRUPTION.RELEASE_DELAY, label: 'Delay a shipment’s release' },
];

const toInt = (v) => (v === '' || v === null ? undefined : Number(v));

/** Adds a disruption to the active scenario. The same validator used for imports checks the record first. */
export default function DisruptionForm({ scenario, dispatch, disabled }) {
  const conns = scenario.network.connections;
  const ships = scenario.shipments;
  const [type, setType] = useState(DISRUPTION.CLOSURE);
  const [connectionId, setConnectionId] = useState('');
  const [shipmentId, setShipmentId] = useState('');
  const [startHour, setStartHour] = useState('0');
  const [endHour, setEndHour] = useState('24');
  const [extraHours, setExtraHours] = useState('3');
  const [capacity, setCapacity] = useState('1');
  const [delayHours, setDelayHours] = useState('6');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState([]);

  const effectiveConn = connectionId || conns[0]?.id || '';
  const effectiveShip = shipmentId || ships[0]?.id || '';

  const submit = (e) => {
    e.preventDefault();
    const record = { type };
    if (type === DISRUPTION.RELEASE_DELAY) {
      record.shipmentId = effectiveShip;
      record.delayHours = toInt(delayHours);
    } else {
      record.connectionId = effectiveConn;
      record.startHour = toInt(startHour);
      record.endHour = toInt(endHour);
      if (type === DISRUPTION.TRAVEL_TIME) record.extraHours = toInt(extraHours);
      if (type === DISRUPTION.CAPACITY) record.capacity = toInt(capacity);
    }
    if (note.trim()) record.note = note.trim();
    const probe = { ...record, id: 'D_new' };
    const problems = validateRecord('disruption', probe, scenario);
    setErrors(problems);
    if (problems.length) return;
    dispatch({ type: 'record/upsert', scenarioId: scenario.id, kind: 'disruption', record });
    setNote('');
  };

  const noTargets = type === DISRUPTION.RELEASE_DELAY ? ships.length === 0 : conns.length === 0;

  return (
    <form onSubmit={submit} className="stack" aria-label="Add disruption">
      <div className="form-grid">
        <SelectField label="Disruption" value={type} onChange={setType} options={TYPES} disabled={disabled} />
        {type === DISRUPTION.RELEASE_DELAY ? (
          <>
            <SelectField label="Shipment" value={effectiveShip} onChange={setShipmentId} disabled={disabled} options={ships.map((s) => ({ value: s.id, label: `${s.id} (${s.origin}→${s.destination}, h${s.release})` }))} />
            <NumberField label="Delay (hours)" value={delayHours} onChange={setDelayHours} min={1} disabled={disabled} hint="Added to the release time" />
          </>
        ) : (
          <>
            <SelectField label="Connection" value={effectiveConn} onChange={setConnectionId} disabled={disabled} options={conns.map((c) => ({ value: c.id, label: `${c.id} (${c.from}–${c.to})` }))} />
            <NumberField label="From hour (incl.)" value={startHour} onChange={setStartHour} min={0} disabled={disabled} hint={`Plan runs hours 0–${HORIZON_HOURS}`} />
            <NumberField label="Until hour (excl.)" value={endHour} onChange={setEndHour} min={1} disabled={disabled} />
            {type === DISRUPTION.TRAVEL_TIME && <NumberField label="Extra hours" value={extraHours} onChange={setExtraHours} min={1} disabled={disabled} hint="For movements departing in the window" />}
            {type === DISRUPTION.CAPACITY && <NumberField label="Reduced capacity /h" value={capacity} onChange={setCapacity} min={0} disabled={disabled} hint="0 blocks all departures" />}
          </>
        )}
        <Field label="Note (optional)"><input type="text" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} disabled={disabled} /></Field>
        <button className="btn primary" type="submit" disabled={disabled || noTargets}><Plus size={15} aria-hidden="true" />Add disruption</button>
      </div>
      {errors.length > 0 && <ul className="fail" role="alert" style={{ margin: 0 }}>{errors.map((m) => <li key={m}>{m}</li>)}</ul>}
    </form>
  );
}
