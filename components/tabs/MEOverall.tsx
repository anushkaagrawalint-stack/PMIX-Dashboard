'use client';
import { useState, useMemo } from 'react';
import type { MERow, PinkSheetRow } from '@/lib/types';
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
  ALL: 'Overall', BL: 'Blended (IH+LO+3PD)', IH: 'In House', LO: 'Loyalty / APP', '3PD': '3rd Party Delivery',
};
const RC_LABELS: Record<ChannelTab, string> = {
  ALL: 'ALL', BL: 'BLENDED', IH: 'IN-HOUSE', LO: 'LOYALTY', '3PD': '3PD',
};
const MENU_LABELS: Record<'IH' | 'LO' | '3PD', string> = {
  IH: 'IN-HOUSE', LO: 'LOYALTY', '3PD': '3PD',
};
const QUAD: Record<QuadrantKey, { bg: string; color: string; fill: string; label: string }> = {
  Star:         { bg: '#dcfce7', color: '#14532d', fill: '#16a34a', label: 'Stars' },
  'Plow Horse': { bg: '#ede9fe', color: '#5b21b6', fill: '#7c3aed', label: 'Plow Horses' },
  Puzzle:       { bg: '#dbeafe', color: '#1e3a8a', fill: '#1e40af', label: 'Puzzles' },
  Dog:          { bg: '#fee2e2', color: '#991b1b', fill: '#dc2626', label: 'Dogs' },
};
const CH_BADGE: Record<'IH' | 'LO' | '3PD', { bg: string; color: string }> = {
  IH:    { bg: '#eff6ff', color: '#1e40af' },
  LO:    { bg: '#f0fdf4', color: '#14532d' },
  '3PD': { bg: '#fef3c7', color: '#92400e' },
};

interface BaseRow {
  name: string; category: string; sub_category: string;
  avg_price: number; avg_cost: number;
  qty: number; net_sales: number; total_cost: number;
}
interface ChannelRow extends BaseRow {
  margin_pct: number; mix_pct: number; cogs_pct: number;
  margin_flag: 'High' | 'Low'; mix_flag: 'High' | 'Low'; quadrant: QuadrantKey;
}
// For Overall flat list: one row per item × channel
interface FlatRow {
  name: string; category: string; sub_category: string;
  avg_price: number; avg_cost: number; margin: number;
  qty: number; total_cost: number; net_sales: number; total_margin: number;
  cogs_pct: number; margin_pct: number; mix_pct: number;
  margin_flag: 'High' | 'Low'; mix_flag: 'High' | 'Low'; quadrant: QuadrantKey;
  menu: string; // IN-HOUSE / LOYALTY / 3PD
  sls_pct: number; sls_cat_pct: number;
  ch: 'IH' | 'LO' | '3PD';
}

function getChData(i: MERow, c: 'IH' | 'LO' | '3PD') {
  if (c === 'IH')  return { qty: i.qty_ih,  ns: i.net_sales_ih,  price: i.avg_price_ih };
  if (c === 'LO')  return { qty: i.qty_lo,  ns: i.net_sales_lo,  price: i.avg_price_lo };
  return                   { qty: i.qty_3pd, ns: i.net_sales_3pd, price: i.avg_price_3pd };
}
function getChCost(i: MERow, c: 'IH' | 'LO' | '3PD', ps: PinkSheetRow | undefined) {
  if (ps) return c === 'IH' ? ps.avg_cost_ih : c === 'LO' ? ps.avg_cost_online : ps.avg_cost_3pd;
  return c === 'IH' ? i.avg_cost_ih : c === 'LO' ? i.avg_cost_lo : i.avg_cost_3pd;
}

function buildBaseRows(meItems: MERow[], ch: ChannelTab, psMap: Map<string, PinkSheetRow>): BaseRow[] {
  return meItems.map(i => {
    let price: number, qty: number, ns: number;
    switch (ch) {
      case 'IH':  price = i.avg_price_ih;  qty = i.qty_ih;  ns = i.net_sales_ih;  break;
      case 'LO':  price = i.avg_price_lo;  qty = i.qty_lo;  ns = i.net_sales_lo;  break;
      case '3PD': price = i.avg_price_3pd; qty = i.qty_3pd; ns = i.net_sales_3pd; break;
      default:    price = i.avg_price;     qty = i.qty;     ns = i.net_sales;
    }
    if (!qty) return null;
    const ps = psMap.get(i.canonical_name);
    let cost: number;
    if (ps) {
      switch (ch) {
        case 'IH':  cost = ps.avg_cost_ih;     break;
        case 'LO':  cost = ps.avg_cost_online;  break;
        case '3PD': cost = ps.avg_cost_3pd;     break;
        default: {
          const tq = i.qty_ih + i.qty_lo + i.qty_3pd;
          cost = tq > 0
            ? (ps.avg_cost_ih * i.qty_ih + ps.avg_cost_online * i.qty_lo + ps.avg_cost_3pd * i.qty_3pd) / tq
            : ps.avg_cost_online;
        }
      }
    } else {
      switch (ch) {
        case 'IH':  cost = i.avg_cost_ih;  break;
        case 'LO':  cost = i.avg_cost_lo;  break;
        case '3PD': cost = i.avg_cost_3pd; break;
        default:    cost = i.avg_cost;
      }
    }
    return { name: i.canonical_name, category: i.category, sub_category: i.sub_category,
             avg_price: price, avg_cost: cost, qty, net_sales: ns, total_cost: cost * qty };
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
    const mf:  'High' | 'Low' = margin_pct >= mThresh  ? 'High' : 'Low';
    const mxf: 'High' | 'Low' = mix_pct   >= mmThresh  ? 'High' : 'Low';
    const quadrant: QuadrantKey =
      mxf === 'High' && mf === 'High' ? 'Star' :
      mxf === 'High' && mf === 'Low'  ? 'Plow Horse' :
      mxf === 'Low'  && mf === 'High' ? 'Puzzle' : 'Dog';
    return { ...r, margin_pct, mix_pct, cogs_pct, margin_flag: mf, mix_flag: mxf, quadrant };
  });
}

export default function MEOverall({
  meItems, pinkSheets,
}: {
  meItems: MERow[];
  pinkSheets: PinkSheetRow[];
}) {
  const [ch,         setCh]         = useState<ChannelTab>('ALL');
  const [search,     setSearch]     = useState('');
  const [quadFilter, setQuadFilter] = useState<Set<QuadrantKey>>(new Set());
  const [view,       setView]       = useState<ViewMode>('table');
  const safeItems = meItems ?? [];

  const psMap = useMemo(() => {
    const m = new Map<string, PinkSheetRow>();
    (pinkSheets ?? []).forEach(p => m.set(p.canonical_name, p));
    return m;
  }, [pinkSheets]);

  // ── For scatter / bar / quadrant cards: single-channel or blended base rows ──
  const rawRows = useMemo(() => {
    // BL scatter/bar uses 'ALL' (IH+LO+3PD) to match AppScript blended
    const tab = ch === 'BL' ? 'ALL' : ch;
    return buildBaseRows(safeItems, tab as ChannelTab, psMap);
  }, [safeItems, ch, psMap]);

  const grandSales = useMemo(() => rawRows.reduce((s, r) => s + r.net_sales,  0), [rawRows]);
  const grandQty   = useMemo(() => rawRows.reduce((s, r) => s + r.qty,        0), [rawRows]);
  const grandCost  = useMemo(() => rawRows.reduce((s, r) => s + r.total_cost, 0), [rawRows]);
  const marginThreshold = grandSales > 0 ? (grandSales - grandCost) / grandSales : 0;
  const mixThreshold    = rawRows.length > 0 ? (1 / rawRows.length) * 0.7 : 0;

  const rows = useMemo<ChannelRow[]>(() =>
    addQuadrant(rawRows, grandSales, grandQty, grandCost),
  [rawRows, grandSales, grandQty, grandCost]);

  const quadStats = useMemo(() => {
    const s: Record<QuadrantKey, { count: number; revenue: number }> = {
      Star: { count: 0, revenue: 0 }, 'Plow Horse': { count: 0, revenue: 0 },
      Puzzle: { count: 0, revenue: 0 }, Dog: { count: 0, revenue: 0 },
    };
    rows.forEach(r => { s[r.quadrant].count++; s[r.quadrant].revenue += r.net_sales; });
    return s;
  }, [rows]);

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
        const ps = psMap.get(i.canonical_name);
        tNS   += ns;
        tCost += getChCost(i, c, ps) * qty;
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
  }, [safeItems, psMap]);

  // ── Overall (ALL) flat list: one row per item × channel ──
  const overallFlatRows = useMemo((): FlatRow[] => {
    if (ch !== 'ALL') return [];
    const q = search.toLowerCase();
    const t = perChThresh;
    const grandQtyAll = t.IH.totalQty + t.LO.totalQty + t['3PD'].totalQty;
    const grandNSAll  = t.IH.totalNS  + t.LO.totalNS  + t['3PD'].totalNS;
    // category NS across all channels (for Sls% Category)
    const catNS: Record<string, number> = {};
    safeItems.forEach(i => {
      catNS[i.category] = (catNS[i.category] ?? 0) + i.net_sales_ih + i.net_sales_lo + i.net_sales_3pd;
    });

    const result: FlatRow[] = [];
    safeItems
      .filter(i => i.qty > 0 && (!q || i.canonical_name.toLowerCase().includes(q)))
      .forEach(i => {
        const ps = psMap.get(i.canonical_name);
        (['IH', 'LO', '3PD'] as const).forEach(c => {
          const { qty, ns, price } = getChData(i, c);
          if (qty <= 0) return;
          const cost       = getChCost(i, c, ps);
          const margin     = price - cost;
          const tc         = cost * qty;
          const totMgn     = ns - tc;
          const cogs_pct   = ns > 0 ? tc / ns : 0;
          const margin_pct = price > 0 ? margin / price : 0;
          const mix_pct    = grandQtyAll > 0 ? qty / grandQtyAll : 0;
          const thresh     = t[c];
          const mf:  'High' | 'Low' = margin_pct >= thresh.mThresh  ? 'High' : 'Low';
          const mxf: 'High' | 'Low' = mix_pct    >= thresh.mmThresh ? 'High' : 'Low';
          const quadrant: QuadrantKey =
            mxf === 'High' && mf === 'High' ? 'Star' :
            mxf === 'High' && mf === 'Low'  ? 'Plow Horse' :
            mxf === 'Low'  && mf === 'High' ? 'Puzzle' : 'Dog';
          result.push({
            name: i.canonical_name, category: i.category, sub_category: i.sub_category,
            avg_price: price, avg_cost: cost, margin, qty, total_cost: tc,
            net_sales: ns, total_margin: totMgn, cogs_pct, margin_pct, mix_pct,
            margin_flag: mf, mix_flag: mxf, quadrant,
            menu: MENU_LABELS[c],
            sls_pct:     grandNSAll > 0 ? ns / grandNSAll : 0,
            sls_cat_pct: catNS[i.category] > 0 ? ns / catNS[i.category] : 0,
            ch: c,
          });
        });
      });
    // Sort: item name asc, then by channel order IH → LO → 3PD
    const ORDER = { IH: 0, LO: 1, '3PD': 2 };
    return result
      .filter(r => quadFilter.size === 0 || quadFilter.has(r.quadrant))
      .sort((a, b) => a.name.localeCompare(b.name) || ORDER[a.ch] - ORDER[b.ch]);
  }, [safeItems, ch, psMap, perChThresh, search, quadFilter]);

  // ── Blended (BL) table rows: IH+LO+3PD aggregated (AppScript stepBuildBlendedMaster) ──
  const blendedTableRows = useMemo<ChannelRow[]>(() => {
    if (ch !== 'BL') return [];
    // `rows` already uses ALL data (ch === 'BL' → rawRows uses 'ALL' build)
    const q = search.toLowerCase();
    const filtered = rows.filter(r => !q || r.name.toLowerCase().includes(q));
    // Recompute thresholds on filtered set only (for displayed items)
    const gS = filtered.reduce((s, r) => s + r.net_sales, 0);
    const gQ = filtered.reduce((s, r) => s + r.qty, 0);
    const gC = filtered.reduce((s, r) => s + r.total_cost, 0);
    const withQuad = addQuadrant(filtered, gS, gQ, gC);
    return quadFilter.size === 0 ? withQuad : withQuad.filter(r => quadFilter.has(r.quadrant));
  }, [ch, rows, search, quadFilter]);

  // filtered set for single-channel table / scatter / bar
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return rows.filter(r =>
      (!q || r.name.toLowerCase().includes(q)) &&
      (quadFilter.size === 0 || quadFilter.has(r.quadrant))
    );
  }, [rows, search, quadFilter]);

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

  const mtPct  = Math.round(marginThreshold * 10000) / 100;
  const mxtPct = Math.round(mixThreshold    * 100000) / 1000;

  // ── Export helpers ──
  function exportOverallCSV() {
    const hdr = 'Item Name,Avg Price,Avg Cost With Modifiers,Margin,Quantity,Total Cost,Net Sales,Total Margin,COGS%,% Margin,% Menu Mix,Margin 2,Menu Mix,Menu Engineering - Final,Menu,Category,Sub Category,Sls %,Sls % Category';
    const csvRows = overallFlatRows.map(r => [
      `"${r.name}"`, r.avg_price.toFixed(2), r.avg_cost > 0 ? r.avg_cost.toFixed(2) : '',
      r.margin.toFixed(2), r.qty, r.total_cost.toFixed(2), r.net_sales.toFixed(2),
      r.total_margin.toFixed(2), pct(r.cogs_pct), pct(r.margin_pct), pct(r.mix_pct, 3),
      r.margin_flag, r.mix_flag, r.quadrant, r.menu,
      `"${r.category}"`, `"${r.sub_category}"`, pct(r.sls_pct, 2), pct(r.sls_cat_pct, 2),
    ].join(','));
    const blob = new Blob([[hdr, ...csvRows].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'menu-engineering-overall.csv'; a.click();
  }

  function exportBlendedCSV() {
    const hdr = 'Item Name,Avg Price,Avg Cost With Modifiers,Margin,Quantity,Total Cost,Net Sales,Total Margin,COGS%,% Margin,% Menu Mix,Margin 2,Menu Mix,Menu Engineering - Final,Category,Sub Category,Sls %,Sls % Category,Sls % Sub Category';
    const csvRows = blendedTableRows.map(r => {
      const margin = r.avg_price - r.avg_cost;
      const totMgn = r.net_sales - r.total_cost;
      const slsPct = blGrandNS > 0 ? r.net_sales / blGrandNS : 0;
      const slsCat = (blCatSales[r.category] ?? 0) > 0 ? r.net_sales / blCatSales[r.category] : 0;
      const slsSub = (blSubCatSales[r.sub_category] ?? 0) > 0 ? r.net_sales / blSubCatSales[r.sub_category] : 0;
      return [
        `"${r.name}"`, r.avg_price.toFixed(2), r.avg_cost > 0 ? r.avg_cost.toFixed(2) : '',
        margin.toFixed(2), r.qty, r.total_cost.toFixed(2), r.net_sales.toFixed(2),
        totMgn.toFixed(2), pct(r.cogs_pct), pct(r.margin_pct), pct(r.mix_pct, 3),
        r.margin_flag, r.mix_flag, r.quadrant,
        `"${r.category}"`, `"${r.sub_category}"`, pct(slsPct, 2), pct(slsCat, 2), pct(slsSub, 2),
      ].join(',');
    });
    const blob = new Blob([[hdr, ...csvRows].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'menu-engineering-blended.csv'; a.click();
  }

  function exportSingleCSV() {
    const hdr = 'Item Name,Avg Price,Avg Cost With Modifiers,Margin,Quantity,Total Cost,Net Sales,Total Margin,COGS%,% Margin,% Menu Mix,Margin 2,Menu Mix,Menu Engineering - Final,Revenue Center,Category,Sub Category,Sls %,Sls % Category,Sls % Sub Category';
    const csvRows = filtered.map(r => {
      const margin = r.avg_price - r.avg_cost;
      const totMgn = r.net_sales - r.total_cost;
      const slsPct = grandSales > 0 ? r.net_sales / grandSales : 0;
      const slsCat = (catSales[r.category] ?? 0) > 0 ? r.net_sales / catSales[r.category] : 0;
      const slsSub = (subCatSales[r.sub_category] ?? 0) > 0 ? r.net_sales / subCatSales[r.sub_category] : 0;
      return [
        `"${r.name}"`, r.avg_price.toFixed(2), r.avg_cost > 0 ? r.avg_cost.toFixed(2) : '',
        margin.toFixed(2), r.qty, r.total_cost.toFixed(2), r.net_sales.toFixed(2),
        totMgn.toFixed(2), pct(r.cogs_pct), pct(r.margin_pct), pct(r.mix_pct, 3),
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
    const c = menu === 'IN-HOUSE' ? CH_BADGE.IH : menu === 'LOYALTY' ? CH_BADGE.LO : CH_BADGE['3PD'];
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
              <div style={{ fontSize: 9, fontWeight: 700, color: qd.color, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 2 }}>{qd.label}</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: qd.color, lineHeight: 1.1 }}>{s.count}</div>
              <div style={{ fontSize: 10, color: qd.color, opacity: 0.8, marginTop: 2 }}>{fmt$R(s.revenue)}</div>
            </div>
          );
        })}
      </div>

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
                   % Margin | % Menu Mix | Margin 2 | Menu Mix |
                   ME Final | Menu | Category | Sub Category |
                   Sls % | Sls % Category
          ════════════════════════════════════════════════════════════ */}
      {view === 'table' && ch === 'ALL' && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search items…" className="srch" />
            <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 'auto' }}>{overallFlatRows.length} rows</span>
            <button onClick={exportOverallCSV} style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid rgba(124,58,237,0.2)', background: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer', color: 'var(--accent)', fontFamily: 'inherit' }}>⬇ Export CSV</button>
          </div>
          <div className="tw"><div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr>
                <th style={{ minWidth: 160 }}>Item Name</th>
                <th>Avg Price</th>
                <th>Avg Cost With Modifiers</th>
                <th>Margin</th>
                <th>Quantity</th>
                <th>Total Cost</th>
                <th>Net Sales</th>
                <th>Total Margin</th>
                <th>COGS%</th>
                <th>% Margin</th>
                <th>% Menu Mix</th>
                <th>Margin 2</th>
                <th>Menu Mix</th>
                <th>Menu Engineering - Final</th>
                <th>Menu</th>
                <th>Category</th>
                <th>Sub Category</th>
                <th>Sls %</th>
                <th>Sls % Category</th>
              </tr></thead>
              <tbody>
                {overallFlatRows.map((r, idx) => (
                  <tr key={r.name + r.ch + idx}>
                    <td style={{ fontWeight: 600 }}>{r.name}</td>
                    <td>{fmt$(r.avg_price)}</td>
                    <td>{r.avg_cost > 0 ? fmt$(r.avg_cost) : '—'}</td>
                    <td>{fmt$(r.margin)}</td>
                    <td>{r.qty.toLocaleString()}</td>
                    <td>{fmt$(r.total_cost)}</td>
                    <td style={{ fontWeight: 600 }}>{fmt$(r.net_sales)}</td>
                    <td>{fmt$(r.total_margin)}</td>
                    <td style={{ color: r.cogs_pct > 0.35 ? '#ef4444' : 'inherit' }}>{pct(r.cogs_pct)}</td>
                    <td>{pct(r.margin_pct)}</td>
                    <td>{pct(r.mix_pct, 3)}</td>
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
                <td>—</td><td>—</td><td>—</td>
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
                   % Margin | % Menu Mix | Margin 2 | Menu Mix |
                   ME Final | Category | Sub Category |
                   Sls % | Sls % Category | Sls % Sub Category
          ════════════════════════════════════════════════════════════ */}
      {view === 'table' && ch === 'BL' && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search items…" className="srch" />
            <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 'auto' }}>{blendedTableRows.length} items</span>
            <button onClick={exportBlendedCSV} style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid rgba(124,58,237,0.2)', background: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer', color: 'var(--accent)', fontFamily: 'inherit' }}>⬇ Export CSV</button>
          </div>
          <div className="tw"><div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr>
                <th style={{ minWidth: 160 }}>Item Name</th>
                <th>Avg Price</th>
                <th>Avg Cost With Modifiers</th>
                <th>Margin</th>
                <th>Quantity</th>
                <th>Total Cost</th>
                <th>Net Sales</th>
                <th>Total Margin</th>
                <th>COGS%</th>
                <th>% Margin</th>
                <th>% Menu Mix</th>
                <th>Margin 2</th>
                <th>Menu Mix</th>
                <th>Menu Engineering - Final</th>
                <th>Category</th>
                <th>Sub Category</th>
                <th>Sls %</th>
                <th>Sls % Category</th>
                <th>Sls % Sub Category</th>
              </tr></thead>
              <tbody>
                {blendedTableRows.map(r => {
                  const margin  = r.avg_price - r.avg_cost;
                  const totMgn  = r.net_sales - r.total_cost;
                  const slsPct  = blGrandNS > 0 ? r.net_sales / blGrandNS : 0;
                  const slsCat  = (blCatSales[r.category]      ?? 0) > 0 ? r.net_sales / blCatSales[r.category]      : 0;
                  const slsSub  = (blSubCatSales[r.sub_category] ?? 0) > 0 ? r.net_sales / blSubCatSales[r.sub_category] : 0;
                  return (
                    <tr key={r.name}>
                      <td style={{ fontWeight: 600 }}>{r.name}</td>
                      <td>{fmt$(r.avg_price)}</td>
                      <td>{r.avg_cost > 0 ? fmt$(r.avg_cost) : '—'}</td>
                      <td>{fmt$(margin)}</td>
                      <td>{r.qty.toLocaleString()}</td>
                      <td>{fmt$(r.total_cost)}</td>
                      <td style={{ fontWeight: 600 }}>{fmt$(r.net_sales)}</td>
                      <td>{fmt$(totMgn)}</td>
                      <td style={{ color: r.cogs_pct > 0.35 ? '#ef4444' : 'inherit' }}>{pct(r.cogs_pct)}</td>
                      <td>{pct(r.margin_pct)}</td>
                      <td>{pct(r.mix_pct, 3)}</td>
                      <td><span style={flagStyle(r.margin_flag)}>{r.margin_flag}</span></td>
                      <td><span style={flagStyle(r.mix_flag)}>{r.mix_flag}</span></td>
                      <td><span style={quadStyle(r.quadrant)}>{r.quadrant}</span></td>
                      <td style={{ fontSize: 10 }}>{r.category}</td>
                      <td style={{ fontSize: 10 }}>{r.sub_category}</td>
                      <td>{pct(slsPct, 2)}</td>
                      <td>{pct(slsCat, 2)}</td>
                      <td>{pct(slsSub, 2)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot><tr style={{ fontWeight: 700, background: 'var(--border)' }}>
                <td>Grand Total</td>
                <td>—</td><td>—</td><td>—</td>
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
            <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 'auto' }}>{filtered.length} items</span>
            <button onClick={exportSingleCSV} style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid rgba(124,58,237,0.2)', background: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer', color: 'var(--accent)', fontFamily: 'inherit' }}>⬇ Export CSV</button>
          </div>
          <div className="tw"><div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr>
                <th style={{ minWidth: 160 }}>Item Name</th>
                <th>Avg Price</th>
                <th>Avg Cost With Modifiers</th>
                <th>Margin</th>
                <th>Quantity</th>
                <th>Total Cost</th>
                <th>Net Sales</th>
                <th>Total Margin</th>
                <th>COGS%</th>
                <th>% Margin</th>
                <th>% Menu Mix</th>
                <th>Margin 2</th>
                <th>Menu Mix</th>
                <th>Menu Engineering - Final</th>
                <th>Revenue Center</th>
                <th>Category</th>
                <th>Sub Category</th>
                <th>Sls %</th>
                <th>Sls % Category</th>
                <th>Sls % Sub Category</th>
              </tr></thead>
              <tbody>
                {filtered.map(r => {
                  const margin  = r.avg_price - r.avg_cost;
                  const totMgn  = r.net_sales - r.total_cost;
                  const slsPct  = grandSales > 0 ? r.net_sales / grandSales : 0;
                  const slsCat  = (catSales[r.category]         ?? 0) > 0 ? r.net_sales / catSales[r.category]         : 0;
                  const slsSub  = (subCatSales[r.sub_category]  ?? 0) > 0 ? r.net_sales / subCatSales[r.sub_category]  : 0;
                  return (
                    <tr key={r.name + ch}>
                      <td style={{ fontWeight: 600 }}>{r.name}</td>
                      <td>{fmt$(r.avg_price)}</td>
                      <td>{r.avg_cost > 0 ? fmt$(r.avg_cost) : '—'}</td>
                      <td>{fmt$(margin)}</td>
                      <td>{r.qty.toLocaleString()}</td>
                      <td>{fmt$(r.total_cost)}</td>
                      <td style={{ fontWeight: 600 }}>{fmt$(r.net_sales)}</td>
                      <td>{fmt$(totMgn)}</td>
                      <td style={{ color: r.cogs_pct > 0.35 ? '#ef4444' : 'inherit' }}>{pct(r.cogs_pct)}</td>
                      <td>{pct(r.margin_pct)}</td>
                      <td>{pct(r.mix_pct, 3)}</td>
                      <td><span style={flagStyle(r.margin_flag)}>{r.margin_flag}</span></td>
                      <td><span style={flagStyle(r.mix_flag)}>{r.mix_flag}</span></td>
                      <td><span style={quadStyle(r.quadrant)}>{r.quadrant}</span></td>
                      <td style={{ fontSize: 10, color: 'var(--muted)' }}>{RC_LABELS[ch]}</td>
                      <td style={{ fontSize: 10 }}>{r.category}</td>
                      <td style={{ fontSize: 10 }}>{r.sub_category}</td>
                      <td>{pct(slsPct, 2)}</td>
                      <td>{pct(slsCat, 2)}</td>
                      <td>{pct(slsSub, 2)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot><tr style={{ fontWeight: 700, background: 'var(--border)' }}>
                <td>Grand Total</td>
                <td>—</td><td>—</td><td>—</td>
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
