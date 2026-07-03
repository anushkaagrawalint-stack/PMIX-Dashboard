'use client';
import { useState, useMemo } from 'react';
import type { ItemRow, PinkSheetRow, PinkSheetDetailRow, ItemCostRow } from '@/lib/types';
import { computeFinalAvgCost } from '@/lib/pinkSheetCost';

const fmt$  = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;
const fmt$2 = (v: number) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type ItemSortKey = 'qty' | 'revenue' | 'gross_sales' | 'avg_price';
type SortKey     = ItemSortKey | 'avg_cost';

interface Props {
  items:            ItemRow[];
  pinkSheets:       PinkSheetRow[];
  pinkSheetDetails: PinkSheetDetailRow[];
  itemCosts:        ItemCostRow[];
  selectedChannels: string[];
  categoryFilter:   string;
}

interface FinalCost { online: number; ih: number }

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

export default function ItemMix({ items, pinkSheets, pinkSheetDetails, itemCosts = [], selectedChannels, categoryFilter }: Props) {
  const [search,          setSearch]          = useState('');
  const [sortKey,         setSortKey]         = useState<SortKey>('gross_sales');
  const [sortDir,         setSortDir]         = useState<'asc' | 'desc'>('desc');
  const [collapsed,       setCollapsed]       = useState<Record<string, boolean>>({});
  const [menuGroupFilter, setMenuGroupFilter] = useState('__ALL__');

  const allMenuGroups = useMemo(() => {
    const s = new Set<string>();
    items.forEach(i => s.add(i.menu_group ?? ''));
    return Array.from(s).sort();
  }, [items]);

  // canonical_name → Pink Sheet's actual displayed "FINAL AVG COST WITH MODIFIER"
  // (same computation PinkSheets.tsx uses — not the backend's raw avg_cost_ih/
  // avg_cost_online fields, which don't apply the same section-inclusion rules).
  const fcMap = useMemo(() => {
    const m = new Map<string, FinalCost>();
    const dets = pinkSheetDetails ?? [];
    pinkSheets.forEach(p => m.set(p.canonical_name, {
      online: computeFinalAvgCost(p, dets, 'online'),
      ih:     computeFinalAvgCost(p, dets, 'ih'),
    }));
    return m;
  }, [pinkSheets, pinkSheetDetails]);

  // lowercase canonical_name → ItemCostRow (fallback: r365 latest period, incl. MI recipes)
  const icMap = useMemo(() => {
    const m = new Map<string, ItemCostRow>();
    itemCosts.forEach(c => m.set(c.canonical_name.toLowerCase(), c));
    return m;
  }, [itemCosts]);

  // Cost cascade — matches PMIX_AppScript.txt's master row assembly (getPinkCost_ +
  // the pc/ac fallback): Pink Sheet cost first, Item Cost Lookup (r365 via itemCosts)
  // only when Pink Sheet has none. Two tiers, no "ME row" middle tier — that's not
  // part of the source logic and only added a second, sometimes-divergent number.
  // Item Mix never applies the 3PD packaging uplift (APP and TPD both read the same
  // online figure) — that uplift is Menu Engineering / Pink Sheet's 3PD column only.
  function getAvgCost(item: ItemRow): number | undefined {
    const key = item.canonical_name.toLowerCase();
    if (item.channel === 'IN_HOUSE') {
      const fc = fcMap.get(item.canonical_name);
      if (fc && fc.ih > 0) return fc.ih;
      const ic = icMap.get(key);
      return ic && ic.ih_cost > 0 ? ic.ih_cost : undefined;
    }
    if (item.channel === 'APP' || item.channel === 'TPD') {
      const fc = fcMap.get(item.canonical_name);
      if (fc && fc.online > 0) return fc.online;
      const ic = icMap.get(key);
      return ic && ic.online_cost > 0 ? ic.online_cost : undefined;
    }
    // CATERING / CATERING_3PD / OFFSITE / OPEN_ITEMS: r365_item_cost for that exact
    // menu, or nothing (shown as "—"). No fallback to IH/other channels — a Catering
    // row's cost must come from the Catering menu in r365, never guessed from another
    // channel's cost.
    if (item.channel === 'CATERING') {
      const ic = icMap.get(key);
      return ic && ic.catering_cost > 0 ? ic.catering_cost : undefined;
    }
    if (item.channel === 'CATERING_3PD') {
      const ic = icMap.get(key);
      return ic && ic.catering_3pd_cost > 0 ? ic.catering_3pd_cost : undefined;
    }
    if (item.channel === 'OFFSITE') {
      const ic = icMap.get(key);
      return ic && ic.offsite_cost > 0 ? ic.offsite_cost : undefined;
    }
    if (item.channel === 'OPEN_ITEMS') {
      const ic = icMap.get(key);
      return ic && ic.open_items_cost > 0 ? ic.open_items_cost : undefined;
    }
    return undefined;
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

  // Merge rows that share canonical_name + channel + category + sub_category
  // (can arise when the same real item appears under two different raw menu names)
  const dedupedFiltered = useMemo(() => {
    const map = new Map<string, ItemRow>();
    filtered.forEach(item => {
      const ch  = item.channel;
      const cat = VENDOR_CH.has(ch) ? (item.menu_group || 'Other')
                : ch === 'OPEN_ITEMS' ? (item.category || 'Other')
                : (item.category || 'Other');
      const sub = (VENDOR_CH.has(ch) || ch === 'OPEN_ITEMS') ? '' : (item.sub_category || '');
      const key = `${item.canonical_name}|${ch}|${cat}|${sub}`;
      const ex  = map.get(key);
      if (!ex) {
        map.set(key, { ...item });
      } else {
        const qty        = ex.qty        + item.qty;
        const revenue    = ex.revenue    + item.revenue;
        const gross_sales= ex.gross_sales+ item.gross_sales;
        map.set(key, {
          ...ex,
          qty,
          revenue,
          gross_sales,
          avg_price:   qty > 0 ? gross_sales / qty : ex.avg_price,
          revenue_pct: ex.revenue_pct + item.revenue_pct,
          qty_pct:     ex.qty_pct     + item.qty_pct,
        });
      }
    });
    return Array.from(map.values());
  }, [filtered]);

  const totalRevenue    = useMemo(() => dedupedFiltered.reduce((s, i) => s + i.revenue,    0), [dedupedFiltered]);
  const totalGrossSales = useMemo(() => dedupedFiltered.reduce((s, i) => s + i.gross_sales, 0), [dedupedFiltered]);

  // Category-level totals for category-wise mix %
  const catTotals = useMemo(() => {
    const qty   = new Map<string, number>();
    const rev   = new Map<string, number>();
    const gross = new Map<string, number>();
    dedupedFiltered.forEach(i => {
      const cat = itemCat(i);
      qty.set(cat,   (qty.get(cat)   ?? 0) + i.qty);
      rev.set(cat,   (rev.get(cat)   ?? 0) + i.revenue);
      gross.set(cat, (gross.get(cat) ?? 0) + i.gross_sales);
    });
    return { qty, rev, gross };
  }, [dedupedFiltered]);

  // Tree: channel → category → subCategory → items
  const tree = useMemo(() => {
    const out: Record<string, Record<string, Record<string, ItemRow[]>>> = {};
    dedupedFiltered.forEach(i => {
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
  }, [dedupedFiltered]);

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

  function subRev(rows: ItemRow[])   { return rows.reduce((s, i) => s + i.revenue,    0); }
  function subGross(rows: ItemRow[]) { return rows.reduce((s, i) => s + i.gross_sales, 0); }
  function subQty(rows: ItemRow[])   { return rows.reduce((s, i) => s + i.qty,         0); }
  function catRev(subs: Record<string, ItemRow[]>) {
    return Object.values(subs).reduce((s, r) => s + subRev(r), 0);
  }
  function catGross(subs: Record<string, ItemRow[]>) {
    return Object.values(subs).reduce((s, r) => s + subGross(r), 0);
  }
  function chRev(cats: Record<string, Record<string, ItemRow[]>>) {
    return Object.values(cats).reduce((s, subs) => s + catRev(subs), 0);
  }
  function chGross(cats: Record<string, Record<string, ItemRow[]>>) {
    return Object.values(cats).reduce((s, subs) => s + catGross(subs), 0);
  }

  const channelsToShow = CH_ORDER.filter(c => tree[c]);
  const COL = 9; // total columns

  const tableRows: React.ReactNode[] = [];

  channelsToShow.forEach(ch => {
    const catMap        = tree[ch] ?? {};
    const chTotal       = chRev(catMap);
    const chTotalGross  = chGross(catMap);
    const chKey        = `ch:${ch}`;
    const showChHeader = channelsToShow.length > 1;

    if (showChHeader) {
      tableRows.push(
        <tr key={chKey} onClick={() => toggle(chKey)} style={{ cursor: 'pointer' }}>
          <td colSpan={COL} style={{ background: '#1e1b4b', color: '#fff', fontWeight: 700, fontSize: 12, padding: '9px 12px' }}>
            <span style={{ marginRight: 6, display: 'inline-block', transform: isOpen(chKey) ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>▶</span>
            {CH_LABEL[ch] ?? ch}
            <span style={{ fontWeight: 400, fontSize: 10, marginLeft: 8, opacity: 0.7 }}>
              {fmt$(chTotalGross)} gross · {fmt$(chTotal)} net · {totalGrossSales > 0 ? ((chTotalGross / totalGrossSales) * 100).toFixed(1) : 0}%
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
      const cGross   = catGross(subMap);
      const cQty     = Object.values(subMap).reduce((s, r) => s + subQty(r), 0);
      const catKey   = `cat:${ch}:${cat}`;
      const catDepth = showChHeader ? 28 : 12;

      tableRows.push(
        <tr key={catKey} onClick={() => toggle(catKey)} style={{ cursor: 'pointer' }}>
          <td colSpan={COL} style={{ background: '#f5f3ff', fontWeight: 700, fontSize: 11, color: '#381d7c', padding: '7px 12px', paddingLeft: catDepth }}>
            <span style={{ marginRight: 6, display: 'inline-block', transform: isOpen(catKey) ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>▶</span>
            {cat}
            <span style={{ fontWeight: 400, fontSize: 10, color: 'var(--muted)', marginLeft: 8 }}>
              {cQty.toLocaleString()} qty · {fmt$(cGross)} gross · {fmt$(cRev)} net · {totalGrossSales > 0 ? ((cGross / totalGrossSales) * 100).toFixed(1) : 0}% of total
            </span>
          </td>
        </tr>
      );

      if (!isOpen(catKey)) return;

      const subs = Object.keys(subMap).sort((a, b) => subRev(subMap[b]) - subRev(subMap[a]));

      subs.forEach(sub => {
        const rows   = sortedItems(subMap[sub] ?? []);
        const sRev   = subRev(rows);
        const sGross = subGross(rows);
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
                {sQty.toLocaleString()} qty · {fmt$(sGross)} gross · {fmt$(sRev)} net
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
    const catQ     = catTotals.qty.get(cat)   ?? 0;
    const catG     = catTotals.gross.get(cat) ?? 0;
    const qtyMix   = catQ > 0 ? (item.qty         / catQ * 100) : 0;
    const grossMix = catG > 0 ? (item.gross_sales  / catG * 100) : 0;
    const avgCost  = getAvgCost(item);
    return (
      <tr key={`${item.canonical_name}||${item.menu_name}||${item.menu_group}`}>
        <td style={{ paddingLeft: 60, fontWeight: 500 }}>{item.canonical_name}</td>
        <td style={{ fontSize: 10, color: 'var(--muted)' }}>{item.menu_group}</td>
        <td style={{ textAlign: 'center' }}>{item.qty.toLocaleString()}</td>
        <td style={{ fontSize: 10, textAlign: 'center' }}>{qtyMix.toFixed(1)}%</td>
        <td style={{ fontWeight: 600, textAlign: 'center' }}>{fmt$(item.gross_sales)}</td>
        <td style={{ fontSize: 10, textAlign: 'center' }}>{grossMix.toFixed(1)}%</td>
        <td style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 11 }}>
          {fmt$(item.revenue)}
        </td>
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
          <option value="gross_sales">Gross Sales</option>
          <option value="revenue">Net Sales</option>
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
        <span style={{ fontSize: 10, color: 'var(--muted)' }}>{dedupedFiltered.length} items</span>
      </div>

      <div className="tw">
        <div className="tscroll">
          <table>
            <thead>
              <tr>
                <th style={thBase}>Item</th>
                <th style={thBase}>Menu Group</th>
                {thSort('qty', 'QTY')}
                <th style={{ ...thBase, textAlign: 'center' }} title="Item qty ÷ category total qty">Mix % (Qty)</th>
                {thSort('gross_sales', 'Gross Sales')}
                <th style={{ ...thBase, textAlign: 'center' }} title="Item gross sales ÷ category gross sales (pre-discount, ties to Toast)">Mix % (Gross)</th>
                <th style={{ ...thBase, textAlign: 'center', fontSize: 10, color: 'var(--muted)' }} title="Net sales after discounts (line_total)">Net Sales</th>
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
