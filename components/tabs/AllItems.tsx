'use client';
import { useState, useMemo } from 'react';
import type { MERow, ItemRow } from '@/lib/types';

const fmt$ = (v: number) =>
  v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M`
  : v >= 1_000   ? `$${(v / 1_000).toFixed(0)}K`
  : `$${v.toFixed(0)}`;

const MB_STYLE: Record<string, { bg: string; text: string }> = {
  'Star':       { bg: '#dcfce7', text: '#14532d' },
  'Plow Horse': { bg: '#ede9fe', text: '#5b21b6' },
  'Puzzle':     { bg: '#dbeafe', text: '#1e3a8a' },
  'Dog':        { bg: '#fee2e2', text: '#991b1b' },
};

type SortKey = 'canonical_name' | 'net_sales' | 'qty' | 'margin_pct';

export default function AllItems({ meItems, items }: { meItems: MERow[]; items: ItemRow[] }) {
  const [search, setSearch] = useState('');
  const [quadFilter, setQuadFilter] = useState('all');
  const [sortKey, setSortKey] = useState<SortKey>('net_sales');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Merge ME data with full items (some items may not have ME classification)
  const meMap = useMemo(() => {
    const m: Record<string, MERow> = {};
    meItems.forEach(i => { m[i.canonical_name] = i; });
    return m;
  }, [meItems]);

  const merged = useMemo(() => {
    return items.map(i => ({
      ...i,
      me: meMap[i.canonical_name] ?? null,
    }));
  }, [items, meMap]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return merged
      .filter(i =>
        (!q || i.canonical_name.toLowerCase().includes(q) || i.category.toLowerCase().includes(q)) &&
        (quadFilter === 'all' || i.me?.quadrant === quadFilter)
      )
      .sort((a, b) => {
        let va = sortKey === 'net_sales' ? (a.me?.net_sales ?? a.revenue)
          : sortKey === 'qty' ? a.qty
          : sortKey === 'margin_pct' ? (a.me?.margin_pct ?? 0)
          : 0;
        let vb = sortKey === 'net_sales' ? (b.me?.net_sales ?? b.revenue)
          : sortKey === 'qty' ? b.qty
          : sortKey === 'margin_pct' ? (b.me?.margin_pct ?? 0)
          : 0;
        if (sortKey === 'canonical_name') {
          return sortDir === 'asc'
            ? a.canonical_name.localeCompare(b.canonical_name)
            : b.canonical_name.localeCompare(a.canonical_name);
        }
        return sortDir === 'asc' ? va - vb : vb - va;
      });
  }, [merged, search, quadFilter, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir('desc'); }
  };

  const arrow = (k: SortKey) => sortKey === k ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ' ↕';

  const exportCSV = () => {
    const hdr = 'Item,ME,Category,Sub-Cat,Net Sales,Qty,Margin %,COGS %,Avg Price,Avg Cost,Total Margin,Mix %';
    const rows = filtered.map(i => [
      `"${i.canonical_name}"`,
      i.me?.quadrant ?? '',
      i.category,
      i.sub_category,
      (i.me?.net_sales ?? i.revenue).toFixed(2),
      i.qty,
      i.me ? (i.me.margin_pct * 100).toFixed(1) + '%' : '',
      i.me ? ((1 - i.me.margin_pct) * 100).toFixed(1) + '%' : '',
      i.avg_price.toFixed(2),
      i.me?.avg_cost ? i.me.avg_cost.toFixed(2) : '',
      i.me?.total_margin.toFixed(2) ?? '',
      i.revenue_pct + '%',
    ].join(','));
    const blob = new Blob([[hdr, ...rows].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'rasa-pmix-items.csv'; a.click();
  };

  return (
    <div>
      <div style={{ background: 'var(--card)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', margin: 0 }}>
            All items — full detail ({filtered.length})
          </h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search items…"
              style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 11, width: 160, fontFamily: 'inherit', outline: 'none' }} />
            <select value={quadFilter} onChange={e => setQuadFilter(e.target.value)}
              style={{ padding: '5px 9px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11, fontFamily: 'inherit' }}>
              <option value="all">All quadrants</option>
              <option value="Star">Stars only</option>
              <option value="Plow Horse">Plow Horses</option>
              <option value="Puzzle">Puzzles</option>
              <option value="Dog">Dogs</option>
            </select>
            <button onClick={exportCSV} style={{
              padding: '5px 12px', borderRadius: 6, border: '1px solid rgba(124,58,237,0.2)',
              background: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer',
              color: 'var(--accent)', fontFamily: 'inherit',
            }}>⬇ Export CSV</button>
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr>
              <th onClick={() => toggleSort('canonical_name')} style={{ cursor: 'pointer' }}>Item{arrow('canonical_name')}</th>
              <th>ME</th><th>Category</th><th>Sub Cat</th>
              <th onClick={() => toggleSort('net_sales')} style={{ cursor: 'pointer' }}>Net Sales{arrow('net_sales')}</th>
              <th onClick={() => toggleSort('qty')} style={{ cursor: 'pointer' }}>QTY{arrow('qty')}</th>
              <th onClick={() => toggleSort('margin_pct')} style={{ cursor: 'pointer' }}>Margin %{arrow('margin_pct')}</th>
              <th>COGS %</th><th>Avg Price</th><th>Avg Cost</th><th>Total Margin</th><th>Mix %</th>
            </tr></thead>
            <tbody>
              {filtered.map(i => {
                const me = i.me;
                const ms = me ? MB_STYLE[me.quadrant] : null;
                const marginPct = me ? (me.margin_pct * 100).toFixed(1) : null;
                const cogsPct   = marginPct ? (100 - Number(marginPct)).toFixed(1) : null;
                return (
                  <tr key={`${i.canonical_name}||${i.menu_group}||${i.menu_name}`}>
                    <td style={{ fontWeight: 600 }}>{i.canonical_name}</td>
                    <td>
                      {ms && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: ms.bg, color: ms.text, textTransform: 'uppercase' }}>
                        {me!.quadrant}
                      </span>}
                    </td>
                    <td style={{ fontSize: 10, color: 'var(--muted)' }}>{i.category}</td>
                    <td style={{ fontSize: 10, color: 'var(--muted)' }}>{i.sub_category || '—'}</td>
                    <td style={{ fontWeight: 600 }}>{fmt$(me?.net_sales ?? i.revenue)}</td>
                    <td>{i.qty.toLocaleString()}</td>
                    <td>
                      {marginPct !== null ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <div style={{ width: 50, background: '#e5e7eb', borderRadius: 3, height: 5, overflow: 'hidden' }}>
                            <div style={{ height: '100%', borderRadius: 3, background: 'var(--accent)', width: `${marginPct}%` }} />
                          </div>
                          {marginPct}%
                        </div>
                      ) : '—'}
                    </td>
                    <td>{cogsPct !== null ? `${cogsPct}%` : '—'}</td>
                    <td>${i.avg_price.toFixed(2)}</td>
                    <td>{me?.avg_cost ? `$${me.avg_cost.toFixed(2)}` : '—'}</td>
                    <td>{me ? fmt$(me.total_margin) : '—'}</td>
                    <td>{i.revenue_pct}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
