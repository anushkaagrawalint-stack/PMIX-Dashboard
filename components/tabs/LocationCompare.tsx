'use client';
import { useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts';
import type { DashboardData } from '@/lib/types';

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

export default function LocationCompare({ data }: { data: DashboardData }) {
  const { locationItems, items, locations } = data;

  const locMeta = useMemo(
    () => locations.map((l, i) => ({ ...l, color: LOC_SHADES[i % LOC_SHADES.length] })),
    [locations],
  );

  const [selectedLocs, setSelectedLocs] = useState<string[]>([]);
  const [locOpen, setLocOpen]           = useState(false);
  const [metric, setMetric]             = useState<Metric>('revenue');
  const [search, setSearch]             = useState('');
  const [sortCol, setSortCol]           = useState<string>('avg');
  const [sortDir, setSortDir]           = useState<'desc' | 'asc'>('desc');
  const [limit, setLimit]               = useState<10 | 20 | 50 | 100 | 'all'>(20);

  const activeMeta = useMemo(() =>
    selectedLocs.length === 0 ? locMeta : locMeta.filter(l => selectedLocs.includes(l.location_code)),
  [locMeta, selectedLocs]);

  function toggleLoc(code: string) {
    setSelectedLocs(prev => prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]);
  }

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
    locationItems.forEach(r => {
      if (!itemTotals[r.location_code]) itemTotals[r.location_code] = {};
      const it = itemTotals[r.location_code];
      if (!it[r.canonical_name]) it[r.canonical_name] = { revenue: 0, qty: 0 };
      it[r.canonical_name].revenue += r.revenue;
      it[r.canonical_name].qty     += r.qty;
    });
    const stats: Record<string, { revenue: number; qty: number; topItem: string; topRev: number }> = {};
    for (const [loc, items] of Object.entries(itemTotals)) {
      let revenue = 0, qty = 0, topItem = '', topRev = 0;
      for (const [name, v] of Object.entries(items)) {
        revenue += v.revenue;
        qty     += v.qty;
        if (v.revenue > topRev) { topRev = v.revenue; topItem = name; }
      }
      stats[loc] = { revenue, qty, topItem, topRev };
    }
    return stats;
  }, [locationItems]);

  const locCatData = useMemo(() => {
    const meta: Record<string, string> = {};
    items.forEach(i => { if (!meta[i.canonical_name]) meta[i.canonical_name] = i.category; });
    const map: Record<string, Record<string, { revenue: number; qty: number }>> = {};
    locationItems.forEach(r => {
      const cat = meta[r.canonical_name] ?? 'Other';
      if (!map[r.location_code]) map[r.location_code] = {};
      if (!map[r.location_code][cat]) map[r.location_code][cat] = { revenue: 0, qty: 0 };
      map[r.location_code][cat].revenue += r.revenue;
      map[r.location_code][cat].qty     += r.qty;
    });
    return map;
  }, [locationItems, items]);

  const dataMap = useMemo(() => {
    // Sum across channels for each (canonical_name, location_code) pair
    const m: Record<string, Record<string, { qty: number; revenue: number; mix_pct: number }>> = {};
    locationItems.forEach(r => {
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
  }, [locationItems]);

  const barData = useMemo(() =>
    activeMeta.map(l => ({
      name:  l.display_name,
      value: metric === 'qty' || metric === 'mix_pct'
        ? (locStats[l.location_code]?.qty ?? 0)
        : (locStats[l.location_code]?.revenue ?? 0),
      color: l.color,
    })),
  [activeMeta, locStats, metric]);

  const allItems = useMemo(() => {
    const q    = search.toLowerCase();
    const seen = new Set<string>();
    const names: string[] = [];
    for (const i of items) {
      if (!seen.has(i.canonical_name)) { seen.add(i.canonical_name); names.push(i.canonical_name); }
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
  }, [items, search, activeMeta, dataMap, metric, sortCol, sortDir]);

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
      </div>

      {/* ── KPI cards ── */}
      <div className="krow" style={{ gridTemplateColumns: `repeat(${activeMeta.length}, 1fr)` }}>
        {activeMeta.map(loc => {
          const s          = locStats[loc.location_code];
          const rev        = s?.revenue ?? 0;
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
          <h3>Category mix by location (% of {metric === 'revenue' ? 'revenue' : 'qty'})</h3>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  {activeMeta.map(l => <th key={l.location_code} style={{ color: l.color }}>{l.display_name}</th>)}
                </tr>
              </thead>
              <tbody>
                {CAT_ORDER.filter(cat => activeMeta.some(l => locCatData[l.location_code]?.[cat])).map(cat => {
                  const vals = activeMeta.map(l => {
                    const catMap  = locCatData[l.location_code] ?? {};
                    const useQty  = metric === 'qty' || metric === 'mix_pct';
                    const catVal  = useQty ? (catMap[cat]?.qty ?? 0) : (catMap[cat]?.revenue ?? 0);
                    const tot     = Object.values(catMap).reduce((a, b) => a + (useQty ? b.qty : b.revenue), 0);
                    return tot > 0 ? (catVal / tot) * 100 : 0;
                  });
                  const maxVal = Math.max(...vals);
                  return (
                    <tr key={cat}>
                      <td style={{ fontWeight: 600, fontSize: 11 }}>{cat}</td>
                      {vals.map((v, i) => (
                        <td key={i} style={{ fontWeight: v === maxVal && v > 0 ? 700 : 400, fontSize: 11 }}>
                          {v > 0 ? `${v.toFixed(1)}%` : '—'}
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

        <div style={{ overflowX: 'auto' }}>
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
