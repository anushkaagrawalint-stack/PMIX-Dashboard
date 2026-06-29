'use client';
import { useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { CHANNEL_LABEL, CHANNEL_COLOR } from '@/lib/constants';
import type { DashboardData } from '@/lib/types';

const HBarChart = dynamic(() => import('../charts/HBarChart'), { ssr: false });

const fmt$ = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;

type SortKey = string; // 'total' or any channel code

const CH_ORDER = ['IN_HOUSE', 'APP', 'TPD', 'TPD_MARKUP', 'CATERING', 'CATERING_3PD', 'OFFSITE', 'OPEN_ITEMS'];

function SectionLabel({ label }: { label: string }) {
  return (
    <div style={{
      fontSize: 9, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase',
      letterSpacing: '.08em', marginBottom: 6, marginTop: 4, paddingLeft: 2,
    }}>
      {label}
    </div>
  );
}

export default function ChannelMenu({ data }: { data: DashboardData }) {
  const { channels, channelItems, meItems } = data;

  const [sort, setSort]   = useState<SortKey>('total');
  const [desc, setDesc]   = useState(true);
  const [topView, setTopView] = useState<'pct' | 'exact'>('pct');
  const [meFilter,  setMeFilter]  = useState<Set<string>>(new Set());
  const [meOpen,    setMeOpen]    = useState(false);

  function toggleSort(key: SortKey) {
    if (sort === key) setDesc(d => !d);
    else { setSort(key); setDesc(true); }
  }
  const arrow = (key: SortKey) => sort === key ? (desc ? ' ↓' : ' ↑') : '';

  // Top items per channel — includes both revenue and qty
  const topByChannel = useMemo(() => {
    const chanRev: Record<string, number> = {};
    const chanQty: Record<string, number> = {};
    channelItems.forEach(r => {
      chanRev[r.channel] = (chanRev[r.channel] ?? 0) + r.revenue;
      chanQty[r.channel] = (chanQty[r.channel] ?? 0) + r.qty;
    });

    const grouped: Record<string, Record<string, { rev: number; qty: number }>> = {};
    channelItems.forEach(r => {
      if (!grouped[r.channel]) grouped[r.channel] = {};
      const e = grouped[r.channel][r.canonical_name] ?? { rev: 0, qty: 0 };
      e.rev += r.revenue;
      e.qty += r.qty;
      grouped[r.channel][r.canonical_name] = e;
    });

    const map: Record<string, Array<{ name: string; rev: number; qty: number; revPct: number; qtyPct: number }>> = {};
    Object.entries(grouped).forEach(([ch, items]) => {
      const totalRev = chanRev[ch] ?? 1;
      const totalQty = chanQty[ch] ?? 1;
      map[ch] = Object.entries(items)
        .sort((a, b) => b[1].rev - a[1].rev)
        .slice(0, 10)
        .map(([name, { rev, qty }]) => ({
          name: name.length > 26 ? name.slice(0, 24) + '…' : name,
          rev, qty,
          revPct: Math.round((rev / totalRev) * 1000) / 10,
          qtyPct: Math.round((qty / totalQty) * 1000) / 10,
        }));
    });
    return map;
  }, [channelItems]);

  // Revenue by channel bar
  const menuRevBar = useMemo(() => {
    const map: Record<string, number> = {};
    channelItems.forEach(r => { map[r.channel] = (map[r.channel] ?? 0) + r.revenue; });
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .map(([name, value]) => ({ name: CHANNEL_LABEL[name] ?? name, value }));
  }, [channelItems]);

  // Channels that actually have items — in display order
  const activeChannels = CH_ORDER
    .filter(code => (topByChannel[code]?.length ?? 0) > 0)
    .map(code => ({ code, label: CHANNEL_LABEL[code] ?? code, color: CHANNEL_COLOR[code] ?? '#9ca3af' }));

  // Item-level channel split — all channels (top 50)
  const itemData = useMemo(() => {
    const map = new Map<string, { name: string; quadrant: string; byChannel: Record<string, number>; total: number }>();
    channelItems.forEach(ci => {
      if (!map.has(ci.canonical_name)) {
        const me = meItems.find(m => m.canonical_name === ci.canonical_name);
        map.set(ci.canonical_name, { name: ci.canonical_name, quadrant: me?.quadrant ?? 'Dog', byChannel: {}, total: 0 });
      }
      const item = map.get(ci.canonical_name)!;
      item.byChannel[ci.channel] = (item.byChannel[ci.channel] ?? 0) + ci.revenue;
      item.total += ci.revenue;
    });
    return [...map.values()]
      .filter(item => meFilter.size === 0 || meFilter.has(item.quadrant))
      .sort((a, b) => {
        const mul = desc ? -1 : 1;
        const av = sort === 'total' ? a.total : (a.byChannel[sort] ?? 0);
        const bv = sort === 'total' ? b.total : (b.byChannel[sort] ?? 0);
        return mul * (av - bv);
      })
      .slice(0, 50);
  }, [channelItems, meItems, sort, desc, meFilter]);

  // Split activeChannels into rows of 3
  const topItemRows: typeof activeChannels[] = [];
  for (let i = 0; i < activeChannels.length; i += 3) topItemRows.push(activeChannels.slice(i, i + 3));

  return (
    <div>

      {/* ── Row 1: KPI cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 10 }}>
        {channels.map(ch => (
          <div
            key={ch.channel}
            className="kc"
            style={{ borderLeftColor: CHANNEL_COLOR[ch.channel] ?? '#999', borderLeftWidth: 3, borderLeftStyle: 'solid' }}
          >
            <div className="kl">{CHANNEL_LABEL[ch.channel] ?? ch.channel}</div>
            <div className="kv">{fmt$(ch.revenue)}</div>
            <div className="ks">{ch.pct}% of total · {ch.qty.toLocaleString()} sold</div>
          </div>
        ))}
      </div>

      {/* ── Row 2: Revenue bar chart (2/3) + summary table (1/3) ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10, marginBottom: 10 }}>
        <div className="cc">
          <h3>Revenue by channel</h3>
          <HBarChart data={menuRevBar} color="#9f7cef" height={240} />
        </div>

        <div className="cc" style={{ overflow: 'hidden' }}>
          <h3>Channel summary</h3>
          <table style={{ width: '100%' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', fontSize: 9, color: 'var(--muted)', fontWeight: 600, padding: '0 0 6px' }}>Channel</th>
                <th style={{ textAlign: 'right', fontSize: 9, color: 'var(--muted)', fontWeight: 600, padding: '0 0 6px' }}>Revenue</th>
                <th style={{ textAlign: 'right', fontSize: 9, color: 'var(--muted)', fontWeight: 600, padding: '0 0 6px' }}>Mix</th>
              </tr>
            </thead>
            <tbody>
              {channels.map(ch => (
                <tr key={ch.channel}>
                  <td style={{ padding: '4px 0', fontSize: 11 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 7, height: 7, borderRadius: 2, background: CHANNEL_COLOR[ch.channel] ?? '#9ca3af', flexShrink: 0, display: 'inline-block' }} />
                      {CHANNEL_LABEL[ch.channel] ?? ch.channel}
                    </div>
                  </td>
                  <td style={{ textAlign: 'right', fontSize: 11, fontWeight: 600, padding: '4px 0' }}>{fmt$(ch.revenue)}</td>
                  <td style={{ textAlign: 'right', fontSize: 10, color: 'var(--muted)', padding: '4px 0' }}>{ch.pct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Top items per channel (3 per row) ── */}
      {topItemRows.length > 0 && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, marginTop: 6, paddingLeft: 2 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>Top items by channel</div>
            <div style={{ display: 'flex', gap: 1, background: '#e5e7eb', borderRadius: 7, padding: 3, border: '1px solid #d1d5db' }}>
              {(['pct', 'exact'] as const).map(v => (
                <button key={v} onClick={() => setTopView(v)} style={{
                  fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 5, border: 'none', cursor: 'pointer',
                  background: topView === v ? 'var(--accent)' : 'transparent',
                  color: topView === v ? '#fff' : '#6b7280',
                  boxShadow: topView === v ? '0 1px 4px rgba(99,102,241,.35)' : 'none',
                  transition: 'all .15s',
                }}>{v === 'pct' ? '%' : '#'}</button>
              ))}
            </div>
          </div>
          {topItemRows.map((row, ri) => (
            <div key={ri} className="gr3">
              {row.map(ch => (
                <div key={ch.code} className="cc">
                  <h3 style={{ borderLeft: `3px solid ${ch.color}`, paddingLeft: 7, marginLeft: -4 }}>
                    {ch.label}
                  </h3>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingBottom: 4, borderBottom: '2px solid #e5e7eb', marginBottom: 2 }}>
                    <span style={{ fontSize: 9, color: 'var(--muted)', width: 14, flexShrink: 0 }} />
                    <div style={{ flex: 1, fontSize: 9, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Item</div>
                    <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em', textAlign: 'right', minWidth: 55 }}>
                      {topView === 'pct' ? '% Rev' : 'Revenue'}
                    </div>
                    <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em', textAlign: 'right', minWidth: 45 }}>
                      {topView === 'pct' ? '% Qty' : 'Qty'}
                    </div>
                  </div>
                  {(topByChannel[ch.code] ?? []).map((item, idx) => (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', borderBottom: '1px solid #f3f4f6' }}>
                      <span style={{ fontSize: 10, color: 'var(--muted)', width: 14, flexShrink: 0, textAlign: 'right' }}>{idx + 1}</span>
                      <div style={{ flex: 1, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', flexShrink: 0, minWidth: 55, textAlign: 'right' }}>
                        {topView === 'pct' ? `${item.revPct}%` : fmt$(item.rev)}
                      </span>
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', flexShrink: 0, minWidth: 45, textAlign: 'right' }}>
                        {topView === 'pct' ? `${item.qtyPct}%` : item.qty.toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </>
      )}

      {/* ── ME quadrant legend ── */}
      <div className="cc" style={{ marginBottom: 10 }}>
        <h3>Menu Engineering quadrant criteria</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f9fafb' }}>
              <th style={{ textAlign: 'left', padding: '6px 10px', fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Quadrant</th>
              <th style={{ textAlign: 'center', padding: '6px 10px', fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Margin</th>
              <th style={{ textAlign: 'center', padding: '6px 10px', fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Popularity</th>
              <th style={{ textAlign: 'left', padding: '6px 10px', fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>What it means</th>
            </tr>
          </thead>
          <tbody>
            {[
              { q: 'Star',       color: '#f59e0b', margin: 'High', pop: 'High', desc: 'High profit, high sales' },
              { q: 'Puzzle',     color: '#6366f1', margin: 'High', pop: 'Low',  desc: 'High profit but not selling well' },
              { q: 'Plow Horse', color: '#10b981', margin: 'Low',  pop: 'High', desc: 'Popular but thin margins' },
              { q: 'Dog',        color: '#94a3b8', margin: 'Low',  pop: 'Low',  desc: 'Low profit and low sales' },
            ].map(({ q, color, margin, pop, desc }, i) => (
              <tr key={q} style={{ borderTop: '1px solid #f3f4f6', background: i % 2 === 1 ? '#fafafa' : 'transparent' }}>
                <td style={{ padding: '8px 10px' }}>
                  <span className={`mb mb-${q.split(' ')[0]}`} style={{ background: color }}>{q}</span>
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: margin === 'High' ? '#10b981' : '#ef4444', background: margin === 'High' ? '#d1fae5' : '#fee2e2', padding: '2px 7px', borderRadius: 10 }}>
                    {margin}
                  </span>
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: pop === 'High' ? '#10b981' : '#ef4444', background: pop === 'High' ? '#d1fae5' : '#fee2e2', padding: '2px 7px', borderRadius: 10 }}>
                    {pop}
                  </span>
                </td>
                <td style={{ padding: '8px 10px', fontSize: 11, color: 'var(--text)' }}>{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ marginTop: 8, fontSize: 10, color: 'var(--muted)', paddingLeft: 2 }}>
          Thresholds are computed dynamically as the median margin % and median mix % across all items in the current filter.
        </div>
      </div>

      {/* ── Item-level channel split table — all channels ── */}
      <SectionLabel label="Item channel split (top 50)" />
      <div className="tw">
        <div className="th2">
          <h3>Revenue by item across all channels</h3>
          <div className="drw" style={{ position: 'relative' }}>
            <button className="drb" onClick={() => setMeOpen(o => !o)} style={{ minWidth: 130 }}>
              {meFilter.size === 0 ? 'All Quadrants' : `${meFilter.size} selected`}
              <i className="ti ti-chevron-down" style={{ fontSize: 11 }} />
            </button>
            {meOpen && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 199 }} onClick={() => setMeOpen(false)} />
                <div className="drm open" style={{ minWidth: 170, zIndex: 200 }}>
                  <label className="dr-it" style={{ gap: 8, userSelect: 'none' }}>
                    <input type="checkbox" checked={meFilter.size === 0}
                      onChange={() => setMeFilter(new Set())}
                      style={{ accentColor: 'var(--accent)' }} />
                    All Quadrants
                  </label>
                  <div className="dr-div" />
                  {[
                    { q: 'Star',       color: '#f59e0b' },
                    { q: 'Puzzle',     color: '#6366f1' },
                    { q: 'Plow Horse', color: '#10b981' },
                    { q: 'Dog',        color: '#94a3b8' },
                  ].map(({ q, color }) => (
                    <label key={q} className="dr-it" style={{ gap: 8, userSelect: 'none' }}>
                      <input
                        type="checkbox"
                        checked={meFilter.has(q)}
                        onChange={() => setMeFilter(prev => {
                          const next = new Set(prev);
                          next.has(q) ? next.delete(q) : next.add(q);
                          return next;
                        })}
                        style={{ accentColor: color }}
                      />
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: color, display: 'inline-block', flexShrink: 0 }} />
                      {q}
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>ME</th>
                <th style={{ cursor: 'pointer', color: sort === 'total' ? 'var(--accent)' : undefined }} onClick={() => toggleSort('total')}>
                  Total{arrow('total')}
                </th>
                {activeChannels.map(ch => (
                  <th
                    key={ch.code}
                    style={{ cursor: 'pointer', color: sort === ch.code ? ch.color : undefined, whiteSpace: 'nowrap' }}
                    onClick={() => toggleSort(ch.code)}
                  >
                    {ch.label}{arrow(ch.code)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {itemData.map(item => (
                <tr key={item.name}>
                  <td style={{ fontWeight: 600, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.name}
                  </td>
                  <td>
                    <span className={`mb mb-${item.quadrant.split(' ')[0]}`}>{item.quadrant}</span>
                  </td>
                  <td style={{ fontWeight: 600 }}>{fmt$(item.total)}</td>
                  {activeChannels.map(ch => {
                    const v = item.byChannel[ch.code] ?? 0;
                    return (
                      <td key={ch.code} style={{ color: v > 0 ? 'var(--text)' : 'var(--muted)' }}>
                        {v > 0 ? fmt$(v) : '—'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
