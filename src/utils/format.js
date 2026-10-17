import { PRIORITY_LABEL } from '../engine/constants.js';

export const fmtNum = (v, digits = 1) =>
  v === null || v === undefined || Number.isNaN(v) ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
export const fmtPct = (v, digits = 1) => (v === null || v === undefined ? '—' : `${fmtNum(v, digits)}%`);
export const fmtRatioPct = (v, digits = 0) => (v === null || v === undefined ? '—' : `${fmtNum(v * 100, digits)}%`);
export const fmtHours = (v, digits = 1) => (v === null || v === undefined ? '—' : `${fmtNum(v, digits)} h`);
export const fmtSigned = (v, digits = 1) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtNum(Math.abs(v), digits)}`);

/** "Day 2, 10:00" for an hour offset; hour 0 is Day 1, 00:00. */
export const dayLabel = (h) => (h === null || h === undefined ? '' : `Day ${Math.floor(h / 24) + 1}, ${String(h % 24).padStart(2, '0')}:00`);

export const priorityLabel = (p) => PRIORITY_LABEL[p] ?? `P${p}`;

export const STATUS_LABEL = { on_time: 'On time', late: 'Late', undeliverable: 'Undeliverable' };

export const SOURCE_LABEL = { seed: 'Seeded', fork: 'Fork', preset: 'Preset', import: 'Imported', generated: 'Generated', custom: 'Custom' };
