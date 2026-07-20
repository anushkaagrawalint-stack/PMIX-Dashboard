'use client';
import { useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts';
import type { DashboardData, MakeItMealModifierRow } from '@/lib/types';
import { normalizeCategory } from '@/lib/constants';

const fmt$ = (v: number) =>
  `$${Math.round(v).toLocaleString('en-US')}`;

const CAT_ORDER = ['Entrees', 'Sides', 'NA Drinks', 'Sweets', 'Alc Drinks', 'Retail', 'Other'];
const LOC_SHADES = ['#4f46e5', '#7c3aed', '#2563eb', '#6d28d9', '#1d4ed8', '#5b21b6'];

type Metric = 'revenue' | 'qty' | 'mix_pct';

const METRIC_LABELS: Record<Metric, string> = {
  revenue: 'Revenue',
  qty:     'Qty Sold',
  mix_pct: '% Mix',
};

export default function LocationCompare({ data, makeItMealModifiers }: { data: DashboardData; makeItMealModifiers: MakeItMealModifierRow[] }) {
  const { locationItems, items, locations } = data;

  const [includeMakeItMeal, setIncludeMakeItMeal] = useState(false);

  // canonical_name|channel|location_code → make-it-a-meal qty + real price.
  // Unlike ItemMix/Overview (canonical_name|channel only), this tab attributes
  // revenue PER LOCATION, so location_code must be part of the join key —
  // MakeItMealModifierRow carries it (unlike ChannelItemRow), so this is exact,
  // not an even split across locations.
  const makeItMealMap = useMemo(() => {
    const m = new Map<string, { qty: number; price: number }>();
    makeItMealModifiers.forEach(r => {
      const key = `${r.canonical_name}|${r.channel}|${r.location_code}`;
      const ex  = m.get(key) ?? { qty: 0, price: 0 };
      m.set(key, { qty: ex.qty + r.qty, price: ex.price + r.price });
    });
    return m;
  }, [makeItMealModifiers]);

  // Per-location modifier-pick qty total — purely for the KPI cards' "+X from
  // Make It a Meal" note text. qty itself is already combined via
  // effectiveLocationItems below (every table/chart in this tab reads that,
  // not this map), so this is never added a second time.
  const locMakeItMealQty = useMemo(() => {
    const m = new Map<string, number>();
    if (!includeMakeItMeal) return m;
    makeItMealMap.forEach((v, key) => {
      const location_code = key.split('|')[2];
      m.set(location_code, (m.get(location_code) ?? 0) + v.qty);
    });
    return m;
  }, [makeItMealMap, includeMakeItMeal]);

  // Folds Make It a Meal qty + price into matching rows (qty combines, same
  // as revenue/gross_sales/net_after_refunds), and adds a synthetic row for a
  // modifier-only pick with no standalone line. Every chart/table in this tab
  // (locStats, locCatData, dataMap, topByLocation, barData, the item
  // comparison table) reads this single array, so they all inherit the
  // combine automatically — mix_pct is the one exception, left as reported
  // (a backend-computed % that would need the full location total to redo correctly).
  const effectiveLocationItems = useMemo(() => {
    if (!includeMakeItMeal) return locationItems;
    const rows = locationItems.map(r => {
      const mm = makeItMealMap.get(`${r.canonical_name}|${r.channel}|${r.location_code}`);
      if (!mm || (mm.price === 0 && mm.qty === 0)) return r;
      return {
        ...r,
        qty:               r.qty               + mm.qty,
        revenue:           r.revenue           + mm.price,
        gross_sales:       r.gross_sales       + mm.price,
        net_after_refunds: r.net_after_refunds + mm.price,
      };
    });
    const existingKeys = new Set(locationItems.map(r => `${r.canonical_name}|${r.channel}|${r.location_code}`));
    makeItMealMap.forEach((mm, key) => {
      if (existingKeys.has(key)) return;
      const [name, channel, location_code] = key.split('|');
      rows.push({
        canonical_name: name,
        location_code,
        channel,
        qty: mm.qty,
        revenue: mm.price,
        gross_sales: mm.price,
        mix_pct: 0,
        refunds: 0,
        net_after_refunds: mm.price,
      });
    });
    return rows;
  }, [locationItems, makeItMealMap, includeMakeItMeal]);

  const locMeta = useMemo(
    () => locations.map((l, i) => ({ ...l, color: LOC_SHADES[i % LOC_SHADES.length] })),
    [locations],
  );

  // Tester-only "Open Locations" quick-select — recomputed live from
  // analytics.location_status, never hardcoded.
  const openLocationCodes = useMemo(
    () => locations.filter(l => l.is_open).map(l => l.location_code),
    [locations],
  );

  const [selectedLocs, setSelectedLocs] = useState<string[]>([]);
  const [locOpen, setLocOpen]           = useState(false);
  const [metric, setMetric]             = useState<Metric>('revenue');
  const [search, setSearch]             = useState('');
  const [sortCol, setSortCol]           = useState<string>('avg');
  const [sortDir, setSortDir]           = useState<'desc' | 'asc'>('desc');
  const [limit, setLimit]               = useState<10 | 20 | 50 | 100 | 'all'>(20);
  const [catShowAmt, setCatShowAmt]     = useState(false);
  const [locShowBottom, setLocShowBottom] = useState(false);
  const [locTopView,    setLocTopView]    = useState<'pct' | 'exact'>('pct');

  const activeMeta = useMemo(() =>
    selectedLocs.length === 0 ? locMeta : locMeta.filter(l => selectedLocs.includes(l.location_code)),
  [locMeta, selectedLocs]);

  function toggleLoc(code: string) {
    setSelectedLocs(prev => prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]);
  }

  const isOpenLocationsSelected = selectedLocs.length > 0
    && selectedLocs.length === openLocationCodes.length
    && openLocationCodes.every(c => selectedLocs.includes(c));

  function handleColSort(col: string) {
    if (sortCol === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortCol(col); setSortDir('desc'); }
  }

  const sortArrow = (col: string) => sortCol === col ? (sortDir === 'desc' ? ' ↓' : ' ↑') : '';

  const locLabel = selectedLocs.length === 0
    ? 'All Locations'
    : selectedLocs.length === 1
      ? locMeta.find(l => l.location_code === selectedLocs[0])?.display_name ?? 'Location'
      : `${selectedLocs.length} Locations`;

  const locStats = useMemo(() => {
    // Aggregate per (location, item) first so topItem reflects item totals, not channel-specific revenue
    const itemTotals: Record<string, Record<string, { revenue: number; qty: number }>> = {};
    const refundTotals: Record<string, number> = {};
    effectiveLocationItems.forEach(r => {
      if (!itemTotals[r.location_code]) itemTotals[r.location_code] = {};
      const it = itemTotals[r.location_code];
      if (!it[r.canonical_name]) it[r.canonical_name] = { revenue: 0, qty: 0 };
      it[r.canonical_name].revenue += r.revenue;
      it[r.canonical_name].qty     += r.qty;
      refundTotals[r.location_code] = (refundTotals[r.location_code] ?? 0) + (r.refunds ?? 0);
    });
    const stats: Record<string, { revenue: number; qty: number; refunds: number; topItem: string; topRev: number }> = {};
    for (const [loc, items] of Object.entries(itemTotals)) {
      let revenue = 0, qty = 0, topItem = '', topRev = 0;
      for (const [name, v] of Object.entries(items)) {
        revenue += v.revenue;
        qty     += v.qty;
        if (v.revenue > topRev) { topRev = v.revenue; topItem = name; }
      }
      const refunds = refundTotals[loc] ?? 0;
      stats[loc] = { revenue: revenue - refunds, qty, refunds, topItem, topRev };
    }
    return stats;
  }, [effectiveLocationItems]);

  const locCatData = useMemo(() => {
    const meta: Record<string, string> = {};
    items.forEach(i => { if (!meta[i.canonical_name]) meta[i.canonical_name] = normalizeCategory(i.category); });
    const map: Record<string, Record<string, { revenue: number; qty: number }>> = {};
    effectiveLocationItems.forEach(r => {
      const cat = meta[r.canonical_name] ?? 'Other';
      if (!map[r.location_code]) map[r.location_code] = {};
      if (!map[r.location_code][cat]) map[r.location_code][cat] = { revenue: 0, qty: 0 };
      map[r.location_code][cat].revenue += r.revenue;
      map[r.location_code][cat].qty     += r.qty;
    });
    return map;
  }, [effectiveLocationItems, items]);

  const dataMap = useMemo(() => {
    // Sum across channels for each (canonical_name, location_code) pair
    const m: Record<string, Record<string, { qty: number; revenue: number; mix_pct: number }>> = {};
    effectiveLocationItems.forEach(r => {
      if (!m[r.canonical_name]) m[r.canonical_name] = {};
      const existing = m[r.canonical_name][r.location_code];
      if (existing) {
        existing.qty     += r.qty;
        existing.revenue += r.revenue;
        existing.mix_pct += r.mix_pct;
      } else {
        m[r.canonical_name][r.location_code] = { qty: r.qty, revenue: r.revenue, mix_pct: r.mix_pct };
      }
    });
    return m;
  }, [effectiveLocationItems]);

  const barData = useMemo(() =>
    activeMeta.map(l => ({
      name:  l.display_name,
      value: metric === 'qty' || metric === 'mix_pct'
        ? (locStats[l.location_code]?.qty ?? 0)
        : (locStats[l.location_code]?.revenue ?? 0),
      color: l.color,
    })),
  [activeMeta, locStats, metric]);

  const topByLocation = useMemo(() => {
    const map: Record<string, Array<{ name: string; rev: number; qty: number; revPct: number; qtyPct: number }>> = {};
    activeMeta.forEach(l => {
      const agg: Record<string, { rev: number; qty: number }> = {};
      effectiveLocationItems.filter(r => r.location_code === l.location_code).forEach(r => {
        const e = agg[r.canonical_name] ?? { rev: 0, qty: 0 };
        e.rev += r.revenue;
        e.qty += r.qty;
        agg[r.canonical_name] = e;
      });
      const totalRev = Object.values(agg).reduce((s, v) => s + v.rev, 0) || 1;
      const totalQty = Object.values(agg).reduce((s, v) => s + v.qty, 0) || 1;
      map[l.location_code] = Object.entries(agg)
        .sort((a, b) => locShowBottom ? a[1].rev - b[1].rev : b[1].rev - a[1].rev)
        .slice(0, 10)
        .map(([name, { rev, qty }]) => ({
          name: name.length > 26 ? name.slice(0, 24) + '…' : name,
          rev, qty,
          revPct: Math.round((rev / totalRev) * 1000) / 10,
          qtyPct: Math.round((qty / totalQty) * 1000) / 10,
        }));
    });
    return map;
  }, [effectiveLocationItems, activeMeta, locShowBottom]);

  const topLocRows: typeof activeMeta[] = [];
  for (let i = 0; i < activeMeta.length; i += 3) topLocRows.push(activeMeta.slice(i, i + 3));

  const allItems = useMemo(() => {
    const q    = search.toLowerCase();
    const seen = new Set<string>();
    const names: string[] = [];
    for (const i of items) {
      if (!seen.has(i.canonical_name)) { seen.add(i.canonical_name); names.push(i.canonical_name); }
    }
    // A Make It a Meal pick with no standalone line anywhere has no entry in
    // `items` at all — without this, it'd be counted in every aggregate above
    // but invisible in this table. dataMap already has it (built off
    // effectiveLocationItems), so pick up any name `items` didn't cover.
    if (includeMakeItMeal) {
      for (const name of Object.keys(dataMap)) {
        if (!seen.has(name)) { seen.add(name); names.push(name); }
      }
    }
    const mul = sortDir === 'asc' ? -1 : 1;
    return names
      .filter(n => !q || n.toLowerCase().includes(q))
      .map(n => {
        const rev     = activeMeta.map(l => dataMap[n]?.[l.location_code]?.revenue  ?? 0);
        const qty     = activeMeta.map(l => dataMap[n]?.[l.location_code]?.qty      ?? 0);
        const mix     = activeMeta.map(l => dataMap[n]?.[l.location_code]?.mix_pct  ?? 0);
        const primary = metric === 'revenue' ? rev : metric === 'qty' ? qty : mix;
        const avg     = primary.reduce((a, b) => a + b, 0) / Math.max(activeMeta.length, 1);
        return { name: n, rev, qty, mix, primary, avg };
      })
      .sort((a, b) => {
        if (sortCol === 'avg') return mul * (b.avg - a.avg);
        const li = activeMeta.findIndex(l => l.location_code === sortCol);
        return mul * ((b.primary[li] ?? 0) - (a.primary[li] ?? 0));
      });
  }, [items, search, activeMeta, dataMap, metric, sortCol, sortDir, includeMakeItMeal]);

  const visibleItems = limit === 'all' ? allItems : allItems.slice(0, limit);

  function fmtPrimary(v: number) {
    if (metric === 'revenue') return fmt$(v);
    if (metric === 'qty')     return v.toLocaleString();
    return `${v.toFixed(1)}%`;
  }

  return (
    <div>
      {/* ── Controls ── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Location dropdown */}
        <div className="drw" style={{ position: 'relative' }}>
          <button className="drb" onClick={() => setLocOpen(o => !o)} style={{ minWidth: 150 }}>
            {locLabel}
            <i className="ti ti-chevron-down" style={{ fontSize: 11 }} />
          </button>
          {locOpen && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 199 }} onClick={() => setLocOpen(false)} />
              <div className="drm open" style={{ minWidth: 190, zIndex: 200 }}>
                <label className="dr-it" style={{ gap: 8, userSelect: 'none' }}>
                  <input type="checkbox" checked={selectedLocs.length === 0} onChange={() => setSelectedLocs([])} style={{ accentColor: 'var(--accent)' }} />
                  All Locations
                </label>
                <label className="dr-it" style={{ gap: 8, userSelect: 'none' }}>
                  <input type="checkbox" checked={isOpenLocationsSelected}
                    onChange={() => setSelectedLocs([...openLocationCodes])} style={{ accentColor: 'var(--accent)' }} />
                  Open Locations
                </label>
                <div className="dr-div" />
                {locMeta.map(l => (
                  <label key={l.location_code} className="dr-it" style={{ gap: 8, userSelect: 'none' }}>
                    <input type="checkbox" checked={selectedLocs.includes(l.location_code)} onChange={() => toggleLoc(l.location_code)} style={{ accentColor: l.color }} />
                    <span style={{ width: 9, height: 9, borderRadius: '50%', background: l.color, flexShrink: 0, display: 'inline-block' }} />
                    {l.display_name}
                  </label>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Metric dropdown */}
        <select value={metric} onChange={e => setMetric(e.target.value as Metric)} className="fb-sel">
          <option value="revenue">Revenue</option>
          <option value="qty">Qty Sold</option>
          <option value="mix_pct">% Mix</option>
        </select>

        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, cursor: 'pointer' }}>
          <input type="checkbox" checked={includeMakeItMeal} onChange={e => setIncludeMakeItMeal(e.target.checked)} />
          Include &quot;Make It a Meal&quot; picks
        </label>
      </div>

      {/* ── KPI cards ── */}
      <div className="krow" style={{ gridTemplateColumns: `repeat(${activeMeta.length}, 1fr)` }}>
        {activeMeta.map(loc => {
          const s          = locStats[loc.location_code];
          const rev        = s?.revenue ?? 0;
          // s.qty already includes Make It a Meal qty (locStats is built off
          // effectiveLocationItems) — mimQty here is only for the note text below.
          const mimQty     = locMakeItMealQty.get(loc.location_code) ?? 0;
          const qty        = s?.qty ?? 0;
          const useQty     = metric === 'qty' || metric === 'mix_pct';
          const totalGroup = activeMeta.reduce((sum, l) => sum + (useQty
            ? (locStats[l.location_code]?.qty ?? 0)
            : (locStats[l.location_code]?.revenue ?? 0)), 0);
          const primary    = useQty ? qty : rev;
          const share      = totalGroup > 0 ? (primary / totalGroup) * 100 : 0;
          return (
            <div key={loc.location_code} className="kc" style={{ borderLeftColor: loc.color, borderLeftWidth: 3, borderLeftStyle: 'solid' }}>
              <div className="kl" style={{ color: loc.color }}>{loc.display_name}</div>
              <div className="kv">{useQty ? qty.toLocaleString() : fmt$(rev)}</div>
              <div className="ks">{useQty ? 'items sold' : `${qty.toLocaleString()} items sold`}</div>
              <div className="ks">{share.toFixed(1)}% of category {useQty ? 'qty' : 'revenue'}</div>
              {mimQty > 0 && (
                <div className="ks">+{mimQty.toLocaleString()} from Make It a Meal</div>
              )}
              {(s?.refunds ?? 0) > 0 && (
                <div className="ks" style={{ color: '#dc2626' }}>-{fmt$(s!.refunds)} refunds</div>
              )}
              {s?.topItem && (
                <div className="ks" style={{ marginTop: 3, fontWeight: 700, color: 'var(--text)' }}>
                  ★ {s.topItem.slice(0, 22)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Revenue chart + Category mix ── */}
      <div className="gr22">
        <div className="cc">
          <h3>{METRIC_LABELS[metric]} by location</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={barData} margin={{ top: 5, right: 10, left: 5, bottom: 5 }}>
              <CartesianGrid stroke="#f3f4f6" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis
                tickFormatter={v => metric === 'revenue' ? `$${Math.round(v).toLocaleString('en-US')}` : v.toLocaleString()}
                tick={{ fontSize: 9 }} tickLine={false} axisLine={false} width={40}
              />
              <Tooltip
                formatter={(v) => [metric === 'revenue' ? fmt$(Number(v)) : Number(v).toLocaleString(), METRIC_LABELS[metric]]}
                contentStyle={{ fontSize: 11, borderRadius: 8 }}
              />
              <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                {barData.map((e, i) => <Cell key={i} fill={e.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="cc">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>Category mix by location ({catShowAmt ? (metric === 'revenue' ? 'USD' : 'qty') : `% of ${metric === 'revenue' ? 'revenue' : 'qty'}`})</h3>
            <button
              className="drb"
              onClick={() => setCatShowAmt(a => !a)}
              style={{ minWidth: 0, padding: '3px 10px', fontSize: 11 }}
            >
              {catShowAmt ? '% Mix' : '$ Amount'}
            </button>
          </div>
          <div className="tscroll">
            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  {activeMeta.map(l => <th key={l.location_code} style={{ color: l.color, textAlign: 'center' }}>{l.display_name}</th>)}
                </tr>
              </thead>
              <tbody>
                {CAT_ORDER.filter(cat => activeMeta.some(l => locCatData[l.location_code]?.[cat])).map(cat => {
                  const useQty = metric === 'qty' || metric === 'mix_pct';
                  const rawVals = activeMeta.map(l => {
                    const catMap = locCatData[l.location_code] ?? {};
                    return useQty ? (catMap[cat]?.qty ?? 0) : (catMap[cat]?.revenue ?? 0);
                  });
                  const pctVals = activeMeta.map((l, idx) => {
                    const catMap = locCatData[l.location_code] ?? {};
                    const tot    = Object.values(catMap).reduce((a, b) => a + (useQty ? b.qty : b.revenue), 0);
                    return tot > 0 ? (rawVals[idx] / tot) * 100 : 0;
                  });
                  const displayVals = catShowAmt ? rawVals : pctVals;
                  const maxVal = Math.max(...displayVals);
                  return (
                    <tr key={cat}>
                      <td style={{ fontWeight: 600, fontSize: 11 }}>{cat}</td>
                      {displayVals.map((v, i) => (
                        <td key={i} style={{ fontWeight: v === maxVal && v > 0 ? 700 : 400, fontSize: 11, textAlign: 'center' }}>
                          {v > 0
                            ? catShowAmt
                              ? useQty ? v.toLocaleString() : fmt$(v)
                              : `${v.toFixed(1)}%`
                            : '—'}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── Top / Bottom items by location ── */}
      {topLocRows.length > 0 && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, marginTop: 6, paddingLeft: 2 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>
                {locShowBottom ? 'Bottom' : 'Top'} items by location
              </div>
              <div style={{ display: 'flex', gap: 1, background: '#e5e7eb', borderRadius: 7, padding: 3, border: '1px solid #d1d5db' }}>
                {([false, true] as const).map(isBottom => (
                  <button key={String(isBottom)} onClick={() => setLocShowBottom(isBottom)} style={{
                    fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 5, border: 'none', cursor: 'pointer',
                    background: locShowBottom === isBottom ? (isBottom ? '#dc2626' : 'var(--accent)') : 'transparent',
                    color: locShowBottom === isBottom ? '#fff' : '#6b7280',
                    boxShadow: locShowBottom === isBottom ? `0 1px 4px ${isBottom ? 'rgba(220,38,38,.3)' : 'rgba(99,102,241,.35)'}` : 'none',
                    transition: 'all .15s',
                  }}>{isBottom ? 'Bottom' : 'Top'}</button>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 1, background: '#e5e7eb', borderRadius: 7, padding: 3, border: '1px solid #d1d5db' }}>
              {(['pct', 'exact'] as const).map(v => (
                <button key={v} onClick={() => setLocTopView(v)} style={{
                  fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 5, border: 'none', cursor: 'pointer',
                  background: locTopView === v ? 'var(--accent)' : 'transparent',
                  color: locTopView === v ? '#fff' : '#6b7280',
                  boxShadow: locTopView === v ? '0 1px 4px rgba(99,102,241,.35)' : 'none',
                  transition: 'all .15s',
                }}>{v === 'pct' ? '%' : '#'}</button>
              ))}
            </div>
          </div>
          {topLocRows.map((row, ri) => (
            <div key={ri} className="gr3">
              {row.map(loc => (
                <div key={loc.location_code} className="cc">
                  <h3 style={{ borderLeft: `3px solid ${loc.color}`, paddingLeft: 7, marginLeft: -4 }}>
                    {loc.display_name}
                  </h3>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingBottom: 4, borderBottom: '2px solid #e5e7eb', marginBottom: 2 }}>
                    <span style={{ fontSize: 9, color: 'var(--muted)', width: 14, flexShrink: 0 }} />
                    <div style={{ flex: 1, fontSize: 9, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Item</div>
                    <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em', textAlign: 'right', minWidth: 55 }}
                      title="This item's revenue ÷ this location's total revenue (not overall revenue across all locations)">
                      {locTopView === 'pct' ? '% Rev' : 'Revenue'}
                    </div>
                    <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em', textAlign: 'right', minWidth: 45 }}
                      title="This item's qty ÷ this location's total qty (not overall qty across all locations)">
                      {locTopView === 'pct' ? '% Qty' : 'Qty'}
                    </div>
                  </div>
                  {(topByLocation[loc.location_code] ?? []).map((item, idx) => (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', borderBottom: '1px solid #f3f4f6' }}>
                      <span style={{ fontSize: 10, color: 'var(--muted)', width: 14, flexShrink: 0, textAlign: 'right' }}>{idx + 1}</span>
                      <div style={{ flex: 1, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', flexShrink: 0, minWidth: 55, textAlign: 'right' }}>
                        {locTopView === 'pct' ? `${item.revPct}%` : fmt$(item.rev)}
                      </span>
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', flexShrink: 0, minWidth: 45, textAlign: 'right' }}>
                        {locTopView === 'pct' ? `${item.qtyPct}%` : item.qty.toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </>
      )}

      {/* ── Item comparison table ── */}
      <div className="tw">
        <div className="th2">
          <h3>Item comparison · {METRIC_LABELS[metric]}</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search items…" className="srch" />
            <select
              value={limit === 'all' ? 'all' : String(limit)}
              onChange={e => setLimit(e.target.value === 'all' ? 'all' : Number(e.target.value) as 10 | 20 | 50 | 100)}
              className="fb-sel"
            >
              <option value="10">Top 10</option>
              <option value="20">Top 20</option>
              <option value="50">Top 50</option>
              <option value="100">Top 100</option>
              <option value="all">All items</option>
            </select>
            <span className="fb-lbl">Sort by</span>
            <select value={sortCol} onChange={e => { setSortCol(e.target.value); setSortDir('desc'); }} className="fb-sel">
              <option value="avg">Avg</option>
              {activeMeta.map(l => (
                <option key={l.location_code} value={l.location_code}>{l.display_name}</option>
              ))}
            </select>
            <select value={sortDir} onChange={e => setSortDir(e.target.value as 'desc' | 'asc')} className="fb-sel">
              <option value="desc">High → Low</option>
              <option value="asc">Low → High</option>
            </select>
          </div>
        </div>

        <div className="tscroll">
          <table>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', minWidth: 160 }}>Item</th>
                {activeMeta.map(l => (
                  <th key={l.location_code} style={{ color: l.color, cursor: 'pointer', minWidth: 110 }} onClick={() => handleColSort(l.location_code)}>
                    {l.display_name}{sortArrow(l.location_code)}
                  </th>
                ))}
                <th style={{ cursor: 'pointer', minWidth: 90 }} onClick={() => handleColSort('avg')}>
                  Avg{sortArrow('avg')}
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.map(({ name, primary }) => {
                const maxPrimary = Math.max(...primary, 0);
                const avg = primary.reduce((a, b) => a + b, 0) / Math.max(activeMeta.length, 1);
                return (
                  <tr key={name}>
                    <td style={{ fontWeight: 600 }}>{name}</td>
                    {primary.map((p, i) => (
                      <td key={i} style={{ fontWeight: p === maxPrimary && p > 0 ? 700 : 400, color: p === 0 ? 'var(--muted)' : 'inherit' }}>
                        {p > 0 ? fmtPrimary(p) : '—'}
                      </td>
                    ))}
                    <td style={{ color: 'var(--muted)' }}>{avg > 0 ? fmtPrimary(avg) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={{ padding: '6px 14px', borderTop: '1px solid var(--border)', fontSize: 10, color: 'var(--muted)', display: 'flex', justifyContent: 'space-between' }}>
          <span>Showing {visibleItems.length} of {allItems.length} items</span>
          <span>Bold = top location for that item</span>
        </div>
      </div>
    </div>
  );
}
