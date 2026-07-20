'use client';
import { useState, useMemo } from 'react';
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ScatterChart, Scatter, ReferenceLine,
} from 'recharts';
import type { BikkyRow, MERow, ItemRow } from '@/lib/types';
import { normalizeCategory } from '@/lib/constants';


interface Props {
  bikky:   BikkyRow[];
  meItems: MERow[];
  items:   ItemRow[];
  period:  string | null;
}

const pct  = (v: number) => `${(v * 100).toFixed(1)}%`;

function rateClass(v: number): string {
  if (v >= 0.25) return 'rate-tag rh';
  if (v >= 0.15) return 'rate-tag rm';
  return 'rate-tag rl';
}

type SortKey = 'return_rate' | 'reorder_rate' | 'guests';
type Source  = 'instore' | '3pd_loyalty';

const SOURCE_LABELS: Record<Source, string> = {
  instore:       'In-Store',
  '3pd_loyalty': '3PD + RASA Digital',
};

// Bikky tables store the pre-byo_fix item names; ME/items use post-fix canonical names.
// This map lets quadrant/category/sub-category look up correctly for both name forms.
const BIKKY_TO_CANONICAL: Record<string, string> = {
  'Grain Bowl':                'BYO Grain Bowl',
  'Salad Bowl':                'BYO Salad Bowl',
  'Greens + Grains Bowl':      'BYO Greens + Grains Bowl',
  'Cauliflower + Quinoa':      'Spiced Cauli + Quinoa Bowl',
  'Cauliflower + Quinoa Bowl': 'Spiced Cauli + Quinoa Bowl',
  'Kids BYO':                  'Kids Meal',
  'Burrito':                   'BYO Indian Burrito',
};
// Reverse: canonical name → all Bikky aliases that map to it
const CANONICAL_ALIASES = new Map<string, string[]>();
Object.entries(BIKKY_TO_CANONICAL).forEach(([raw, canonical]) => {
  const arr = CANONICAL_ALIASES.get(canonical) ?? [];
  arr.push(raw);
  CANONICAL_ALIASES.set(canonical, arr);
});

function CheckboxDropdown({ label, options, selected, onChange }: {
  label:    string;
  options:  string[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnLabel = selected.length === 0
    ? `All ${label}`
    : selected.length === 1 ? selected[0] : `${selected.length} selected`;

  function toggle(opt: string) {
    onChange(selected.includes(opt) ? selected.filter(s => s !== opt) : [...selected, opt]);
  }

  return (
    <div style={{ position: 'relative' }}>
      <button className="drb" onClick={() => setOpen(o => !o)} style={{ minWidth: 130 }}>
        {btnLabel}
        <i className="ti ti-chevron-down" style={{ fontSize: 11 }} />
      </button>
      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 199 }} onClick={() => setOpen(false)} />
          <div className="drm open" style={{ minWidth: 200, zIndex: 200, maxHeight: 260, overflowY: 'auto' }}>
            <label className="dr-it" style={{ gap: 8, userSelect: 'none' }}>
              <input type="checkbox" checked={selected.length === 0}
                onChange={() => onChange([])} style={{ accentColor: 'var(--accent)' }} />
              All
            </label>
            <div className="dr-div" />
            {options.map(opt => (
              <label key={opt} className="dr-it" style={{ gap: 8, userSelect: 'none' }}>
                <input type="checkbox"
                  checked={selected.includes(opt)}
                  onChange={() => toggle(opt)}
                  style={{ accentColor: 'var(--accent)' }} />
                {opt}
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Top10List({ rows, color }: {
  rows: { name: string; value: number; prev: number | null; guests: number }[];
  color: string;
}) {
  const max = Math.max(...rows.map(r => r.value), 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {rows.map((r, i) => {
        const delta = r.prev != null ? r.value - r.prev : null;
        const up    = delta != null && delta >= 0;
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 18, textAlign: 'right', fontSize: 9, color: 'var(--muted)', flexShrink: 0 }}>
              {i + 1}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {r.name} <span style={{ fontWeight: 400, color: 'var(--muted)' }}>· {r.guests.toLocaleString()} guests</span>
              </div>
              <div style={{ height: 5, borderRadius: 3, background: 'var(--border)', marginTop: 3 }}>
                <div style={{ height: '100%', borderRadius: 3, background: color, width: `${(r.value / max) * 100}%` }} />
              </div>
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color, flexShrink: 0, minWidth: 38, textAlign: 'right' }}>
              {r.value.toFixed(1)}%
            </div>
            {delta != null ? (
              <div style={{
                fontSize: 9, fontWeight: 600, flexShrink: 0, minWidth: 42, textAlign: 'right',
                color: up ? '#16a34a' : '#dc2626',
              }}>
                {up ? '↑' : '↓'}{Math.abs(delta).toFixed(1)}pp
              </div>
            ) : (
              <div style={{ minWidth: 42 }} />
            )}
          </div>
        );
      })}
      <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 4 }}>
        pp = percentage point vs prev period
      </div>
    </div>
  );
}

export default function CustomerRetention({ bikky, meItems, items, period }: Props) {
  const [search,         setSearch]       = useState('');
  const [sort,           setSort]         = useState<SortKey>('return_rate');
  const [desc,           setDesc]         = useState(true);
  const [source,         setSource]       = useState<Source>('instore');
  const [catFilters,     setCatFilters]   = useState<string[]>([]);
  const [subCatFilters,  setSubCatFilters]= useState<string[]>([]);
  const [quadrantFilter, setQuadrant]     = useState('all');
  const [showBottom,     setShowBottom]   = useState(false);

  function toggleSort(key: SortKey) {
    if (sort === key) setDesc(d => !d);
    else { setSort(key); setDesc(true); }
  }

  // Lookup maps from meItems + items.
  // Each map also registers Bikky-side aliases (pre-byo_fix names) so that Bikky's
  // raw item_name (e.g. 'Grain Bowl') resolves to the ME canonical ('BYO Grain Bowl').
  const quadrantMap = useMemo(() => {
    const m = new Map<string, string>();
    meItems.forEach(i => {
      if (!i.quadrant) return;
      m.set(i.canonical_name, i.quadrant);
      CANONICAL_ALIASES.get(i.canonical_name)?.forEach(alias => m.set(alias, i.quadrant));
    });
    return m;
  }, [meItems]);

  const subCatMap = useMemo(() => {
    const m = new Map<string, string>();
    items.forEach(i => {
      if (!i.sub_category) return;
      m.set(i.canonical_name, i.sub_category);
      CANONICAL_ALIASES.get(i.canonical_name)?.forEach(alias => m.set(alias, i.sub_category));
    });
    return m;
  }, [items]);

  const catMap = useMemo(() => {
    const m = new Map<string, string>();
    items.forEach(i => {
      if (!i.category) return;
      const cat = normalizeCategory(i.category);
      m.set(i.canonical_name, cat);
      CANONICAL_ALIASES.get(i.canonical_name)?.forEach(alias => m.set(alias, cat));
    });
    return m;
  }, [items]);

  const sourceRows = useMemo(() => bikky.filter(r => r.source === source), [bikky, source]);

  // Quadrant options (from all source rows, always full)
  const quadrantOptions = useMemo(() => {
    const s = new Set<string>();
    sourceRows.forEach(r => {
      const q = quadrantMap.get(r.item_name);
      if (q) s.add(q);
    });
    return [...s].sort();
  }, [sourceRows, quadrantMap]);

  // Apply quadrant filter
  const quadrantFilteredRows = useMemo(() =>
    quadrantFilter === 'all'
      ? sourceRows
      : sourceRows.filter(r => (quadrantMap.get(r.item_name) ?? '') === quadrantFilter),
  [sourceRows, quadrantFilter, quadrantMap]);

  // Dynamic category options — only categories present after quadrant filter
  const categoryOptions = useMemo(() => {
    const s = new Set<string>();
    quadrantFilteredRows.forEach(r => {
      const cat = catMap.get(r.item_name);
      if (cat) s.add(cat);
    });
    return [...s].sort();
  }, [quadrantFilteredRows, catMap]);

  // Apply category multi-select filter
  const catFilteredRows = useMemo(() =>
    catFilters.length === 0
      ? quadrantFilteredRows
      : quadrantFilteredRows.filter(r => catFilters.includes(catMap.get(r.item_name) ?? '')),
  [quadrantFilteredRows, catFilters, catMap]);

  // Dynamic sub-category options — only sub-cats present in category-filtered rows
  const subCatOptions = useMemo(() => {
    const s = new Set<string>();
    catFilteredRows.forEach(r => {
      const sc = subCatMap.get(r.item_name);
      if (sc) s.add(sc);
    });
    return [...s].sort();
  }, [catFilteredRows, subCatMap]);

  // Final filtered rows
  const filteredSourceRows = useMemo(() =>
    subCatFilters.length === 0
      ? catFilteredRows
      : catFilteredRows.filter(r => subCatFilters.includes(subCatMap.get(r.item_name) ?? '')),
  [catFilteredRows, subCatFilters, subCatMap]);

  // Average rates per item across all periods (for charts + scatter)
  const byItem = useMemo(() => {
    const map: Record<string, {
      return_rate: number; reorder_rate: number;
      return_rate_prev: number; reorder_rate_prev: number;
      guests: number; count: number; prev_count: number;
    }> = {};
    filteredSourceRows.forEach(r => {
      if (!map[r.item_name]) map[r.item_name] = {
        return_rate: 0, reorder_rate: 0,
        return_rate_prev: 0, reorder_rate_prev: 0,
        guests: 0, count: 0, prev_count: 0,
      };
      map[r.item_name].return_rate  += r.return_rate;
      map[r.item_name].reorder_rate += r.reorder_rate;
      map[r.item_name].guests       += r.guests;
      map[r.item_name].count        += 1;
      if (r.return_rate_prev > 0 || r.reorder_rate_prev > 0) {
        map[r.item_name].return_rate_prev  += r.return_rate_prev;
        map[r.item_name].reorder_rate_prev += r.reorder_rate_prev;
        map[r.item_name].prev_count        += 1;
      }
    });
    return Object.entries(map).map(([name, v]) => ({
      name,
      return_rate:       v.return_rate  / v.count,
      reorder_rate:      v.reorder_rate / v.count,
      return_rate_prev:  v.prev_count > 0 ? v.return_rate_prev  / v.prev_count : null,
      reorder_rate_prev: v.prev_count > 0 ? v.reorder_rate_prev / v.prev_count : null,
      guests:            v.guests,
    }));
  }, [filteredSourceRows]);

  // Dynamic KPIs from filtered data
  const avgReturn  = byItem.length > 0 ? byItem.reduce((s, r) => s + r.return_rate,  0) / byItem.length : 0;
  const avgReorder = byItem.length > 0 ? byItem.reduce((s, r) => s + r.reorder_rate, 0) / byItem.length : 0;

  // "Top"/"Bottom" by rate is only meaningful among items with enough guests to
  // trust the percentage — a 1-guest item at 100% return rate isn't a winner,
  // it's noise. Floor is the median guest count of the currently-filtered set
  // (adapts to whatever category/quadrant/search filters are active, rather
  // than a hardcoded guest count that wouldn't generalize across date ranges).
  // Falls back to the unfiltered set if the floor would empty it out.
  const significantItems = useMemo(() => {
    if (byItem.length === 0) return byItem;
    const sortedGuests = [...byItem.map(r => r.guests)].sort((a, b) => a - b);
    const mid = Math.floor(sortedGuests.length / 2);
    const median = sortedGuests.length % 2
      ? sortedGuests[mid]
      : (sortedGuests[mid - 1] + sortedGuests[mid]) / 2;
    const filtered = byItem.filter(r => r.guests >= median);
    return filtered.length > 0 ? filtered : byItem;
  }, [byItem]);

  const topReorder = significantItems.length > 0 ? [...significantItems].sort((a, b) => b.reorder_rate - a.reorder_rate)[0] : null;
  const topReturn  = significantItems.length > 0 ? [...significantItems].sort((a, b) => b.return_rate  - a.return_rate )[0] : null;

  // Top-10 data with prev-period delta
  const top10Reorder = useMemo(() =>
    [...significantItems].sort((a, b) => showBottom ? a.reorder_rate - b.reorder_rate : b.reorder_rate - a.reorder_rate)
      .slice(0, 10)
      .map(r => ({
        name:   r.name.slice(0, 28),
        value:  Math.round(r.reorder_rate * 1000) / 10,
        prev:   r.reorder_rate_prev != null ? Math.round(r.reorder_rate_prev * 1000) / 10 : null,
        guests: r.guests,
      })),
  [significantItems, showBottom]);

  const top10Return = useMemo(() =>
    [...significantItems].sort((a, b) => showBottom ? a.return_rate - b.return_rate : b.return_rate - a.return_rate)
      .slice(0, 10)
      .map(r => ({
        name:   r.name.slice(0, 28),
        value:  Math.round(r.return_rate * 1000) / 10,
        prev:   r.return_rate_prev != null ? Math.round(r.return_rate_prev * 1000) / 10 : null,
        guests: r.guests,
      })),
  [significantItems, showBottom]);

  const scatterData = byItem.map(r => ({
    x:    Math.round(r.return_rate  * 1000) / 10,
    y:    Math.round(r.reorder_rate * 1000) / 10,
    name: r.name,
    guests: r.guests,
  }));

  const filtered = useMemo(() => {
    return filteredSourceRows
      .filter(r => !search || r.item_name.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => {
        const mul = desc ? -1 : 1;
        if (sort === 'guests') return mul * (a.guests - b.guests);
        return mul * (a[sort] - b[sort]);
      });
  }, [filteredSourceRows, search, sort, desc]);

  const thStyle = (key: SortKey): React.CSSProperties => ({
    cursor: 'pointer', color: sort === key ? 'var(--accent)' : undefined,
  });
  const arrow = (key: SortKey) => sort === key ? (desc ? ' ↓' : ' ↑') : '';

  return (
    <div>
      <div className="info-banner blue">
        <i className="ti ti-info-circle" />
        <div>
          Bikky retention data · {period ? <strong>{period}</strong> : 'all periods'} — return rate (% of guests who returned within 90 days) and reorder rate (same item again). &quot;Highest&quot;/Top-10/Bottom-10 rankings only consider items with at least median guest volume, so a low-guest item at a deceptively high or low rate can&apos;t dominate the ranking.
        </div>
      </div>

      {/* Filter row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Source</span>
        <div className="chp">
          {(['instore', '3pd_loyalty'] as Source[]).map(s => (
            <button key={s} onClick={() => setSource(s)}
              className={`cp all${source === s ? ' on' : ''}`}>{SOURCE_LABELS[s]}</button>
          ))}
        </div>

        {categoryOptions.length > 0 && (
          <>
            <div className="fb-sep" />
            <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Category</span>
            <CheckboxDropdown
              label="Categories"
              options={categoryOptions}
              selected={catFilters}
              onChange={v => { setCatFilters(v); setSubCatFilters([]); }}
            />
          </>
        )}

        {subCatOptions.length > 0 && (
          <>
            <div className="fb-sep" />
            <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Sub-Category</span>
            <CheckboxDropdown
              label="Sub-Categories"
              options={subCatOptions}
              selected={subCatFilters}
              onChange={setSubCatFilters}
            />
          </>
        )}

        {quadrantOptions.length > 0 && (
          <>
            <div className="fb-sep" />
            <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Quadrant</span>
            <select className="fb-sel" value={quadrantFilter} onChange={e => setQuadrant(e.target.value)}>
              <option value="all">All</option>
              {quadrantOptions.map(q => <option key={q} value={q}>{q}</option>)}
            </select>
          </>
        )}
      </div>

      {/* KPI row — dynamic, responds to all filters */}
      <div className="krow k4" style={{ marginBottom: 16 }}>
        <div className="kc a">
          <div className="kl">Avg Return Rate</div>
          <div className="kv">{pct(avgReturn)}</div>
          <div className="ks">90-day window</div>
        </div>
        <div className="kc g">
          <div className="kl">Avg Reorder Rate</div>
          <div className="kv">{pct(avgReorder)}</div>
          <div className="ks">same item again</div>
        </div>
        <div className="kc b">
          <div className="kl">Highest Reorder Item</div>
          <div className="kv-sm">{topReorder?.name ?? '—'}</div>
          <div className="ks">{topReorder ? `${pct(topReorder.reorder_rate)} reorder rate · ${topReorder.guests.toLocaleString()} guests` : ''}</div>
        </div>
        <div className="kc p">
          <div className="kl">Highest Return Item</div>
          <div className="kv-sm">{topReturn?.name ?? '—'}</div>
          <div className="ks">{topReturn ? `${pct(topReturn.return_rate)} return rate · ${topReturn.guests.toLocaleString()} guests` : ''}</div>
        </div>
      </div>

      {bikky.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          No Bikky data available.
        </div>
      ) : (
        <>
          {/* Scatter */}
          <div className="cc" style={{ padding: '14px 16px', marginBottom: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 11, marginBottom: 10, color: 'var(--fg)' }}>
              Return Rate vs Reorder Rate
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <ScatterChart margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
                <CartesianGrid stroke="#f3f4f6" />
                <XAxis dataKey="x" name="Return %" type="number" tick={{ fontSize: 9 }} tickLine={false}
                  label={{ value: 'Return Rate %', position: 'insideBottom', offset: -12, fontSize: 9 }} />
                <YAxis dataKey="y" name="Reorder %" type="number" tick={{ fontSize: 9 }} tickLine={false}
                  label={{ value: 'Reorder Rate %', angle: -90, position: 'insideLeft', fontSize: 9 }} />
                <ReferenceLine x={avgReturn * 100}  stroke="#a78bfa" strokeDasharray="4 2" strokeWidth={1} />
                <ReferenceLine y={avgReorder * 100} stroke="#a78bfa" strokeDasharray="4 2" strokeWidth={1} />
                <Tooltip
                  content={({ payload }) => {
                    const p = payload?.[0]?.payload;
                    if (!p) return null;
                    return (
                      <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 11 }}>
                        <div style={{ fontWeight: 700, marginBottom: 3 }}>{p.name}</div>
                        <div>Return Rate: <strong>{p.x.toFixed(1)}%</strong></div>
                        <div>Reorder Rate: <strong>{p.y.toFixed(1)}%</strong></div>
                        {p.guests > 0 && <div style={{ color: 'var(--muted)' }}>{p.guests.toLocaleString()} guests</div>}
                      </div>
                    );
                  }}
                />
                <Scatter data={scatterData} fill="#7c3aed99" stroke="#7c3aed" r={4} />
              </ScatterChart>
            </ResponsiveContainer>
            <div style={{ fontSize: 9, color: 'var(--muted)', textAlign: 'center', marginTop: 4 }}>
              Dashed lines = avg. Top-right = high retention + high reorder
            </div>
          </div>

          {/* Top/Bottom-10 lists */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <button className="drb" onClick={() => setShowBottom(b => !b)} style={{ minWidth: 0, padding: '3px 10px', fontSize: 11 }}>
              {showBottom ? 'Show Top 10' : 'Show Bottom 10'}
            </button>
          </div>
          <div className="gr2" style={{ marginBottom: 12 }}>
            <div className="cc">
              <h3>{showBottom ? 'Bottom' : 'Top'} 10 by Reorder Rate</h3>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 10 }}>
                Ranked by % of guests who ordered the same item again · {period ?? 'all periods'}
              </div>
              <Top10List rows={top10Reorder} color="#10b981" />
            </div>
            <div className="cc">
              <h3>{showBottom ? 'Bottom' : 'Top'} 10 by Return Rate</h3>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 10 }}>
                Ranked by % of guests who returned within 90 days · {period ?? 'all periods'}
              </div>
              <Top10List rows={top10Return} color="#7c3aed" />
            </div>
          </div>

          {/* Table */}
          <div className="tw">
            <div className="th2">
              <h3>Item-level retention · {SOURCE_LABELS[source]}</h3>
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search items…" className="srch" />
            </div>
            {filtered.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
                No data for the current filters.
              </div>
            ) : (
              <div className="tscroll">
                <table>
                  <thead>
                    <tr>
                      <th>Item / Modifier</th>
                      <th>Period</th>
                      <th style={thStyle('return_rate')}  onClick={() => toggleSort('return_rate')}>Return Rate{arrow('return_rate')}</th>
                      <th style={thStyle('reorder_rate')} onClick={() => toggleSort('reorder_rate')}>Reorder Rate{arrow('reorder_rate')}</th>
                      <th style={thStyle('guests')}       onClick={() => toggleSort('guests')}>Guests{arrow('guests')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r, i) => {
                      return (
                        <tr key={`${r.item_name}-${r.source}-${r.period}-${i}`}>
                          <td style={{ fontWeight: 600 }}>{r.item_name}</td>
                          <td style={{ fontSize: 10, color: 'var(--muted)' }}>{r.period}</td>
                          <td><span className={rateClass(r.return_rate)}>{pct(r.return_rate)}</span></td>
                          <td><span className={rateClass(r.reorder_rate)}>{pct(r.reorder_rate)}</span></td>
                          <td style={{ fontSize: 10 }}>{r.guests > 0 ? r.guests.toLocaleString() : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
