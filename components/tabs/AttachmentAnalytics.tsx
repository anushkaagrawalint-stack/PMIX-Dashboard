'use client';
import { Fragment, useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  LineChart, Line, Legend,
} from 'recharts';
import type { AttachmentData, AttachmentTrendData, LocationRow, ItemRow, BeverageModifierRow, FiscalPeriodRow } from '@/lib/types';
import type { Role } from '@/lib/auth';
import { CHANNEL_LABEL } from '@/lib/constants';
import { fiscalWeekLabel } from '@/lib/fiscal';

const fmtInt = (v: number) => v.toLocaleString();
const fmtPct = (v: number) => `${v.toFixed(2)}%`;
const fmtUsd = (v: number) => `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const CATEGORIES = ['Main', 'Sweet', 'Side', 'Drink'] as const;
// Main is excluded from the category-checks KPI row — it's always exactly
// 100% of Total Main Checks by definition (that KPI card already covers it),
// so showing it again here would just be a redundant, tautological card.
const ATTACH_CATEGORIES = ['Sweet', 'Side', 'Drink'] as const;
// Measured height of one thead row (9px font + 7px/7px padding + 1px border,
// see .tscroll thead th in globals.css) — the "Number of Attaches" table has a
// two-row header (location name, then its 5 sub-columns), so the second row's
// sticky offset must sit below the first row instead of overlapping it at top:0.
const HEADER_ROW_H = 28;
const CAT_COLOR: Record<string, string> = { Drink: '#2563eb', Sweet: '#c9832e', Side: '#10b981', Main: '#8b5cf6' };

// Entree Mix / Beverages sections scope to In-House + APP + 3PD only —
// catering/offsite/open-items/3PD Markup are all out of scope for this report
// (owner request — 3PD Markup isn't a platform they want to see here).
const ENTREE_CHANNELS = [
  { code: 'IN_HOUSE', label: 'In-House' },
  { code: 'APP',      label: 'RASA Digital' },
  { code: 'TPD',      label: '3PD' },
] as const;
type EntreeChannelCode = typeof ENTREE_CHANNELS[number]['code'];
const ENTREE_CHANNEL_SET = new Set<string>(ENTREE_CHANNELS.map(c => c.code));

const SUB_CAT_LABEL: Record<string, string> = { Bowl: 'Bowls', Plates: 'Plates', Burrito: 'Burritos', 'Kids Meal': 'Kids' };
const SUB_CAT_ORDER = ['Bowl', 'Plates', 'Burrito', 'Kids Meal'];

// Unified Item Mix — one table switchable between Entree/Drink/Side/Sweet via
// dropdown. Drink includes both NA and Alc Drinks (a "make it a meal" pick
// can be either). Category roll-up (Bowls/Plates/Burritos/Kids) only applies
// to Entree — the other three don't have an equivalent sub-bucket grouping.
const MIX_TYPES = ['Entree', 'Drink', 'Side', 'Sweet'] as const;
type MixType = typeof MIX_TYPES[number];
const MIX_TYPE_ITEM_CATEGORIES: Record<MixType, string[]> = {
  Entree: ['Entrees'],
  Drink:  ['NA Drinks', 'Alc Drinks'],
  Side:   ['Sides'],
  Sweet:  ['Sweets'],
};

interface MixRow { name: string; asItem: number; asModifier: number; total: number; pct: number; revenue: number; revPct: number; }

// mul=1 (default, first click) sorts descending for numbers and Z→A for text;
// mul=-1 (second click) sorts ascending / A→Z — same convention for every table.
function cmp(a: string | number, b: string | number, mul: number): number {
  if (typeof a === 'string' && typeof b === 'string') return mul === 1 ? b.localeCompare(a) : a.localeCompare(b);
  return mul * ((b as number) - (a as number));
}

interface MergedRow { name: string; checksItem: number; checksMod: number; totals: number; rate: number; }
interface CatItemRow { category: string; name: string; checksWith: number; rate: number; }

function csvDownload(filename: string, headers: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Same visual pattern as Overview.tsx's DeltaBadge (kept as a local copy since
// that one isn't exported) — up=green when positiveGood, "vs {label}" suffix.
function DeltaBadge({ curr, prev, vsLabel }: { curr: number; prev: number | undefined; vsLabel: string | null }) {
  if (!prev) return null;
  const diff = curr - prev;
  const pct  = (diff / Math.abs(prev)) * 100;
  const up   = pct >= 0;
  const color = up ? '#16a34a' : '#dc2626';
  const vs    = vsLabel ? `vs ${vsLabel}` : 'vs prev';
  return (
    <div style={{ fontSize: 10, fontWeight: 600, marginTop: 1, color }}>
      {up ? '↑' : '↓'} {Math.abs(pct).toFixed(1)}% {vs}
    </div>
  );
}

// Aggregates one AttachmentData bundle down to mainChecks / category totals /
// the merged (item+modifier) report, for any (location, channel) predicate —
// reused for the current period, the prev period, and per-location slices.
function aggregate(ad: AttachmentData, filter: (loc: string, ch: string) => boolean) {
  let mainChecks = 0;
  for (const b of ad.buckets) if (filter(b.location_code, b.channel)) mainChecks += b.main_checks;

  const catMap = new Map<string, number>();
  for (const c of ad.categoryChecks) if (filter(c.location_code, c.channel)) catMap.set(c.category, (catMap.get(c.category) ?? 0) + c.checks);

  const catModMap = new Map<string, number>();
  for (const c of ad.categoryModChecks) if (filter(c.location_code, c.channel)) catModMap.set(c.category, (catModMap.get(c.category) ?? 0) + c.checks);

  const catItemMap = new Map<string, { category: string; checksWith: number }>();
  for (const r of ad.items) {
    if (!filter(r.location_code, r.channel)) continue;
    const key = `${r.category}||${r.item}`;
    const existing = catItemMap.get(key);
    if (existing) existing.checksWith += r.checks_with;
    else catItemMap.set(key, { category: r.category, checksWith: r.checks_with });
  }
  const itemMap = new Map<string, number>();
  const itemCategoryMap = new Map<string, string>();
  for (const [key, v] of catItemMap) {
    const name = key.split('||')[1];
    itemMap.set(name, (itemMap.get(name) ?? 0) + v.checksWith);
    itemCategoryMap.set(name, v.category);
  }

  const modMap = new Map<string, number>();
  for (const r of ad.modifiers) if (filter(r.location_code, r.channel)) modMap.set(r.modifier, (modMap.get(r.modifier) ?? 0) + r.checks_with);

  // Only names that are actual Main/Sweet/Side/Drink items get a row — a
  // modifier never gets its own attachment row, its checks just merge into
  // the item's totals when the names happen to match.
  const merged: MergedRow[] = [...itemMap.keys()].map(name => {
    const checksItem = itemMap.get(name) ?? 0;
    const checksMod   = modMap.get(name) ?? 0;
    const totals      = checksItem + checksMod;
    return { name, checksItem, checksMod, totals, rate: mainChecks ? (totals / mainChecks) * 100 : 0 };
  }).sort((a, b) => b.totals - a.totals);

  const catItems: CatItemRow[] = [...catItemMap.entries()].map(([key, v]) => ({
    category: v.category, name: key.split('||')[1], checksWith: v.checksWith,
    rate: mainChecks ? (v.checksWith / mainChecks) * 100 : 0,
  })).sort((a, b) => a.category.localeCompare(b.category) || b.checksWith - a.checksWith);

  // "Total attachment" (and the rate derived from it) is a true up-sell
  // measure — a Main item recurring on a check isn't an attach, it's just
  // another entree, so Main is excluded from this sum (owner request 2026-07-14).
  // Individual Main rows in `merged` are untouched; only this aggregate excludes them.
  const totalAttach = merged
    .filter(r => itemCategoryMap.get(r.name) !== 'Main')
    .reduce((s, r) => s + r.totals, 0);
  const overallRate = mainChecks ? (totalAttach / mainChecks) * 100 : 0;

  return { mainChecks, catMap, catModMap, merged, catItems, totalAttach, overallRate };
}

export default function AttachmentAnalytics({
  data, prevData, prevLabel, trendData, locations, selectedLocations, selectedChannels, items, beverageModifiers, role, periods,
}: {
  data: AttachmentData;
  prevData: AttachmentData | null;
  prevLabel: string | null;
  trendData: AttachmentTrendData;
  locations: LocationRow[];
  selectedLocations: string[];
  selectedChannels: string[];
  items: ItemRow[];
  beverageModifiers: BeverageModifierRow[];
  role: Role;
  periods: FiscalPeriodRow[];
}) {
  const showExport = role !== 'user';
  const [tableCategory, setTableCategory] = useState('');
  const [tableSearch, setTableSearch]     = useState('');
  const [tableLimit, setTableLimit]       = useState<10 | 25 | 50 | 100 | 'all'>(25);
  const [tableMode, setTableMode]         = useState<'percent' | 'detail'>('percent');
  const [tableBreakdown, setTableBreakdown] = useState<'location' | 'channel' | 'overall'>('location');
  const [tableSortCol, setTableSortCol]   = useState<string>('overall');
  const [tableSortDir, setTableSortDir]   = useState<'desc' | 'asc'>('desc');
  const [breakdownView, setBreakdownView] = useState<'location' | 'channel' | 'overall'>('location');
  const [bdSortCol, setBdSortCol]         = useState<string>('rate');
  const [bdSortDir, setBdSortDir]         = useState<'desc' | 'asc'>('desc');

  const locName = (code: string) => locations.find(l => l.location_code === code)?.display_name ?? code;

  const bucketMatches = (loc: string, ch: string) =>
    (selectedLocations.length === 0 || selectedLocations.includes(loc)) &&
    (selectedChannels.length === 0 || selectedChannels.includes(ch));

  const current = useMemo(() => aggregate(data, bucketMatches), [data, selectedLocations, selectedChannels]);
  const prev = useMemo(() => prevData ? aggregate(prevData, bucketMatches) : null, [prevData, selectedLocations, selectedChannels]);

  const totalMainChecks = current.mainChecks;
  const merged   = current.merged;
  const distinctNames = merged.length;

  const highest = merged[0];
  const prevHighestRate = highest && prev ? prev.merged.find(r => r.name === highest.name)?.rate : undefined;

  // Best performing location: highest overall attachment rate among locations
  // currently in scope, respecting the channel filter but ignoring the location
  // filter (the whole point is comparing across locations).
  const locStats = useMemo(() => {
    const codes = [...new Set(data.buckets.map(b => b.location_code))];
    return codes.map(code => {
      const filter = (l: string, ch: string) => l === code && (selectedChannels.length === 0 || selectedChannels.includes(ch));
      const agg = aggregate(data, filter);
      const prevAgg = prevData ? aggregate(prevData, filter) : null;
      return { code, mainChecks: agg.mainChecks, rate: agg.overallRate, prevRate: prevAgg?.overallRate };
    }).filter(s => s.mainChecks > 0);
  }, [data, prevData, selectedChannels]);
  const bestLocation = [...locStats].sort((a, b) => b.rate - a.rate)[0];

  // Per-location Drink/Side/Sweet + Overall breakdown for the chart below —
  // built the same way as `breakdownRows`' location mode (buildBreakdownRow,
  // defined further down — function declarations hoist, so this is safe),
  // but independent of the `breakdownView` toggle so this chart always shows
  // every location regardless of which view the table below is set to.
  // Ignores the location filter (so every location stays comparable) but
  // respects the channel filter, same convention as `locStats` above.
  const locationChartData = useMemo(() => {
    const codes = [...new Set(data.buckets.map(b => b.location_code))];
    return codes
      .map(code => buildBreakdownRow(code, locName(code),
        (l, ch) => l === code && (selectedChannels.length === 0 || selectedChannels.includes(ch))))
      .filter(r => r.mainChecks > 0)
      .sort((a, b) => b.rate - a.rate);
  }, [data, prevData, selectedChannels, locations]);

  // Unified location/channel/overall breakdown table — one row per location,
  // per channel, or a single combined row, depending on `breakdownView`. Each
  // row carries its own Drink/Side/Sweet rate (via catMap, already item+modifier
  // merged — see aggregate()) alongside the blended Overall rate, so there's no
  // need for three separate tables.
  interface BreakdownRow {
    code: string; name: string; mainChecks: number; totalAttach: number;
    drinkRate: number; sideRate: number; sweetRate: number; rate: number; prevRate?: number;
  }
  function buildBreakdownRow(code: string, name: string, filter: (l: string, ch: string) => boolean): BreakdownRow {
    const agg = aggregate(data, filter);
    const prevAgg = prevData ? aggregate(prevData, filter) : null;
    const catRate = (cat: string) => agg.mainChecks ? ((agg.catMap.get(cat) ?? 0) / agg.mainChecks) * 100 : 0;
    return {
      code, name, mainChecks: agg.mainChecks, totalAttach: agg.totalAttach,
      drinkRate: catRate('Drink'), sideRate: catRate('Side'), sweetRate: catRate('Sweet'),
      rate: agg.overallRate, prevRate: prevAgg?.overallRate,
    };
  }
  const breakdownRows = useMemo(() => {
    let rows: BreakdownRow[];
    if (breakdownView === 'overall') {
      rows = [buildBreakdownRow('overall', 'Overall', bucketMatches)];
    } else if (breakdownView === 'channel') {
      const inScope = selectedChannels.length > 0
        ? selectedChannels
        : [...new Set(data.buckets.map(b => b.channel))];
      rows = inScope.map(ch => buildBreakdownRow(ch, CHANNEL_LABEL[ch] ?? ch,
        (l, c) => c === ch && (selectedLocations.length === 0 || selectedLocations.includes(l))));
    } else {
      const inScope = selectedLocations.length > 0
        ? selectedLocations
        : [...new Set(data.buckets.map(b => b.location_code))];
      rows = inScope.map(code => buildBreakdownRow(code, locName(code),
        (l, ch) => l === code && (selectedChannels.length === 0 || selectedChannels.includes(ch))));
    }
    return rows.sort((a, b) => {
      const mul = bdSortDir === 'asc' ? -1 : 1;
      const key = bdSortCol as keyof BreakdownRow;
      return cmp(a[key] as string | number, b[key] as string | number, mul);
    });
  }, [data, prevData, selectedLocations, selectedChannels, breakdownView, bdSortCol, bdSortDir]);

  function handleBdSort(col: string) {
    if (bdSortCol === col) setBdSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setBdSortCol(col); setBdSortDir('desc'); }
  }
  const bdSortArrow = (col: string) => bdSortCol === col ? (bdSortDir === 'desc' ? ' ↓' : ' ↑') : '';
  const breakdownLabel = breakdownView === 'channel' ? 'Channel' : breakdownView === 'overall' ? 'Scope' : 'Location';

  // name → category, sourced from the item-side breakdown. Every row in
  // `merged` is by construction a Main/Sweet/Side/Drink item (see aggregate()),
  // so this always resolves — no "Modifier" fallback needed.
  const nameCategory = useMemo(() => {
    const m = new Map<string, string>();
    current.catItems.forEach(r => m.set(r.name, r.category));
    return m;
  }, [current.catItems]);
  const categoryOf = (name: string) => nameCategory.get(name) ?? '';

  // One column-group per in-scope location/channel (or none, in 'overall' mode),
  // so a single name's actual attachment rate (and its underlying counts) can
  // be compared side-by-side, alongside its overall (all-scope) figure — no
  // averaging. Location and Channel modes each ignore their OWN dimension's
  // global filter (so every location/channel stays comparable) but still
  // respect the OTHER dimension's filter — same convention as the summary
  // breakdown table above.
  const tableCols = useMemo(() => {
    if (tableBreakdown === 'overall') {
      // 'Percentage' mode already shows the Overall Rate via the base column
      // (below), so an extra column here would just duplicate it — but
      // 'Number of Attaches' mode has nothing else to expand into a detail
      // breakdown, so it needs this one synthetic "Overall" column group.
      if (tableMode !== 'detail') return [];
      return [{ code: 'overall', label: 'Overall', mainChecks: current.mainChecks,
                rowMap: new Map(current.merged.map(r => [r.name, r])) }];
    }
    if (tableBreakdown === 'channel') {
      const inScope = selectedChannels.length > 0
        ? selectedChannels
        : [...new Set(data.buckets.map(b => b.channel))];
      return inScope.map(code => {
        const filter = (l: string, ch: string) => ch === code && (selectedLocations.length === 0 || selectedLocations.includes(l));
        const agg = aggregate(data, filter);
        const rowMap = new Map(agg.merged.map(r => [r.name, r]));
        return { code, label: CHANNEL_LABEL[code] ?? code, mainChecks: agg.mainChecks, rowMap };
      });
    }
    const inScope = selectedLocations.length > 0
      ? selectedLocations
      : [...new Set(data.buckets.map(b => b.location_code))];
    return inScope.map(code => {
      const filter = (l: string, ch: string) => l === code && (selectedChannels.length === 0 || selectedChannels.includes(ch));
      const agg = aggregate(data, filter);
      const rowMap = new Map(agg.merged.map(r => [r.name, r]));
      return { code, label: locName(code), mainChecks: agg.mainChecks, rowMap };
    });
  }, [data, selectedLocations, selectedChannels, tableBreakdown, tableMode, current]);

  const EMPTY_ROW = { checksItem: 0, checksMod: 0, totals: 0, rate: 0 };

  const chartData = useMemo(() => [...merged].sort((a, b) => b.rate - a.rate).slice(0, 12).reverse(), [merged]);

  // Weekly attach-rate trend within the selected date range — respects the
  // same location/channel filters as everything else on this tab (bucketMatches).
  // "Overall" mirrors aggregate()'s totalAttach/overallRate: Sweet+Side+Drink
  // summed (Main excluded), so a check with two attaches can push it past 100%,
  // same convention as the rest of the tab.
  const weeklyTrend = useMemo(() => {
    const map = new Map<string, { mainChecks: number; drink: number; sweet: number; side: number }>();
    trendData.buckets.forEach(b => {
      if (!bucketMatches(b.location_code, b.channel)) return;
      const e = map.get(b.week_start) ?? { mainChecks: 0, drink: 0, sweet: 0, side: 0 };
      e.mainChecks += b.main_checks;
      map.set(b.week_start, e);
    });
    trendData.categories.forEach(c => {
      if (!bucketMatches(c.location_code, c.channel)) return;
      const e = map.get(c.week_start) ?? { mainChecks: 0, drink: 0, sweet: 0, side: 0 };
      if (c.category === 'Drink') e.drink += c.checks_with;
      else if (c.category === 'Sweet') e.sweet += c.checks_with;
      else if (c.category === 'Side') e.side += c.checks_with;
      map.set(c.week_start, e);
    });
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([week_start, v]) => ({
        week_start,
        label:       fiscalWeekLabel(week_start, periods),
        drinkRate:   v.mainChecks ? (v.drink / v.mainChecks) * 100 : 0,
        sweetRate:   v.mainChecks ? (v.sweet / v.mainChecks) * 100 : 0,
        sideRate:    v.mainChecks ? (v.side  / v.mainChecks) * 100 : 0,
        overallRate: v.mainChecks ? ((v.drink + v.sweet + v.side) / v.mainChecks) * 100 : 0,
        mainChecks:  v.mainChecks,
      }));
  }, [trendData, selectedLocations, selectedChannels, periods]);

  const tableRows = useMemo(() => {
    const q = tableSearch.trim().toLowerCase();
    const mul = tableSortDir === 'asc' ? -1 : 1;
    return merged
      .filter(r => (!q || r.name.toLowerCase().includes(q)) && (!tableCategory || categoryOf(r.name) === tableCategory))
      .map(r => ({
        name: r.name,
        category: categoryOf(r.name),
        overall: r,
        perCol: tableCols.map(l => l.rowMap.get(r.name) ?? EMPTY_ROW),
      }))
      .sort((a, b) => {
        if (tableSortCol === 'category') return cmp(a.category, b.category, mul);
        if (tableSortCol === 'name') return cmp(a.name, b.name, mul);
        if (tableSortCol === 'overall') return cmp(a.overall.rate, b.overall.rate, mul);
        const [colCode, metric] = tableSortCol.split(':');
        const li = tableCols.findIndex(l => l.code === colCode);
        if (li < 0) return 0;
        const val = (row: typeof a) => metric === 'mainChecks'
          ? tableCols[li].mainChecks
          : (row.perCol[li]?.[metric as 'checksItem' | 'checksMod' | 'totals' | 'rate'] ?? 0);
        return cmp(val(a), val(b), mul);
      });
  }, [merged, tableCols, tableSearch, tableCategory, tableSortCol, tableSortDir, nameCategory]);
  const visibleTable = tableLimit === 'all' ? tableRows : tableRows.slice(0, tableLimit);

  function handleTableSort(col: string) {
    if (tableSortCol === col) setTableSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setTableSortCol(col); setTableSortDir('desc'); }
  }
  const tableSortArrow = (col: string) => tableSortCol === col ? (tableSortDir === 'desc' ? ' ↓' : ' ↑') : '';

  function exportTableCsv() {
    const headers = ['Category', 'Item / Modifier', 'Overall Attachment Rate (%)'];
    tableCols.forEach(l => headers.push(`${l.label} Attachment Rate (%)`));
    const rows = tableRows.map(r => [
      r.category, r.name, r.overall.rate.toFixed(2),
      ...r.perCol.map(v => v.rate.toFixed(2)),
    ]);
    csvDownload(`attachment_rate_by_item_and_${tableBreakdown}.csv`, headers, rows);
  }

  // ── Unified Item Mix (Entree / Drink / Side / Sweet) — one table switchable
  // via dropdown, scoped to In-House + APP + 3PD (catering/offsite/open-items
  // excluded). `items` is already location-adjusted by the parent (Dashboard's
  // locationBaseItems, scaled from data.locationItems), so this section is
  // dynamic to the location filter too, same as channel/date. beverageModifiers
  // carries its own exact location_code (unscaled), filtered the same way.
  const namesByMixType = useMemo(() => {
    const m: Record<MixType, Set<string>> = { Entree: new Set(), Drink: new Set(), Side: new Set(), Sweet: new Set() };
    for (const i of items) {
      for (const t of MIX_TYPES) if (MIX_TYPE_ITEM_CATEGORIES[t].includes(i.category)) m[t].add(i.canonical_name);
    }
    return m;
  }, [items]);

  const [mixType, setMixType]         = useState<MixType>('Entree');
  const [mixPlatform, setMixPlatform] = useState<'ALL' | EntreeChannelCode>('ALL');
  const [mixSortCol, setMixSortCol]   = useState<keyof MixRow>('total');
  const [mixSortDir, setMixSortDir]   = useState<'desc' | 'asc'>('desc');

  const mixItemsInScope = useMemo(() => {
    const cats = MIX_TYPE_ITEM_CATEGORIES[mixType];
    return items.filter(i =>
      cats.includes(i.category) && ENTREE_CHANNEL_SET.has(i.channel) &&
      (selectedChannels.length === 0 || selectedChannels.includes(i.channel))
    );
  }, [items, mixType, selectedChannels]);

  const mixModifiersInScope = useMemo(() => {
    const names = namesByMixType[mixType];
    return beverageModifiers.filter(r =>
      names.has(r.name) && ENTREE_CHANNEL_SET.has(r.channel) &&
      (selectedChannels.length === 0 || selectedChannels.includes(r.channel)) &&
      (selectedLocations.length === 0 || selectedLocations.includes(r.location_code))
    );
  }, [beverageModifiers, namesByMixType, mixType, selectedChannels, selectedLocations]);

  // Category roll-up (Bowls/Plates/Burritos/Kids) — Entree only.
  const entreeTotals = useMemo(() => {
    if (mixType !== 'Entree') return { qty: 0, revenue: 0 };
    let qty = 0, revenue = 0;
    for (const i of mixItemsInScope) { qty += i.qty; revenue += i.revenue; }
    return { qty, revenue };
  }, [mixItemsInScope, mixType]);

  const categoryRollup = useMemo(() => {
    if (mixType !== 'Entree') return [];
    const m = new Map<string, { qty: number; revenue: number }>();
    for (const i of mixItemsInScope) {
      const key = i.sub_category || 'Other';
      const e = m.get(key) ?? { qty: 0, revenue: 0 };
      e.qty += i.qty; e.revenue += i.revenue;
      m.set(key, e);
    }
    return [...m.entries()]
      .map(([subCat, v]) => ({
        subCat, label: SUB_CAT_LABEL[subCat] ?? subCat, qty: v.qty, revenue: v.revenue,
        pct: entreeTotals.qty ? (v.qty / entreeTotals.qty) * 100 : 0,
      }))
      .sort((a, b) => {
        const ai = SUB_CAT_ORDER.indexOf(a.subCat), bi = SUB_CAT_ORDER.indexOf(b.subCat);
        if (ai === -1 && bi === -1) return b.qty - a.qty;
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      });
  }, [mixItemsInScope, entreeTotals, mixType]);

  const mixRows = useMemo((): MixRow[] => {
    const items_ = mixPlatform === 'ALL' ? mixItemsInScope : mixItemsInScope.filter(i => i.channel === mixPlatform);
    const mods_  = mixPlatform === 'ALL' ? mixModifiersInScope : mixModifiersInScope.filter(r => r.channel === mixPlatform);
    const m = new Map<string, { asItem: number; asModifier: number; revenue: number }>();
    for (const i of items_) {
      const e = m.get(i.canonical_name) ?? { asItem: 0, asModifier: 0, revenue: 0 };
      e.asItem += i.qty; e.revenue += i.revenue;
      m.set(i.canonical_name, e);
    }
    for (const r of mods_) {
      const e = m.get(r.name) ?? { asItem: 0, asModifier: 0, revenue: 0 };
      e.asModifier += r.qty;
      m.set(r.name, e);
    }
    const totalQty = [...m.values()].reduce((s, v) => s + v.asItem + v.asModifier, 0);
    const totalRev = [...m.values()].reduce((s, v) => s + v.revenue, 0);
    const rows = [...m.entries()].map(([name, v]) => {
      const total = v.asItem + v.asModifier;
      return {
        name, asItem: v.asItem, asModifier: v.asModifier, total,
        pct: totalQty ? (total / totalQty) * 100 : 0,
        revenue: v.revenue,
        revPct: totalRev ? (v.revenue / totalRev) * 100 : 0,
      };
    });
    const mul = mixSortDir === 'asc' ? -1 : 1;
    return rows.sort((a, b) => cmp(a[mixSortCol], b[mixSortCol], mul));
  }, [mixItemsInScope, mixModifiersInScope, mixPlatform, mixSortCol, mixSortDir]);

  // KPI cards for the unified section — recompute from mixRows, so they're
  // dynamic to the category dropdown, the platform toggle, and (via mixRows'
  // inputs) the global channel/location/date filters.
  const mixKpis = useMemo(() => {
    const qty     = mixRows.reduce((s, r) => s + r.total, 0);
    const revenue = mixRows.reduce((s, r) => s + r.revenue, 0);
    const top     = [...mixRows].sort((a, b) => b.total - a.total)[0];
    return { qty, revenue, top, distinct: mixRows.length };
  }, [mixRows]);

  function handleMixSort(col: keyof MixRow) {
    if (mixSortCol === col) setMixSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setMixSortCol(col); setMixSortDir('desc'); }
  }
  const mixSortArrow = (col: keyof MixRow) => mixSortCol === col ? (mixSortDir === 'desc' ? ' ↓' : ' ↑') : '';

  function exportMixCsv() {
    const headers = ['Item', 'As Item', 'As Modifier', 'Total Qty', '% of Qty', 'Revenue', '% of Revenue'];
    const rows = mixRows.map(r => [r.name, r.asItem, r.asModifier, r.total, r.pct.toFixed(1), r.revenue.toFixed(2), r.revPct.toFixed(1)]);
    csvDownload(`${mixType.toLowerCase()}_mix.csv`, headers, rows);
  }

  return (
    <div>
      {/* ── Headline KPI cards ── */}
      <div className="krow k4">
        <div className="kc a">
          <div className="kl">Total Main Checks</div>
          <div className="kv">{fmtInt(totalMainChecks)}</div>
          <div className="ks">Checks with ≥1 main item — denominator for the attachment rate</div>
          <DeltaBadge curr={totalMainChecks} prev={prev?.mainChecks} vsLabel={prevLabel} />
        </div>
        <div className="kc b">
          <div className="kl">Highest Attachment</div>
          <div className="kv" style={{ fontSize: 16 }}>{highest ? highest.name : '—'}</div>
          <div className="ks">{highest ? `${fmtPct(highest.rate)} attachment rate` : 'No data'}</div>
          {highest && <DeltaBadge curr={highest.rate} prev={prevHighestRate} vsLabel={prevLabel} />}
        </div>
        <div className="kc p">
          <div className="kl">Best Performing Location</div>
          <div className="kv" style={{ fontSize: 16 }}>{bestLocation ? locName(bestLocation.code) : '—'}</div>
          <div className="ks">{bestLocation ? `${fmtPct(bestLocation.rate)} attachment rate` : 'No data'}</div>
          {bestLocation && <DeltaBadge curr={bestLocation.rate} prev={bestLocation.prevRate} vsLabel={prevLabel} />}
        </div>
        <div className="kc g">
          <div className="kl">Distinct Names</div>
          <div className="kv">{fmtInt(distinctNames)}</div>
          <div className="ks">Unique Main/Sweet/Side/Drink items in the report</div>
        </div>
      </div>

      {/* ── Category breakdown KPI cards ── */}
      <div className="krow k3">
        {ATTACH_CATEGORIES.map(cat => {
          const curr = current.catMap.get(cat) ?? 0;
          const modCurr = current.catModMap.get(cat) ?? 0;
          const prevVal = prev?.catMap.get(cat);
          return (
            <div key={cat} className="kc" style={{ borderLeftColor: CAT_COLOR[cat], borderLeftWidth: 3, borderLeftStyle: 'solid' }}>
              <div className="kl" style={{ color: CAT_COLOR[cat] }}>{cat} Checks</div>
              <div className="kv">{fmtInt(curr)}</div>
              <div className="ks">{totalMainChecks ? fmtPct((curr / totalMainChecks) * 100) : '—'} of main checks</div>
              {modCurr > 0 && <div className="ks">among above, {fmtInt(modCurr)} are mod checks</div>}
              <DeltaBadge curr={curr} prev={prevVal} vsLabel={prevLabel} />
            </div>
          );
        })}
      </div>

      {/* ── Attachment rate trend ── */}
      <div className="cc">
        <h3>Attachment rate trend (weekly)</h3>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>
          % of main checks in that week with a Drink/Sweet/Side attach (item or make-it-a-meal modifier) — respects the channel/location filters above
        </div>
        {weeklyTrend.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>No data in the selected range.</div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={weeklyTrend} margin={{ top: 5, right: 20, left: 5, bottom: 5 }}>
              <CartesianGrid stroke="#f3f4f6" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
              <YAxis tickFormatter={v => `${v}%`} tick={{ fontSize: 9 }} tickLine={false} axisLine={false} width={44} />
              <Tooltip formatter={(v, name) => [`${Number(v).toFixed(1)}%`, name]} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Line type="monotone" dataKey="overallRate" name="Overall" stroke="#111827" strokeWidth={2} dot={{ r: 2 }} />
              <Line type="monotone" dataKey="drinkRate"   name="Drink"   stroke={CAT_COLOR.Drink} strokeWidth={2} dot={{ r: 2 }} />
              <Line type="monotone" dataKey="sweetRate"   name="Sweet"  stroke={CAT_COLOR.Sweet} strokeWidth={2} dot={{ r: 2 }} />
              <Line type="monotone" dataKey="sideRate"    name="Side"   stroke={CAT_COLOR.Side}  strokeWidth={2} dot={{ r: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── Chart ── */}
      <div className="cc">
        <h3>Top 12 by attachment rate</h3>
        <ResponsiveContainer width="100%" height={360}>
          <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 20, left: 5, bottom: 5 }}>
            <CartesianGrid stroke="#f3f4f6" horizontal={false} />
            <XAxis type="number" tickFormatter={v => `${v}%`} tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="name" width={160} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
            <Tooltip formatter={(v) => [`${Number(v).toFixed(2)}%`, 'Attachment Rate']} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
            <Bar dataKey="rate" radius={[0, 6, 6, 0]} fill="#4f46e5" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* ── Attachment rate by location ── */}
      <div className="cc">
        <h3>Attachment rate by location</h3>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>
          Overall and Drink/Sweet/Side attachment rate per location — ignores the location filter above so every location stays comparable, respects the channel filter
        </div>
        {locationChartData.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>No data in the selected range.</div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={locationChartData} margin={{ top: 5, right: 20, left: 5, bottom: 5 }}>
              <CartesianGrid stroke="#f3f4f6" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis tickFormatter={v => `${v}%`} tick={{ fontSize: 9 }} tickLine={false} axisLine={false} width={44} />
              <Tooltip formatter={(v, name) => [`${Number(v).toFixed(2)}%`, name]} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="rate"       name="Overall" fill="#4c1d95" radius={[4, 4, 0, 0]} />
              <Bar dataKey="drinkRate"  name="Drink"   fill="#7c3aed" radius={[4, 4, 0, 0]} />
              <Bar dataKey="sweetRate"  name="Sweet"   fill="#d1d5db" radius={[4, 4, 0, 0]} />
              <Bar dataKey="sideRate"   name="Side"    fill="#c4b5fd" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── Unified location / channel / overall breakdown ── */}
      <div className="tw">
        <div className="th2">
          <h3>Attachment rate breakdown</h3>
          <div style={{ display: 'flex', gap: 1, background: '#e5e7eb', borderRadius: 7, padding: 3, border: '1px solid #d1d5db' }}>
            {(['location', 'channel', 'overall'] as const).map(v => (
              <button key={v} onClick={() => setBreakdownView(v)} style={{
                fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 5, border: 'none', cursor: 'pointer',
                background: breakdownView === v ? 'var(--accent)' : 'transparent',
                color: breakdownView === v ? '#fff' : '#6b7280',
                boxShadow: breakdownView === v ? '0 1px 4px rgba(99,102,241,.35)' : 'none',
                transition: 'all .15s',
              }}>{v === 'location' ? 'Location' : v === 'channel' ? 'Channel' : 'Overall'}</button>
            ))}
          </div>
        </div>
        <div className="tscroll">
          <table>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => handleBdSort('name')}>{breakdownLabel}{bdSortArrow('name')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleBdSort('mainChecks')}>Main Checks{bdSortArrow('mainChecks')}</th>
                <th style={{ cursor: 'pointer', color: CAT_COLOR.Drink }} onClick={() => handleBdSort('drinkRate')}>Drink %{bdSortArrow('drinkRate')}</th>
                <th style={{ cursor: 'pointer', color: CAT_COLOR.Side }} onClick={() => handleBdSort('sideRate')}>Side %{bdSortArrow('sideRate')}</th>
                <th style={{ cursor: 'pointer', color: CAT_COLOR.Sweet }} onClick={() => handleBdSort('sweetRate')}>Sweet %{bdSortArrow('sweetRate')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleBdSort('rate')}>Overall Rate{bdSortArrow('rate')}</th>
              </tr>
            </thead>
            <tbody>
              {breakdownRows.map(r => (
                <tr key={r.code}>
                  <td style={{ fontWeight: 600 }}>{r.name}</td>
                  <td>{fmtInt(r.mainChecks)}</td>
                  <td>{fmtPct(r.drinkRate)}</td>
                  <td>{fmtPct(r.sideRate)}</td>
                  <td>{fmtPct(r.sweetRate)}</td>
                  <td style={{ fontWeight: 700 }}>
                    {fmtPct(r.rate)}
                    <DeltaBadge curr={r.rate} prev={r.prevRate} vsLabel={prevLabel} />
                  </td>
                </tr>
              ))}
              {breakdownRows.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--muted)', padding: 20 }}>No matching rows</td></tr>
              )}
              {breakdownView !== 'overall' && (
                <tr style={{ borderTop: '2px solid var(--border)' }}>
                  <td style={{ fontWeight: 700 }}>Overall (selected {breakdownView === 'channel' ? 'channels' : 'locations'})</td>
                  <td style={{ fontWeight: 700 }}>{fmtInt(totalMainChecks)}</td>
                  <td style={{ fontWeight: 700 }}>{fmtPct(totalMainChecks ? ((current.catMap.get('Drink') ?? 0) / totalMainChecks) * 100 : 0)}</td>
                  <td style={{ fontWeight: 700 }}>{fmtPct(totalMainChecks ? ((current.catMap.get('Side') ?? 0) / totalMainChecks) * 100 : 0)}</td>
                  <td style={{ fontWeight: 700 }}>{fmtPct(totalMainChecks ? ((current.catMap.get('Sweet') ?? 0) / totalMainChecks) * 100 : 0)}</td>
                  <td style={{ fontWeight: 700 }}>
                    {fmtPct(current.overallRate)}
                    <DeltaBadge curr={current.overallRate} prev={prev?.overallRate} vsLabel={prevLabel} />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Unified item/category/location attachment table ── */}
      <div className="tw freeze-2col">
        <div className="th2">
          <h3>Attachment Rate by Item &amp; {tableBreakdown === 'channel' ? 'Channel' : tableBreakdown === 'overall' ? 'Overall' : 'Location'}</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 1, background: '#e5e7eb', borderRadius: 7, padding: 3, border: '1px solid #d1d5db' }}>
              {(['location', 'channel', 'overall'] as const).map(v => (
                <button key={v} onClick={() => setTableBreakdown(v)} style={{
                  fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 5, border: 'none', cursor: 'pointer',
                  background: tableBreakdown === v ? 'var(--accent)' : 'transparent',
                  color: tableBreakdown === v ? '#fff' : '#6b7280',
                  boxShadow: tableBreakdown === v ? '0 1px 4px rgba(99,102,241,.35)' : 'none',
                  transition: 'all .15s',
                }}>{v === 'location' ? 'Location' : v === 'channel' ? 'Channel' : 'Overall'}</button>
              ))}
            </div>
            <select className="fb-sel" value={tableCategory} onChange={e => setTableCategory(e.target.value)}>
              <option value="">All categories</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <input value={tableSearch} onChange={e => setTableSearch(e.target.value)} placeholder="Search item or modifier…" className="srch" />
            <div style={{ display: 'flex', gap: 1, background: '#e5e7eb', borderRadius: 7, padding: 3, border: '1px solid #d1d5db' }}>
              {([['percent', 'Percentage'], ['detail', 'Number of Attaches']] as const).map(([v, label]) => (
                <button key={v} onClick={() => setTableMode(v)} style={{
                  fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 5, border: 'none', cursor: 'pointer',
                  background: tableMode === v ? 'var(--accent)' : 'transparent',
                  color: tableMode === v ? '#fff' : '#6b7280',
                  boxShadow: tableMode === v ? '0 1px 4px rgba(99,102,241,.35)' : 'none',
                  transition: 'all .15s',
                }}>{label}</button>
              ))}
            </div>
            <select className="fb-sel" value={String(tableLimit)} onChange={e => setTableLimit(e.target.value === 'all' ? 'all' : Number(e.target.value) as 10 | 25 | 50 | 100)}>
              <option value="10">Top 10</option>
              <option value="25">Top 25</option>
              <option value="50">Top 50</option>
              <option value="100">Top 100</option>
              <option value="all">All</option>
            </select>
            {showExport && (
              <button className="drb" onClick={exportTableCsv} style={{ minWidth: 0, padding: '6px 12px' }}>
                <i className="ti ti-download" style={{ fontSize: 12, marginRight: 4 }} />
                Export CSV
              </button>
            )}
          </div>
        </div>
        <div className="tscroll">
          <table>
            <thead>
              <tr>
                <th rowSpan={tableMode === 'detail' ? 2 : 1} style={{ textAlign: 'left', minWidth: 90, verticalAlign: 'bottom', zIndex: 3, cursor: 'pointer' }} onClick={() => handleTableSort('category')}>
                  Category{tableSortArrow('category')}
                </th>
                <th rowSpan={tableMode === 'detail' ? 2 : 1} style={{ textAlign: 'left', minWidth: 170, verticalAlign: 'bottom', zIndex: 3, cursor: 'pointer' }} onClick={() => handleTableSort('name')}>
                  Item / Modifier{tableSortArrow('name')}
                </th>
                <th rowSpan={tableMode === 'detail' ? 2 : 1} style={{ cursor: 'pointer', minWidth: 90, verticalAlign: 'bottom', borderLeft: '2px solid var(--border)', zIndex: 3 }} onClick={() => handleTableSort('overall')}>
                  Overall Rate{tableSortArrow('overall')}
                </th>
                {tableCols.map(l => tableMode === 'percent' ? (
                  <th key={l.code} style={{ cursor: 'pointer', minWidth: 100, borderLeft: '2px solid var(--border)', zIndex: 3 }} onClick={() => handleTableSort(`${l.code}:rate`)}>
                    {l.label}{tableSortArrow(`${l.code}:rate`)}
                  </th>
                ) : (
                  <th key={l.code} colSpan={5} style={{ textAlign: 'center', borderLeft: '2px solid var(--border)', top: 0, zIndex: 3, background: '#f0f0f4' }}>
                    {l.label}
                  </th>
                ))}
              </tr>
              {tableMode === 'detail' && (
                <tr>
                  {tableCols.map(l => (
                    <Fragment key={l.code}>
                      <th style={{ minWidth: 70, cursor: 'pointer', borderLeft: '2px solid var(--border)', top: HEADER_ROW_H, zIndex: 2 }} onClick={() => handleTableSort(`${l.code}:mainChecks`)}>
                        Total Main Checks{tableSortArrow(`${l.code}:mainChecks`)}
                      </th>
                      <th style={{ minWidth: 60, cursor: 'pointer', top: HEADER_ROW_H, zIndex: 2 }} onClick={() => handleTableSort(`${l.code}:checksItem`)}>
                        Checks With Item{tableSortArrow(`${l.code}:checksItem`)}
                      </th>
                      <th style={{ minWidth: 60, cursor: 'pointer', top: HEADER_ROW_H, zIndex: 2 }} onClick={() => handleTableSort(`${l.code}:checksMod`)}>
                        Checks With Modifier{tableSortArrow(`${l.code}:checksMod`)}
                      </th>
                      <th style={{ minWidth: 55, cursor: 'pointer', top: HEADER_ROW_H, zIndex: 2 }} onClick={() => handleTableSort(`${l.code}:totals`)}>
                        Totals{tableSortArrow(`${l.code}:totals`)}
                      </th>
                      <th style={{ minWidth: 65, cursor: 'pointer', top: HEADER_ROW_H, zIndex: 2 }} onClick={() => handleTableSort(`${l.code}:rate`)}>
                        Attachment Rate{tableSortArrow(`${l.code}:rate`)}
                      </th>
                    </Fragment>
                  ))}
                </tr>
              )}
            </thead>
            <tbody>
              {visibleTable.map(row => {
                const maxRate = Math.max(...row.perCol.map(v => v.rate), 0);
                return (
                  <tr key={row.name}>
                    <td>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, color: '#fff', background: CAT_COLOR[row.category] ?? '#6b7280' }}>
                        {row.category}
                      </span>
                    </td>
                    <td style={{ fontWeight: 600 }}>{row.name}</td>
                    <td style={{ fontWeight: 700, color: row.overall.rate > 100 ? '#dc2626' : 'inherit', borderLeft: '2px solid var(--border)' }}>
                      {fmtPct(row.overall.rate)}
                    </td>
                    {tableMode === 'percent'
                      ? row.perCol.map((v, i) => (
                        <td key={i} style={{ fontWeight: v.rate === maxRate && v.rate > 0 ? 700 : 400, color: v.rate === 0 ? 'var(--muted)' : v.rate > 100 ? '#dc2626' : 'inherit', borderLeft: '2px solid var(--border)' }}>
                          {v.rate > 0 ? fmtPct(v.rate) : '—'}
                        </td>
                      ))
                      : row.perCol.map((v, i) => (
                        <Fragment key={i}>
                          <td style={{ borderLeft: '2px solid var(--border)' }}>{fmtInt(tableCols[i].mainChecks)}</td>
                          <td>{v.checksItem ? fmtInt(v.checksItem) : '—'}</td>
                          <td>{v.checksMod ? fmtInt(v.checksMod) : '—'}</td>
                          <td>{v.totals ? fmtInt(v.totals) : '—'}</td>
                          <td style={{ fontWeight: v.rate === maxRate && v.rate > 0 ? 700 : 400, color: v.rate === 0 ? 'var(--muted)' : v.rate > 100 ? '#dc2626' : 'inherit' }}>
                            {v.rate > 0 ? fmtPct(v.rate) : '—'}
                          </td>
                        </Fragment>
                      ))}
                  </tr>
                );
              })}
              {visibleTable.length === 0 && (
                <tr><td colSpan={3 + tableCols.length * (tableMode === 'detail' ? 5 : 1)} style={{ textAlign: 'center', color: 'var(--muted)', padding: 20 }}>No matching rows</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '6px 14px', borderTop: '1px solid var(--border)', fontSize: 10, color: 'var(--muted)', display: 'flex', justifyContent: 'space-between' }}>
          <span>Showing {visibleTable.length} of {tableRows.length} rows · {merged.filter(r => r.rate > 100).length} with overall rate over 100%</span>
          <span>Bold = highest rate for that name across {tableBreakdown === 'channel' ? 'channels' : tableBreakdown === 'overall' ? 'the overall figure' : 'locations'}</span>
        </div>
      </div>

      <div className="cc" style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, marginTop: 12 }}>
        <b style={{ color: 'var(--text)' }}>Notes:</b> Every row is a Main/Sweet/Side/Drink item — modifiers never get their own row, they only merge into an item&apos;s totals when a modifier happens to share that item&apos;s exact name. Per-item rates (in the table above and the chart) use total main-item checks as the denominator and cover all four categories, including Main. Aggregate &quot;total attachment&quot; figures — the per-location table, the &quot;Overall&quot; row, and &quot;Best Performing Location&quot; — count Side/Sweet/Drink only; Main is excluded from these sums since a Main item recurring on a check is just another entree, not an up-sell. &quot;Best Performing Location&quot; and the per-location columns ignore the current location filter (so locations can be compared) but still respect the channel filter. Voided rows are excluded from every count.
      </div>

      {/* ══════════════════════ Item Mix (Entree / Drink / Side / Sweet) ══════════════════════ */}
      <h2 style={{ fontSize: 15, fontWeight: 700, margin: '24px 0 4px' }}>Item Mix</h2>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10 }}>
        Scope: In-House + RASA Digital + 3PD only (catering excluded) · includes items sold standalone and as a modifier (e.g. a &quot;make it a meal&quot; pick) · reacts to the channel, location, and date filters above
      </div>

      <div className="krow k4">
        <div className="kc a">
          <div className="kl">Total {mixType} Qty</div>
          <div className="kv">{fmtInt(mixKpis.qty)}</div>
          <div className="ks">As item + as modifier combined</div>
        </div>
        <div className="kc b">
          <div className="kl">Total Revenue</div>
          <div className="kv">{fmtUsd(mixKpis.revenue)}</div>
          <div className="ks">As-item revenue (modifier picks are bundled, $0 marginal)</div>
        </div>
        <div className="kc p">
          <div className="kl">Top {mixType}</div>
          <div className="kv" style={{ fontSize: 16 }}>{mixKpis.top ? mixKpis.top.name : '—'}</div>
          <div className="ks">{mixKpis.top ? `${fmtInt(mixKpis.top.total)} qty` : 'No data'}</div>
        </div>
        <div className="kc g">
          <div className="kl">Distinct Items</div>
          <div className="kv">{fmtInt(mixKpis.distinct)}</div>
          <div className="ks">Unique {mixType.toLowerCase()} names in scope</div>
        </div>
      </div>

      {mixType === 'Entree' && (
        <div className="krow k4">
          {categoryRollup.map(c => (
            <div key={c.subCat} className="kc">
              <div className="kl">{c.label}</div>
              <div className="kv">{fmtInt(c.qty)}</div>
              <div className="ks">{fmtPct(c.pct)} of entrees · {fmtUsd(c.revenue)}</div>
            </div>
          ))}
          {categoryRollup.length === 0 && (
            <div className="kc"><div className="ks">No entree data in the current scope</div></div>
          )}
        </div>
      )}

      <div className="tw">
        <div className="th2">
          <h3>{mixType} Mix by Item</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select className="fb-sel" value={mixType} onChange={e => setMixType(e.target.value as MixType)}>
              {MIX_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <div style={{ display: 'flex', gap: 1, background: '#e5e7eb', borderRadius: 7, padding: 3, border: '1px solid #d1d5db' }}>
              {([['ALL', 'All Channels'], ...ENTREE_CHANNELS.map(c => [c.code, c.label])] as const).map(([v, label]) => (
                <button key={v} onClick={() => setMixPlatform(v as 'ALL' | EntreeChannelCode)} style={{
                  fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 5, border: 'none', cursor: 'pointer',
                  background: mixPlatform === v ? 'var(--accent)' : 'transparent',
                  color: mixPlatform === v ? '#fff' : '#6b7280',
                  boxShadow: mixPlatform === v ? '0 1px 4px rgba(99,102,241,.35)' : 'none',
                  transition: 'all .15s',
                }}>{label}</button>
              ))}
            </div>
            {showExport && (
              <button className="drb" onClick={exportMixCsv} style={{ minWidth: 0, padding: '6px 12px' }}>
                <i className="ti ti-download" style={{ fontSize: 12, marginRight: 4 }} />
                Export CSV
              </button>
            )}
          </div>
        </div>
        <div className="tscroll">
          <table>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => handleMixSort('name')}>Item{mixSortArrow('name')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleMixSort('asItem')}>As Item{mixSortArrow('asItem')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleMixSort('asModifier')}>As Modifier{mixSortArrow('asModifier')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleMixSort('total')}>Total Qty{mixSortArrow('total')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleMixSort('pct')}>% of Qty{mixSortArrow('pct')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleMixSort('revenue')}>Revenue{mixSortArrow('revenue')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleMixSort('revPct')}>% of Rev{mixSortArrow('revPct')}</th>
              </tr>
            </thead>
            <tbody>
              {mixRows.map(r => (
                <tr key={r.name}>
                  <td style={{ fontWeight: 600 }}>{r.name}</td>
                  <td>{r.asItem ? fmtInt(r.asItem) : '—'}</td>
                  <td>{r.asModifier ? fmtInt(r.asModifier) : '—'}</td>
                  <td style={{ fontWeight: 700 }}>{fmtInt(r.total)}</td>
                  <td>{fmtPct(r.pct)}</td>
                  <td>{fmtUsd(r.revenue)}</td>
                  <td>{fmtPct(r.revPct)}</td>
                </tr>
              ))}
              {mixRows.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--muted)', padding: 20 }}>No matching rows</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
