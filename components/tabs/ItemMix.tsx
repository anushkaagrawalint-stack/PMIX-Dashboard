'use client';
import { useState, useMemo } from 'react';
import type { ItemRow, PinkSheetRow, PinkSheetDetailRow, ItemCostRow, MakeItMealModifierRow } from '@/lib/types';
import { computeFinalAvgCost } from '@/lib/pinkSheetCost';
import { normalizeCategory } from '@/lib/constants';

const fmt$  = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;
const fmt$2 = (v: number) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type ItemSortKey = 'qty' | 'revenue' | 'gross_sales' | 'avg_price' | 'refunds' | 'net_after_refunds';
type SortKey     = ItemSortKey | 'avg_cost' | 'cogs' | 'qty_mix' | 'gross_mix' | 'gross_mix_all';

// Extends ItemRow with "Make It a Meal" modifier-pick figures — local to this
// tab, not part of the shared ItemRow type. When the (admin/tester-only)
// checkbox is on, gross_sales/revenue/net_after_refunds already have the
// modifier pick's own real fact_modifiers.price folded in (so every existing
// calculation that reads those three fields — dedup, category/channel
// totals, sort, COGS% — picks it up with no further changes); qty stays the
// real standalone qty, with makeItMealQty/combinedQty reported as their own
// separate columns.
interface ItemRowX extends ItemRow {
  makeItMealQty: number;
  combinedQty:   number;
}

interface Props {
  items:              ItemRow[];
  pinkSheets:         PinkSheetRow[];
  pinkSheetDetails:   PinkSheetDetailRow[];
  itemCosts:          ItemCostRow[];
  makeItMealModifiers: MakeItMealModifierRow[];
  selectedChannels:   string[];
  categoryFilter:     string;
}

interface FinalCost { online: number; ih: number }

const CH_LABEL: Record<string, string> = {
  IN_HOUSE:    'In-House',
  APP:         'RASA Digital',
  TPD:         '3PD',
  TPD_MARKUP:  '3PD Markup',
  CATERING:    'Catering',
  CATERING_3PD:'Catering 3PD',
  OFFSITE:     'Offsite',
  OPEN_ITEMS:  'Open Items',
};

const CH_ORDER  = ['IN_HOUSE', 'APP', 'TPD', 'TPD_MARKUP', 'CATERING', 'CATERING_3PD', 'OFFSITE', 'OPEN_ITEMS'];
const CAT_ORDER = ['Entrees', 'Sides', 'NA Drinks', 'Sweets', 'Alc Drinks', 'Retail', 'Other'];
const normCat = normalizeCategory;
const VENDOR_CH = new Set(['CATERING', 'CATERING_3PD', 'OFFSITE']);

function itemCat(i: ItemRow): string {
  if (VENDOR_CH.has(i.channel)) return i.menu_group || 'Other';
  if (i.channel === 'OPEN_ITEMS') return normCat(i.category);
  return normCat(i.category);
}

export default function ItemMix({ items, pinkSheets, pinkSheetDetails, itemCosts = [], makeItMealModifiers, selectedChannels, categoryFilter }: Props) {
  const [search,          setSearch]          = useState('');
  const [sortKey,         setSortKey]         = useState<SortKey>('gross_sales');
  const [sortDir,         setSortDir]         = useState<'asc' | 'desc'>('desc');
  const [collapsed,       setCollapsed]       = useState<Record<string, boolean>>({});
  const [menuGroupFilter, setMenuGroupFilter] = useState('__ALL__');
  const [includeMakeItMeal, setIncludeMakeItMeal] = useState(false);

  // canonical_name|channel → total "make it a meal" modifier-pick qty + the
  // modifier's own real price (public.fact_modifiers.price, already a
  // line-level total — WHERE option_group_name = 'Make it a Meal'), NOT
  // avg_price and NOT unit cost.
  const makeItMealMap = useMemo(() => {
    const m = new Map<string, { qty: number; price: number }>();
    makeItMealModifiers.forEach(r => {
      const key = `${r.canonical_name}|${r.channel}`;
      const ex  = m.get(key) ?? { qty: 0, price: 0 };
      m.set(key, { qty: ex.qty + r.qty, price: ex.price + r.price });
    });
    return m;
  }, [makeItMealModifiers]);

  // Descriptive fields borrowed by canonical_name from wherever this item
  // exists as a real standalone line — needed below to place a synthetic row
  // for a "Make it a Meal" pick that has no standalone line of its own in
  // that channel (e.g. Naan/Mini Samosas picked as a Catering meal add-on —
  // Catering never sells them ala carte, so they'd otherwise have nowhere to
  // attach and their modifier data would be silently dropped).
  const descriptorByName = useMemo(() => {
    const m = new Map<string, { menu_name: string; menu_group: string; category: string; sub_category: string }>();
    items.forEach(i => {
      if (!m.has(i.canonical_name)) {
        m.set(i.canonical_name, { menu_name: i.menu_name, menu_group: i.menu_group, category: i.category, sub_category: i.sub_category });
      }
    });
    return m;
  }, [items]);

  // Augments every item with its Make-It-a-Meal qty + a combined qty. When
  // the (admin/tester-only) checkbox is on, gross_sales/revenue/
  // net_after_refunds have the modifier's own real fact_modifiers.price
  // folded in, so every existing calculation reading those three fields
  // (dedup, category/channel totals, sort, COGS%) picks it up automatically —
  // qty itself is left as real standalone qty; combinedQty is the new,
  // separate total.
  const itemsWithMakeItMeal = useMemo((): ItemRowX[] => {
    const rows: ItemRowX[] = items.map(i => {
      const mm = makeItMealMap.get(`${i.canonical_name}|${i.channel}`);
      const makeItMealQty = mm?.qty ?? 0;
      const addedAmount = includeMakeItMeal ? (mm?.price ?? 0) : 0;
      return {
        ...i,
        makeItMealQty,
        combinedQty: i.qty + makeItMealQty,
        gross_sales: i.gross_sales + addedAmount,
        revenue: i.revenue + addedAmount,
        net_after_refunds: i.net_after_refunds + addedAmount,
      };
    });

    // Modifier-only picks (no standalone ItemRow to attach to) only surface
    // once the checkbox is on — nothing about this feature, including a
    // whole new row, should appear while it's unchecked.
    if (includeMakeItMeal) {
      const existingKeys = new Set(items.map(i => `${i.canonical_name}|${i.channel}`));
      makeItMealMap.forEach((mm, key) => {
        if (existingKeys.has(key)) return;
        const sep           = key.lastIndexOf('|');
        const canonicalName = key.slice(0, sep);
        const channel        = key.slice(sep + 1);
        const desc = descriptorByName.get(canonicalName);
        rows.push({
          canonical_name: canonicalName,
          menu_name:      desc?.menu_name   ?? '',
          menu_group:     desc?.menu_group  ?? '',
          channel,
          category:       desc?.category     ?? 'Other',
          sub_category:   desc?.sub_category ?? '',
          qty:            0,
          revenue:        mm.price,
          gross_sales:    mm.price,
          avg_price:      0,
          revenue_pct:    0,
          qty_pct:        0,
          is_open_item:   false,
          refunds:            0,
          net_after_refunds:  mm.price,
          makeItMealQty:  mm.qty,
          combinedQty:    mm.qty,
        });
      });
    }
    return rows;
  }, [items, makeItMealMap, includeMakeItMeal, descriptorByName]);

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

  // COGS% = (avg cost × qty) / (avg price × qty) — qty cancels out, but written
  // this way to mirror the formula as specified rather than just avgCost/avgPrice.
  function getCogsPct(item: ItemRow): number | null {
    const avgCost = getAvgCost(item);
    return (avgCost != null && item.avg_price > 0)
      ? (avgCost * item.qty) / (item.avg_price * item.qty)
      : null;
  }

  // Scoped items — channel/category/menu-group filters only. Deliberately excludes
  // the search box: mix %/totals must stay stable as you type a search, only the
  // set of rows actually rendered should narrow. See matchesSearch() below.
  const filtered = useMemo(() => {
    return itemsWithMakeItMeal.filter(i => {
      if (selectedChannels.length > 0 && !selectedChannels.includes(i.channel)) return false;
      if (categoryFilter !== 'all') {
        if (itemCat(i) !== categoryFilter) return false;
      }
      if (menuGroupFilter !== '__ALL__' && (i.menu_group ?? '') !== menuGroupFilter) return false;
      return true;
    });
  }, [itemsWithMakeItMeal, selectedChannels, categoryFilter, menuGroupFilter]);

  function matchesSearch(i: ItemRow): boolean {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return i.canonical_name.toLowerCase().includes(q) || i.menu_group.toLowerCase().includes(q);
  }

  // Merge rows that share canonical_name + channel + category + sub_category
  // (can arise when the same real item appears under two different raw menu names)
  const dedupedFiltered = useMemo(() => {
    const map = new Map<string, ItemRowX>();
    filtered.forEach(item => {
      const ch  = item.channel;
      const cat = itemCat(item);
      const sub = (VENDOR_CH.has(ch) || ch === 'OPEN_ITEMS') ? '' : (item.sub_category || '');
      const key = `${item.canonical_name}|${ch}|${cat}|${sub}`;
      const ex  = map.get(key);
      if (!ex) {
        map.set(key, { ...item });
      } else {
        const qty          = ex.qty          + item.qty;
        const revenue      = ex.revenue      + item.revenue;
        const gross_sales  = ex.gross_sales  + item.gross_sales;
        const refunds      = ex.refunds      + item.refunds;
        const makeItMealQty= ex.makeItMealQty+ item.makeItMealQty;
        map.set(key, {
          ...ex,
          qty,
          revenue,
          gross_sales,
          avg_price:   qty > 0 ? gross_sales / qty : ex.avg_price,
          revenue_pct: ex.revenue_pct + item.revenue_pct,
          qty_pct:     ex.qty_pct     + item.qty_pct,
          refunds,
          net_after_refunds: Math.round((revenue - refunds) * 100) / 100,
          makeItMealQty,
          combinedQty: qty + makeItMealQty,
        });
      }
    });
    return Array.from(map.values());
  }, [filtered]);

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
    const out: Record<string, Record<string, Record<string, ItemRowX[]>>> = {};
    dedupedFiltered.forEach(i => {
      const ch  = i.channel;
      const cat = itemCat(i);
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

  function sortedItems(rows: ItemRowX[]): ItemRowX[] {
    // b - a sorts descending by default, so mul must be +1 for 'desc' and -1
    // for 'asc' — it was inverted before, making every sort (direction toggle
    // and column-header clicks alike) apply backwards from what the ↓/↑ showed.
    const mul = sortDir === 'desc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (sortKey === 'avg_cost') {
        return mul * ((getAvgCost(b) ?? 0) - (getAvgCost(a) ?? 0));
      }
      if (sortKey === 'cogs') {
        return mul * ((getCogsPct(b) ?? 0) - (getCogsPct(a) ?? 0));
      }
      // Mix % columns are a positive-constant-denominator scaling of qty/gross_sales
      // within the group being sorted (same category/channel), so sorting by the
      // raw figure gives an identical order without recomputing the % here.
      if (sortKey === 'qty_mix') {
        return mul * (b.qty - a.qty);
      }
      if (sortKey === 'gross_mix' || sortKey === 'gross_mix_all') {
        return mul * (b.gross_sales - a.gross_sales);
      }
      return mul * (b[sortKey as ItemSortKey] - a[sortKey as ItemSortKey]);
    });
  }

  function subRev(rows: ItemRow[])   { return rows.reduce((s, i) => s + i.revenue,    0); }
  function subGross(rows: ItemRow[]) { return rows.reduce((s, i) => s + i.gross_sales, 0); }
  function subQty(rows: ItemRow[])   { return rows.reduce((s, i) => s + i.qty,         0); }
  function subRefunds(rows: ItemRow[])         { return rows.reduce((s, i) => s + i.refunds,           0); }
  function subNetAfterRefunds(rows: ItemRow[]) { return rows.reduce((s, i) => s + i.net_after_refunds, 0); }
  function catRev(subs: Record<string, ItemRow[]>) {
    return Object.values(subs).reduce((s, r) => s + subRev(r), 0);
  }
  function catGross(subs: Record<string, ItemRow[]>) {
    return Object.values(subs).reduce((s, r) => s + subGross(r), 0);
  }
  function catRefunds(subs: Record<string, ItemRow[]>) {
    return Object.values(subs).reduce((s, r) => s + subRefunds(r), 0);
  }
  function catNetAfterRefunds(subs: Record<string, ItemRow[]>) {
    return Object.values(subs).reduce((s, r) => s + subNetAfterRefunds(r), 0);
  }
  function chRev(cats: Record<string, Record<string, ItemRow[]>>) {
    return Object.values(cats).reduce((s, subs) => s + catRev(subs), 0);
  }
  function chGross(cats: Record<string, Record<string, ItemRow[]>>) {
    return Object.values(cats).reduce((s, subs) => s + catGross(subs), 0);
  }
  function chRefunds(cats: Record<string, Record<string, ItemRow[]>>) {
    return Object.values(cats).reduce((s, subs) => s + catRefunds(subs), 0);
  }
  function chNetAfterRefunds(cats: Record<string, Record<string, ItemRow[]>>) {
    return Object.values(cats).reduce((s, subs) => s + catNetAfterRefunds(subs), 0);
  }

  // Whether a ch/cat/sub node has at least one item matching the search box —
  // used only to decide whether to render that section at all. Header totals
  // (chTotal, cRev, sRev, etc.) always sum the FULL node regardless of search,
  // so % figures never shift as you type — only which rows are visible does.
  function nodeHasMatch(cats: Record<string, Record<string, ItemRow[]>>): boolean {
    if (!search.trim()) return true;
    return Object.values(cats).some(subs => Object.values(subs).some(rows => rows.some(matchesSearch)));
  }
  function catHasMatch(subs: Record<string, ItemRow[]>): boolean {
    if (!search.trim()) return true;
    return Object.values(subs).some(rows => rows.some(matchesSearch));
  }

  const channelsToShow = CH_ORDER.filter(c => tree[c]);
  const COL = includeMakeItMeal ? 15 : 13; // total columns — the 2 Make It a Meal cols only exist once the checkbox is on

  const tableRows: React.ReactNode[] = [];

  channelsToShow.forEach(ch => {
    const catMap        = tree[ch] ?? {};
    if (!nodeHasMatch(catMap)) return;
    const chTotal       = chRev(catMap);
    const chTotalGross  = chGross(catMap);
    const chTotalRefunds= chRefunds(catMap);
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
              {chTotalRefunds > 0 && <> · {fmt$(chTotalRefunds)} refunds · {fmt$(chNetAfterRefunds(catMap))} after refunds</>}
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
      if (!catHasMatch(subMap)) return;
      const cRev     = catRev(subMap);
      const cGross   = catGross(subMap);
      const cRefunds = catRefunds(subMap);
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
              {cRefunds > 0 && <> · {fmt$(cRefunds)} refunds · {fmt$(catNetAfterRefunds(subMap))} after refunds</>}
            </span>
          </td>
        </tr>
      );

      if (!isOpen(catKey)) return;

      const subs = Object.keys(subMap).sort((a, b) => subRev(subMap[b]) - subRev(subMap[a]));

      subs.forEach(sub => {
        const rows   = sortedItems(subMap[sub] ?? []);
        if (search.trim() && !rows.some(matchesSearch)) return;
        const sRev   = subRev(rows);
        const sGross = subGross(rows);
        const sQty   = subQty(rows);
        const subKey = `sub:${ch}:${cat}:${sub}`;

        // No sub-category — render items directly under category
        if (!sub) {
          rows.forEach(item => { if (matchesSearch(item)) tableRows.push(renderItemRow(item, cat)); });
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
        rows.forEach(item => { if (matchesSearch(item)) tableRows.push(renderItemRow(item, cat)); });
      });
    });
  });

  function renderItemRow(item: ItemRowX, cat: string): React.ReactNode {
    const catQ     = catTotals.qty.get(cat)   ?? 0;
    const catG     = catTotals.gross.get(cat) ?? 0;
    const qtyMix     = catQ > 0 ? (item.qty         / catQ * 100) : 0;
    const grossMix   = catG > 0 ? (item.gross_sales  / catG * 100) : 0;
    const grossMixAll = totalGrossSales > 0 ? (item.gross_sales / totalGrossSales * 100) : 0;
    const avgCost  = getAvgCost(item);
    const cogsPct  = getCogsPct(item);
    return (
      <tr key={`${item.canonical_name}||${item.menu_name}||${item.menu_group}`}>
        <td style={{ paddingLeft: 60, fontWeight: 500 }}>{item.canonical_name}</td>
        <td style={{ fontSize: 10, color: 'var(--muted)' }}>{item.menu_group}</td>
        <td style={{ textAlign: 'center' }}>{item.qty.toLocaleString()}</td>
        {includeMakeItMeal && (
          <>
            <td style={{ textAlign: 'center', fontSize: 11, color: item.makeItMealQty > 0 ? 'var(--accent)' : 'var(--muted)' }}>
              {item.makeItMealQty > 0 ? item.makeItMealQty.toLocaleString() : '—'}
            </td>
            <td style={{ textAlign: 'center', fontWeight: 600, fontSize: 11 }}>{item.combinedQty.toLocaleString()}</td>
          </>
        )}
        <td style={{ fontSize: 10, textAlign: 'center' }}>{qtyMix.toFixed(1)}%</td>
        <td style={{ fontWeight: 600, textAlign: 'center' }}>{fmt$(item.gross_sales)}</td>
        <td style={{ fontSize: 10, textAlign: 'center' }}>{grossMix.toFixed(1)}%</td>
        <td style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 11 }}>
          {fmt$(item.revenue)}
        </td>
        <td style={{ textAlign: 'center', fontSize: 11, color: item.refunds > 0 ? '#dc2626' : 'var(--muted)' }}>
          {item.refunds > 0 ? fmt$(item.refunds) : '—'}
        </td>
        <td style={{ textAlign: 'center', fontWeight: 600, fontSize: 11 }}>
          {fmt$(item.net_after_refunds)}
        </td>
        <td style={{ fontSize: 10, textAlign: 'center', fontWeight: 600, color: 'var(--accent)' }}>{grossMixAll.toFixed(1)}%</td>
        <td style={{ textAlign: 'center' }}>{fmt$2(item.avg_price)}</td>
        <td style={{ textAlign: 'center', color: avgCost != null ? 'var(--text)' : 'var(--muted)' }}>
          {avgCost != null ? fmt$2(avgCost) : '—'}
        </td>
        <td style={{ textAlign: 'center', color: cogsPct != null && cogsPct > 0.35 ? '#ef4444' : 'inherit' }}>
          {cogsPct != null ? `${(cogsPct * 100).toFixed(1)}%` : '—'}
        </td>
      </tr>
    );
  }

  const thBase: React.CSSProperties = { position: 'sticky', top: 0, zIndex: 2, background: 'var(--card)' };

  function thSort(key: SortKey, label: string, formulaTitle?: string, opts?: { wrap?: boolean; fontSize?: number }) {
    const active = sortKey === key;
    return (
      <th
        onClick={() => { setSortKey(key); setSortDir(d => active ? (d === 'desc' ? 'asc' : 'desc') : 'desc'); }}
        style={{
          ...thBase,
          cursor: 'pointer',
          color: active ? 'var(--accent)' : undefined,
          whiteSpace: opts?.wrap ? 'normal' : 'nowrap',
          textAlign: 'center',
          ...(opts?.fontSize ? { fontSize: opts.fontSize } : {}),
        }}
        title={formulaTitle}
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
          <option value="qty">Qty</option>
          <option value="qty_mix">Mix % (Qty)</option>
          <option value="gross_sales">Gross Sales</option>
          <option value="gross_mix">Mix % Revenue by Category</option>
          <option value="revenue">Net Sales</option>
          <option value="refunds">Refunds</option>
          <option value="net_after_refunds">Net after Refunds</option>
          <option value="gross_mix_all">Mix % Revenue Overall</option>
          <option value="avg_price">Avg Price</option>
          <option value="avg_cost">Avg Cost</option>
          <option value="cogs">COGS%</option>
        </select>
        <button
          className="drb"
          onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
          style={{ minWidth: 0, padding: '4px 10px', fontSize: 13 }}
        >
          {sortDir === 'desc' ? '↓' : '↑'}
        </button>
        <span style={{ fontSize: 10, color: 'var(--muted)' }}>
          {search.trim() ? dedupedFiltered.filter(matchesSearch).length : dedupedFiltered.length} items
        </span>
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, cursor: 'pointer', width: '100%' }}>
          <input type="checkbox" checked={includeMakeItMeal} onChange={e => setIncludeMakeItMeal(e.target.checked)} />
          Include &quot;Make It a Meal&quot; picks in Gross Sales / Net Sales / Net after Refunds (adds the modifier&apos;s own real price from fact_modifiers)
        </label>
      </div>

      <div className="tw">
        <div className="tscroll">
          <table style={{ tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '16%' }} />
              <col style={{ width: '7%' }} />
              <col style={{ width: '5%' }} />
              {includeMakeItMeal && <col style={{ width: '6%' }} />}
              {includeMakeItMeal && <col style={{ width: '6%' }} />}
              <col style={{ width: '6%' }} />
              <col style={{ width: '6%' }} />
              <col style={{ width: '6%' }} />
              <col style={{ width: '6%' }} />
              <col style={{ width: '6%' }} />
              <col style={{ width: '7%' }} />
              <col style={{ width: '6%' }} />
              <col style={{ width: '6%' }} />
              <col style={{ width: '5%' }} />
              <col style={{ width: '5%' }} />
            </colgroup>
            <thead>
              <tr>
                <th style={thBase}>Item</th>
                <th style={thBase}>Menu Group</th>
                {thSort('qty', 'QTY', 'Total quantity sold (SUM of order line quantity)')}
                {includeMakeItMeal && (
                  <>
                    <th style={{ ...thBase, textAlign: 'center', fontSize: 10, whiteSpace: 'normal' }} title="Times this item was picked as a &quot;make it a meal&quot; modifier (side/drink/sweet add-on), sourced from public.fact_modifiers">Make It a Meal Qty</th>
                    <th style={{ ...thBase, textAlign: 'center', fontSize: 10 }} title="QTY + Make It a Meal Qty">Combined Qty</th>
                  </>
                )}
                {thSort('qty_mix', 'Mix % (Qty)', 'Item qty ÷ category total qty')}
                {thSort('gross_sales', 'Gross Sales', 'SUM of pre-discount revenue (ties to Toast gross sales reports)')}
                {thSort('gross_mix', 'Mix % Revenue by Category', 'Item gross sales ÷ category gross sales (pre-discount, ties to Toast)', { wrap: true })}
                {thSort('revenue', 'Net Sales', 'Net sales after discounts (line_total)')}
                {thSort('refunds', 'Refunds', 'analytics.refund_sales, exact — joined by selection_guid', { fontSize: 10 })}
                {thSort('net_after_refunds', 'Net after Refunds', "Net Sales − Refunds — matches Toast's Net item amt", { wrap: true, fontSize: 10 })}
                {thSort('gross_mix_all', 'Mix % Revenue Overall', 'Item gross sales ÷ total gross sales across every filtered item, across all categories (not just its own category)', { wrap: true })}
                {thSort('avg_price', 'Avg Price', 'Gross Sales ÷ Qty (pre-discount average selling price)')}
                {thSort('avg_cost', 'Avg Cost', 'Pink Sheet "Final Avg Cost With Modifier" for this channel; falls back to r365 Item Cost Lookup when no Pink Sheet cost exists')}
                {thSort('cogs', 'COGS%', '(Avg Cost × Qty) ÷ (Avg Price × Qty) — cost of goods sold as a % of price')}
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
