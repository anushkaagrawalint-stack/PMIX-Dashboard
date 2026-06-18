'use client';
import { useState, useMemo } from 'react';
import type { MERow } from '@/lib/types';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend } from 'recharts';

const fmt$ = (v: number) =>
  v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M`
  : v >= 1_000   ? `$${(v / 1_000).toFixed(0)}K`
  : `$${v.toFixed(0)}`;

const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;

const QUAD_STYLE: Record<string, { bg: string; border: string; text: string; label: string }> = {
  'Star':       { bg: '#dcfce7', border: '#86efac', text: '#14532d', label: 'Stars' },
  'Plow Horse': { bg: '#ede9fe', border: '#c4b5fd', text: '#5b21b6', label: 'Plow Horses' },
  'Puzzle':     { bg: '#dbeafe', border: '#93c5fd', text: '#1e3a8a', label: 'Puzzles' },
  'Dog':        { bg: '#fee2e2', border: '#fca5a5', text: '#991b1b', label: 'Dogs' },
};
const QUAD_COLORS: Record<string, string> = {
  'Star': '#16a34a', 'Plow Horse': '#7c3aed', 'Puzzle': '#1e40af', 'Dog': '#dc2626',
};

const CAT_ORDER = ['Entrees', 'Sides', 'NA Drinks', 'Sweets', 'Kids Meal', 'Alc Drinks', 'Retail', 'Other'];

export default function MenuEngineering({ meItems }: { meItems: MERow[] }) {
  const [search, setSearch]       = useState('');
  const [quadFilter, setQuadFilter] = useState('all');
  const [catFilter, setCatFilter]   = useState('all');
  const [view, setView]             = useState<'table' | 'scatter'>('table');

  const quadCounts = useMemo(() => {
    const c: Record<string, number> = { Star: 0, 'Plow Horse': 0, Puzzle: 0, Dog: 0 };
    meItems.forEach(i => { c[i.quadrant] = (c[i.quadrant] ?? 0) + 1; });
    return c;
  }, [meItems]);

  const categories = useMemo(() => {
    const seen = new Set<string>();
    meItems.forEach(i => seen.add(i.category));
    return CAT_ORDER.filter(c => seen.has(c));
  }, [meItems]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return meItems.filter(i =>
      (!q || i.canonical_name.toLowerCase().includes(q) || i.sub_category.toLowerCase().includes(q)) &&
      (quadFilter === 'all' || i.quadrant === quadFilter) &&
      (catFilter  === 'all' || i.category  === catFilter)
    );
  }, [meItems, search, quadFilter, catFilter]);

  const scatterData = useMemo(() =>
    meItems.map(i => ({
      x:        Math.round(i.mix_pct * 10000) / 100,
      y:        Math.round(i.margin_pct * 10000) / 100,
      name:     i.canonical_name,
      quadrant: i.quadrant,
      ns:       i.net_sales,
    })), [meItems]);

  const byQuad: Record<string, typeof scatterData> = { Star: [], 'Plow Horse': [], Puzzle: [], Dog: [] };
  scatterData.forEach(d => { byQuad[d.quadrant]?.push(d); });

  const mt  = meItems[0] ? Math.round(meItems[0].margin_threshold * 10000) / 100 : 75;
  const mxt = meItems[0] ? Math.round(meItems[0].mix_threshold * 10000) / 100 : 0.7;

  if (!meItems.length) return (
    <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>
      No ME data — cost data may not be loaded for this period.
    </div>
  );

  return (
    <div>
      {/* Quadrant summary cards */}
      <div className="me-quad-grid">
        {(['Star', 'Plow Horse', 'Puzzle', 'Dog'] as const).map(q => {
          const s = QUAD_STYLE[q];
          const cnt = quadCounts[q] ?? 0;
          const rev = meItems.filter(i => i.quadrant === q).reduce((a, i) => a + i.net_sales, 0);
          const cls = q === 'Plow Horse' ? 'plow' : q.toLowerCase();
          return (
            <div key={q}
              onClick={() => setQuadFilter(quadFilter === q ? 'all' : q)}
              className={`mqc ${cls}`}
              style={{ cursor: 'pointer', opacity: quadFilter !== 'all' && quadFilter !== q ? 0.5 : 1 }}>
              <div className="mql">{s.label}</div>
              <div className="mqn">{cnt}</div>
              <div className="mqr">{fmt$(rev)}</div>
            </div>
          );
        })}
      </div>

      {/* Threshold info + view toggle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ background: '#f5f3ff', color: '#381d7c', borderRadius: 10, padding: '6px 12px', fontSize: 10 }}>
          Margin threshold: <strong>{mt.toFixed(1)}%</strong>&nbsp;·&nbsp;
          Mix threshold: <strong>{mxt.toFixed(3)}%</strong>&nbsp;(1/n × 0.7)
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['table', 'scatter'] as const).map(v => (
            <button key={v} onClick={() => setView(v)}
              style={{
                padding: '4px 12px', borderRadius: 8, border: '1px solid var(--border)',
                fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                background: view === v ? 'var(--accent)' : 'var(--card)',
                color: view === v ? '#fff' : 'var(--muted)',
              }}>{v === 'table' ? 'Table' : 'Scatter'}</button>
          ))}
        </div>
      </div>

      {view === 'scatter' ? (
        <div style={{ background: 'var(--card)', borderRadius: 'var(--radius)', padding: '14px 16px', boxShadow: 'var(--shadow)' }}>
          <ResponsiveContainer width="100%" height={320}>
            <ScatterChart margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
              <CartesianGrid stroke="#f3f4f6" />
              <XAxis dataKey="x" name="Mix %" tick={{ fontSize: 9 }} tickLine={false}
                label={{ value: 'Menu Mix %', position: 'insideBottom', offset: -12, fontSize: 9 }} />
              <YAxis dataKey="y" name="Margin %" tick={{ fontSize: 9 }} tickLine={false}
                label={{ value: 'Margin %', angle: -90, position: 'insideLeft', fontSize: 9 }} />
              <Tooltip cursor={{ strokeDasharray: '3 3' }}
                content={({ payload }) => {
                  const p = payload?.[0]?.payload;
                  if (!p) return null;
                  return (
                    <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 11 }}>
                      <div style={{ fontWeight: 700, marginBottom: 3 }}>{p.name}</div>
                      <div>Mix: {p.x.toFixed(3)}% · Margin: {p.y.toFixed(1)}%</div>
                      <div>Rev: {fmt$(p.ns)}</div>
                      <div style={{ color: QUAD_COLORS[p.quadrant], fontWeight: 600 }}>{p.quadrant}</div>
                    </div>
                  );
                }}
              />
              <ReferenceLine x={mxt} stroke="#dc2626" strokeDasharray="4 2" strokeWidth={1.5} />
              <ReferenceLine y={mt}  stroke="#dc2626" strokeDasharray="4 2" strokeWidth={1.5} />
              <Legend iconType="circle" iconSize={8} formatter={v => <span style={{ fontSize: 9 }}>{v}</span>} />
              {Object.entries(byQuad).map(([q, pts]) => (
                <Scatter key={q} name={q} data={pts} fill={`${QUAD_COLORS[q]}99`} stroke={QUAD_COLORS[q]} r={4} />
              ))}
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <>
          {/* Filters */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search items…" className="srch" />
            <select value={quadFilter} onChange={e => setQuadFilter(e.target.value)} className="fb-sel">
              <option value="all">All quadrants</option>
              <option value="Star">Stars</option>
              <option value="Plow Horse">Plow Horses</option>
              <option value="Puzzle">Puzzles</option>
              <option value="Dog">Dogs</option>
            </select>
            <select value={catFilter} onChange={e => setCatFilter(e.target.value)} className="fb-sel">
              <option value="all">All categories</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 'auto' }}>{filtered.length} items</span>
          </div>

          {/* Table */}
          <div className="tw">
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead><tr>
                  <th>Item</th>
                  <th>ME</th>
                  <th>Category</th>
                  <th>Sub Cat</th>
                  <th>Net Sales</th>
                  <th>Sls % Cat</th>
                  <th>Qty</th>
                  <th>Mix %</th>
                  <th>Margin %</th>
                  <th>COGS %</th>
                  <th>Avg Price</th>
                  <th>Avg Cost</th>
                  <th>Margin</th>
                  <th>Mix</th>
                </tr></thead>
                <tbody>
                  {filtered.map(i => {
                    const ms = QUAD_STYLE[i.quadrant];
                    return (
                      <tr key={`${i.canonical_name}|${i.menu_group}`}>
                        <td style={{ fontWeight: 600, minWidth: 160 }}>{i.canonical_name}</td>
                        <td>
                          <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                            background: ms.bg, color: ms.text, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                            {i.quadrant}
                          </span>
                        </td>
                        <td style={{ fontSize: 10, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{i.category}</td>
                        <td style={{ fontSize: 10, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{i.sub_category || '—'}</td>
                        <td style={{ fontWeight: 600 }}>{fmt$(i.net_sales)}</td>
                        <td style={{ fontSize: 10 }}>{pct(i.sls_pct_category)}</td>
                        <td>{i.qty.toLocaleString()}</td>
                        <td style={{ fontSize: 10 }}>{pct(i.mix_pct, 3)}</td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <div style={{ width: 40, background: '#e5e7eb', borderRadius: 3, height: 5, overflow: 'hidden' }}>
                              <div style={{ height: '100%', borderRadius: 3, background: 'var(--accent)',
                                width: `${Math.min(i.margin_pct * 100, 100)}%` }} />
                            </div>
                            <span>{pct(i.margin_pct)}</span>
                          </div>
                        </td>
                        <td style={{ fontSize: 10, color: i.cogs_pct > 0.35 ? '#ef4444' : 'inherit' }}>{pct(i.cogs_pct)}</td>
                        <td>${i.avg_price.toFixed(2)}</td>
                        <td>{i.avg_cost > 0 ? `$${i.avg_cost.toFixed(2)}` : '—'}</td>
                        <td>
                          <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                            background: i.margin_flag === 'High' ? '#dcfce7' : '#fee2e2',
                            color: i.margin_flag === 'High' ? '#14532d' : '#991b1b' }}>
                            {i.margin_flag}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                            background: i.mix_flag === 'High' ? '#dcfce7' : '#fee2e2',
                            color: i.mix_flag === 'High' ? '#14532d' : '#991b1b' }}>
                            {i.mix_flag}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>{/* .tw */}
        </>
      )}
    </div>
  );
}
