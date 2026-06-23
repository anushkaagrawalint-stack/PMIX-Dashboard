'use client';
import { useState, useMemo } from 'react';
import type { OpenItemRow, OpenItemsSummary } from '@/lib/types';

interface Props {
  openItems:        OpenItemRow[];
  openItemsSummary: OpenItemsSummary;
}

const fmt$ = (v: number) =>
  `$${Math.round(v).toLocaleString('en-US')}`;

const ISSUE_COLORS: Record<string, string> = {
  'NO COST':            '#ef4444',
  'UNCATEGORIZED':      '#f97316',
  'MISSING MENU GROUP': '#eab308',
};

export default function OpenItems({ openItems, openItemsSummary }: Props) {
  const [search, setSearch] = useState('');
  const [issueFilter, setIssueFilter] = useState<string>('all');

  const issueTypes = useMemo(() => {
    const set = new Set<string>();
    openItems.forEach(r => r.issue_types.forEach(t => set.add(t)));
    return ['all', ...Array.from(set).sort()];
  }, [openItems]);

  const filtered = useMemo(() => {
    let rows = openItems;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(r => r.canonical_name.toLowerCase().includes(q));
    }
    if (issueFilter !== 'all') {
      rows = rows.filter(r => r.issue_types.includes(issueFilter));
    }
    return rows;
  }, [openItems, search, issueFilter]);

  return (
    <div>
      {/* Warning banner */}
      <div className="info-banner yellow" style={{ marginBottom: 12 }}>
        <i className="ti ti-alert-triangle" />
        <div>
          <strong>{openItemsSummary.total}</strong> items have no menu assignment (<code>menu_name IS NULL</code>).
          They appear in channel metrics as <strong>Open Items</strong> but may be misconfigured.
        </div>
      </div>

      {/* KPI summary row */}
      <div className="krow" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 12 }}>
        <div className="kc a">
          <div className="kl">Open Items</div>
          <div className="kv">{openItemsSummary.total}</div>
          <div className="ks">unique item names</div>
        </div>
        <div className="kc t">
          <div className="kl">Revenue Affected</div>
          <div className="kv">{fmt$(openItemsSummary.revenue_affected)}</div>
          <div className="ks">needs review</div>
        </div>
        <div className="kc r">
          <div className="kl">Missing Cost</div>
          <div className="kv">{openItemsSummary.missing_cost}</div>
          <div className="ks">no cost on file</div>
        </div>
        <div className="kc o">
          <div className="kl">Uncategorized</div>
          <div className="kv">{openItemsSummary.uncategorized}</div>
          <div className="ks">no item_lookup match</div>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Search item name…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            flex: 1, minWidth: 200, padding: '6px 10px', borderRadius: 6,
            border: '1px solid var(--border)', fontSize: 12, background: 'var(--card)',
          }}
        />
        <select
          value={issueFilter}
          onChange={e => setIssueFilter(e.target.value)}
          style={{
            padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)',
            fontSize: 12, background: 'var(--card)', cursor: 'pointer',
          }}
        >
          {issueTypes.map(t => (
            <option key={t} value={t}>{t === 'all' ? 'All issues' : t}</option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="cc" style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
          <i className="ti ti-check" style={{ fontSize: 32, opacity: 0.3 }} />
          <div style={{ marginTop: 10 }}>No open items match your filters.</div>
        </div>
      ) : (
        <div className="tw">
          <div className="th2">
            <h3>Open items ({filtered.length})</h3>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Item Name</th>
                  <th>Issues</th>
                  <th>Sales Category</th>
                  <th>Menu Group</th>
                  <th>Dining Option</th>
                  <th>Qty</th>
                  <th>Net Sales</th>
                  <th>Last Seen</th>
                  <th>Suggested Fix</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 600, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.canonical_name || <em style={{ color: 'var(--muted)' }}>(blank)</em>}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {row.issue_types.map(issue => (
                          <span key={issue} style={{
                            fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                            background: ISSUE_COLORS[issue] ?? '#6b7280',
                            color: '#fff', textTransform: 'uppercase', whiteSpace: 'nowrap',
                          }}>
                            {issue}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td style={{ color: row.sales_category ? 'var(--text)' : 'var(--muted)', fontSize: 11 }}>
                      {row.sales_category ?? '—'}
                    </td>
                    <td style={{ color: row.menu_group ? 'var(--text)' : 'var(--muted)', fontSize: 11 }}>
                      {row.menu_group ?? '—'}
                    </td>
                    <td style={{ color: row.dining_option ? 'var(--text)' : 'var(--muted)', fontSize: 11 }}>
                      {row.dining_option ?? '—'}
                    </td>
                    <td style={{ fontWeight: 600 }}>{row.qty.toLocaleString()}</td>
                    <td style={{ fontWeight: 600, color: 'var(--accent)' }}>{fmt$(row.net_sales)}</td>
                    <td style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{row.last_seen}</td>
                    <td style={{ fontSize: 11, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#7c6af0' }}>
                      {row.suggested_fix}
                    </td>
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
