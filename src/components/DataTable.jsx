import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { compareIds } from '../engine/ids.js';

function compareValues(a, b) {
  const an = a === null || a === undefined;
  const bn = b === null || b === undefined;
  if (an || bn) return an === bn ? 0 : an ? 1 : -1; // nulls always last (before direction flip handled by caller)
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return compareIds(String(a), String(b));
}

/**
 * Generic sortable, optionally paginated table.
 * columns: [{ key, header, render?(row), sortValue?(row), align?: 'r', sortable?: boolean }]
 */
export default function DataTable({
  columns,
  rows,
  rowKey = (r) => r.id,
  initialSort = null,
  pageSize = 0,
  onRowClick,
  selectedKey,
  empty = 'Nothing to show.',
  dense = false,
  caption,
}) {
  const [sort, setSort] = useState(initialSort); // { key, dir: 1 | -1 }
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows;
    const get = col.sortValue ?? ((r) => r[col.key]);
    return rows
      .map((r, i) => ({ r, i, v: get(r) }))
      .sort((x, y) => {
        const nullish = (v) => v === null || v === undefined;
        if (nullish(x.v) || nullish(y.v)) return compareValues(x.v, y.v) || x.i - y.i; // nulls last in both directions
        return compareValues(x.v, y.v) * sort.dir || x.i - y.i;
      })
      .map((x) => x.r);
  }, [rows, sort, columns]);

  const pages = pageSize ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1;
  const current = Math.min(page, pages - 1);
  const visible = pageSize ? sorted.slice(current * pageSize, (current + 1) * pageSize) : sorted;

  const toggle = (key) => {
    setPage(0);
    setSort((s) => (s?.key === key ? (s.dir === 1 ? { key, dir: -1 } : null) : { key, dir: 1 }));
  };

  return (
    <div>
      <div className="table-wrap">
        <table className={`t ${dense ? 'dense' : ''}`}>
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr>
              {columns.map((c) => {
                const sortable = c.sortable !== false;
                const active = sort?.key === c.key;
                return (
                  <th key={c.key} className={c.align === 'r' ? 'r' : ''} aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
                    {sortable ? (
                      <button onClick={() => toggle(c.key)} title={`Sort by ${typeof c.header === 'string' ? c.header : c.key}`}>
                        {c.header}
                        {active ? (sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ChevronsUpDown size={12} opacity={0.4} />}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const key = rowKey(row);
              return (
                <tr
                  key={key}
                  className={`${onRowClick ? 'clickable' : ''} ${selectedKey === key ? 'selected' : ''}`}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onKeyDown={onRowClick ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onRowClick(row)) : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={c.align === 'r' ? 'r' : ''}>{c.render ? c.render(row) : row[c.key]}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <div className="empty">{empty}</div>}
      </div>
      {pageSize > 0 && sorted.length > pageSize && (
        <div className="pager">
          <span>{current * pageSize + 1}–{Math.min(sorted.length, (current + 1) * pageSize)} of {sorted.length}</span>
          <button className="btn sm" disabled={current === 0} onClick={() => setPage(current - 1)}>Previous</button>
          <button className="btn sm" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}
