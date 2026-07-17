'use client';
import { useState } from 'react';
import type { RenameRow } from '@/lib/types';
import type { Role } from '@/lib/auth';

interface Props { renames: RenameRow[]; role: Role }

const fmt$ = (v: number) =>
  `$${Math.round(v).toLocaleString('en-US')}`;

function csvDownload(filename: string, headers: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function RenamesAudit({ renames, role }: Props) {
  const [search, setSearch] = useState('');

  const filtered = renames.filter(r =>
    !search ||
    r.canonical_name.toLowerCase().includes(search.toLowerCase()) ||
    r.all_names.some(n => n.toLowerCase().includes(search.toLowerCase())),
  );

  function exportCsv() {
    const headers = ['Canonical Name (Current)', 'Name History', 'Lifetime Qty', 'Lifetime $', 'Locations', 'First Seen'];
    const rows = filtered.map(r => [
      r.canonical_name,
      r.name_history.map(h => `${h.name} (${h.first_used} → ${h.name === r.canonical_name ? 'present' : h.last_used})`).join('; '),
      r.lifetime_qty,
      r.lifetime_revenue.toFixed(2),
      r.location_count,
      r.first_seen,
    ]);
    csvDownload('renames_audit.csv', headers, rows);
  }

  return (
    <div>
      <div className="info-banner purple">
        <i className="ti ti-refresh" />
        <div>
          <strong>{renames.length}</strong> items renamed in Toast POS — same item (by internal ID) appeared under different display names over time.
          Current name shown normally; former names appear strikethrough, each with the date range it was actually in use. Sorted by lifetime qty.
          Detection is GUID-based from raw Toast data and covers our data window (Dec 2025 onward).
        </div>
      </div>

      {renames.length === 0 ? (
        <div className="cc" style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
          <i className="ti ti-check" style={{ fontSize: 32, opacity: 0.3 }} />
          <div style={{ marginTop: 10 }}>No rename groups found — all items have a single consistent name.</div>
        </div>
      ) : (
        <div className="tw">
          <div className="th2">
            <h3>Item name history</h3>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search items…" className="srch"
              />
              {role !== 'user' && (
                <button className="drb" onClick={exportCsv} style={{ minWidth: 0, padding: '6px 12px' }}>
                  <i className="ti ti-download" style={{ fontSize: 12, marginRight: 4 }} />
                  Export CSV
                </button>
              )}
            </div>
          </div>
          <div className="tscroll">
            <table>
              <thead>
                <tr>
                  <th>Canonical name (current)</th>
                  <th>Name history</th>
                  <th>Lifetime Qty</th>
                  <th>Lifetime $</th>
                  <th>Locations</th>
                  <th>First seen</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.canonical_name}>
                    <td style={{ fontWeight: 700 }}>{r.canonical_name}</td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {r.name_history.map(h => {
                          const isCurrent = h.name === r.canonical_name;
                          return (
                            <div key={h.name} style={{ fontSize: 10, display: 'flex', gap: 5, alignItems: 'baseline' }}>
                              <span style={{
                                fontWeight: isCurrent ? 700 : 400,
                                color: isCurrent ? 'var(--text)' : '#9ca3af',
                                textDecoration: isCurrent ? 'none' : 'line-through',
                              }}>{h.name}</span>
                              <span style={{ color: 'var(--muted)' }}>
                                {h.first_used} → {isCurrent ? 'present' : h.last_used}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </td>
                    <td>{r.lifetime_qty.toLocaleString()}</td>
                    <td>{fmt$(r.lifetime_revenue)}</td>
                    <td>
                      <span style={{
                        display: 'inline-block', background: '#f3f0fb', color: '#381d7c',
                        borderRadius: 4, padding: '1px 7px', fontSize: 10, fontWeight: 700,
                      }}>
                        {r.location_count}
                      </span>
                    </td>
                    <td style={{ fontSize: 10, color: 'var(--muted)' }}>{r.first_seen}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
