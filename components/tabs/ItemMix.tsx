'use client';
import { useState, useMemo } from 'react';
import type { ItemRow, MERow } from '@/lib/types';

const fmt$  = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;
const fmt$2 = (v: number) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type ItemSortKey = 'qty' | 'revenue' | 'avg_price';
type SortKey     = ItemSortKey | 'avg_cost';

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

const CH_ORDER  = ['IN_HOUSE', 'APP', 'TPD', 'TPD_MARKUP', 'CATERING', 'CATERING_3PD', 'OFFSITE', 'OPEN_ITEMS'];
const CAT_ORDER = ['Entrees', 'Sides', 'NA Drinks', 'Sweets', 'Alc Drinks', 'Retail', 'Other'];
const normCat = (c: string | null | undefined) => (c === 'Kids Meal' ? 'Entrees' : c || 'Other');
const VENDOR_CH = new Set(['CATERING', 'CATERING_3PD', 'OFFSITE']);

function itemCat(i: ItemRow): string {
  if (VENDOR_CH.has(i.channel)) return i.menu_group || 'Other';
  if (i.channel === 'OPEN_ITEMS') return normCat(i.category);
  return normCat(i.category);
}

export default function ItemMix({ items, meItems, selectedChannels, categoryFilter }: Props) {
  const [search,          setSearch]          = useState('');
  const [sortKey,         setSortKey]         = useState<SortKey>('revenue');
  const [sortDir,         setSortDir]         = useState<'asc' | 'desc'>('desc');
  const [collapsed,       setCollapsed]       = useState<Record<string, boolean>>({});
  const [menuGroupFilter, setMenuGroupFilter] = useState('__ALL__');

  const allMenuGroups = useMemo(() => {
    const s = new Set<string>();
    items.forEach(i => s.add(i.menu_group ?? ''));
    return Array.from(s).sort();
  }, [items]);

  // canonical_name → MERow for per-channel cost lookup
  const meMap = useMemo(() => {
    const m = new Map<string, typeof meItems[0]>();
    meItems.forEach(i => m.set(i.canonical_name, i));
    return m;
  }, [meItems]);

  // Channel-aware cost: use modifier-adjusted cost when available.
  // For APP / TPD / TPD_MARKUP / CATERING_3PD: use avg_cost_lo (online, non-uplifted).
  // For IN_HOUSE: use avg_cost_ih.
  // Fallback for everything else: avg_cost (blended).
  function getAvgCost(item: ItemRow): number | undefined {
    const me = meMap.get(item.canonical_name);
    if (!me) return undefined;
    if (item.channel === 'IN_HOUSE') {
      return me.avg_cost_ih > 0 ? me.avg_cost_ih : undefined;
    }
    if (['APP', 'TPD', 'TPD_MARKUP', 'CATERING_3PD'].includes(item.channel)) {
      return me.avg_cost_lo > 0 ? me.avg_cost_lo : undefined;
    }
    return me.avg_cost > 0 ? me.avg_cost : undefined;
  }

  // Filtered items
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return items.filter(i => {
      if (selectedChannels.length > 0 && !selectedChannels.includes(i.channel)) return false;
      if (categoryFilter !== 'all') {
        if (itemCat(i) !== categoryFilter) return false;
      }
      if (menuGroupFilter !== '__ALL__' && (i.menu_group ?? '') !== menuGroupFilter) return false;
      if (q && !i.canonical_name.toLowerCase().includes(q) && !i.menu_group.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, selectedChannels, categoryFilter, menuGroupFilter, search]);

  const totalRevenue = useMemo(() => filtered.reduce((s, i) => s + i.revenue, 0), [filtered]);

  // Category-level totals for category-wise mix %
  const catTotals = useMemo(() => {
    const qty = new Map<string, number>();
    const rev = new Map<string, number>();
    filtered.forEach(i => {
      const cat = itemCat(i);
      qty.set(cat, (qty.get(cat) ?? 0) + i.qty);
      rev.set(cat, (rev.get(cat) ?? 0) + i.revenue);
    });
    return { qty, rev };
  }, [filtered]);

  // Tree: channel → category → subCategory → items
  const tree = useMemo(() => {
    const out: Record<string, Record<string, Record<string, ItemRow[]>>> = {};
    filtered.forEach(i => {
      const ch  = i.channel;
      const cat = VENDOR_CH.has(ch) ? (i.menu_group || 'Other')
                : ch === 'OPEN_ITEMS' ? (i.category || 'Other')
                : (i.category || 'Other');
      const sub = (VENDOR_CH.has(ch) || ch === 'OPEN_ITEMS') ? '' : (i.sub_category || '');
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
      if (sortKey === 'avg_cost') {
        return mul * ((getAvgCost(b) ?? 0) - (getAvgCost(a) ?? 0));
      }
      return mul * (b[sortKey as ItemSortKey] - a[sortKey as ItemSortKey]);
    });
  }

  function subRev(rows: ItemRow[]) { return rows.reduce((s, i) => s + i.revenue, 0); }
  function subQty(rows: ItemRow[]) { return rows.reduce((s, i) => s + i.qty,     0); }
  function catRev(subs: Record<string, ItemRow[]>) {
    return Object.values(subs).reduce((s, r) => s + subRev(r), 0);
  }
  function chRev(cats: Record<string, Record<string, ItemRow[]>>) {
    return Object.values(cats).reduce((s, subs) => s + catRev(subs), 0);
  }

  const channelsToShow = CH_ORDER.filter(c => tree[c]);
  const COL = 8; // total columns

  const tableRows: React.ReactNode[] = [];

  channelsToShow.forEach(ch => {
    const catMap       = tree[ch] ?? {};
    const chTotal      = chRev(catMap);
    const chKey        = `ch:${ch}`;
    const showChHeader = channelsToShow.length > 1;

    if (showChHeader) {
      tableRows.push(
        <tr key={chKey} onClick={() => toggle(chKey)} style={{ cursor: 'pointer' }}>
          <td colSpan={COL} style={{ background: '#1e1b4b', color: '#fff', fontWeight: 700, fontSize: 12, padding: '9px 12px' }}>
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
      const cQty     = Object.values(subMap).reduce((s, r) => s + subQty(r), 0);
      const catKey   = `cat:${ch}:${cat}`;
      const catDepth = showChHeader ? 28 : 12;

      tableRows.push(
        <tr key={catKey} onClick={() => toggle(catKey)} style={{ cursor: 'pointer' }}>
          <td colSpan={COL} style={{ background: '#f5f3ff', fontWeight: 700, fontSize: 11, color: '#381d7c', padding: '7px 12px', paddingLeft: catDepth }}>
            <span style={{ marginRight: 6, display: 'inline-block', transform: isOpen(catKey) ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>▶</span>
            {cat}
            <span style={{ fontWeight: 400, fontSize: 10, color: 'var(--muted)', marginLeft: 8 }}>
              {cQty.toLocaleString()} qty · {fmt$(cRev)} · {totalRevenue > 0 ? ((cRev / totalRevenue) * 100).toFixed(1) : 0}% of total
            </span>
          </td>
        </tr>
      );

      if (!isOpen(catKey)) return;

      const subs = Object.keys(subMap).sort((a, b) => subRev(subMap[b]) - subRev(subMap[a]));

      subs.forEach(sub => {
        const rows   = sortedItems(subMap[sub] ?? []);
        const sRev   = subRev(rows);
        const sQty   = subQty(rows);
        const subKey = `sub:${ch}:${cat}:${sub}`;

        // No sub-category — render items directly under category
        if (!sub) {
          rows.forEach(item => tableRows.push(renderItemRow(item, cat)));
          return;
        }

        tableRows.push(
          <tr key={subKey} onClick={() => toggle(subKey)} style={{ cursor: 'pointer' }}>
            <td colSpan={COL} style={{ background: '#faf9ff', fontSize: 10, color: '#6b46c1', padding: '5px 12px', paddingLeft: 48, fontWeight: 600 }}>
              <span style={{ marginRight: 5, display: 'inline-block', transform: isOpen(subKey) ? 'rotate(90deg)' : 'none', transition: 'transform .15s', fontSize: 8 }}>▶</span>
              {sub}
              <span style={{ fontWeight: 400, color: 'var(--muted)', marginLeft: 6 }}>
                {sQty.toLocaleString()} qty · {fmt$(sRev)}
              </span>
            </td>
          </tr>
        );

        if (!isOpen(subKey)) return;
        rows.forEach(item => tableRows.push(renderItemRow(item, cat)));
      });
    });
  });

  function renderItemRow(item: ItemRow, cat: string): React.ReactNode {
    const catQ    = catTotals.qty.get(cat) ?? 0;
    const catR    = catTotals.rev.get(cat) ?? 0;
    const qtyMix  = catQ > 0 ? (item.qty     / catQ * 100) : 0;
    const revMix  = catR > 0 ? (item.revenue / catR * 100) : 0;
    const avgCost = getAvgCost(item);
    return (
      <tr key={`${item.canonical_name}||${item.menu_name}||${item.menu_group}`}>
        <td style={{ paddingLeft: 60, fontWeight: 500 }}>{item.canonical_name}</td>
        <td style={{ fontSize: 10, color: 'var(--muted)' }}>{item.menu_group}</td>
        <td style={{ textAlign: 'center' }}>{item.qty.toLocaleString()}</td>
        <td style={{ fontSize: 10, textAlign: 'center' }}>{qtyMix.toFixed(1)}%</td>
        <td style={{ fontWeight: 600, textAlign: 'center' }}>{fmt$(item.revenue)}</td>
        <td style={{ fontSize: 10, textAlign: 'center' }}>{revMix.toFixed(1)}%</td>
        <td style={{ textAlign: 'center' }}>{fmt$2(item.avg_price)}</td>
        <td style={{ textAlign: 'center', color: avgCost != null ? 'var(--text)' : 'var(--muted)' }}>
          {avgCost != null ? fmt$2(avgCost) : '—'}
        </td>
      </tr>
    );
  }

  const thBase: React.CSSProperties = { position: 'sticky', top: 0, zIndex: 2, background: 'var(--card)' };

  function thSort(key: SortKey, label: string) {
    const active = sortKey === key;
    return (
      <th
        onClick={() => { setSortKey(key); setSortDir(d => active ? (d === 'desc' ? 'asc' : 'desc') : 'desc'); }}
        style={{ ...thBase, cursor: 'pointer', color: active ? 'var(--accent)' : undefined, whiteSpace: 'nowrap', textAlign: 'center' }}
      >
        {label}{active ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
      </th>
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
          className="fb-sel" value={menuGroupFilter}
          onChange={e => setMenuGroupFilter(e.target.value)}
        >
          <option value="__ALL__">All groups</option>
          {allMenuGroups.map(g => (
            <option key={g} value={g}>{g || '(blank)'}</option>
          ))}
        </select>
        <select
          className="fb-sel" value={sortKey}
          onChange={e => { setSortKey(e.target.value as SortKey); setSortDir('desc'); }}
          style={{ marginLeft: 'auto' }}
        >
          <option value="revenue">Gross Amount</option>
          <option value="qty">Qty</option>
          <option value="avg_price">Avg Price</option>
          <option value="avg_cost">Avg Cost</option>
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
        <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 280px)' }}>
          <table>
            <thead>
              <tr>
                <th style={thBase}>Item</th>
                <th style={thBase}>Menu Group</th>
                {thSort('qty', 'QTY')}
                <th style={{ ...thBase, textAlign: 'center' }} title="Item qty ÷ category total qty">Mix % (Qty)</th>
                {thSort('revenue', 'Gross Amount')}
                <th style={{ ...thBase, textAlign: 'center' }} title="Item gross amount ÷ category total gross amount">Mix % (Rev)</th>
                {thSort('avg_price', 'Avg Price')}
                {thSort('avg_cost', 'Avg Cost')}
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
