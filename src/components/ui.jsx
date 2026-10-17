import { cloneElement, isValidElement, useEffect, useId, useRef, useState } from 'react';
import { AlertOctagon, AlertTriangle, CheckCircle2, Clock, Info, X } from 'lucide-react';
import { priorityLabel, STATUS_LABEL } from '../utils/format.js';

export function Card({ title, actions, children, flush = false, className = '', ...rest }) {
  return (
    <section className={`card ${className}`} {...rest}>
      {(title || actions) && (
        <div className="card-head">
          {title && <h2>{title}</h2>}
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      <div className={`card-body ${flush ? 'flush' : ''}`}>{children}</div>
    </section>
  );
}

export function KpiCard({ label, value, sub, tone = '', icon }) {
  return (
    <div className={`card kpi ${tone}`}>
      <div className="label">{icon}{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

const STATUS_ICON = {
  on_time: <CheckCircle2 size={13} aria-hidden="true" />,
  late: <Clock size={13} aria-hidden="true" />,
  undeliverable: <AlertOctagon size={13} aria-hidden="true" />,
};
/** Status is always icon + text, never colour alone. */
export function StatusBadge({ status }) {
  return <span className={`badge ${status}`}>{STATUS_ICON[status]}{STATUS_LABEL[status] ?? status}</span>;
}

export function PriorityBadge({ priority }) {
  return <span className={`prio prio-${priority}`}><i aria-hidden="true" />{priorityLabel(priority)}</span>;
}

const SEVERITY_ICON = {
  critical: <AlertOctagon size={16} />,
  warning: <AlertTriangle size={16} />,
  info: <Info size={16} />,
  error: <AlertOctagon size={16} />,
  ok: <CheckCircle2 size={16} />,
};
export function SeverityIcon({ severity }) {
  return <span className="ic" aria-label={severity}>{SEVERITY_ICON[severity]}</span>;
}

export function Banner({ tone = 'info', children, actions, ...rest }) {
  return (
    <div className={`banner ${tone}`} role={tone === 'error' ? 'alert' : 'status'} {...rest}>
      <SeverityIcon severity={tone} />
      <div className="grow">{children}</div>
      {actions}
    </div>
  );
}

const CONTROLS = ['input', 'select', 'textarea'];

/** Label + control. The label is bound with htmlFor/id so the control's accessible name is just the label text. */
export function Field({ label, hint, children }) {
  const id = useId();
  const direct = isValidElement(children) && CONTROLS.includes(children.type);
  const control = direct ? cloneElement(children, { id, 'aria-describedby': hint ? `${id}-hint` : undefined }) : children;
  return (
    <div className="field">
      <label className="lbl" htmlFor={direct ? id : undefined}>{label}</label>
      {control}
      {hint && <span className="hint" id={`${id}-hint`}>{hint}</span>}
    </div>
  );
}

export function NumberField({ label, value, onChange, hint, min, max, disabled }) {
  return (
    <Field label={label} hint={hint}>
      <input type="number" inputMode="numeric" step="1" value={value} min={min} max={max} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

export function SelectField({ label, value, onChange, options, hint, disabled }) {
  return (
    <Field label={label} hint={hint}>
      <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </Field>
  );
}

export function Segmented({ options, value, onChange, label }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Modal({ title, children, onClose, wide }) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const prev = document.activeElement;
    ref.current?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="overlay center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={ref} style={wide ? { width: 'min(640px, 100%)' } : undefined}>
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function Drawer({ title, children, onClose }) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const prev = document.activeElement;
    ref.current?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={ref}>
        <div className="drawer-head">
          <h2 id={titleId}>{title}</h2>
          <button className="btn icon ghost" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>
  );
}

/** const [confirm, dialog] = useConfirm();  confirm({title, message, confirmLabel}, () => ...) */
export function useConfirm() {
  const [pending, setPending] = useState(null);
  const confirm = (opts, onYes) => setPending({ ...opts, onYes });
  const dialog = pending && (
    <Modal title={pending.title ?? 'Please confirm'} onClose={() => setPending(null)}>
      <div>{pending.message}</div>
      <div className="row end">
        <button className="btn" onClick={() => setPending(null)}>Cancel</button>
        <button
          className={`btn ${pending.danger === false ? 'primary' : 'danger'}`}
          onClick={() => {
            const fn = pending.onYes;
            setPending(null);
            fn();
          }}
        >
          {pending.confirmLabel ?? 'Delete'}
        </button>
      </div>
    </Modal>
  );
  return [confirm, dialog];
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}

export function ShipmentChips({ ids, onSelect, max = 12 }) {
  if (!ids?.length) return null;
  const shown = ids.slice(0, max);
  return (
    <div className="chips">
      {shown.map((id) => (
        <button key={id} className="chip" onClick={() => onSelect?.(id)} aria-label={`Open shipment ${id}`}>{id}</button>
      ))}
      {ids.length > max && <span className="faint">+{ids.length - max} more</span>}
    </div>
  );
}
