'use client';
import { useState } from 'react';
import type { BikkyRow } from '@/lib/types';

interface Props { bikky: BikkyRow[] }

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const fmt$ = (v: number) =>
  v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M`
  : v >= 1_000   ? `$${(v / 1_000).toFixed(0)}K`
  : `$${v.toFixed(0)}`;

function rateClass(v: number): string {
  if (v >= 0.25) return 'rate-tag rh';
  if (v >= 0.15) return 'rate-tag rm';
  return 'rate-tag rl';
}

type SortKey = 'return_rate' | 'reorder_rate' | 'revenue' | 'qty';

export default function CustomerRetention({ bikky }: Props) {
  const [search, setSearch] = useState('');
  const [sort,   setSort]   = useState<SortKey>('return_rate');
  const [desc,   setDesc]   = useState(true);

  function toggleSort(key: SortKey) {
    if (sort === key) setDesc(d => !d);
    else { setSort(key); setDesc(true); }
  }

  const avgReturn  = bikky.length > 0 ? bikky.reduce((s, r) => s + r.return_rate,  0) / bikky.length : 0;
  const avgReorder = bikky.length > 0 ? bikky.reduce((s, r) => s + r.reorder_rate, 0) / bikky.length : 0;
  const topRet     = bikky.length > 0 ? [...bikky].sort((a, b) => b.return_rate  - a.return_rate )[0] : null;
  const botRet     = bikky.length > 0 ? [...bikky].sort((a, b) => a.return_rate  - b.return_rate )[0] : null;

  const filtered = bikky
    .filter(r => !search || r.item_name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const mul = desc ? -1 : 1;
      return mul * (a[sort] - b[sort]);
    });

  const thStyle = (key: SortKey): React.CSSProperties => ({
    cursor: 'pointer',
    color: sort === key ? 'var(--accent)' : undefined,
  });

  const arrow = (key: SortKey) => sort === key ? (desc ? ' ↓' : ' ↑') : '';

  if (!bikky.length) {
    return (
      <div>
        <div className="info-banner blue">
          <i className="ti ti-info-circle" />
          <div>
            Bikky retention data is loaded by fiscal period. Select a fiscal period from the date dropdown (e.g. P5 2026) to load retention metrics.
          </div>
        </div>
        <div className="cc" style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
          <i className="ti ti-users" style={{ fontSize: 32, opacity: 0.3 }} />
          <div style={{ marginTop: 10, fontSize: 13 }}>No Bikky retention data for this date range.</div>
          <div style={{ marginTop: 4, fontSize: 11 }}>Use the date dropdown to pick a fiscal period.</div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="info-banner blue">
        <i className="ti ti-info-circle" />
        <div>
          Bikky tracks guest-level item retention — return rate (% of guests who bought again within 90 days) and reorder rate (same item again). Data shown for period <strong>{bikky[0]?.period ?? '—'}</strong>.
        </div>
      </div>

      {/* KPI row */}
      <div className="krow k4" style={{ marginBottom: 12 }}>
        <div className="kc a">
          <div className="kl">Avg Return Rate</div>
          <div className="kv">{pct(avgReturn)}</div>
          <div className="ks">90-day window</div>
        </div>
        <div className="kc g">
          <div className="kl">Avg Reorder Rate</div>
          <div className="kv">{pct(avgReorder)}</div>
          <div className="ks">same item again</div>
        </div>
        <div className="kc b">
          <div className="kl">Top Retention</div>
          <div className="kv-sm">{topRet?.item_name ?? '—'}</div>
          <div className="ks">{topRet ? pct(topRet.return_rate) + ' return rate' : ''}</div>
        </div>
        <div className="kc p">
          <div className="kl">Lowest Retention</div>
          <div className="kv-sm">{botRet?.item_name ?? '—'}</div>
          <div className="ks">{botRet ? pct(botRet.return_rate) + ' return rate' : ''}</div>
        </div>
      </div>

      {/* Table */}
      <div className="tw">
        <div className="th2">
          <h3>Item-level retention · {bikky[0]?.period ?? ''}</h3>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search items…" className="srch"
          />
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Category</th>
                <th style={thStyle('revenue')} onClick={() => toggleSort('revenue')}>Revenue{arrow('revenue')}</th>
                <th style={thStyle('qty')} onClick={() => toggleSort('qty')}>Qty{arrow('qty')}</th>
                <th style={thStyle('return_rate')} onClick={() => toggleSort('return_rate')}>Return Rate{arrow('return_rate')}</th>
                <th style={thStyle('reorder_rate')} onClick={() => toggleSort('reorder_rate')}>Reorder Rate{arrow('reorder_rate')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={`${r.item_name}-${i}`}>
                  <td style={{ fontWeight: 600 }}>{r.item_name}</td>
                  <td style={{ fontSize: 10, color: 'var(--muted)' }}>{r.category}</td>
                  <td>{r.revenue > 0 ? fmt$(r.revenue) : <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                  <td>{r.qty > 0 ? r.qty.toLocaleString() : <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                  <td><span className={rateClass(r.return_rate)}>{pct(r.return_rate)}</span></td>
                  <td><span className={rateClass(r.reorder_rate)}>{pct(r.reorder_rate)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
