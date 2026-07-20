'use client';
import { useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { CHANNEL_LABEL, CHANNEL_COLOR, normalizeCategory } from '@/lib/constants';
import type { DashboardData, MakeItMealModifierRow } from '@/lib/types';

const HBarChart = dynamic(() => import('../charts/HBarChart'), { ssr: false });

const fmt$ = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;

type SortKey = string; // 'total' or any channel code

const CH_ORDER = ['IN_HOUSE', 'APP', 'TPD', 'TPD_MARKUP', 'CATERING', 'CATERING_3PD', 'OFFSITE', 'OPEN_ITEMS'];

// These channels use menu_group as primary breakdown (vendor names) instead of
// category. APP (RASA Digital) was here too, but its menu_group values are
// real menu categories (SIDES, DRINKS, CHEF CURATED BOWLS, ...), not vendor
// names — so it now shows canonical item names like In-House/3PD instead.
const MENU_GROUP_CHANNELS = new Set(['CATERING', 'CATERING_3PD', 'OFFSITE']);

const thC: React.CSSProperties = { textAlign: 'center', fontSize: 9, color: 'var(--muted)', fontWeight: 600, padding: '0 4px 6px' };
const tdC: React.CSSProperties = { textAlign: 'center', padding: '4px' };

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

export default function ChannelMenu({ data, makeItMealModifiers }: { data: DashboardData; makeItMealModifiers: MakeItMealModifierRow[] }) {
  const { channels, channelItems, channelCategories } = data;

  const [sort, setSort]       = useState<SortKey>('total');
  const [desc, setDesc]       = useState(true);
  const [topView, setTopView] = useState<'pct' | 'exact'>('pct');
  const [showBottom, setShowBottom] = useState(false);
  const [includeMakeItMeal, setIncludeMakeItMeal] = useState(false);

  function toggleSort(key: SortKey) {
    if (sort === key) setDesc(d => !d);
    else { setSort(key); setDesc(true); }
  }
  const arrow = (key: SortKey) => sort === key ? (desc ? ' ↓' : ' ↑') : '';

  // canonical_name|channel → make-it-a-meal qty + real price (fact_modifiers.price).
  // `makeItMealModifiers` here is only location-filtered, not category-filtered
  // (see Dashboard.tsx's locationFilteredMakeItMealModifiers), so this only ever
  // adds price onto rows that already exist in channelItems/data.items — those are
  // pre-scoped by category upstream. Unlike ItemMix/Overview, this tab does NOT
  // synthesize new modifier-only rows, since it has no categoryFilter of its own
  // to correctly scope one (a wrong category could otherwise leak through).
  const makeItMealMap = useMemo(() => {
    const m = new Map<string, { qty: number; price: number }>();
    makeItMealModifiers.forEach(r => {
      const key = `${r.canonical_name}|${r.channel}`;
      const ex  = m.get(key) ?? { qty: 0, price: 0 };
      m.set(key, { qty: ex.qty + r.qty, price: ex.price + r.price });
    });
    return m;
  }, [makeItMealModifiers]);

  // Per-channel KPI aggregates from channelItems (already channel+category filtered by Dashboard)
  const kpiByChannel = useMemo(() => {
    const agg = new Map<string, { revenue: number; qty: number; refunds: number }>();
    channelItems.forEach(ci => {
      const mm = includeMakeItMeal ? makeItMealMap.get(`${ci.canonical_name}|${ci.channel}`) : undefined;
      const e = agg.get(ci.channel) ?? { revenue: 0, qty: 0, refunds: 0 };
      e.revenue += ci.revenue + (mm?.price ?? 0);
      e.qty     += ci.qty     + (mm?.qty   ?? 0);
      e.refunds += ci.refunds;
      agg.set(ci.channel, e);
    });
    const totalNet = [...agg.values()].reduce((s, v) => s + (v.revenue - v.refunds), 0);
    const result = new Map<string, { revenue: number; qty: number; refunds: number; net: number; pct: string }>();
    agg.forEach((v, ch) => {
      const net = v.revenue - v.refunds;
      result.set(ch, { ...v, net, pct: totalNet > 0 ? ((net / totalNet) * 100).toFixed(1) : '0.0' });
    });
    return result;
  }, [channelItems, makeItMealMap, includeMakeItMeal]);

  // Per-channel modifier-pick qty total — purely for the KPI cards' "+X from
  // Make It a Meal" note text. qty itself is already combined above/below
  // (kpiByChannel, topByChannel, mgTopByChannel all fold it in directly), so
  // this is never added a second time.
  const channelMakeItMealQty = useMemo(() => {
    const m = new Map<string, number>();
    if (!includeMakeItMeal) return m;
    makeItMealMap.forEach((v, key) => {
      const channel = key.slice(key.lastIndexOf('|') + 1);
      m.set(channel, (m.get(channel) ?? 0) + v.qty);
    });
    return m;
  }, [makeItMealMap, includeMakeItMeal]);

  // Top items per channel — for non-MG channels
  const topByChannel = useMemo(() => {
    const chanRev: Record<string, number> = {};
    const chanQty: Record<string, number> = {};
    channelItems.forEach(r => {
      const mm = includeMakeItMeal ? makeItMealMap.get(`${r.canonical_name}|${r.channel}`) : undefined;
      chanRev[r.channel] = (chanRev[r.channel] ?? 0) + r.revenue + (mm?.price ?? 0);
      chanQty[r.channel] = (chanQty[r.channel] ?? 0) + r.qty     + (mm?.qty   ?? 0);
    });

    const grouped: Record<string, Record<string, { rev: number; qty: number }>> = {};
    channelItems.forEach(r => {
      const mm = includeMakeItMeal ? makeItMealMap.get(`${r.canonical_name}|${r.channel}`) : undefined;
      if (!grouped[r.channel]) grouped[r.channel] = {};
      const e = grouped[r.channel][r.canonical_name] ?? { rev: 0, qty: 0 };
      e.rev += r.revenue + (mm?.price ?? 0);
      e.qty += r.qty     + (mm?.qty   ?? 0);
      grouped[r.channel][r.canonical_name] = e;
    });

    const map: Record<string, Array<{ name: string; rev: number; qty: number; revPct: number; qtyPct: number }>> = {};
    Object.entries(grouped).forEach(([ch, items]) => {
      const totalRev = chanRev[ch] ?? 1;
      const totalQty = chanQty[ch] ?? 1;
      const sorted = Object.entries(items).sort((a, b) =>
        showBottom ? a[1].rev - b[1].rev : b[1].rev - a[1].rev,
      );
      map[ch] = sorted
        .slice(0, 10)
        .map(([name, { rev, qty }]) => ({
          name: name.length > 26 ? name.slice(0, 24) + '…' : name,
          rev, qty,
          revPct: Math.round((rev / totalRev) * 1000) / 10,
          qtyPct: Math.round((qty / totalQty) * 1000) / 10,
        }));
    });
    return map;
  }, [channelItems, showBottom, makeItMealMap, includeMakeItMeal]);

  // Menu-group distribution for MG channels (uses data.items which has menu_group)
  const menuGroupByChannel = useMemo(() => {
    const map: Record<string, Array<{ name: string; value: number }>> = {};
    data.items.forEach(item => {
      const ch = item.channel;
      if (!MENU_GROUP_CHANNELS.has(ch)) return;
      const added = includeMakeItMeal ? (makeItMealMap.get(`${item.canonical_name}|${ch}`)?.price ?? 0) : 0;
      const g = item.menu_group || 'Other';
      if (!map[ch]) map[ch] = [];
      const existing = map[ch].find(e => e.name === g);
      if (existing) existing.value += item.gross_sales + added;
      else map[ch].push({ name: g, value: item.gross_sales + added });
    });
    Object.values(map).forEach(groups => groups.sort((a, b) => b.value - a.value));
    return map;
  }, [data.items, makeItMealMap, includeMakeItMeal]);

  // Top menu-groups per MG channel (for the table section)
  const mgTopByChannel = useMemo(() => {
    const map: Record<string, Array<{ name: string; rev: number; qty: number; revPct: number; qtyPct: number }>> = {};
    MENU_GROUP_CHANNELS.forEach(ch => {
      const groups: Record<string, { rev: number; qty: number }> = {};
      data.items.filter(i => i.channel === ch).forEach(item => {
        const mm = includeMakeItMeal ? makeItMealMap.get(`${item.canonical_name}|${ch}`) : undefined;
        const g = item.menu_group || 'Other';
        const e = groups[g] ?? { rev: 0, qty: 0 };
        e.rev += item.gross_sales + (mm?.price ?? 0);
        e.qty += item.qty         + (mm?.qty   ?? 0);
        groups[g] = e;
      });
      const totalRev = Object.values(groups).reduce((s, v) => s + v.rev, 0);
      const totalQty = Object.values(groups).reduce((s, v) => s + v.qty, 0);
      map[ch] = Object.entries(groups)
        .sort((a, b) => showBottom ? a[1].rev - b[1].rev : b[1].rev - a[1].rev)
        .slice(0, 10)
        .map(([name, { rev, qty }]) => ({
          name,
          rev,
          qty,
          revPct: Math.round(totalRev > 0 ? (rev / totalRev) * 1000 : 0) / 10,
          qtyPct: Math.round(totalQty > 0 ? (qty / totalQty) * 1000 : 0) / 10,
        }));
    });
    return map;
  }, [data.items, showBottom, makeItMealMap, includeMakeItMeal]);

  // Revenue by channel bar
  const menuRevBar = useMemo(() => {
    const map: Record<string, number> = {};
    channelItems.forEach(r => {
      const added = includeMakeItMeal ? (makeItMealMap.get(`${r.canonical_name}|${r.channel}`)?.price ?? 0) : 0;
      map[r.channel] = (map[r.channel] ?? 0) + r.revenue - r.refunds + added;
    });
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .map(([name, value]) => ({ name: CHANNEL_LABEL[name] ?? name, value }));
  }, [channelItems, makeItMealMap, includeMakeItMeal]);

  // Per-channel category breakdown (for non-MG channels) — NOT adjusted for Make
  // It a Meal: channelCategories has no canonical_name, so there's no join key
  // to attach the modifier's price to (category totals stay revenue-as-loaded).
  const catByChannel = useMemo(() => {
    const map: Record<string, Array<{ name: string; value: number }>> = {};
    channelCategories.forEach(cc => {
      if (!map[cc.channel]) map[cc.channel] = [];
      const cat = normalizeCategory(cc.category);
      const existing = map[cc.channel].find(e => e.name === cat);
      if (existing) existing.value += cc.revenue;
      else map[cc.channel].push({ name: cat, value: cc.revenue });
    });
    Object.values(map).forEach(cats => cats.sort((a, b) => b.value - a.value));
    return map;
  }, [channelCategories]);

  // Chart channels: MG channels show menu_group, others show category
  const chartChannels = CH_ORDER
    .filter(code => {
      if (MENU_GROUP_CHANNELS.has(code)) return (menuGroupByChannel[code]?.length ?? 0) > 0;
      return (catByChannel[code]?.length ?? 0) > 0;
    })
    .map(code => ({
      code,
      label:    CHANNEL_LABEL[code] ?? code,
      color:    CHANNEL_COLOR[code] ?? '#9ca3af',
      data:     MENU_GROUP_CHANNELS.has(code) ? (menuGroupByChannel[code] ?? []) : (catByChannel[code] ?? []),
      isMG:     MENU_GROUP_CHANNELS.has(code),
    }));

  // Channels that actually have items — in display order
  const activeChannels = CH_ORDER
    .filter(code => {
      if (MENU_GROUP_CHANNELS.has(code)) return (mgTopByChannel[code]?.length ?? 0) > 0;
      return (topByChannel[code]?.length ?? 0) > 0;
    })
    .map(code => ({ code, label: CHANNEL_LABEL[code] ?? code, color: CHANNEL_COLOR[code] ?? '#9ca3af', isMG: MENU_GROUP_CHANNELS.has(code) }));

  // Item-level channel split — all channels (top 50)
  const itemData = useMemo(() => {
    const map = new Map<string, { name: string; byChannel: Record<string, number>; total: number }>();
    channelItems.forEach(ci => {
      const added = includeMakeItMeal ? (makeItMealMap.get(`${ci.canonical_name}|${ci.channel}`)?.price ?? 0) : 0;
      if (!map.has(ci.canonical_name)) {
        map.set(ci.canonical_name, { name: ci.canonical_name, byChannel: {}, total: 0 });
      }
      const item = map.get(ci.canonical_name)!;
      item.byChannel[ci.channel] = (item.byChannel[ci.channel] ?? 0) + ci.revenue + added;
      item.total += ci.revenue + added;
    });
    return [...map.values()]
      .sort((a, b) => {
        const mul = desc ? -1 : 1;
        const av = sort === 'total' ? a.total : (a.byChannel[sort] ?? 0);
        const bv = sort === 'total' ? b.total : (b.byChannel[sort] ?? 0);
        return mul * (av - bv);
      })
      .slice(0, 50);
  }, [channelItems, sort, desc, makeItMealMap, includeMakeItMeal]);

  // Split activeChannels into rows of 3
  const topItemRows: typeof activeChannels[] = [];
  for (let i = 0; i < activeChannels.length; i += 3) topItemRows.push(activeChannels.slice(i, i + 3));

  // Split chartChannels into rows of 3
  const chartRows: typeof chartChannels[] = [];
  for (let i = 0; i < chartChannels.length; i += 3) chartRows.push(chartChannels.slice(i, i + 3));

  return (
    <div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, cursor: 'pointer', marginBottom: 8 }}>
        <input type="checkbox" checked={includeMakeItMeal} onChange={e => setIncludeMakeItMeal(e.target.checked)} />
        Include &quot;Make It a Meal&quot; picks in Revenue (adds the modifier&apos;s own real price from fact_modifiers; category breakdown charts are unaffected — no per-item join key there)
      </label>

      {/* ── Row 1: KPI cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 10 }}>
        {channels.map(ch => {
          const kpi    = kpiByChannel.get(ch.channel) ?? { revenue: 0, qty: 0, refunds: 0, net: 0, pct: '0.0' };
          const mimQty = channelMakeItMealQty.get(ch.channel) ?? 0;
          return (
            <div
              key={ch.channel}
              className="kc"
              style={{ borderLeftColor: CHANNEL_COLOR[ch.channel] ?? '#999', borderLeftWidth: 3, borderLeftStyle: 'solid' }}
            >
              <div className="kl">{CHANNEL_LABEL[ch.channel] ?? ch.channel}</div>
              <div className="kv">{fmt$(kpi.net)}</div>
              <div className="ks">{kpi.pct}% of total · {kpi.qty.toLocaleString()} sold</div>
              {mimQty > 0 && <div className="ks">+{mimQty.toLocaleString()} from Make It a Meal</div>}
              {kpi.refunds > 0 && <div className="ks" style={{ color: '#dc2626' }}>-{fmt$(kpi.refunds)} refunds</div>}
            </div>
          );
        })}
      </div>

      {/* ── Row 2: Revenue bar chart (2/3) + summary table (1/3) ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10, marginBottom: 10 }}>
        <div className="cc">
          <h3>Revenue by channel</h3>
          <HBarChart data={menuRevBar} color="#9f7cef" height={240} />
        </div>

        <div className="cc" style={{ overflow: 'hidden' }}>
          <h3>Channel summary</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...thC, textAlign: 'left' }}>Channel</th>
                <th style={thC}>Revenue</th>
                <th style={thC}>Mix</th>
              </tr>
            </thead>
            <tbody>
              {channels.map(ch => {
                const kpi = kpiByChannel.get(ch.channel) ?? { revenue: 0, qty: 0, refunds: 0, net: 0, pct: '0.0' };
                return (
                  <tr key={ch.channel}>
                    <td style={{ ...tdC, textAlign: 'left', fontSize: 11 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 7, height: 7, borderRadius: 2, background: CHANNEL_COLOR[ch.channel] ?? '#9ca3af', flexShrink: 0, display: 'inline-block' }} />
                        {CHANNEL_LABEL[ch.channel] ?? ch.channel}
                      </div>
                    </td>
                    <td style={{ ...tdC, fontSize: 11, fontWeight: 600 }}>{fmt$(kpi.net)}</td>
                    <td style={{ ...tdC, fontSize: 10, color: 'var(--muted)' }}>{kpi.pct}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Category / Menu-group breakdown by channel (3 per row) ── */}
      {chartChannels.length > 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', marginBottom: 8, marginTop: 6, paddingLeft: 2 }}>
            Breakdown by channel
          </div>
          {chartRows.map((row, ri) => (
            <div key={ri} className="gr3">
              {row.map(ch => (
                <div key={ch.code} className="cc">
                  <h3 style={{ borderLeft: `3px solid ${ch.color}`, paddingLeft: 7, marginLeft: -4 }}>
                    {ch.label}
                    <span style={{ fontSize: 9, fontWeight: 400, color: 'var(--muted)', marginLeft: 6 }}>
                      {ch.isMG ? 'by vendor' : 'by category'}
                    </span>
                  </h3>
                  <HBarChart data={ch.data} color={ch.color} height={180} />
                </div>
              ))}
            </div>
          ))}
        </>
      )}

      {/* ── Top items / menu-groups per channel (3 per row) ── */}
      {topItemRows.length > 0 && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, marginTop: 6, paddingLeft: 2 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>
                {showBottom ? 'Bottom' : 'Top'} items by channel
              </div>
              {/* Top / Bottom pill toggle */}
              <div style={{ display: 'flex', gap: 1, background: '#e5e7eb', borderRadius: 7, padding: 3, border: '1px solid #d1d5db' }}>
                {([false, true] as const).map(isBottom => (
                  <button key={String(isBottom)} onClick={() => setShowBottom(isBottom)} style={{
                    fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 5, border: 'none', cursor: 'pointer',
                    background: showBottom === isBottom ? (isBottom ? '#dc2626' : 'var(--accent)') : 'transparent',
                    color: showBottom === isBottom ? '#fff' : '#6b7280',
                    boxShadow: showBottom === isBottom ? `0 1px 4px ${isBottom ? 'rgba(220,38,38,.3)' : 'rgba(99,102,241,.35)'}` : 'none',
                    transition: 'all .15s',
                  }}>{isBottom ? 'Bottom' : 'Top'}</button>
                ))}
              </div>
            </div>
            {/* % / # pill toggle */}
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
              {row.map(ch => {
                const rows = ch.isMG
                  ? (mgTopByChannel[ch.code] ?? [])
                  : (topByChannel[ch.code] ?? []);
                const rowLabel = ch.isMG ? 'Vendor / Group' : 'Item';
                return (
                  <div key={ch.code} className="cc">
                    <h3 style={{ borderLeft: `3px solid ${ch.color}`, paddingLeft: 7, marginLeft: -4 }}>
                      {ch.label}
                      {ch.isMG && (
                        <span style={{ fontSize: 9, fontWeight: 400, color: 'var(--muted)', marginLeft: 6 }}>by vendor</span>
                      )}
                    </h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingBottom: 4, borderBottom: '2px solid #e5e7eb', marginBottom: 2 }}>
                      <span style={{ fontSize: 9, color: 'var(--muted)', width: 14, flexShrink: 0 }} />
                      <div style={{ flex: 1, fontSize: 9, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{rowLabel}</div>
                      <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em', textAlign: 'center', minWidth: 55 }}>
                        {topView === 'pct' ? '% Rev' : 'Revenue'}
                      </div>
                      <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em', textAlign: 'center', minWidth: 45 }}>
                        {topView === 'pct' ? '% Qty' : 'Qty'}
                      </div>
                    </div>
                    {rows.map((item, idx) => (
                      <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', borderBottom: '1px solid #f3f4f6' }}>
                        <span style={{ fontSize: 10, color: 'var(--muted)', width: 14, flexShrink: 0, textAlign: 'center' }}>{idx + 1}</span>
                        <div style={{ flex: 1, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
                        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', flexShrink: 0, minWidth: 55, textAlign: 'center' }}>
                          {topView === 'pct' ? `${item.revPct}%` : fmt$(item.rev)}
                        </span>
                        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', flexShrink: 0, minWidth: 45, textAlign: 'center' }}>
                          {topView === 'pct' ? `${item.qtyPct}%` : item.qty.toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
        </>
      )}

      {/* ── Item-level channel split table — all channels ── */}
      <SectionLabel label="Item channel split (top 50)" />
      <div className="tw">
        <div className="th2">
          <h3>Revenue by item across all channels</h3>
        </div>
        <div className="tscroll">
          <table style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Item</th>
                <th style={{ textAlign: 'center', cursor: 'pointer', color: sort === 'total' ? 'var(--accent)' : undefined }} onClick={() => toggleSort('total')}>
                  Total{arrow('total')}
                </th>
                {activeChannels.map(ch => (
                  <th
                    key={ch.code}
                    style={{ textAlign: 'center', cursor: 'pointer', color: sort === ch.code ? ch.color : undefined, whiteSpace: 'nowrap' }}
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
                  <td style={{ fontWeight: 600, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}>
                    {item.name}
                  </td>
                  <td style={{ fontWeight: 600, textAlign: 'center' }}>{fmt$(item.total)}</td>
                  {activeChannels.map(ch => {
                    const v = item.byChannel[ch.code] ?? 0;
                    return (
                      <td key={ch.code} style={{ textAlign: 'center', color: v > 0 ? 'var(--text)' : 'var(--muted)' }}>
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
