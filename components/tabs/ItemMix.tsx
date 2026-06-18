'use client';
import { useState, useMemo } from 'react';
import type { ItemRow } from '@/lib/types';

const fmt$ = (v: number) =>
  v >= 1000 ? `$${(v / 1000).toFixed(0)}K` : `$${v.toFixed(0)}`;

export default function ItemMix({ items }: { items: ItemRow[] }) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<'qty' | 'revenue' | 'avg_price'>('revenue');

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return items
      .filter(i => !q || i.canonical_name.toLowerCase().includes(q) || i.menu_group.toLowerCase().includes(q))
      .sort((a, b) => b[sortKey] - a[sortKey]);
  }, [items, search, sortKey]);

  // Group by menu_group
  const groups = useMemo(() => {
    const map: Record<string, ItemRow[]> = {};
    filtered.forEach(i => {
      const g = i.menu_group || 'Other';
      if (!map[g]) map[g] = [];
      map[g].push(i);
    });
    return Object.entries(map).sort((a, b) =>
      b[1].reduce((s, i) => s + i.revenue, 0) - a[1].reduce((s, i) => s + i.revenue, 0)
    );
  }, [filtered]);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggleGroup = (g: string) => setCollapsed(c => ({ ...c, [g]: !c[g] }));

  const totalRevenue = items.reduce((s, i) => s + i.revenue, 0);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search items…"
          className="srch"
          style={{ width: 180 }}
        />
        <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700 }}>SORT BY</span>
        <div className="tgl-g">
          {(['revenue', 'qty', 'avg_price'] as const).map(k => (
            <button key={k} onClick={() => setSortKey(k)} className={`tgl${sortKey === k ? ' on' : ''}`}>
              {{ revenue: 'Revenue', qty: 'Qty', avg_price: 'Avg Price' }[k]}
            </button>
          ))}
        </div>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--muted)' }}>
          {filtered.length} items
        </span>
      </div>

      <div className="tw">
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr>
              <th>Item</th><th>Menu Group</th><th>Category</th>
              <th>QTY</th><th>Revenue</th><th>Avg Price</th><th>% Mix (rev)</th><th>Share</th>
            </tr></thead>
            <tbody>
              {groups.map(([group, rows]) => {
                const groupRev = rows.reduce((s, i) => s + i.revenue, 0);
                const groupQty = rows.reduce((s, i) => s + i.qty, 0);
                const isOpen = !collapsed[group];
                return [
                  <tr key={`hdr-${group}`} onClick={() => toggleGroup(group)} style={{ cursor: 'pointer' }}>
                    <td colSpan={8} style={{
                      background: '#f5f3ff', fontWeight: 700, fontSize: 11, color: '#381d7c',
                      padding: '8px 10px',
                    }}>
                      <span style={{ marginRight: 6, display: 'inline-block', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform .15s' }}>▶</span>
                      {group}
                      <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 10, marginLeft: 8 }}>
                        {groupQty.toLocaleString()} qty · {fmt$(groupRev)} · {((groupRev / totalRevenue) * 100).toFixed(1)}%
                      </span>
                    </td>
                  </tr>,
                  ...(isOpen ? rows.map(item => (
                    <tr key={`${item.canonical_name}||${item.menu_group}||${item.menu_name}`}>
                      <td style={{ paddingLeft: 20, fontWeight: 500 }}>{item.canonical_name}</td>
                      <td style={{ fontSize: 10, color: 'var(--muted)' }}>{item.menu_group}</td>
                      <td style={{ fontSize: 10, color: 'var(--muted)' }}>{item.category}</td>
                      <td>{item.qty.toLocaleString()}</td>
                      <td style={{ fontWeight: 600 }}>{fmt$(item.revenue)}</td>
                      <td>${item.avg_price.toFixed(2)}</td>
                      <td>{item.revenue_pct}%</td>
                      <td style={{ width: 100 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <div style={{ flex: 1, background: '#e5e7eb', borderRadius: 3, height: 5, minWidth: 40, overflow: 'hidden' }}>
                            <div style={{ height: '100%', borderRadius: 3, background: 'var(--accent)', width: `${Math.min(item.revenue_pct * 5, 100)}%` }} />
                          </div>
                        </div>
                      </td>
                    </tr>
                  )) : []),
                ];
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
