'use client';
import { useState } from 'react';
import type { RenameDemoRow } from '@/lib/types';

interface Props { renames: RenameDemoRow[] }

const fmt$ = (v: number) =>
  `$${Math.round(v).toLocaleString('en-US')}`;

export default function RenamesDemo({ renames }: Props) {
  const [search, setSearch] = useState('');

  const filtered = renames.filter(r =>
    !search ||
    r.canonical_name.toLowerCase().includes(search.toLowerCase()) ||
    r.variant_labels.some(n => n.toLowerCase().includes(search.toLowerCase())),
  );

  return (
    <div>
      <div className="info-banner purple">
        <i className="ti ti-flask" />
        <div>
          <strong>Demo (tester-only):</strong> broader rename detection — groups by display name (not Toast's internal item_key)
          and synthesizes a variant tag from the catering/offsite vendor (Fooda, Aramark, Eurest, EzCater, etc.) or a
          &quot;Gameday&quot; menu tag when present. Unlike Renames Audit, these are usually <em>concurrent</em> variants
          (same dish, sold via a vendor/event channel at the same time), not sequential renames — nothing here is a
          confirmed "old name retired." <strong>{renames.length}</strong> items found. Sorted by lifetime qty.
        </div>
      </div>

      {renames.length === 0 ? (
        <div className="cc" style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
          <i className="ti ti-check" style={{ fontSize: 32, opacity: 0.3 }} />
          <div style={{ marginTop: 10 }}>No variant groups found.</div>
        </div>
      ) : (
        <div className="tw">
          <div className="th2">
            <h3>Items with vendor/event-tagged variants</h3>
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search items…" className="srch"
            />
          </div>
          <div className="tscroll">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Variant tags found</th>
                  <th>Lifetime Qty</th>
                  <th>Lifetime $</th>
                  <th>Locations</th>
                  <th>First seen</th>
                  <th>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => {
                  // canonical_name itself is always one of the variant_labels (the
                  // plain/untagged form) — show the others as tagged variants.
                  const taggedVariants = r.variant_labels.filter(n => n !== r.canonical_name);
                  return (
                    <tr key={r.canonical_name}>
                      <td style={{ fontWeight: 700 }}>{r.canonical_name}</td>
                      <td>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {taggedVariants.length > 0 ? taggedVariants.map(n => (
                            <span
                              key={n}
                              style={{
                                fontSize: 10, padding: '1px 6px', borderRadius: 4,
                                background: '#fef3c7', color: '#92400e', fontWeight: 600,
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
                      <td style={{ fontSize: 10, color: 'var(--muted)' }}>{r.last_seen}</td>
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
