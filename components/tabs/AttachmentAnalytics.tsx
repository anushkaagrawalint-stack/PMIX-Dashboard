'use client';
import { Fragment, useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import type { AttachmentData, LocationRow } from '@/lib/types';

const fmtInt = (v: number) => v.toLocaleString();
const fmtPct = (v: number) => `${v.toFixed(2)}%`;
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

  return { mainChecks, catMap, merged, catItems, totalAttach, overallRate };
}

export default function AttachmentAnalytics({
  data, prevData, prevLabel, locations, selectedLocations, selectedChannels,
}: {
  data: AttachmentData;
  prevData: AttachmentData | null;
  prevLabel: string | null;
  locations: LocationRow[];
  selectedLocations: string[];
  selectedChannels: string[];
}) {
  const [tableCategory, setTableCategory] = useState('');
  const [tableSearch, setTableSearch]     = useState('');
  const [tableLimit, setTableLimit]       = useState<10 | 25 | 50 | 100 | 'all'>(25);
  const [tableMode, setTableMode]         = useState<'percent' | 'detail'>('percent');
  const [tableSortCol, setTableSortCol]   = useState<string>('overall');
  const [tableSortDir, setTableSortDir]   = useState<'desc' | 'asc'>('desc');
  const [locSortCol, setLocSortCol]       = useState<string>('rate');
  const [locSortDir, setLocSortDir]       = useState<'desc' | 'asc'>('desc');

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

  // Per-location breakdown — one row per location currently in scope
  // (all locations if none selected, otherwise just the selected ones), plus
  // a combined "Overall" row so multi-location selections can be compared at a glance.
  const locationBreakdown = useMemo(() => {
    const inScope = selectedLocations.length > 0
      ? selectedLocations
      : [...new Set(data.buckets.map(b => b.location_code))];
    return inScope.map(code => {
      const filter = (l: string, ch: string) => l === code && (selectedChannels.length === 0 || selectedChannels.includes(ch));
      const agg = aggregate(data, filter);
      const prevAgg = prevData ? aggregate(prevData, filter) : null;
      return { code, name: locName(code), mainChecks: agg.mainChecks, totalAttach: agg.totalAttach, rate: agg.overallRate, prevRate: prevAgg?.overallRate };
    }).sort((a, b) => {
      const mul = locSortDir === 'asc' ? -1 : 1;
      const key = locSortCol as 'name' | 'mainChecks' | 'totalAttach' | 'rate';
      return cmp(a[key], b[key], mul);
    });
  }, [data, prevData, selectedLocations, selectedChannels, locSortCol, locSortDir]);
  const overallAttach = current.totalAttach;

  function handleLocSort(col: string) {
    if (locSortCol === col) setLocSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setLocSortCol(col); setLocSortDir('desc'); }
  }
  const locSortArrow = (col: string) => locSortCol === col ? (locSortDir === 'desc' ? ' ↓' : ' ↑') : '';

  // name → category, sourced from the item-side breakdown. Every row in
  // `merged` is by construction a Main/Sweet/Side/Drink item (see aggregate()),
  // so this always resolves — no "Modifier" fallback needed.
  const nameCategory = useMemo(() => {
    const m = new Map<string, string>();
    current.catItems.forEach(r => m.set(r.name, r.category));
    return m;
  }, [current.catItems]);
  const categoryOf = (name: string) => nameCategory.get(name) ?? '';

  // One column-group per in-scope location, so a single name's actual attachment
  // rate (and its underlying counts) can be compared across locations at a
  // glance, alongside its overall (all-scope) figure — no averaging.
  const tableLocs = useMemo(() => {
    const inScope = selectedLocations.length > 0
      ? selectedLocations
      : [...new Set(data.buckets.map(b => b.location_code))];
    return inScope.map(code => {
      const filter = (l: string, ch: string) => l === code && (selectedChannels.length === 0 || selectedChannels.includes(ch));
      const agg = aggregate(data, filter);
      const rowMap = new Map(agg.merged.map(r => [r.name, r]));
      return { code, mainChecks: agg.mainChecks, rowMap };
    });
  }, [data, selectedLocations, selectedChannels]);

  const EMPTY_ROW = { checksItem: 0, checksMod: 0, totals: 0, rate: 0 };

  const chartData = useMemo(() => [...merged].sort((a, b) => b.rate - a.rate).slice(0, 12).reverse(), [merged]);

  const tableRows = useMemo(() => {
    const q = tableSearch.trim().toLowerCase();
    const mul = tableSortDir === 'asc' ? -1 : 1;
    return merged
      .filter(r => (!q || r.name.toLowerCase().includes(q)) && (!tableCategory || categoryOf(r.name) === tableCategory))
      .map(r => ({
        name: r.name,
        category: categoryOf(r.name),
        overall: r,
        perLoc: tableLocs.map(l => l.rowMap.get(r.name) ?? EMPTY_ROW),
      }))
      .sort((a, b) => {
        if (tableSortCol === 'category') return cmp(a.category, b.category, mul);
        if (tableSortCol === 'name') return cmp(a.name, b.name, mul);
        if (tableSortCol === 'overall') return cmp(a.overall.rate, b.overall.rate, mul);
        const [locCode, metric] = tableSortCol.split(':');
        const li = tableLocs.findIndex(l => l.code === locCode);
        if (li < 0) return 0;
        const val = (row: typeof a) => metric === 'mainChecks'
          ? tableLocs[li].mainChecks
          : (row.perLoc[li]?.[metric as 'checksItem' | 'checksMod' | 'totals' | 'rate'] ?? 0);
        return cmp(val(a), val(b), mul);
      });
  }, [merged, tableLocs, tableSearch, tableCategory, tableSortCol, tableSortDir, nameCategory]);
  const visibleTable = tableLimit === 'all' ? tableRows : tableRows.slice(0, tableLimit);

  function handleTableSort(col: string) {
    if (tableSortCol === col) setTableSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setTableSortCol(col); setTableSortDir('desc'); }
  }
  const tableSortArrow = (col: string) => tableSortCol === col ? (tableSortDir === 'desc' ? ' ↓' : ' ↑') : '';

  function exportTableCsv() {
    const headers = ['Category', 'Item / Modifier', 'Overall Attachment Rate (%)'];
    tableLocs.forEach(l => headers.push(`${locName(l.code)} Attachment Rate (%)`));
    const rows = tableRows.map(r => [
      r.category, r.name, r.overall.rate.toFixed(2),
      ...r.perLoc.map(v => v.rate.toFixed(2)),
    ]);
    csvDownload('attachment_rate_by_item_and_location.csv', headers, rows);
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
          <div className="ks">{highest ? fmtPct(highest.rate) : 'No data'}</div>
          {highest && <DeltaBadge curr={highest.rate} prev={prevHighestRate} vsLabel={prevLabel} />}
        </div>
        <div className="kc p">
          <div className="kl">Best Performing Location</div>
          <div className="kv" style={{ fontSize: 16 }}>{bestLocation ? locName(bestLocation.code) : '—'}</div>
          <div className="ks">{bestLocation ? fmtPct(bestLocation.rate) : 'No data'}</div>
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
          const prevVal = prev?.catMap.get(cat);
          return (
            <div key={cat} className="kc" style={{ borderLeftColor: CAT_COLOR[cat], borderLeftWidth: 3, borderLeftStyle: 'solid' }}>
              <div className="kl" style={{ color: CAT_COLOR[cat] }}>{cat} Checks</div>
              <div className="kv">{fmtInt(curr)}</div>
              <div className="ks">{totalMainChecks ? fmtPct((curr / totalMainChecks) * 100) : '—'} of main checks</div>
              <DeltaBadge curr={curr} prev={prevVal} vsLabel={prevLabel} />
            </div>
          );
        })}
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

      {/* ── Per-location breakdown ── */}
      <div className="tw">
        <div className="th2">
          <h3>Attachment rate by location</h3>
        </div>
        <div className="tscroll">
          <table>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => handleLocSort('name')}>Location{locSortArrow('name')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleLocSort('mainChecks')}>Main Checks{locSortArrow('mainChecks')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleLocSort('totalAttach')}>Total Attachment (Side/Sweet/Drink){locSortArrow('totalAttach')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleLocSort('rate')}>Attachment Rate{locSortArrow('rate')}</th>
              </tr>
            </thead>
            <tbody>
              {locationBreakdown.map(r => (
                <tr key={r.code}>
                  <td style={{ fontWeight: 600 }}>{r.name}</td>
                  <td>{fmtInt(r.mainChecks)}</td>
                  <td>{fmtInt(r.totalAttach)}</td>
                  <td style={{ fontWeight: 700 }}>
                    {fmtPct(r.rate)}
                    <DeltaBadge curr={r.rate} prev={r.prevRate} vsLabel={prevLabel} />
                  </td>
                </tr>
              ))}
              {locationBreakdown.length === 0 && (
                <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--muted)', padding: 20 }}>No matching rows</td></tr>
              )}
              <tr style={{ borderTop: '2px solid var(--border)' }}>
                <td style={{ fontWeight: 700 }}>Overall (selected locations)</td>
                <td style={{ fontWeight: 700 }}>{fmtInt(totalMainChecks)}</td>
                <td style={{ fontWeight: 700 }}>{fmtInt(overallAttach)}</td>
                <td style={{ fontWeight: 700 }}>
                  {fmtPct(current.overallRate)}
                  <DeltaBadge curr={current.overallRate} prev={prev?.overallRate} vsLabel={prevLabel} />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Unified item/category/location attachment table ── */}
      <div className="tw">
        <div className="th2">
          <h3>Attachment Rate by Item &amp; Location</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
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
            <button className="drb" onClick={exportTableCsv} style={{ minWidth: 0, padding: '6px 12px' }}>
              <i className="ti ti-download" style={{ fontSize: 12, marginRight: 4 }} />
              Export CSV
            </button>
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
                {tableLocs.map(l => tableMode === 'percent' ? (
                  <th key={l.code} style={{ cursor: 'pointer', minWidth: 100, borderLeft: '2px solid var(--border)', zIndex: 3 }} onClick={() => handleTableSort(`${l.code}:rate`)}>
                    {locName(l.code)}{tableSortArrow(`${l.code}:rate`)}
                  </th>
                ) : (
                  <th key={l.code} colSpan={5} style={{ textAlign: 'center', borderLeft: '2px solid var(--border)', top: 0, zIndex: 3, background: '#f0f0f4' }}>
                    {locName(l.code)}
                  </th>
                ))}
              </tr>
              {tableMode === 'detail' && (
                <tr>
                  {tableLocs.map(l => (
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
                const maxRate = Math.max(...row.perLoc.map(v => v.rate), 0);
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
                      ? row.perLoc.map((v, i) => (
                        <td key={i} style={{ fontWeight: v.rate === maxRate && v.rate > 0 ? 700 : 400, color: v.rate === 0 ? 'var(--muted)' : v.rate > 100 ? '#dc2626' : 'inherit', borderLeft: '2px solid var(--border)' }}>
                          {v.rate > 0 ? fmtPct(v.rate) : '—'}
                        </td>
                      ))
                      : row.perLoc.map((v, i) => (
                        <Fragment key={i}>
                          <td style={{ borderLeft: '2px solid var(--border)' }}>{fmtInt(tableLocs[i].mainChecks)}</td>
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
                <tr><td colSpan={3 + tableLocs.length * (tableMode === 'detail' ? 5 : 1)} style={{ textAlign: 'center', color: 'var(--muted)', padding: 20 }}>No matching rows</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '6px 14px', borderTop: '1px solid var(--border)', fontSize: 10, color: 'var(--muted)', display: 'flex', justifyContent: 'space-between' }}>
          <span>Showing {visibleTable.length} of {tableRows.length} rows · {merged.filter(r => r.rate > 100).length} with overall rate over 100%</span>
          <span>Bold = highest rate for that name across locations</span>
        </div>
      </div>

      <div className="cc" style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, marginTop: 12 }}>
        <b style={{ color: 'var(--text)' }}>Notes:</b> Every row is a Main/Sweet/Side/Drink item — modifiers never get their own row, they only merge into an item&apos;s totals when a modifier happens to share that item&apos;s exact name. Per-item rates (in the table above and the chart) use total main-item checks as the denominator and cover all four categories, including Main. Aggregate &quot;total attachment&quot; figures — the per-location table, the &quot;Overall&quot; row, and &quot;Best Performing Location&quot; — count Side/Sweet/Drink only; Main is excluded from these sums since a Main item recurring on a check is just another entree, not an up-sell. &quot;Best Performing Location&quot; and the per-location columns ignore the current location filter (so locations can be compared) but still respect the channel filter. Voided rows are excluded from every count.
      </div>
    </div>
  );
}
