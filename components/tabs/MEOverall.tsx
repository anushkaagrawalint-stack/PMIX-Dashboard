'use client';
import { useState, useMemo } from 'react';
import type { MERow, PinkSheetRow, PinkSheetDetailRow, ItemCostRow } from '@/lib/types';
import type { Role } from '@/lib/auth';
import { computeFinalAvgCost } from '@/lib/pinkSheetCost';
import { normalizeCategory } from '@/lib/constants';
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
  ResponsiveContainer, ReferenceLine, Legend,
  BarChart, Bar, Cell,
} from 'recharts';

const fmt$ = (v: number) =>
  `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmt$R = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;
const fmtK  = (v: number) => v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${Math.round(v)}`;
const pct   = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;

type ChannelTab  = 'ALL' | 'BL' | 'IH' | 'LO' | '3PD';
type QuadrantKey = 'Star' | 'Plow Horse' | 'Puzzle' | 'Dog';
type ViewMode    = 'table' | 'scatter' | 'bar';

const CH_LABELS: Record<ChannelTab, string> = {
  ALL: 'Overall', BL: 'Blended (IH+LO+3PD)', IH: 'In House', LO: 'RASA Digital', '3PD': '3rd Party Delivery',
};
const RC_LABELS: Record<ChannelTab, string> = {
  ALL: 'ALL', BL: 'BLENDED', IH: 'IN-HOUSE', LO: 'RASA DIGITAL', '3PD': '3PD',
};
const MENU_LABELS: Record<'IH' | 'LO' | '3PD', string> = {
  IH: 'IN-HOUSE', LO: 'RASA DIGITAL', '3PD': '3PD',
};
const QUAD: Record<QuadrantKey, { bg: string; color: string; fill: string; label: string }> = {
  Star:         { bg: '#dcfce7', color: '#14532d', fill: '#16a34a', label: 'Stars' },
  'Plow Horse': { bg: '#ede9fe', color: '#5b21b6', fill: '#7c3aed', label: 'Plow Horses' },
  Puzzle:       { bg: '#dbeafe', color: '#1e3a8a', fill: '#1e40af', label: 'Puzzles' },
  Dog:          { bg: '#fee2e2', color: '#991b1b', fill: '#dc2626', label: 'Dogs' },
};
// What each quadrant means (High/Low margin × High/Low menu mix)
const QUAD_DESC: Record<QuadrantKey, string> = {
  Star:         'High margin + High menu mix — popular and profitable. Keep promoting.',
  'Plow Horse': 'Low margin + High menu mix — popular but low-profit. Consider a price increase or cost reduction.',
  Puzzle:       'High margin + Low menu mix — profitable but underordered. Needs marketing/menu placement to sell more.',
  Dog:          'Low margin + Low menu mix — low-profit and unpopular. Candidate for rework, re-pricing, or removal.',
};
const CH_BADGE: Record<'IH' | 'LO' | '3PD', { bg: string; color: string }> = {
  IH:    { bg: '#eff6ff', color: '#1e40af' },
  LO:    { bg: '#f0fdf4', color: '#14532d' },
  '3PD': { bg: '#fef3c7', color: '#92400e' },
};

interface BaseRow {
  name: string; category: string; sub_category: string;
  avg_price: number; avg_price_raw: number; avg_cost: number; avg_cost_raw: number;
  qty: number; net_sales: number; total_cost: number;
}
interface ChannelRow extends BaseRow {
  margin_pct: number; mix_pct: number; cogs_pct: number;
  margin_flag: 'High' | 'Low'; mix_flag: 'High' | 'Low'; quadrant: QuadrantKey;
}
// For Overall flat list: one row per item × channel
interface FlatRow {
  name: string; category: string; sub_category: string;
  avg_price: number; avg_price_raw: number; avg_cost: number; avg_cost_raw: number; margin: number;
  qty: number; total_cost: number; net_sales: number; total_margin: number;
  cogs_pct: number; margin_pct: number; mix_pct: number;
  margin_flag: 'High' | 'Low'; mix_flag: 'High' | 'Low'; quadrant: QuadrantKey;
  menu: string; // IN-HOUSE / RASA DIGITAL / 3PD
  sls_pct: number; sls_cat_pct: number;
  ch: 'IH' | 'LO' | '3PD';
}

function getChData(i: MERow, c: 'IH' | 'LO' | '3PD') {
  if (c === 'IH')  return { qty: i.qty_ih,  ns: i.net_sales_ih,  price: i.avg_price_ih };
  if (c === 'LO')  return { qty: i.qty_lo,  ns: i.net_sales_lo,  price: i.avg_price_lo };
  return                   { qty: i.qty_3pd, ns: i.net_sales_3pd, price: i.avg_price_3pd };
}
// The Pink Sheet's actual "FINAL AVG COST WITH MODIFIER" for one item — computed via
// computeFinalAvgCost (same rules as PinkSheets.tsx: excludes 1/2 Main, excludes 1/2 Base
// unless there's no real Base section, re-prices "1/2 and 1/2" composites), NOT the
// backend's raw avg_cost_ih/avg_cost_online fields, which skip all of that.
interface FinalCost { online: number; ih: number }

// Cost cascade — matches PMIX_AppScript.txt's master row assembly exactly (getPinkCost_
// + the pc/ac fallback around "RATE_3PD_COST"): Pink Sheet cost first, Item Cost Lookup
// (r365 via itemCosts) only when Pink Sheet has none. Two tiers, no third "meItems' own
// embedded cost" — that doesn't exist in the source logic and only added ambiguity.
// LO and 3PD both key off the SAME Pink Sheet "online" figure — there's no separate
// RASA Digital pink sheet — 3PD then applies the ×1.18 packaging uplift on top (AppScript
// RATE_3PD_COST), whichever tier resolved the base cost.
function getChBaseCost(i: MERow, c: 'IH' | 'LO' | '3PD', fc: FinalCost | undefined, ic: ItemCostRow | undefined) {
  const pinkBase = fc ? (c === 'IH' ? fc.ih : fc.online) : 0;
  return pinkBase > 0 ? pinkBase : (ic ? (c === 'IH' ? ic.ih_cost : ic.online_cost) : 0);
}
function getChCost(i: MERow, c: 'IH' | 'LO' | '3PD', fc: FinalCost | undefined, ic: ItemCostRow | undefined) {
  const base = getChBaseCost(i, c, fc, ic);
  return c === '3PD' ? base * 1.18 : base;
}

function buildBaseRows(
  meItems: MERow[], ch: ChannelTab, fcMap: Map<string, FinalCost>, icMap: Map<string, ItemCostRow>,
): BaseRow[] {
  return meItems.map(i => {
    let price: number, qty: number, ns: number;
    switch (ch) {
      case 'IH':  price = i.avg_price_ih;  qty = i.qty_ih;  ns = i.net_sales_ih;  break;
      case 'LO':  price = i.avg_price_lo;  qty = i.qty_lo;  ns = i.net_sales_lo;  break;
      case '3PD': price = i.avg_price_3pd; qty = i.qty_3pd; ns = i.net_sales_3pd; break;
      default:    price = i.avg_price;     qty = i.qty;     ns = i.net_sales;
    }
    if (!qty) return null;
    const fc = fcMap.get(i.canonical_name);
    const ic = icMap.get(i.canonical_name.toLowerCase());
    const tq = i.qty_ih + i.qty_lo + i.qty_3pd;
    let cost: number, costRaw: number;
    if (ch === 'IH' || ch === 'LO' || ch === '3PD') {
      cost    = getChCost(i, ch, fc, ic);
      costRaw = getChBaseCost(i, ch, fc, ic);
    } else if (fc) {
      cost = tq > 0
        ? (fc.ih * i.qty_ih + fc.online * i.qty_lo + (fc.online * 1.18) * i.qty_3pd) / tq
        : fc.online;
      costRaw = tq > 0
        ? (fc.ih * i.qty_ih + fc.online * i.qty_lo + fc.online * i.qty_3pd) / tq
        : fc.online;
    } else {
      cost = costRaw = i.avg_cost;
    }
    // Raw price = the same figure before the 3PD ×1.22 uplift (owner request
    // 2026-07-14) — identical to avg_price for IH/LO since no markup applies there.
    const priceRaw =
      ch === 'IH' || ch === 'LO' ? price :
      ch === '3PD'               ? price / 1.22 :
      tq > 0 ? (i.avg_price_ih * i.qty_ih + i.avg_price_lo * i.qty_lo + (i.avg_price_3pd / 1.22) * i.qty_3pd) / tq
             : price;
    return { name: i.canonical_name, category: normalizeCategory(i.category), sub_category: i.sub_category,
             avg_price: price, avg_price_raw: priceRaw, avg_cost: cost, avg_cost_raw: costRaw,
             qty, net_sales: ns, total_cost: cost * qty };
  }).filter(Boolean) as BaseRow[];
}

function addQuadrant(
  base: BaseRow[],
  gSales: number, gQty: number, gCost: number,
): ChannelRow[] {
  const mThresh  = gSales > 0 ? (gSales - gCost) / gSales : 0;
  const mmThresh = base.length > 0 ? (1 / base.length) * 0.7 : 0;
  return base.map(r => {
    const margin_pct = r.avg_price > 0 ? (r.avg_price - r.avg_cost) / r.avg_price : 0;
    const mix_pct    = gQty > 0 ? r.qty / gQty : 0;
    const cogs_pct   = r.net_sales > 0 ? r.total_cost / r.net_sales : 0;
    const mf:  'High' | 'Low' = margin_pct > mThresh  ? 'High' : 'Low';
    const mxf: 'High' | 'Low' = mix_pct   > mmThresh  ? 'High' : 'Low';
    const quadrant: QuadrantKey =
      mxf === 'High' && mf === 'High' ? 'Star' :
      mxf === 'High' && mf === 'Low'  ? 'Plow Horse' :
      mxf === 'Low'  && mf === 'High' ? 'Puzzle' : 'Dog';
    return { ...r, margin_pct, mix_pct, cogs_pct, margin_flag: mf, mix_flag: mxf, quadrant };
  });
}

// Blended/Single-channel tables compute margin/total_margin/sls_% inline per-row
// during render (recomputed on every render, not stored on ChannelRow). Materializing
// them here instead lets every numeric column be sorted the same generic way the
// Overall table's FlatRow already supports — same field names as FlatRow on purpose.
interface DerivedRow extends ChannelRow {
  margin: number; total_margin: number;
  sls_pct: number; sls_cat_pct: number; sls_sub_pct: number;
}
function withDerived(
  rowsIn: ChannelRow[], grandNS: number,
  catSalesMap: Record<string, number>, subCatSalesMap: Record<string, number>,
): DerivedRow[] {
  return rowsIn.map(r => ({
    ...r,
    margin:       r.avg_price - r.avg_cost,
    total_margin: r.net_sales - r.total_cost,
    sls_pct:      grandNS > 0 ? r.net_sales / grandNS : 0,
    sls_cat_pct:  (catSalesMap[r.category]         ?? 0) > 0 ? r.net_sales / catSalesMap[r.category]         : 0,
    sls_sub_pct:  (subCatSalesMap[r.sub_category]  ?? 0) > 0 ? r.net_sales / subCatSalesMap[r.sub_category]  : 0,
  }));
}

// Generic checkbox-dropdown filter for categorical columns (Margin Level, Menu Mix,
// Menu Engineering - Final, Menu) — these don't get click-to-sort headers since
// there's no meaningful order for a handful of fixed categories; filtering via a
// toolbar dropdown is more useful. Reused identically in all three tables.
function MultiCheckDropdown<T extends string>({
  label, id, open, setOpen, options, selected, onToggle,
}: {
  label: string; id: string;
  open: string | null; setOpen: (v: string | null) => void;
  options: readonly T[]; selected: Set<T>; onToggle: (v: T) => void;
}) {
  const isOpen = open === id;
  const btnLabel = selected.size === 0 ? label : `${label}: ${selected.size}`;
  return (
    <div className="drw" style={{ position: 'relative' }}>
      <button className="drb" onClick={() => setOpen(isOpen ? null : id)} style={{ minWidth: 0 }}>
        {btnLabel}
        <i className="ti ti-chevron-down" style={{ fontSize: 11 }} />
      </button>
      {isOpen && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 199 }} onClick={() => setOpen(null)} />
          <div className="drm open" style={{ minWidth: 160, zIndex: 200 }}>
            {options.map(v => (
              <label key={v} className="dr-it" style={{ gap: 8, userSelect: 'none' }}>
                <input type="checkbox" checked={selected.has(v)} onChange={() => onToggle(v)} style={{ accentColor: 'var(--accent)' }} />
                {v}
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Dedicated bar chart for one quadrant (Dogs / Puzzles) — always visible, independent
// of the main view toggle, so the "needs attention" items are never one click away.
function QuadrantBarChart({ title, subtitle, color, data }: {
  title: string; subtitle: string; color: string;
  data: { name: string; fullName: string; net_sales: number; cogs: number }[];
}) {
  if (!data.length) return null;
  return (
    <div style={{ background: 'var(--card)', borderRadius: 'var(--radius)', padding: '14px 16px', boxShadow: 'var(--shadow)', marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 2 }}>{title}</div>
      <div style={{ fontSize: 9, color: 'var(--muted)', marginBottom: 8 }}>{subtitle}</div>
      <ResponsiveContainer width="100%" height={Math.max(200, data.length * 26 + 40)}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 60, left: 8, bottom: 4 }}>
          <CartesianGrid stroke="#f3f4f6" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 9 }} tickLine={false} tickFormatter={fmtK} />
          <YAxis type="category" dataKey="name" tick={{ fontSize: 9 }} width={134} />
          <RTooltip content={({ payload }) => {
            const p = payload?.[0]?.payload; if (!p) return null;
            return (
              <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 11 }}>
                <div style={{ fontWeight: 700, marginBottom: 3 }}>{p.fullName}</div>
                <div>Net sales: {fmt$R(p.net_sales)}</div>
                <div>COGS: {p.cogs}%</div>
              </div>
            );
          }} />
          <Bar dataKey="net_sales" radius={[0, 3, 3, 0]} fill={`${color}cc`} stroke={color} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function MEOverall({
  meItems, pinkSheets, pinkSheetDetails, itemCosts, role,
}: {
  meItems: MERow[];
  pinkSheets: PinkSheetRow[];
  pinkSheetDetails: PinkSheetDetailRow[];
  itemCosts: ItemCostRow[];
  role: Role;
}) {
  const showExport = role !== 'user';
  const [ch,         setCh]         = useState<ChannelTab>('ALL');
  const [search,     setSearch]     = useState('');
  const [quadFilter, setQuadFilter] = useState<Set<QuadrantKey>>(new Set());
  const [view,       setView]       = useState<ViewMode>('table');
  const [quadChartMode, setQuadChartMode] = useState<'top' | 'bottom'>('top');
  const safeItems = meItems ?? [];

  // ── Table sort — one shared sort state, since only one of the three tables
  // (Overall / Blended / Single-channel) is ever visible at a time. Column keys
  // are shared field names across the three row shapes (see withDerived below,
  // which adds margin/total_margin/sls_* to Blended+Single so every numeric
  // column is sortable the same way as the Overall table's FlatRow already is).
  const [sortCol, setSortCol] = useState<string>('net_sales');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  function handleSort(col: string) {
    if (sortCol === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortCol(col); setSortDir('desc'); }
  }
  const sortArrow = (col: string) => sortCol === col ? (sortDir === 'desc' ? ' ↓' : ' ↑') : '';
  function sortRows<T>(rowsIn: T[], col: string): T[] {
    const mul = sortDir === 'asc' ? -1 : 1; // mul=1 (default) = desc for numbers, Z→A for text
    return [...rowsIn].sort((a, b) => {
      const av = (a as Record<string, unknown>)[col];
      const bv = (b as Record<string, unknown>)[col];
      if (typeof av === 'string' && typeof bv === 'string') return mul === 1 ? bv.localeCompare(av) : av.localeCompare(bv);
      return mul * ((bv as number) - (av as number));
    });
  }

  // ── Margin Level / Menu Mix are the High/Low flag columns — categorical, so a
  // checkbox filter (like the quadrant cards above) is more useful than a sort.
  // Empty set = no filter (show both), matching quadFilter's convention.
  const [marginFlagFilter, setMarginFlagFilter] = useState<Set<'High' | 'Low'>>(new Set());
  const [mixFlagFilter,    setMixFlagFilter]    = useState<Set<'High' | 'Low'>>(new Set());
  const [flagDropOpen, setFlagDropOpen] = useState<string | null>(null);
  function toggleFlagFilter(which: 'margin' | 'mix', v: 'High' | 'Low') {
    const setter = which === 'margin' ? setMarginFlagFilter : setMixFlagFilter;
    setter(prev => { const n = new Set(prev); n.has(v) ? n.delete(v) : n.add(v); return n; });
  }
  const flagMatch = (r: { margin_flag: 'High' | 'Low'; mix_flag: 'High' | 'Low' }) =>
    (marginFlagFilter.size === 0 || marginFlagFilter.has(r.margin_flag)) &&
    (mixFlagFilter.size    === 0 || mixFlagFilter.has(r.mix_flag));

  // Pink Sheet's actual displayed cost per item — same computation PinkSheets.tsx uses,
  // not the backend's raw avg_cost_ih/avg_cost_online fields.
  const fcMap = useMemo(() => {
    const m = new Map<string, FinalCost>();
    const dets = pinkSheetDetails ?? [];
    (pinkSheets ?? []).forEach(p => m.set(p.canonical_name, {
      online: computeFinalAvgCost(p, dets, 'online'),
      ih:     computeFinalAvgCost(p, dets, 'ih'),
    }));
    return m;
  }, [pinkSheets, pinkSheetDetails]);

  const icMap = useMemo(() => {
    const m = new Map<string, ItemCostRow>();
    (itemCosts ?? []).forEach(c => m.set(c.canonical_name.toLowerCase(), c));
    return m;
  }, [itemCosts]);

  // ── For scatter / bar / quadrant cards: single-channel or blended base rows ──
  const rawRows = useMemo(() => {
    // BL scatter/bar uses 'ALL' (IH+LO+3PD) to match AppScript blended
    const tab = ch === 'BL' ? 'ALL' : ch;
    return buildBaseRows(safeItems, tab as ChannelTab, fcMap, icMap);
  }, [safeItems, ch, fcMap, icMap]);

  const grandSales = useMemo(() => rawRows.reduce((s, r) => s + r.net_sales,  0), [rawRows]);
  const grandQty   = useMemo(() => rawRows.reduce((s, r) => s + r.qty,        0), [rawRows]);
  const grandCost  = useMemo(() => rawRows.reduce((s, r) => s + r.total_cost, 0), [rawRows]);
  const marginThreshold = grandSales > 0 ? (grandSales - grandCost) / grandSales : 0;
  const mixThreshold    = rawRows.length > 0 ? (1 / rawRows.length) * 0.7 : 0;

  const rows = useMemo<ChannelRow[]>(() =>
    addQuadrant(rawRows, grandSales, grandQty, grandCost),
  [rawRows, grandSales, grandQty, grandCost]);

  const catSales = useMemo(() => {
    const m: Record<string, number> = {};
    rows.forEach(r => { m[r.category] = (m[r.category] ?? 0) + r.net_sales; });
    return m;
  }, [rows]);

  const subCatSales = useMemo(() => {
    const m: Record<string, number> = {};
    rows.forEach(r => { m[r.sub_category] = (m[r.sub_category] ?? 0) + r.net_sales; });
    return m;
  }, [rows]);

  // ── Per-channel thresholds for Overall flat list (matching AppScript per-master flags) ──
  const perChThresh = useMemo(() => {
    const res = {} as Record<'IH' | 'LO' | '3PD', { mThresh: number; mmThresh: number; totalQty: number; totalNS: number }>;
    (['IH', 'LO', '3PD'] as const).forEach(c => {
      let tNS = 0, tCost = 0, tQty = 0, n = 0;
      safeItems.forEach(i => {
        const { qty, ns } = getChData(i, c);
        if (qty <= 0) return;
        const fc = fcMap.get(i.canonical_name);
        const ic = icMap.get(i.canonical_name.toLowerCase());
        tNS   += ns;
        tCost += getChCost(i, c, fc, ic) * qty;
        tQty  += qty;
        n++;
      });
      res[c] = {
        mThresh:  tNS > 0 ? (tNS - tCost) / tNS : 0,
        mmThresh: n > 0 ? (1 / n) * 0.7 : 0,
        totalQty: tQty, totalNS: tNS,
      };
    });
    return res;
  }, [safeItems, fcMap, icMap]);

  // ── Overall (ALL) flat list, unfiltered by search/quadFilter — one row per item ×
  // channel (so an item sold in IH+LO+3PD contributes 3 rows). This is the same
  // per-channel breakdown the Overall table shows, and is what quadrant counts /
  // charts should be based on for ch==='ALL' so the numbers match the table 1:1.
  const overallFlatRowsAll = useMemo((): FlatRow[] => {
    if (ch !== 'ALL') return [];
    const t = perChThresh;
    const grandNSAll  = t.IH.totalNS  + t.LO.totalNS  + t['3PD'].totalNS;
    const catNS: Record<string, number> = {};
    safeItems.forEach(i => {
      const cat = normalizeCategory(i.category);
      catNS[cat] = (catNS[cat] ?? 0) + i.net_sales_ih + i.net_sales_lo + i.net_sales_3pd;
    });
    const result: FlatRow[] = [];
    safeItems.filter(i => i.qty > 0).forEach(i => {
      const fc = fcMap.get(i.canonical_name);
      const ic = icMap.get(i.canonical_name.toLowerCase());
      (['IH', 'LO', '3PD'] as const).forEach(c => {
        const { qty, ns, price } = getChData(i, c);
        if (qty <= 0) return;
        const cost       = getChCost(i, c, fc, ic);
        const costRaw    = getChBaseCost(i, c, fc, ic);
        // Raw price = same figure before the 3PD ×1.22 uplift (owner request
        // 2026-07-14) — identical to avg_price for IH/LO since no markup applies there.
        const priceRaw   = c === '3PD' ? price / 1.22 : price;
        const margin     = price - cost;
        const tc         = cost * qty;
        const totMgn     = ns - tc;
        const cogs_pct   = ns > 0 ? tc / ns : 0;
        const margin_pct = price > 0 ? margin / price : 0;
        const thresh     = t[c];
        // % Menu Mix is the item's share of TOTAL qty across every channel (owner
        // request 2026-07-14), not just its share within its own channel — grandQty
        // and mixThreshold already reflect the true blended (IH+LO+3PD) totals for
        // ch==='ALL' (computed above from rawRows). Margin stays per-channel since
        // channel-specific pricing/cost genuinely differs; only mix was the complaint.
        const mix_pct    = grandQty > 0 ? qty / grandQty : 0;
        const mf:  'High' | 'Low' = margin_pct > thresh.mThresh  ? 'High' : 'Low';
        const mxf: 'High' | 'Low' = mix_pct    > mixThreshold    ? 'High' : 'Low';
        const quadrant: QuadrantKey =
          mxf === 'High' && mf === 'High' ? 'Star' :
          mxf === 'High' && mf === 'Low'  ? 'Plow Horse' :
          mxf === 'Low'  && mf === 'High' ? 'Puzzle' : 'Dog';
        const cat = normalizeCategory(i.category);
        result.push({
          name: i.canonical_name, category: cat, sub_category: i.sub_category,
          avg_price: price, avg_price_raw: priceRaw, avg_cost: cost, avg_cost_raw: costRaw, margin, qty, total_cost: tc,
          net_sales: ns, total_margin: totMgn, cogs_pct, margin_pct, mix_pct,
          margin_flag: mf, mix_flag: mxf, quadrant,
          menu: MENU_LABELS[c],
          sls_pct:     grandNSAll > 0 ? ns / grandNSAll : 0,
          sls_cat_pct: catNS[cat] > 0 ? ns / catNS[cat] : 0,
          ch: c,
        });
      });
    });
    return result;
  }, [safeItems, ch, fcMap, icMap, perChThresh, grandQty, mixThreshold]);

  // Source rows for quadrant counts/charts: for Overall, use the per-channel flat
  // rows (3 per item) so counts match what the Overall table actually shows; for
  // every other view (Blended / IH / LO / 3PD) one row per item is already correct.
  const quadSourceRows = useMemo(() => (ch === 'ALL' ? overallFlatRowsAll : rows), [ch, overallFlatRowsAll, rows]);

  const quadStats = useMemo(() => {
    const s: Record<QuadrantKey, { count: number; revenue: number }> = {
      Star: { count: 0, revenue: 0 }, 'Plow Horse': { count: 0, revenue: 0 },
      Puzzle: { count: 0, revenue: 0 }, Dog: { count: 0, revenue: 0 },
    };
    quadSourceRows.forEach(r => { s[r.quadrant].count++; s[r.quadrant].revenue += r.net_sales; });
    return s;
  }, [quadSourceRows]);

  // ── Overall (ALL) flat table: search + quadrant-card filter applied on top of
  // overallFlatRowsAll (the per-channel, unfiltered source used for counts/charts) ──
  const overallFlatRows = useMemo((): FlatRow[] => {
    if (ch !== 'ALL') return [];
    const q = search.toLowerCase();
    const base = overallFlatRowsAll.filter(r =>
      (!q || r.name.toLowerCase().includes(q)) &&
      (quadFilter.size === 0 || quadFilter.has(r.quadrant)) &&
      flagMatch(r)
    );
    return sortRows(base, sortCol);
  }, [overallFlatRowsAll, ch, search, quadFilter, marginFlagFilter, mixFlagFilter, sortCol, sortDir]);

  // ── Blended (BL) table rows: IH+LO+3PD aggregated (AppScript stepBuildBlendedMaster) ──
  // Quadrant comes from full-portfolio thresholds already in `rows` — don't recompute on filtered subset.
  const blendedTableRows = useMemo<ChannelRow[]>(() => {
    if (ch !== 'BL') return [];
    const q = search.toLowerCase();
    return rows.filter(r =>
      (!q || r.name.toLowerCase().includes(q)) &&
      (quadFilter.size === 0 || quadFilter.has(r.quadrant)) &&
      flagMatch(r)
    );
  }, [ch, rows, search, quadFilter, marginFlagFilter, mixFlagFilter]);

  // filtered set for single-channel table / scatter / bar
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return rows.filter(r =>
      (!q || r.name.toLowerCase().includes(q)) &&
      (quadFilter.size === 0 || quadFilter.has(r.quadrant)) &&
      flagMatch(r)
    );
  }, [rows, search, quadFilter, marginFlagFilter, mixFlagFilter]);

  const scatterByQuad = useMemo(() => {
    const byQ: Record<QuadrantKey, Array<{ x: number; y: number; name: string; ns: number; quadrant: QuadrantKey }>> = {
      Star: [], 'Plow Horse': [], Puzzle: [], Dog: [],
    };
    rows.forEach(r => byQ[r.quadrant].push({
      x: Math.round(r.mix_pct * 100000) / 1000,
      y: Math.round(r.margin_pct * 10000) / 100,
      name: r.name, ns: r.net_sales, quadrant: r.quadrant,
    }));
    return byQ;
  }, [rows]);

  const barData = useMemo(() =>
    [...filtered]
      .sort((a, b) => b.net_sales - a.net_sales)
      .slice(0, 15)
      .map(r => ({
        name:      r.name.length > 22 ? r.name.slice(0, 20) + '…' : r.name,
        fullName:  r.name,
        net_sales: Math.round(r.net_sales),
        cogs:      Math.round(r.cogs_pct * 100),
        quadrant:  r.quadrant,
      }))
      .reverse(),
  [filtered]);

  // Bar-chart data for all 4 quadrants (hidden in Table view), independent of the
  // quadrant-card click filter above. Capped at 5 (top or bottom by net sales,
  // per quadChartMode) — these are meant as a quick spot-check, not a full listing.
  function quadBarData(q: QuadrantKey, mode: 'top' | 'bottom') {
    const sorted = quadSourceRows
      .filter(r => r.quadrant === q)
      .sort((a, b) => mode === 'top' ? b.net_sales - a.net_sales : a.net_sales - b.net_sales)
      .slice(0, 5)
      .map(r => ({
        name:      r.name.length > 22 ? r.name.slice(0, 20) + '…' : r.name,
        fullName:  r.name,
        net_sales: Math.round(r.net_sales),
        cogs:      Math.round(r.cogs_pct * 100),
      }));
    return mode === 'top' ? sorted.reverse() : sorted;
  }
  const starBarData       = useMemo(() => quadBarData('Star', quadChartMode),        [quadSourceRows, quadChartMode]);
  const plowHorseBarData  = useMemo(() => quadBarData('Plow Horse', quadChartMode),  [quadSourceRows, quadChartMode]);
  const puzzleBarData     = useMemo(() => quadBarData('Puzzle', quadChartMode),      [quadSourceRows, quadChartMode]);
  const dogBarData        = useMemo(() => quadBarData('Dog', quadChartMode),         [quadSourceRows, quadChartMode]);

  const totalMargin = grandSales - grandCost;

  // ── Grand totals for Overall flat table ──
  const ovGrandQty   = useMemo(() => overallFlatRows.reduce((s, r) => s + r.qty,        0), [overallFlatRows]);
  const ovGrandNS    = useMemo(() => overallFlatRows.reduce((s, r) => s + r.net_sales,  0), [overallFlatRows]);
  const ovGrandCost  = useMemo(() => overallFlatRows.reduce((s, r) => s + r.total_cost, 0), [overallFlatRows]);
  const ovGrandMgn   = useMemo(() => overallFlatRows.reduce((s, r) => s + r.total_margin, 0), [overallFlatRows]);

  // ── Grand totals for Blended table ──
  const blGrandQty   = useMemo(() => blendedTableRows.reduce((s, r) => s + r.qty,        0), [blendedTableRows]);
  const blGrandNS    = useMemo(() => blendedTableRows.reduce((s, r) => s + r.net_sales,  0), [blendedTableRows]);
  const blGrandCost  = useMemo(() => blendedTableRows.reduce((s, r) => s + r.total_cost, 0), [blendedTableRows]);
  const blGrandMgn   = useMemo(() => blendedTableRows.reduce((s, r) => s + r.net_sales - r.total_cost, 0), [blendedTableRows]);
  const blCatSales   = useMemo(() => {
    const m: Record<string, number> = {};
    blendedTableRows.forEach(r => { m[r.category] = (m[r.category] ?? 0) + r.net_sales; });
    return m;
  }, [blendedTableRows]);
  const blSubCatSales = useMemo(() => {
    const m: Record<string, number> = {};
    blendedTableRows.forEach(r => { m[r.sub_category] = (m[r.sub_category] ?? 0) + r.net_sales; });
    return m;
  }, [blendedTableRows]);

  // Sortable, fully-materialized rows for the Blended and Single-channel tables
  // (margin/total_margin/sls_% computed once here instead of inline per-render,
  // so every column — not just the pre-computed ones — can be sorted the same
  // generic way as the Overall table's FlatRow).
  const blendedTableRowsD = useMemo(
    () => sortRows(withDerived(blendedTableRows, blGrandNS, blCatSales, blSubCatSales), sortCol),
    [blendedTableRows, blGrandNS, blCatSales, blSubCatSales, sortCol, sortDir],
  );
  const filteredD = useMemo(
    () => sortRows(withDerived(filtered, grandSales, catSales, subCatSales), sortCol),
    [filtered, grandSales, catSales, subCatSales, sortCol, sortDir],
  );

  const mtPct  = Math.round(marginThreshold * 10000) / 100;
  const mxtPct = Math.round(mixThreshold    * 100000) / 1000;

  // ── Export helpers ──
  function exportOverallCSV() {
    const hdr = 'Item Name,Uplifted Avg Price,Avg Price,Uplifted Avg Cost With Modifiers,Avg Cost,Margin,Quantity,Total Cost,Net Sales,Total Margin,COGS%,% Margin,% Menu Mix,Margin Level,Menu Mix,Menu Engineering - Final,Menu,Category,Sub Category,Sls %,Sls % Category';
    const csvRows = overallFlatRows.map(r => [
      `"${r.name}"`, r.avg_price.toFixed(2), r.avg_price_raw.toFixed(2),
      r.avg_cost > 0 ? r.avg_cost.toFixed(2) : '', r.avg_cost_raw > 0 ? r.avg_cost_raw.toFixed(2) : '',
      r.margin.toFixed(2), r.qty, r.total_cost.toFixed(2), r.net_sales.toFixed(2),
      r.total_margin.toFixed(2), pct(r.cogs_pct), pct(r.margin_pct), pct(r.mix_pct, 1),
      r.margin_flag, r.mix_flag, r.quadrant, r.menu,
      `"${r.category}"`, `"${r.sub_category}"`, pct(r.sls_pct, 2), pct(r.sls_cat_pct, 2),
    ].join(','));
    const blob = new Blob([[hdr, ...csvRows].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'menu-engineering-overall.csv'; a.click();
  }

  function exportBlendedCSV() {
    const hdr = 'Item Name,Uplifted Avg Price,Avg Price,Uplifted Avg Cost With Modifiers,Avg Cost,Margin,Quantity,Total Cost,Net Sales,Total Margin,COGS%,% Margin,% Menu Mix,Margin Level,Menu Mix,Menu Engineering - Final,Category,Sub Category,Sls %,Sls % Category,Sls % Sub Category';
    const csvRows = blendedTableRows.map(r => {
      const margin = r.avg_price - r.avg_cost;
      const totMgn = r.net_sales - r.total_cost;
      const slsPct = blGrandNS > 0 ? r.net_sales / blGrandNS : 0;
      const slsCat = (blCatSales[r.category] ?? 0) > 0 ? r.net_sales / blCatSales[r.category] : 0;
      const slsSub = (blSubCatSales[r.sub_category] ?? 0) > 0 ? r.net_sales / blSubCatSales[r.sub_category] : 0;
      return [
        `"${r.name}"`, r.avg_price.toFixed(2), r.avg_price_raw.toFixed(2),
        r.avg_cost > 0 ? r.avg_cost.toFixed(2) : '', r.avg_cost_raw > 0 ? r.avg_cost_raw.toFixed(2) : '',
        margin.toFixed(2), r.qty, r.total_cost.toFixed(2), r.net_sales.toFixed(2),
        totMgn.toFixed(2), pct(r.cogs_pct), pct(r.margin_pct), pct(r.mix_pct, 1),
        r.margin_flag, r.mix_flag, r.quadrant,
        `"${r.category}"`, `"${r.sub_category}"`, pct(slsPct, 2), pct(slsCat, 2), pct(slsSub, 2),
      ].join(',');
    });
    const blob = new Blob([[hdr, ...csvRows].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'menu-engineering-blended.csv'; a.click();
  }

  function exportSingleCSV() {
    const hdr = 'Item Name,Uplifted Avg Price,Avg Price,Uplifted Avg Cost With Modifiers,Avg Cost,Margin,Quantity,Total Cost,Net Sales,Total Margin,COGS%,% Margin,% Menu Mix,Margin Level,Menu Mix,Menu Engineering - Final,Revenue Center,Category,Sub Category,Sls %,Sls % Category,Sls % Sub Category';
    const csvRows = filtered.map(r => {
      const margin = r.avg_price - r.avg_cost;
      const totMgn = r.net_sales - r.total_cost;
      const slsPct = grandSales > 0 ? r.net_sales / grandSales : 0;
      const slsCat = (catSales[r.category] ?? 0) > 0 ? r.net_sales / catSales[r.category] : 0;
      const slsSub = (subCatSales[r.sub_category] ?? 0) > 0 ? r.net_sales / subCatSales[r.sub_category] : 0;
      return [
        `"${r.name}"`, r.avg_price.toFixed(2), r.avg_price_raw.toFixed(2),
        r.avg_cost > 0 ? r.avg_cost.toFixed(2) : '', r.avg_cost_raw > 0 ? r.avg_cost_raw.toFixed(2) : '',
        margin.toFixed(2), r.qty, r.total_cost.toFixed(2), r.net_sales.toFixed(2),
        totMgn.toFixed(2), pct(r.cogs_pct), pct(r.margin_pct), pct(r.mix_pct, 1),
        r.margin_flag, r.mix_flag, r.quadrant, RC_LABELS[ch],
        `"${r.category}"`, `"${r.sub_category}"`, pct(slsPct, 2), pct(slsCat, 2), pct(slsSub, 2),
      ].join(',');
    });
    const blob = new Blob([[hdr, ...csvRows].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `menu-engineering-${ch.toLowerCase()}.csv`; a.click();
  }

  if (!safeItems.length) return (
    <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>
      No ME data for this period.
    </div>
  );

  // ── Shared table header styles ──
  const FLAG_H: React.CSSProperties = {
    fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
    background: '#dcfce7', color: '#14532d',
  };
  const FLAG_L: React.CSSProperties = {
    ...FLAG_H, background: '#fee2e2', color: '#991b1b',
  };
  const flagStyle = (v: 'High' | 'Low') => v === 'High' ? FLAG_H : FLAG_L;
  const quadStyle = (q: QuadrantKey): React.CSSProperties => ({
    fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
    background: QUAD[q].bg, color: QUAD[q].color,
  });
  const menuBadge = (menu: string): React.CSSProperties => {
    const c = menu === 'IN-HOUSE' ? CH_BADGE.IH : menu === 'RASA DIGITAL' ? CH_BADGE.LO : CH_BADGE['3PD'];
    return { fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: c.bg, color: c.color };
  };

  return (
    <div>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Menu Engineering — Overall</h2>
          <p style={{ fontSize: 10, color: 'var(--muted)', margin: '2px 0 0' }}>
            {rows.length} items · {CH_LABELS[ch]}
            &nbsp;·&nbsp;Margin threshold: <strong>{pct(marginThreshold)}</strong>
            &nbsp;·&nbsp;Mix threshold: <strong>{(mixThreshold * 100).toFixed(3)}%</strong>
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600 }}>Cost view</span>
          <select className="fb-sel" value={ch} onChange={e => setCh(e.target.value as ChannelTab)}>
            {(['ALL', 'BL', 'IH', 'LO', '3PD'] as ChannelTab[]).map(c => (
              <option key={c} value={c}>{CH_LABELS[c]}</option>
            ))}
          </select>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['table', 'scatter', 'bar'] as ViewMode[]).map(v => (
              <button key={v} onClick={() => setView(v)} style={{
                padding: '4px 12px', borderRadius: 8, border: '1px solid var(--border)',
                fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                background: view === v ? 'var(--accent)' : 'var(--card)',
                color: view === v ? '#fff' : 'var(--muted)',
              }}>{v === 'table' ? 'Table' : v === 'scatter' ? 'Scatter' : 'Bar Chart'}</button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Note: all downstream calcs (margin, COGS%, quadrant, etc.) are based on
          the uplifted figures (3PD ×1.22 price / ×1.18 cost), not the raw ones ── */}
      <div style={{
        fontSize: 10, color: 'var(--muted)', background: 'var(--card)',
        border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px', marginBottom: 10,
      }}>
        <strong>Note:</strong> All calculations on this page (Margin, Total Margin, COGS%, % Margin,
        quadrant classification, etc.) are based on <strong>Uplifted Avg Price</strong> and{' '}
        <strong>Uplifted Avg Cost With Modifiers</strong> — the raw <strong>Avg Price</strong> and{' '}
        <strong>Avg Cost</strong> columns are shown for reference only.
      </div>

      {/* ── Quadrant cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 14 }}>
        {(['Star', 'Plow Horse', 'Puzzle', 'Dog'] as QuadrantKey[]).map(q => {
          const qd = QUAD[q]; const s = quadStats[q]; const checked = quadFilter.has(q);
          return (
            <div key={q} onClick={() => setQuadFilter(prev => { const n = new Set(prev); n.has(q) ? n.delete(q) : n.add(q); return n; })}
              style={{ background: qd.bg, border: `1.5px solid ${checked ? qd.fill : qd.fill + '40'}`,
                borderRadius: 10, padding: '10px 14px', cursor: 'pointer',
                opacity: quadFilter.size > 0 && !checked ? 0.45 : 1,
                boxShadow: checked ? `0 0 0 2px ${qd.fill}` : 'none' }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: qd.color, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 2 }}
                title={QUAD_DESC[q]}>
                {qd.label}
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                <span style={{ fontSize: 24, fontWeight: 800, color: qd.color, lineHeight: 1.1 }}>{s.count}</span>
                <span style={{ fontSize: 10, color: qd.color, opacity: 0.7 }}>item{s.count === 1 ? '' : 's'}</span>
              </div>
              <div style={{ fontSize: 10, color: qd.color, opacity: 0.8, marginTop: 2 }}>
                {fmt$R(s.revenue)} net sales
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Quadrant charts (hidden in Table view) ── */}
      {view !== 'table' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, marginBottom: 8 }}>
            <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600 }}>Show</span>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['top', 'bottom'] as const).map(m => (
                <button key={m} onClick={() => setQuadChartMode(m)} style={{
                  padding: '4px 12px', borderRadius: 8, border: '1px solid var(--border)',
                  fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                  background: quadChartMode === m ? 'var(--accent)' : 'var(--card)',
                  color: quadChartMode === m ? '#fff' : 'var(--muted)',
                }}>{m === 'top' ? 'Top 5' : 'Bottom 5'}</button>
              ))}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14, marginBottom: 14 }}>
            <QuadrantBarChart
              title={`Star Items — ${quadChartMode === 'top' ? 'Top' : 'Bottom'} 5 by Net Sales (${starBarData.length} of ${quadStats.Star.count})`}
              subtitle={QUAD_DESC.Star}
              color={QUAD.Star.fill}
              data={starBarData}
            />
            <QuadrantBarChart
              title={`Plow Horse Items — ${quadChartMode === 'top' ? 'Top' : 'Bottom'} 5 by Net Sales (${plowHorseBarData.length} of ${quadStats['Plow Horse'].count})`}
              subtitle={QUAD_DESC['Plow Horse']}
              color={QUAD['Plow Horse'].fill}
              data={plowHorseBarData}
            />
            <QuadrantBarChart
              title={`Puzzle Items — ${quadChartMode === 'top' ? 'Top' : 'Bottom'} 5 by Net Sales (${puzzleBarData.length} of ${quadStats.Puzzle.count})`}
              subtitle={QUAD_DESC.Puzzle}
              color={QUAD.Puzzle.fill}
              data={puzzleBarData}
            />
            <QuadrantBarChart
              title={`Dog Items — ${quadChartMode === 'top' ? 'Top' : 'Bottom'} 5 by Net Sales (${dogBarData.length} of ${quadStats.Dog.count})`}
              subtitle={QUAD_DESC.Dog}
              color={QUAD.Dog.fill}
              data={dogBarData}
            />
          </div>
        </>
      )}

      {/* ── Scatter chart ── */}
      {view === 'scatter' && (
        <div style={{ background: 'var(--card)', borderRadius: 'var(--radius)', padding: '14px 16px', boxShadow: 'var(--shadow)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 8 }}>Menu Mix % vs Margin % — {CH_LABELS[ch]}</div>
          <ResponsiveContainer width="100%" height={340}>
            <ScatterChart margin={{ top: 10, right: 24, left: 0, bottom: 24 }}>
              <CartesianGrid stroke="#f3f4f6" />
              <XAxis dataKey="x" name="Mix %" tick={{ fontSize: 9 }} tickLine={false}
                label={{ value: 'Menu Mix %', position: 'insideBottom', offset: -14, fontSize: 9 }} />
              <YAxis dataKey="y" name="Margin %" tick={{ fontSize: 9 }} tickLine={false}
                label={{ value: 'Margin %', angle: -90, position: 'insideLeft', fontSize: 9 }} />
              <RTooltip cursor={{ strokeDasharray: '3 3' }}
                content={({ payload }) => {
                  const p = payload?.[0]?.payload; if (!p) return null;
                  const qd = QUAD[p.quadrant as QuadrantKey];
                  return (
                    <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 11 }}>
                      <div style={{ fontWeight: 700, marginBottom: 3 }}>{p.name}</div>
                      <div>Mix: {p.x.toFixed(3)}% · Margin: {p.y.toFixed(1)}%</div>
                      <div>Revenue: {fmt$R(p.ns)}</div>
                      <div style={{ color: qd.fill, fontWeight: 600 }}>{p.quadrant}</div>
                    </div>
                  );
                }} />
              <ReferenceLine x={mxtPct} stroke="#dc2626" strokeDasharray="4 2" strokeWidth={1.5} />
              <ReferenceLine y={mtPct}  stroke="#dc2626" strokeDasharray="4 2" strokeWidth={1.5} />
              <Legend iconType="circle" iconSize={8} formatter={v => <span style={{ fontSize: 9 }}>{v}</span>} />
              {(Object.keys(QUAD) as QuadrantKey[]).map(q => (
                <Scatter key={q} name={q} data={scatterByQuad[q]} fill={`${QUAD[q].fill}99`} stroke={QUAD[q].fill} r={4} />
              ))}
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Bar chart ── */}
      {view === 'bar' && (
        <div style={{ background: 'var(--card)', borderRadius: 'var(--radius)', padding: '14px 16px', boxShadow: 'var(--shadow)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4 }}>
            Top 15 Items by Revenue — {CH_LABELS[ch]}
            {quadFilter.size > 0 && <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--muted)', marginLeft: 8 }}>({[...quadFilter].map(q => QUAD[q].label).join(', ')} only)</span>}
          </div>
          <div style={{ fontSize: 9, color: 'var(--muted)', marginBottom: 8 }}>Bars coloured by quadrant · hover for COGS%</div>
          <ResponsiveContainer width="100%" height={Math.max(320, barData.length * 26 + 40)}>
            <BarChart data={barData} layout="vertical" margin={{ top: 4, right: 60, left: 8, bottom: 4 }}>
              <CartesianGrid stroke="#f3f4f6" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 9 }} tickLine={false} tickFormatter={fmtK} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 9 }} width={134} />
              <RTooltip content={({ payload }) => {
                const p = payload?.[0]?.payload; if (!p) return null;
                const qd = QUAD[p.quadrant as QuadrantKey];
                return (
                  <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 11 }}>
                    <div style={{ fontWeight: 700, marginBottom: 3 }}>{p.fullName}</div>
                    <div>Revenue: {fmt$R(p.net_sales)}</div>
                    <div>COGS: {p.cogs}%</div>
                    <div style={{ color: qd.fill, fontWeight: 600 }}>{p.quadrant}</div>
                  </div>
                );
              }} />
              <Bar dataKey="net_sales" radius={[0, 3, 3, 0]}>
                {barData.map((d, idx) => <Cell key={idx} fill={QUAD[d.quadrant].fill + 'cc'} stroke={QUAD[d.quadrant].fill} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════
          OVERALL TABLE — flat list, one row per item × channel
          Matches AppScript: stepBuildOverallMaster
          19 cols: Item Name | Avg Price | Avg Cost | Margin | Qty |
                   Total Cost | Net Sales | Total Margin | COGS% |
                   % Margin | % Menu Mix | Margin Level | Menu Mix |
                   ME Final | Menu | Category | Sub Category |
                   Sls % | Sls % Category
          ════════════════════════════════════════════════════════════ */}
      {view === 'table' && ch === 'ALL' && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search items…" className="srch" />
            <MultiCheckDropdown label="Margin Level" id="margin" open={flagDropOpen} setOpen={setFlagDropOpen} options={['High', 'Low']} selected={marginFlagFilter} onToggle={v => toggleFlagFilter('margin', v)} />
            <MultiCheckDropdown label="Menu Mix" id="mix" open={flagDropOpen} setOpen={setFlagDropOpen} options={['High', 'Low']} selected={mixFlagFilter} onToggle={v => toggleFlagFilter('mix', v)} />
            <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 'auto' }}>{overallFlatRows.length} rows</span>
            {showExport && <button onClick={exportOverallCSV} style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid rgba(124,58,237,0.2)', background: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer', color: 'var(--accent)', fontFamily: 'inherit' }}>⬇ Export CSV</button>}
          </div>
          <div className="tw"><div className="tscroll">
            <table>
              <thead><tr>
                <th style={{ minWidth: 160, cursor: 'pointer' }} onClick={() => handleSort('name')}>Item Name{sortArrow('name')}</th>
                <th style={{ cursor: 'pointer', whiteSpace: 'normal' }} onClick={() => handleSort('avg_price')} title="Gross sales ÷ qty for this channel; 3PD carries an additional ×1.22 price markup on top">Uplifted Avg Price{sortArrow('avg_price')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('avg_price_raw')} title="Same as Uplifted Avg Price, before the 3PD ×1.22 markup — identical to Uplifted Avg Price for In-House/RASA Digital">Avg Price{sortArrow('avg_price_raw')}</th>
                <th style={{ cursor: 'pointer', whiteSpace: 'normal' }} onClick={() => handleSort('avg_cost')} title="Pink Sheet Final Avg Cost With Modifier (or r365 Item Cost Lookup fallback); 3PD carries an additional ×1.18 packaging markup on top">Uplifted Avg Cost With Modifiers{sortArrow('avg_cost')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('avg_cost_raw')} title="Same as Uplifted Avg Cost With Modifiers, before the 3PD ×1.18 markup — identical to it for In-House/RASA Digital">Avg Cost{sortArrow('avg_cost_raw')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('margin')} title="Uplifted Avg Price − Uplifted Avg Cost With Modifiers">Margin{sortArrow('margin')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('qty')}>Quantity{sortArrow('qty')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('total_cost')} title="Uplifted Avg Cost With Modifiers × Quantity">Total Cost{sortArrow('total_cost')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('net_sales')} title="Uplifted Avg Price × Quantity">Net Sales{sortArrow('net_sales')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('total_margin')} title="Net Sales − Total Cost">Total Margin{sortArrow('total_margin')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('cogs_pct')} title="Total Cost ÷ Net Sales — cost of goods sold as a % of sales">COGS%{sortArrow('cogs_pct')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('margin_pct')} title="Margin ÷ Uplifted Avg Price">% Margin{sortArrow('margin_pct')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('mix_pct')} title="Item qty ÷ total qty across this view">% Menu Mix{sortArrow('mix_pct')}</th>
                <th title="High if % Margin is above the blended margin threshold ((total net sales − total cost) ÷ total net sales), else Low">Margin Level</th>
                <th title="High if % Menu Mix is above the mix threshold ((1 ÷ item count) × 0.7), else Low">Menu Mix</th>
                <th title="Star = High Margin Level + High Menu Mix · Plow Horse = Low Margin + High Mix · Puzzle = High Margin + Low Mix · Dog = Low Margin + Low Mix">Menu Engineering - Final</th>
                <th>Menu</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('category')}>Category{sortArrow('category')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('sub_category')}>Sub Category{sortArrow('sub_category')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('sls_pct')} title="Net Sales ÷ grand total Net Sales across every item in this view">Sls %{sortArrow('sls_pct')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('sls_cat_pct')} title="Net Sales ÷ total Net Sales for this item's Category">Sls % Category{sortArrow('sls_cat_pct')}</th>
              </tr></thead>
              <tbody>
                {overallFlatRows.map((r, idx) => (
                  <tr key={r.name + r.ch + idx}>
                    <td style={{ fontWeight: 600 }}>{r.name}</td>
                    <td>{fmt$(r.avg_price)}</td>
                    <td style={{ color: 'var(--muted)' }}>{fmt$(r.avg_price_raw)}</td>
                    <td>{r.avg_cost > 0 ? fmt$(r.avg_cost) : '—'}</td>
                    <td style={{ color: 'var(--muted)' }}>{r.avg_cost_raw > 0 ? fmt$(r.avg_cost_raw) : '—'}</td>
                    <td>{fmt$(r.margin)}</td>
                    <td>{r.qty.toLocaleString()}</td>
                    <td>{fmt$(r.total_cost)}</td>
                    <td style={{ fontWeight: 600 }}>{fmt$(r.net_sales)}</td>
                    <td>{fmt$(r.total_margin)}</td>
                    <td style={{ color: r.cogs_pct > 0.35 ? '#ef4444' : 'inherit' }}>{pct(r.cogs_pct)}</td>
                    <td>{pct(r.margin_pct)}</td>
                    <td>{pct(r.mix_pct, 1)}</td>
                    <td><span style={flagStyle(r.margin_flag)}>{r.margin_flag}</span></td>
                    <td><span style={flagStyle(r.mix_flag)}>{r.mix_flag}</span></td>
                    <td><span style={quadStyle(r.quadrant)}>{r.quadrant}</span></td>
                    <td><span style={menuBadge(r.menu)}>{r.menu}</span></td>
                    <td style={{ fontSize: 10 }}>{r.category}</td>
                    <td style={{ fontSize: 10 }}>{r.sub_category}</td>
                    <td>{pct(r.sls_pct, 2)}</td>
                    <td>{pct(r.sls_cat_pct, 2)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr style={{ fontWeight: 700, background: 'var(--border)' }}>
                <td>Grand Total</td>
                <td>—</td><td>—</td><td>—</td><td>—</td><td>—</td>
                <td>{ovGrandQty.toLocaleString()}</td>
                <td>{fmt$(ovGrandCost)}</td>
                <td>{fmt$(ovGrandNS)}</td>
                <td>{fmt$(ovGrandMgn)}</td>
                <td>{ovGrandNS > 0 ? pct(ovGrandCost / ovGrandNS) : '—'}</td>
                <td>{ovGrandNS > 0 ? pct(ovGrandMgn / ovGrandNS) : '—'}</td>
                <td>100.0%</td>
                <td colSpan={8} />
              </tr></tfoot>
            </table>
          </div></div>
        </>
      )}

      {/* ════════════════════════════════════════════════════════════
          BLENDED TABLE — one aggregated row per item (IH+LO+3PD)
          Matches AppScript: stepBuildBlendedMaster
          19 cols: Item Name | Avg Price | Avg Cost | Margin | Qty |
                   Total Cost | Net Sales | Total Margin | COGS% |
                   % Margin | % Menu Mix | Margin Level | Menu Mix |
                   ME Final | Category | Sub Category |
                   Sls % | Sls % Category | Sls % Sub Category
          ════════════════════════════════════════════════════════════ */}
      {view === 'table' && ch === 'BL' && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search items…" className="srch" />
            <MultiCheckDropdown label="Margin Level" id="margin" open={flagDropOpen} setOpen={setFlagDropOpen} options={['High', 'Low']} selected={marginFlagFilter} onToggle={v => toggleFlagFilter('margin', v)} />
            <MultiCheckDropdown label="Menu Mix" id="mix" open={flagDropOpen} setOpen={setFlagDropOpen} options={['High', 'Low']} selected={mixFlagFilter} onToggle={v => toggleFlagFilter('mix', v)} />
            <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 'auto' }}>{blendedTableRows.length} items</span>
            {showExport && <button onClick={exportBlendedCSV} style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid rgba(124,58,237,0.2)', background: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer', color: 'var(--accent)', fontFamily: 'inherit' }}>⬇ Export CSV</button>}
          </div>
          <div className="tw"><div className="tscroll">
            <table>
              <thead><tr>
                <th style={{ minWidth: 160, cursor: 'pointer' }} onClick={() => handleSort('name')}>Item Name{sortArrow('name')}</th>
                <th style={{ cursor: 'pointer', whiteSpace: 'normal' }} onClick={() => handleSort('avg_price')} title="Gross sales ÷ qty for this channel; 3PD carries an additional ×1.22 price markup on top">Uplifted Avg Price{sortArrow('avg_price')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('avg_price_raw')} title="Same as Uplifted Avg Price, before the 3PD ×1.22 markup — identical to Uplifted Avg Price for In-House/RASA Digital">Avg Price{sortArrow('avg_price_raw')}</th>
                <th style={{ cursor: 'pointer', whiteSpace: 'normal' }} onClick={() => handleSort('avg_cost')} title="Pink Sheet Final Avg Cost With Modifier (or r365 Item Cost Lookup fallback); 3PD carries an additional ×1.18 packaging markup on top">Uplifted Avg Cost With Modifiers{sortArrow('avg_cost')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('avg_cost_raw')} title="Same as Uplifted Avg Cost With Modifiers, before the 3PD ×1.18 markup — identical to it for In-House/RASA Digital">Avg Cost{sortArrow('avg_cost_raw')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('margin')} title="Uplifted Avg Price − Uplifted Avg Cost With Modifiers">Margin{sortArrow('margin')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('qty')}>Quantity{sortArrow('qty')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('total_cost')} title="Uplifted Avg Cost With Modifiers × Quantity">Total Cost{sortArrow('total_cost')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('net_sales')} title="Uplifted Avg Price × Quantity">Net Sales{sortArrow('net_sales')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('total_margin')} title="Net Sales − Total Cost">Total Margin{sortArrow('total_margin')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('cogs_pct')} title="Total Cost ÷ Net Sales — cost of goods sold as a % of sales">COGS%{sortArrow('cogs_pct')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('margin_pct')} title="Margin ÷ Uplifted Avg Price">% Margin{sortArrow('margin_pct')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('mix_pct')} title="Item qty ÷ total qty across this view">% Menu Mix{sortArrow('mix_pct')}</th>
                <th title="High if % Margin is above the blended margin threshold ((total net sales − total cost) ÷ total net sales), else Low">Margin Level</th>
                <th title="High if % Menu Mix is above the mix threshold ((1 ÷ item count) × 0.7), else Low">Menu Mix</th>
                <th title="Star = High Margin Level + High Menu Mix · Plow Horse = Low Margin + High Mix · Puzzle = High Margin + Low Mix · Dog = Low Margin + Low Mix">Menu Engineering - Final</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('category')}>Category{sortArrow('category')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('sub_category')}>Sub Category{sortArrow('sub_category')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('sls_pct')} title="Net Sales ÷ grand total Net Sales across every item in this view">Sls %{sortArrow('sls_pct')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('sls_cat_pct')} title="Net Sales ÷ total Net Sales for this item's Category">Sls % Category{sortArrow('sls_cat_pct')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('sls_sub_pct')} title="Net Sales ÷ total Net Sales for this item's Sub Category">Sls % Sub Category{sortArrow('sls_sub_pct')}</th>
              </tr></thead>
              <tbody>
                {blendedTableRowsD.map(r => (
                  <tr key={r.name}>
                    <td style={{ fontWeight: 600 }}>{r.name}</td>
                    <td>{fmt$(r.avg_price)}</td>
                    <td style={{ color: 'var(--muted)' }}>{fmt$(r.avg_price_raw)}</td>
                    <td>{r.avg_cost > 0 ? fmt$(r.avg_cost) : '—'}</td>
                    <td style={{ color: 'var(--muted)' }}>{r.avg_cost_raw > 0 ? fmt$(r.avg_cost_raw) : '—'}</td>
                    <td>{fmt$(r.margin)}</td>
                    <td>{r.qty.toLocaleString()}</td>
                    <td>{fmt$(r.total_cost)}</td>
                    <td style={{ fontWeight: 600 }}>{fmt$(r.net_sales)}</td>
                    <td>{fmt$(r.total_margin)}</td>
                    <td style={{ color: r.cogs_pct > 0.35 ? '#ef4444' : 'inherit' }}>{pct(r.cogs_pct)}</td>
                    <td>{pct(r.margin_pct)}</td>
                    <td>{pct(r.mix_pct, 1)}</td>
                    <td><span style={flagStyle(r.margin_flag)}>{r.margin_flag}</span></td>
                    <td><span style={flagStyle(r.mix_flag)}>{r.mix_flag}</span></td>
                    <td><span style={quadStyle(r.quadrant)}>{r.quadrant}</span></td>
                    <td style={{ fontSize: 10 }}>{r.category}</td>
                    <td style={{ fontSize: 10 }}>{r.sub_category}</td>
                    <td>{pct(r.sls_pct, 2)}</td>
                    <td>{pct(r.sls_cat_pct, 2)}</td>
                    <td>{pct(r.sls_sub_pct, 2)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr style={{ fontWeight: 700, background: 'var(--border)' }}>
                <td>Grand Total</td>
                <td>—</td><td>—</td><td>—</td><td>—</td><td>—</td>
                <td>{blGrandQty.toLocaleString()}</td>
                <td>{fmt$(blGrandCost)}</td>
                <td>{fmt$(blGrandNS)}</td>
                <td>{fmt$(blGrandMgn)}</td>
                <td>{blGrandNS > 0 ? pct(blGrandCost / blGrandNS) : '—'}</td>
                <td>{blGrandNS > 0 ? pct(blGrandMgn / blGrandNS) : '—'}</td>
                <td>100.0%</td>
                <td colSpan={8} />
              </tr></tfoot>
            </table>
          </div></div>
        </>
      )}

      {/* ════════════════════════════════════════════════════════════
          SINGLE-CHANNEL TABLE (IH / LO / 3PD)
          22 cols matching per-channel AppScript masters:
          + Revenue Center, Sls % Sub Category
          ════════════════════════════════════════════════════════════ */}
      {view === 'table' && ch !== 'ALL' && ch !== 'BL' && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search items…" className="srch" />
            <MultiCheckDropdown label="Margin Level" id="margin" open={flagDropOpen} setOpen={setFlagDropOpen} options={['High', 'Low']} selected={marginFlagFilter} onToggle={v => toggleFlagFilter('margin', v)} />
            <MultiCheckDropdown label="Menu Mix" id="mix" open={flagDropOpen} setOpen={setFlagDropOpen} options={['High', 'Low']} selected={mixFlagFilter} onToggle={v => toggleFlagFilter('mix', v)} />
            <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 'auto' }}>{filtered.length} items</span>
            {showExport && <button onClick={exportSingleCSV} style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid rgba(124,58,237,0.2)', background: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer', color: 'var(--accent)', fontFamily: 'inherit' }}>⬇ Export CSV</button>}
          </div>
          <div className="tw"><div className="tscroll">
            <table>
              <thead><tr>
                <th style={{ minWidth: 160, cursor: 'pointer' }} onClick={() => handleSort('name')}>Item Name{sortArrow('name')}</th>
                <th style={{ cursor: 'pointer', whiteSpace: 'normal' }} onClick={() => handleSort('avg_price')} title="Gross sales ÷ qty for this channel; 3PD carries an additional ×1.22 price markup on top">Uplifted Avg Price{sortArrow('avg_price')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('avg_price_raw')} title="Same as Uplifted Avg Price, before the 3PD ×1.22 markup — identical to Uplifted Avg Price for In-House/RASA Digital">Avg Price{sortArrow('avg_price_raw')}</th>
                <th style={{ cursor: 'pointer', whiteSpace: 'normal' }} onClick={() => handleSort('avg_cost')} title="Pink Sheet Final Avg Cost With Modifier (or r365 Item Cost Lookup fallback); 3PD carries an additional ×1.18 packaging markup on top">Uplifted Avg Cost With Modifiers{sortArrow('avg_cost')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('avg_cost_raw')} title="Same as Uplifted Avg Cost With Modifiers, before the 3PD ×1.18 markup — identical to it for In-House/RASA Digital">Avg Cost{sortArrow('avg_cost_raw')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('margin')} title="Uplifted Avg Price − Uplifted Avg Cost With Modifiers">Margin{sortArrow('margin')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('qty')}>Quantity{sortArrow('qty')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('total_cost')} title="Uplifted Avg Cost With Modifiers × Quantity">Total Cost{sortArrow('total_cost')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('net_sales')} title="Uplifted Avg Price × Quantity">Net Sales{sortArrow('net_sales')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('total_margin')} title="Net Sales − Total Cost">Total Margin{sortArrow('total_margin')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('cogs_pct')} title="Total Cost ÷ Net Sales — cost of goods sold as a % of sales">COGS%{sortArrow('cogs_pct')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('margin_pct')} title="Margin ÷ Uplifted Avg Price">% Margin{sortArrow('margin_pct')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('mix_pct')} title="Item qty ÷ total qty across this view">% Menu Mix{sortArrow('mix_pct')}</th>
                <th title="High if % Margin is above the blended margin threshold ((total net sales − total cost) ÷ total net sales), else Low">Margin Level</th>
                <th title="High if % Menu Mix is above the mix threshold ((1 ÷ item count) × 0.7), else Low">Menu Mix</th>
                <th title="Star = High Margin Level + High Menu Mix · Plow Horse = Low Margin + High Mix · Puzzle = High Margin + Low Mix · Dog = Low Margin + Low Mix">Menu Engineering - Final</th>
                <th>Revenue Center</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('category')}>Category{sortArrow('category')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('sub_category')}>Sub Category{sortArrow('sub_category')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('sls_pct')} title="Net Sales ÷ grand total Net Sales across every item in this view">Sls %{sortArrow('sls_pct')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('sls_cat_pct')} title="Net Sales ÷ total Net Sales for this item's Category">Sls % Category{sortArrow('sls_cat_pct')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('sls_sub_pct')} title="Net Sales ÷ total Net Sales for this item's Sub Category">Sls % Sub Category{sortArrow('sls_sub_pct')}</th>
              </tr></thead>
              <tbody>
                {filteredD.map(r => (
                  <tr key={r.name + ch}>
                    <td style={{ fontWeight: 600 }}>{r.name}</td>
                    <td>{fmt$(r.avg_price)}</td>
                    <td style={{ color: 'var(--muted)' }}>{fmt$(r.avg_price_raw)}</td>
                    <td>{r.avg_cost > 0 ? fmt$(r.avg_cost) : '—'}</td>
                    <td style={{ color: 'var(--muted)' }}>{r.avg_cost_raw > 0 ? fmt$(r.avg_cost_raw) : '—'}</td>
                    <td>{fmt$(r.margin)}</td>
                    <td>{r.qty.toLocaleString()}</td>
                    <td>{fmt$(r.total_cost)}</td>
                    <td style={{ fontWeight: 600 }}>{fmt$(r.net_sales)}</td>
                    <td>{fmt$(r.total_margin)}</td>
                    <td style={{ color: r.cogs_pct > 0.35 ? '#ef4444' : 'inherit' }}>{pct(r.cogs_pct)}</td>
                    <td>{pct(r.margin_pct)}</td>
                    <td>{pct(r.mix_pct, 1)}</td>
                    <td><span style={flagStyle(r.margin_flag)}>{r.margin_flag}</span></td>
                    <td><span style={flagStyle(r.mix_flag)}>{r.mix_flag}</span></td>
                    <td><span style={quadStyle(r.quadrant)}>{r.quadrant}</span></td>
                    <td style={{ fontSize: 10, color: 'var(--muted)' }}>{RC_LABELS[ch]}</td>
                    <td style={{ fontSize: 10 }}>{r.category}</td>
                    <td style={{ fontSize: 10 }}>{r.sub_category}</td>
                    <td>{pct(r.sls_pct, 2)}</td>
                    <td>{pct(r.sls_cat_pct, 2)}</td>
                    <td>{pct(r.sls_sub_pct, 2)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr style={{ fontWeight: 700, background: 'var(--border)' }}>
                <td>Grand Total</td>
                <td>—</td><td>—</td><td>—</td><td>—</td><td>—</td>
                <td>{grandQty.toLocaleString()}</td>
                <td>{fmt$(grandCost)}</td>
                <td>{fmt$(grandSales)}</td>
                <td>{fmt$(totalMargin)}</td>
                <td style={{ color: grandSales > 0 && grandCost / grandSales > 0.35 ? '#ef4444' : 'inherit' }}>
                  {grandSales > 0 ? pct(grandCost / grandSales) : '—'}
                </td>
                <td>{grandSales > 0 ? pct(totalMargin / grandSales) : '—'}</td>
                <td>100.0%</td>
                <td colSpan={9} />
              </tr></tfoot>
            </table>
          </div></div>
        </>
      )}
    </div>
  );
}
