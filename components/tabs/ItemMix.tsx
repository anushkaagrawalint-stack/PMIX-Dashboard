'use client';
import { useState, useMemo } from 'react';
import type { ItemRow, PinkSheetRow, PinkSheetDetailRow, ItemCostRow, ItemModifierRow, CateringPinkSheetRow } from '@/lib/types';
import { computeFinalAvgCost } from '@/lib/pinkSheetCost';
import { normalizeCategory, deriveChannelFromMenuName } from '@/lib/constants';
import { downloadCsv } from '@/lib/csvExport';

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
// real standalone qty.
//
// Item Mix renders modifiers nested under the item they were ordered on, the way
// Toast's Product Mix does. Verified against Toast 2026-09-29: a modifier's qty
// and revenue are NOT rolled into its parent — they are shown as child rows only.
// Rolling them up would have moved FOOD - IN HOUSE from 16,456/$178,819 to
// 24,108/$185,190, which is not what Toast reports.
interface ItemRowX extends ItemRow {
  modifiers: ItemModifierRow[];
}

interface Props {
  items:              ItemRow[];
  pinkSheets:         PinkSheetRow[];
  pinkSheetDetails:   PinkSheetDetailRow[];
  cateringPinkSheets: CateringPinkSheetRow[];
  itemCosts:          ItemCostRow[];
  itemModifiers:      ItemModifierRow[];
  selectedChannels:   string[];
  categoryFilter:     string;
  isAdmin?:           boolean;
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
  EZCATER:     'EzCater',
  OPEN_ITEMS:  'Open Items',
};

const CH_ORDER  = ['IN_HOUSE', 'APP', 'TPD', 'TPD_MARKUP', 'CATERING', 'CATERING_3PD', 'OFFSITE', 'EZCATER', 'OPEN_ITEMS'];
const CAT_ORDER = ['Entrees', 'Sides', 'NA Drinks', 'Sweets', 'Alc Drinks', 'Retail', 'Other'];
const normCat = normalizeCategory;
const VENDOR_CH = new Set(['CATERING', 'CATERING_3PD', 'OFFSITE', 'EZCATER']);

// Vendor channels group by raw menu_group (e.g. "Ez Cater + Relish Individually
// Packaged Bowls") since that's descriptive for genuine vendor-menu items. But a
// row whose channel came from a Needs Review correction (channel_overrides) still
// carries its ORIGINAL menu_group (e.g. plain "BOWLS" from an in-house-style
// menu) — grouping it by that stale raw value looks wrong once it's displayed
// under its corrected vendor channel. Detect that case by comparing the row's
// actual channel against what its raw menu_name alone would derive to; if they
// differ, treat it like a normal (non-vendor-grouped) row everywhere below.
function usesRawMenuGroup(i: ItemRow): boolean {
  return VENDOR_CH.has(i.channel) && deriveChannelFromMenuName(i.menu_name) === i.channel;
}

function itemCat(i: ItemRow): string {
  if (usesRawMenuGroup(i)) return i.menu_group || 'Other';
  return normCat(i.category);
}

// Sub-category used for grouping AND for the sub-category mix denominator —
// vendor-grouped and open-item rows have no sub-category tier, so both
// collapse to ''. One function, so the tree's buckets and the % denominator
// can never drift apart (that drift is exactly the bug Mix % (Qty) had).
function itemSub(i: ItemRow): string {
  return (usesRawMenuGroup(i) || i.channel === 'OPEN_ITEMS') ? '' : (i.sub_category || '');
}

export default function ItemMix({ items, pinkSheets, pinkSheetDetails, cateringPinkSheets = [], itemCosts = [], itemModifiers = [], selectedChannels, categoryFilter, isAdmin = false }: Props) {
  const [search,          setSearch]          = useState('');
  const [cogsOutlierOnly, setCogsOutlierOnly] = useState(false);
  const [sortKey,         setSortKey]         = useState<SortKey>('gross_sales');
  const [sortDir,         setSortDir]         = useState<'asc' | 'desc'>('desc');
  const [collapsed,       setCollapsed]       = useState<Record<string, boolean>>({});
  const [menuGroupFilter, setMenuGroupFilter] = useState('__ALL__');
  // Which levels of the hierarchy to show, mirroring Toast's "Menu hierarchy"
  // control. Items/Open items/Modifiers default on; Special requests (free text
  // a guest typed, which Toast records as a modifier with no option group) is
  // off by default because it is thousands of one-off strings.
  const [showItems,     setShowItems]     = useState(true);
  const [showOpenItems, setShowOpenItems] = useState(true);
  const [showModifiers, setShowModifiers] = useState(true);
  const [showSpecial,   setShowSpecial]   = useState(false);
  const [hierOpen,      setHierOpen]      = useState(false);
  // Item rows start COLLAPSED (the group levels above default open) — with
  // modifiers on, expanding every item at once would render tens of thousands
  // of rows. Keyed the same way the row itself is.
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});
  const itemKeyOf = (i: ItemRowX, cat: string) => {
    return `${i.canonical_name}||${i.channel}||${cat}||${itemSub(i)}`;
  };
  const toggleItem = (k: string) => setExpandedItems(e => ({ ...e, [k]: !e[k] }));

  // parent item|channel → its modifiers, ordered biggest first.
  //
  // Rows arrive one per location (they have to, so the location filter can apply
  // to them), so they MUST be summed back together here — otherwise one modifier
  // renders once per store, e.g. Chicken Tikka appearing four times at 507/391/
  // 357/260 instead of once at 1,515. Avg price is recomputed from the combined
  // totals rather than averaged, since averaging per-location averages would
  // weight a quiet store the same as a busy one.
  const modifiersByItem = useMemo(() => {
    const combined = new Map<string, ItemModifierRow>();
    itemModifiers.forEach(r => {
      if (r.is_special_request && !showSpecial) return;
      if (!r.is_special_request && !showModifiers) return;
      const key = `${r.parent_item}|${r.channel}|${r.modifier_name}`;
      const ex  = combined.get(key);
      if (!ex) {
        combined.set(key, { ...r });
      } else {
        ex.qty         += r.qty;
        ex.gross_sales += r.gross_sales;
        ex.option_group = ex.option_group ?? r.option_group;
      }
    });

    const m = new Map<string, ItemModifierRow[]>();
    combined.forEach(r => {
      r.gross_sales = Math.round(r.gross_sales * 100) / 100;
      r.avg_price   = r.qty > 0 ? Math.round((r.gross_sales / r.qty) * 100) / 100 : 0;
      const key = `${r.parent_item}|${r.channel}`;
      const arr = m.get(key);
      if (arr) arr.push(r); else m.set(key, [r]);
    });
    m.forEach(arr => arr.sort((a, b) => b.qty - a.qty));
    return m;
  }, [itemModifiers, showModifiers, showSpecial]);

  const itemsWithModifiers = useMemo((): ItemRowX[] =>
    items.map(i => ({ ...i, modifiers: modifiersByItem.get(`${i.canonical_name}|${i.channel}`) ?? [] })),
  [items, modifiersByItem]);

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

  // "canonical_name|channel" → Catering Pink Sheet's already-computed final avg
  // cost (base + modifier cost) — admin/tester-only catering channels. Owner
  // request 2026-08-03: bring these 4 channels up to the same base+modifier
  // standard as IH/Online, instead of the bare r365 item cost they use today.
  // NOTE: unlike fcMap, this is not scaled by the location filter — catering
  // Pink Sheets don't have a per-location breakdown yet.
  const catFcMap = useMemo(() => {
    const m = new Map<string, number>();
    cateringPinkSheets.forEach(r => m.set(`${r.canonical_name}|${r.channel}`, r.avg_cost));
    return m;
  }, [cateringPinkSheets]);

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
    // CATERING / CATERING_3PD / OFFSITE / OPEN_ITEMS: Catering Pink Sheet cost
    // (base + modifier, same standard as IH/Online) first, r365 bare item cost
    // as fallback when the Pink Sheet has none — same two-tier cascade as
    // IH/Online above. No fallback to IH/other channels — a Catering row's
    // cost must come from Catering's own data, never guessed from another
    // channel's cost.
    if (item.channel === 'CATERING') {
      const cfc = catFcMap.get(`${item.canonical_name}|catering`);
      if (cfc && cfc > 0) return cfc;
      const ic = icMap.get(key);
      return ic && ic.catering_cost > 0 ? ic.catering_cost : undefined;
    }
    if (item.channel === 'CATERING_3PD') {
      const cfc = catFcMap.get(`${item.canonical_name}|catering_3pd`);
      if (cfc && cfc > 0) return cfc;
      const ic = icMap.get(key);
      return ic && ic.catering_3pd_cost > 0 ? ic.catering_3pd_cost : undefined;
    }
    if (item.channel === 'OFFSITE') {
      const cfc = catFcMap.get(`${item.canonical_name}|offsite`);
      if (cfc && cfc > 0) return cfc;
      const ic = icMap.get(key);
      return ic && ic.offsite_cost > 0 ? ic.offsite_cost : undefined;
    }
    if (item.channel === 'EZCATER') {
      const cfc = catFcMap.get(`${item.canonical_name}|ezcater`);
      if (cfc && cfc > 0) return cfc;
      const ic = icMap.get(key);
      return ic && ic.ezcater_cost > 0 ? ic.ezcater_cost : undefined;
    }
    if (item.channel === 'OPEN_ITEMS') {
      const cfc = catFcMap.get(`${item.canonical_name}|open`);
      if (cfc && cfc > 0) return cfc;
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
    return itemsWithModifiers.filter(i => {
      // Hierarchy toggles: an open item is a line Toast had no menu entry for
      // (menu_name IS NULL); everything else is a regular menu item.
      if (i.is_open_item ? !showOpenItems : !showItems) return false;
      if (selectedChannels.length > 0 && !selectedChannels.includes(i.channel)) return false;
      if (categoryFilter !== 'all') {
        if (itemCat(i) !== categoryFilter) return false;
      }
      if (menuGroupFilter !== '__ALL__' && (i.menu_group ?? '') !== menuGroupFilter) return false;
      return true;
    });
  }, [itemsWithModifiers, selectedChannels, categoryFilter, menuGroupFilter, showItems, showOpenItems]);

  function matchesSearch(i: ItemRow): boolean {
    const q = search.trim().toLowerCase();
    if (q && !(i.canonical_name.toLowerCase().includes(q) || i.menu_group.toLowerCase().includes(q))) return false;
    if (cogsOutlierOnly) {
      const c = getCogsPct(i);
      if (c == null || (c >= 0.10 && c <= 0.60)) return false;
    }
    return true;
  }

  // Merge rows that share canonical_name + channel + category + sub_category
  // (can arise when the same real item appears under two different raw menu names)
  const dedupedFiltered = useMemo(() => {
    const map = new Map<string, ItemRowX>();
    filtered.forEach(item => {
      const ch  = item.channel;
      const cat = itemCat(item);
      const sub = itemSub(item);
      const key = `${item.canonical_name}|${ch}|${cat}|${sub}`;
      const ex  = map.get(key);
      if (!ex) {
        map.set(key, { ...item });
      } else {
        const qty          = ex.qty          + item.qty;
        const revenue      = ex.revenue      + item.revenue;
        const gross_sales  = ex.gross_sales  + item.gross_sales;
        const refunds      = ex.refunds      + item.refunds;
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
          // Same item arriving under two raw menu names keeps one modifier list.
          modifiers: ex.modifiers.length ? ex.modifiers : item.modifiers,
        });
      }
    });
    return Array.from(map.values());
  }, [filtered]);

  const totalGrossSales = useMemo(() => dedupedFiltered.reduce((s, i) => s + i.gross_sales, 0), [dedupedFiltered]);

  // What the caption reports: distinct dishes vs rows actually drawn. They differ
  // because a dish gets a row per channel it sold in — reporting only the row
  // count as "items" invited the comparison against the Overview header's item
  // count, which is a genuinely different figure (owner request 2026-09-28).
  const visibleCounts = useMemo(() => {
    const rows = (search.trim() || cogsOutlierOnly)
      ? dedupedFiltered.filter(matchesSearch)
      : dedupedFiltered;
    return { rows: rows.length, items: new Set(rows.map(r => r.canonical_name)).size };
  }, [dedupedFiltered, search, cogsOutlierOnly]);

  // Category-level gross-sales totals, for Mix % Revenue by Category.
  const catTotals = useMemo(() => {
    const gross = new Map<string, number>();
    dedupedFiltered.forEach(i => {
      const cat = itemCat(i);
      gross.set(cat, (gross.get(cat) ?? 0) + i.gross_sales);
    });
    return { gross };
  }, [dedupedFiltered]);

  // Item-level totals across every channel currently in view — the denominator
  // for Mix % (Qty). A row is one item in one channel; this sums that same item's
  // qty across ALL of its channels, so item.qty / itemQtyTotals.get(name) answers
  // "what share of this item's total sales happened in this channel?" (owner
  // confirmed 2026-10-01, replacing the old category-total denominator, which
  // mismatched a single-channel numerator against an all-channel category sum).
  const itemQtyTotals = useMemo(() => {
    const m = new Map<string, number>();
    dedupedFiltered.forEach(i => m.set(i.canonical_name, (m.get(i.canonical_name) ?? 0) + i.qty));
    return m;
  }, [dedupedFiltered]);


  // Tree: channel → category → subCategory → items
  const tree = useMemo(() => {
    const out: Record<string, Record<string, Record<string, ItemRowX[]>>> = {};
    dedupedFiltered.forEach(i => {
      const ch  = i.channel;
      const cat = itemCat(i);
      const sub = itemSub(i);
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
      // gross_mix/gross_mix_all's denominator (category or grand total) is constant
      // across the group being sorted, so sorting by the raw figure gives an
      // identical order without recomputing the %. qty_mix's denominator is now
      // per-ITEM (itemQtyTotals, see above), which varies within the group, so it
      // has to compute the actual ratio rather than reuse that shortcut.
      if (sortKey === 'qty_mix') {
        const aQ = itemQtyTotals.get(a.canonical_name) ?? 0;
        const bQ = itemQtyTotals.get(b.canonical_name) ?? 0;
        const aMix = aQ > 0 ? a.qty / aQ : 0;
        const bMix = bQ > 0 ? b.qty / bQ : 0;
        return mul * (bMix - aMix);
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
  const COL = 13; // total columns

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
          rows.forEach(item => {
            if (!matchesSearch(item)) return;
            tableRows.push(renderItemRow(item, cat));
            if (expandedItems[itemKeyOf(item, cat)]) {
              renderModifierRows(item, cat).forEach(r => tableRows.push(r));
            }
          });
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
        rows.forEach(item => {
          if (!matchesSearch(item)) return;
          tableRows.push(renderItemRow(item, cat));
          if (expandedItems[itemKeyOf(item, cat)]) {
            renderModifierRows(item, cat).forEach(r => tableRows.push(r));
          }
        });
      });
    });
  });

  // Modifiers shown beneath the item they were ordered on, matching Toast's
  // Product Mix. Display-only: only the columns that mean something for a
  // modifier are filled (qty, gross, avg price); the rest stay blank rather than
  // showing a zero that reads like real data. Nothing here feeds any total.
  function renderModifierRows(item: ItemRowX, cat: string): React.ReactNode[] {
    if (!item.modifiers.length) return [];
    const sub = itemSub(item);
    const blank = <td style={{ color: 'var(--muted)' }}>—</td>;
    return item.modifiers.map(m => (
      <tr key={`mod||${item.canonical_name}||${item.channel}||${cat}||${sub}||${m.modifier_name}`}
          style={{ background: 'var(--card)' }}>
        <td style={{ paddingLeft: 96, fontSize: 11, color: 'var(--muted)' }}>
          {m.is_special_request && (
            <span style={{
              display: 'inline-block', background: '#f3f4f6', color: '#6b7280', borderRadius: 3,
              padding: '0 4px', fontSize: 8, fontWeight: 700, marginRight: 5, verticalAlign: 'middle',
            }}>REQ</span>
          )}
          {m.modifier_name}
        </td>
        <td style={{ fontSize: 9, color: 'var(--muted)' }}>{m.option_group ?? ''}</td>
        <td style={{ textAlign: 'center', fontSize: 11, color: 'var(--muted)' }}>{m.qty.toLocaleString()}</td>
        {blank}
        <td style={{ textAlign: 'right', fontSize: 11, color: 'var(--muted)' }}>
          {m.gross_sales > 0 ? fmt$2(m.gross_sales) : '—'}
        </td>
        {blank}{blank}{blank}{blank}{blank}
        <td style={{ textAlign: 'right', fontSize: 11, color: 'var(--muted)' }}>
          {m.avg_price > 0 ? fmt$2(m.avg_price) : '—'}
        </td>
        {blank}{blank}
      </tr>
    ));
  }

  function renderItemRow(item: ItemRowX, cat: string): React.ReactNode {
    const itemQ    = itemQtyTotals.get(item.canonical_name) ?? 0;
    const catG     = catTotals.gross.get(cat) ?? 0;
    const qtyMix     = itemQ > 0 ? (item.qty         / itemQ * 100) : 0;
    const grossMix   = catG > 0 ? (item.gross_sales  / catG * 100) : 0;
    const grossMixAll = totalGrossSales > 0 ? (item.gross_sales / totalGrossSales * 100) : 0;
    // Same uniqueness key dedupedFiltered already guarantees (canonical_name +
    // channel + category + sub_category) — menu_name/menu_group alone can repeat
    // across different channels for the same item, causing duplicate React keys.
    const sub      = itemSub(item);
    const avgCost  = getAvgCost(item);
    const cogsPct  = getCogsPct(item);
    const key      = itemKeyOf(item, cat);
    const hasMods  = item.modifiers.length > 0;
    const expanded = !!expandedItems[key];
    return (
      <tr key={`${item.canonical_name}||${item.channel}||${cat}||${sub}`}
          onClick={hasMods ? () => toggleItem(key) : undefined}
          style={hasMods ? { cursor: 'pointer' } : undefined}>
        <td style={{ paddingLeft: hasMods ? 46 : 60, fontWeight: 500 }}>
          {hasMods && (
            <span style={{
              marginRight: 5, display: 'inline-block', fontSize: 8,
              transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform .15s',
              color: 'var(--muted)',
            }}>▶</span>
          )}
          {item.canonical_name}
        </td>
        <td style={{ fontSize: 10, color: 'var(--muted)' }}>{item.menu_group}</td>
        <td style={{ textAlign: 'center' }}>{item.qty.toLocaleString()}</td>
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

  // Admin/tester-only export — every currently filtered/searched row (ignores
  // collapse state, which has no meaning in a flat CSV), same columns/values
  // as the table, same sort order as currently displayed.
  function exportCsv() {
    const header = [
      'item', 'channel', 'category', 'sub_category', 'menu_group', 'qty',
      'qty_mix_pct', 'gross_sales', 'gross_mix_pct', 'net_sales', 'refunds',
      'net_after_refunds', 'gross_mix_all_pct', 'avg_price', 'avg_cost', 'cogs_pct',
    ];
    const rowsOut = sortedItems(dedupedFiltered.filter(matchesSearch)).map(item => {
      const cat = itemCat(item);
      const itemQ = itemQtyTotals.get(item.canonical_name) ?? 0;
      const catG = catTotals.gross.get(cat) ?? 0;
      const qtyMix = itemQ > 0 ? (item.qty / itemQ * 100) : 0;
      const grossMix = catG > 0 ? (item.gross_sales / catG * 100) : 0;
      const grossMixAll = totalGrossSales > 0 ? (item.gross_sales / totalGrossSales * 100) : 0;
      const avgCost = getAvgCost(item);
      const cogsPct = getCogsPct(item);
      return [
        item.canonical_name, item.channel, cat, item.sub_category || '', item.menu_group, item.qty,
        Math.round(qtyMix * 10) / 10, Math.round(item.gross_sales * 100) / 100,
        Math.round(grossMix * 10) / 10, Math.round(item.revenue * 100) / 100,
        Math.round(item.refunds * 100) / 100, Math.round(item.net_after_refunds * 100) / 100,
        Math.round(grossMixAll * 10) / 10, Math.round(item.avg_price * 100) / 100,
        avgCost != null ? Math.round(avgCost * 100) / 100 : null,
        cogsPct != null ? Math.round(cogsPct * 1000) / 10 : null,
      ];
    });
    downloadCsv('item_mix.csv', header, rowsOut);
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
        {/* Menu hierarchy — which levels of the tree to render, mirroring Toast's
            Product Mix control so the two read the same way. */}
        <div className="drw" style={{ position: 'relative' }}>
          <button className="drb" onClick={() => setHierOpen(o => !o)} style={{ minWidth: 150 }}>
            Menu hierarchy
            <i className="ti ti-chevron-down" style={{ fontSize: 11, marginLeft: 4 }} />
          </button>
          {hierOpen && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 199 }} onClick={() => setHierOpen(false)} />
              <div className="drm open" style={{ minWidth: 230, zIndex: 200 }}>
                {([
                  ['Items',           showItems,     setShowItems,     ''],
                  ['Open items',      showOpenItems, setShowOpenItems, ''],
                  ['Modifiers',       showModifiers, setShowModifiers, ''],
                  ['Special requests', showSpecial,  setShowSpecial,   'Free text a guest typed on the order — Toast records it as a modifier with no group'],
                ] as const).map(([label, val, set, hint]) => (
                  <label key={label} className="dr-it" style={{ gap: 8, userSelect: 'none', alignItems: 'flex-start' }}>
                    <input type="checkbox" checked={val}
                      onChange={() => (set as (v: boolean) => void)(!val)}
                      style={{ accentColor: 'var(--accent)', marginTop: 2 }} />
                    <span>
                      {label}
                      {hint && <div style={{ fontSize: 9, color: 'var(--muted)', lineHeight: 1.3 }}>{hint}</div>}
                    </span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
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
        <button
          className="drb"
          onClick={() => setCogsOutlierOnly(v => !v)}
          title="Show only items with COGS% under 10% or over 60%"
          style={{
            minWidth: 0, padding: '4px 10px', fontSize: 11, fontWeight: 600,
            background: cogsOutlierOnly ? '#dc2626' : undefined,
            color: cogsOutlierOnly ? '#fff' : undefined,
            borderColor: cogsOutlierOnly ? '#dc2626' : undefined,
          }}
        >
          COGS Outliers
        </button>
        <span
          style={{ fontSize: 10, color: 'var(--muted)' }}
          title="A dish appears once per channel it sold in, so the table draws more rows than there are distinct items. The item count is the same figure the Overview header and Location Compare report."
        >
          {visibleCounts.items} items · {visibleCounts.rows} rows
        </span>
        {isAdmin && (
          <button className="drb" onClick={exportCsv}
            title="Download every currently filtered/searched row as CSV"
            style={{ minWidth: 0, padding: '4px 10px', fontSize: 11 }}>
            ⬇ Export CSV
          </button>
        )}
      </div>

      <div className="tw">
        <div className="tscroll">
          <table style={{ tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '16%' }} />
              <col style={{ width: '7%' }} />
              <col style={{ width: '5%' }} />
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
                {thSort('qty_mix', 'Mix % (Qty)', "This channel's qty ÷ this item's total qty across every channel in view — i.e. what share of the item's own sales happened in this channel")}
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
