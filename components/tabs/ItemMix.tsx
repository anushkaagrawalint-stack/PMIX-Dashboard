'use client';
import { useState, useMemo } from 'react';
import type { ItemRow, MERow } from '@/lib/types';

const fmt$ = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;

type SortKey = 'qty' | 'revenue' | 'avg_price' | 'avg_cost' | 'margin_pct';

interface Props {
  items:            ItemRow[];
  meItems:          MERow[];
  selectedChannels: string[];
  categoryFilter:   string;
}

const CH_LABEL: Record<string, string> = {
  IN_HOUSE:    'In-House',
  APP:         'Loyalty',
  TPD:         '3PD',
  TPD_MARKUP:  '3PD Markup',
  CATERING:    'Catering',
  CATERING_3PD:'Catering 3PD',
  OFFSITE:     'Offsite',
  OPEN_ITEMS:  'Open Items',
};

const CH_ORDER = ['IN_HOUSE', 'APP', 'TPD', 'TPD_MARKUP', 'CATERING', 'CATERING_3PD', 'OFFSITE', 'OPEN_ITEMS'];

// Display order for categories (non-catering channels)
const CAT_ORDER = ['Entrees', 'Sides', 'NA Drinks', 'Sweets', 'Kids Meal', 'Alc Drinks', 'Retail', 'Modifier', 'Other'];


export default function ItemMix({ items, meItems, selectedChannels, categoryFilter }: Props) {
  const [search,    setSearch]   = useState('');
  const [sortKey,   setSortKey]  = useState<SortKey>('revenue');
  const [sortDir,   setSortDir]  = useState<'asc' | 'desc'>('desc');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const costMap = useMemo(() => {
    const m = new Map<string, { avg_cost: number; margin_pct: number }>();
    meItems.forEach(r => m.set(r.canonical_name, { avg_cost: r.avg_cost, margin_pct: r.margin_pct }));
    return m;
  }, [meItems]);

  const VENDOR_CH = new Set(['CATERING', 'CATERING_3PD', 'OFFSITE']);

  // Items filtered by global channel + category + search.
  // For CATERING / CATERING_3PD / OFFSITE, the "category" is menu_group (vendor/package name).
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return items.filter(i => {
      if (selectedChannels.length > 0 && !selectedChannels.includes(i.channel)) return false;
      if (categoryFilter !== 'all') {
        const itemCat = VENDOR_CH.has(i.channel)
          ? (i.menu_group || 'Other')
          : (i.category   || 'Other');
        if (itemCat !== categoryFilter) return false;
      }
      if (q && !i.canonical_name.toLowerCase().includes(q) && !i.menu_group.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, selectedChannels, categoryFilter, search]);

  const totalRevenue = useMemo(() => filtered.reduce((s, i) => s + i.revenue, 0), [filtered]);

  // Build 3-level map: channel → category → subCategory → ItemRow[]
  // CATERING   → category = menu_group (EzCater package name), no sub
  // OFFSITE    → category = menu_group (vendor: Aramark, Eurest…), no sub
  // OPEN_ITEMS → category from AppScript logic, no sub
  // Others     → category + sub_category from AppScript
  const tree = useMemo(() => {
    const out: Record<string, Record<string, Record<string, ItemRow[]>>> = {};
    filtered.forEach(i => {
      const ch  = i.channel;
      let cat: string;
      let sub: string;

      if (ch === 'CATERING' || ch === 'CATERING_3PD' || ch === 'OFFSITE') {
        cat = i.menu_group || 'Other';
        sub = '';
      } else if (ch === 'OPEN_ITEMS') {
        cat = i.category || 'Other';
        sub = '';
      } else {
        cat = i.category     || 'Other';
        sub = i.sub_category || '';
      }

      if (!out[ch])           out[ch]           = {};
      if (!out[ch][cat])      out[ch][cat]      = {};
      if (!out[ch][cat][sub]) out[ch][cat][sub] = [];
      out[ch][cat][sub].push(i);
    });
    return out;
  }, [filtered]);

  const toggle = (k: string) => setCollapsed(c => ({ ...c, [k]: !c[k] }));
  const isOpen = (k: string) => !collapsed[k];

  function sortedItems(rows: ItemRow[]): ItemRow[] {
    const mul = sortDir === 'desc' ? -1 : 1;
    return [...rows].sort((a, b) => {
      if (sortKey === 'avg_cost')
        return mul * ((costMap.get(b.canonical_name)?.avg_cost ?? 0) - (costMap.get(a.canonical_name)?.avg_cost ?? 0));
      if (sortKey === 'margin_pct')
        return mul * ((costMap.get(b.canonical_name)?.margin_pct ?? 0) - (costMap.get(a.canonical_name)?.margin_pct ?? 0));
      return mul * (b[sortKey] - a[sortKey]);
    });
  }

  function subRev(rows: ItemRow[])                       { return rows.reduce((s, i) => s + i.revenue, 0); }
  function subQtyTotal(rows: ItemRow[])                  { return rows.reduce((s, i) => s + i.qty, 0); }
  function catRev(subs: Record<string, ItemRow[]>)       { return Object.values(subs).reduce((s, r) => s + subRev(r), 0); }
  function chRev(cats: Record<string, Record<string, ItemRow[]>>) {
    return Object.values(cats).reduce((s, subs) => s + catRev(subs), 0);
  }

  const channelsToShow = CH_ORDER.filter(c => tree[c]);

  // Accumulate all table rows
  const tableRows: React.ReactNode[] = [];

  channelsToShow.forEach(ch => {
    const catMap  = tree[ch] ?? {};
    const chTotal = chRev(catMap);
    const chKey   = `ch:${ch}`;
    const showChHeader = channelsToShow.length > 1;

    if (showChHeader) {
      tableRows.push(
        <tr key={chKey} onClick={() => toggle(chKey)} style={{ cursor: 'pointer' }}>
          <td colSpan={9} style={{ background: '#1e1b4b', color: '#fff', fontWeight: 700, fontSize: 12, padding: '9px 12px' }}>
            <span style={{ marginRight: 6, display: 'inline-block', transform: isOpen(chKey) ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>▶</span>
            {CH_LABEL[ch] ?? ch}
            <span style={{ fontWeight: 400, fontSize: 10, marginLeft: 8, opacity: 0.7 }}>
              {fmt$(chTotal)} · {totalRevenue > 0 ? ((chTotal / totalRevenue) * 100).toFixed(1) : 0}%
            </span>
          </td>
        </tr>
      );
    }

    if (showChHeader && !isOpen(chKey)) return;

    // Sort categories
    const cats = Object.keys(catMap).sort((a, b) => {
      if (ch !== 'CATERING') {
        const ia = CAT_ORDER.indexOf(a), ib = CAT_ORDER.indexOf(b);
        if (ia !== -1 && ib !== -1) return ia - ib;
        if (ia !== -1) return -1;
        if (ib !== -1) return 1;
      }
      return catRev(catMap[b]) - catRev(catMap[a]);
    });

    cats.forEach(cat => {
      const subMap   = catMap[cat] ?? {};
      const cRev     = catRev(subMap);
      const catKey   = `cat:${ch}:${cat}`;
      const catDepth = showChHeader ? 28 : 12;

      tableRows.push(
        <tr key={catKey} onClick={() => toggle(catKey)} style={{ cursor: 'pointer' }}>
          <td colSpan={9} style={{ background: '#f5f3ff', fontWeight: 700, fontSize: 11, color: '#381d7c', padding: '7px 12px', paddingLeft: catDepth }}>
            <span style={{ marginRight: 6, display: 'inline-block', transform: isOpen(catKey) ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>▶</span>
            {cat}
            <span style={{ fontWeight: 400, fontSize: 10, color: 'var(--muted)', marginLeft: 8 }}>
              {fmt$(cRev)} · {totalRevenue > 0 ? ((cRev / totalRevenue) * 100).toFixed(1) : 0}%
            </span>
          </td>
        </tr>
      );

      if (!isOpen(catKey)) return;

      // Sort sub-categories by revenue
      const subs = Object.keys(subMap).sort((a, b) => subRev(subMap[b]) - subRev(subMap[a]));

      subs.forEach(sub => {
        const rows    = sortedItems(subMap[sub] ?? []);
        const sRev    = subRev(rows);
        const sQty    = subQtyTotal(rows);
        const subKey  = `sub:${ch}:${cat}:${sub}`;

        // No sub_category (CATERING or items with empty sub) — render items directly
        if (!sub) {
          rows.forEach(item => {
            tableRows.push(renderItemRow(item, sQty, totalRevenue));
          });
          return;
        }

        tableRows.push(
          <tr key={subKey} onClick={() => toggle(subKey)} style={{ cursor: 'pointer' }}>
            <td colSpan={9} style={{ background: '#faf9ff', fontSize: 10, color: '#6b46c1', padding: '5px 12px', paddingLeft: 48, fontWeight: 600 }}>
              <span style={{ marginRight: 5, display: 'inline-block', transform: isOpen(subKey) ? 'rotate(90deg)' : 'none', transition: 'transform .15s', fontSize: 8 }}>▶</span>
              {sub}
              <span style={{ fontWeight: 400, color: 'var(--muted)', marginLeft: 6 }}>
                {sQty.toLocaleString()} qty · {fmt$(sRev)}
              </span>
            </td>
          </tr>
        );

        if (!isOpen(subKey)) return;

        rows.forEach(item => {
          tableRows.push(renderItemRow(item, sQty, totalRevenue));
        });
      });
    });
  });

  function renderItemRow(item: ItemRow, groupQty: number, totalRev: number): React.ReactNode {
    const cost    = costMap.get(item.canonical_name);
    const hasCost = !!cost && cost.avg_cost > 0;
    return (
      <tr key={`${item.canonical_name}||${item.menu_name}||${item.menu_group}`}>
        <td style={{ paddingLeft: 60, fontWeight: 500 }}>{item.canonical_name}</td>
        <td style={{ fontSize: 10, color: 'var(--muted)' }}>{item.menu_group}</td>
        <td>{item.qty.toLocaleString()}</td>
        <td style={{ fontWeight: 600 }}>{fmt$(item.revenue)}</td>
        <td>${item.avg_price.toFixed(2)}</td>
        <td style={{ color: hasCost ? 'var(--text)' : 'var(--muted)' }}>
          {hasCost ? `$${cost!.avg_cost.toFixed(2)}` : '—'}
        </td>
        <td>
          {hasCost ? (
            <span className={`rate-tag ${cost!.margin_pct >= 0.65 ? 'rh' : cost!.margin_pct >= 0.50 ? 'rm' : 'rl'}`}>
              {(cost!.margin_pct * 100).toFixed(1)}%
            </span>
          ) : <span style={{ color: 'var(--muted)' }}>—</span>}
        </td>
        <td>{totalRev > 0 ? ((item.revenue / totalRev) * 100).toFixed(1) : '0'}%</td>
        <td style={{ width: 80 }}>
          <div style={{ background: '#e5e7eb', borderRadius: 3, height: 5, overflow: 'hidden' }}>
            <div style={{ height: '100%', borderRadius: 3, background: 'var(--accent)', width: `${groupQty > 0 ? (item.qty / groupQty) * 100 : 0}%` }} />
          </div>
        </td>
      </tr>
    );
  }

  return (
    <div>
      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search items…"
          className="srch" style={{ width: 180 }}
        />
        <select
          className="fb-sel" value={sortKey}
          onChange={e => { setSortKey(e.target.value as SortKey); setSortDir('desc'); }}
          style={{ marginLeft: 'auto' }}
        >
          <option value="revenue">Revenue</option>
          <option value="qty">Qty</option>
          <option value="avg_price">Avg Price</option>
          <option value="avg_cost">Avg Cost</option>
          <option value="margin_pct">Margin %</option>
        </select>
        <button
          className="drb"
          onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
          style={{ minWidth: 0, padding: '4px 10px', fontSize: 13 }}
        >
          {sortDir === 'desc' ? '↓' : '↑'}
        </button>
        <span style={{ fontSize: 10, color: 'var(--muted)' }}>{filtered.length} items</span>
      </div>

      <div className="tw">
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Menu Group</th>
                <th onClick={() => { setSortKey('qty');       setSortDir(d => d === 'desc' ? 'asc' : 'desc'); }} style={{ cursor: 'pointer' }}>QTY{sortKey==='qty'?(sortDir==='desc'?' ↓':' ↑'):''}</th>
                <th onClick={() => { setSortKey('revenue');   setSortDir(d => d === 'desc' ? 'asc' : 'desc'); }} style={{ cursor: 'pointer' }}>Revenue{sortKey==='revenue'?(sortDir==='desc'?' ↓':' ↑'):''}</th>
                <th onClick={() => { setSortKey('avg_price'); setSortDir(d => d === 'desc' ? 'asc' : 'desc'); }} style={{ cursor: 'pointer' }}>Avg Price{sortKey==='avg_price'?(sortDir==='desc'?' ↓':' ↑'):''}</th>
                <th onClick={() => { setSortKey('avg_cost');  setSortDir(d => d === 'desc' ? 'asc' : 'desc'); }} style={{ cursor: 'pointer' }}>Avg Cost{sortKey==='avg_cost'?(sortDir==='desc'?' ↓':' ↑'):''}</th>
                <th onClick={() => { setSortKey('margin_pct');setSortDir(d => d === 'desc' ? 'asc' : 'desc'); }} style={{ cursor: 'pointer' }}>Margin %{sortKey==='margin_pct'?(sortDir==='desc'?' ↓':' ↑'):''}</th>
                <th title="Item revenue ÷ total filtered revenue">Mix %</th>
                <th>Bar</th>
              </tr>
            </thead>
            <tbody>
              {tableRows}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
