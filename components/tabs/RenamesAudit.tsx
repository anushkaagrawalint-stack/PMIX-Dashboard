'use client';
import { useState } from 'react';
import type { RenameRow } from '@/lib/types';

interface Props { renames: RenameRow[] }

const fmt$ = (v: number) =>
  `$${Math.round(v).toLocaleString('en-US')}`;

export default function RenamesAudit({ renames }: Props) {
  const [search, setSearch] = useState('');

  const filtered = renames.filter(r =>
    !search ||
    r.canonical_name.toLowerCase().includes(search.toLowerCase()) ||
    r.all_names.some(n => n.toLowerCase().includes(search.toLowerCase())),
  );

  return (
    <div>
      <div className="info-banner purple">
        <i className="ti ti-refresh" />
        <div>
          <strong>{renames.length}</strong> items renamed in Toast POS — same item (by internal ID) appeared under different display names over time.
          Current name shown normally; former names appear strikethrough. Sorted by lifetime qty.
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
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search items…" className="srch"
            />
          </div>
          <div className="tscroll">
            <table>
              <thead>
                <tr>
                  <th>Canonical name (current)</th>
                  <th>Historical names</th>
                  <th>Lifetime Qty</th>
                  <th>Lifetime $</th>
                  <th>Locations</th>
                  <th>First seen</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => {
                  // The canonical_name is considered the "current" name;
                  // all other names in all_names that differ are historical
                  const otherNames = r.all_names.filter(n => n !== r.canonical_name);
                  return (
                    <tr key={r.canonical_name}>
                      <td style={{ fontWeight: 700 }}>{r.canonical_name}</td>
                      <td>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {otherNames.length > 0 ? otherNames.map(n => (
                            <span
                              key={n}
                              style={{
                                fontSize: 10, padding: '1px 6px', borderRadius: 4,
                                background: '#f3f4f6', color: '#9ca3af',
                                textDecoration: 'line-through',
                              }}
                            >{n}</span>
                          )) : (
                            <span style={{ fontSize: 10, color: 'var(--muted)' }}>—</span>
                          )}
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
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
