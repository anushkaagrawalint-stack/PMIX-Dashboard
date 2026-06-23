'use client';
import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { CHANNEL_LABEL, CHANNEL_COLOR } from '@/lib/constants';
import type { DashboardData } from '@/lib/types';

const WeeklyChart = dynamic(() => import('../charts/WeeklyChart'), { ssr: false });
const ChannelDonut = dynamic(() => import('../charts/ChannelDonut'), { ssr: false });
const HBarChart    = dynamic(() => import('../charts/HBarChart'),    { ssr: false });

const fmt$ = (v: number) =>
  `$${Math.round(v).toLocaleString('en-US')}`;

interface Props {
  data: DashboardData;
  selectedChannels: string[];
  categoryFilter: string;
}

export default function Overview({ data, selectedChannels, categoryFilter }: Props) {
  const { summary, channels, weekly, daily, periods, items, avgMargin,
          channelItems, channelCategories, weeklyByChannel, dailyByChannel } = data;

  // Weekly trend filtered by selected channels
  const effectiveWeekly = useMemo(() => {
    if (selectedChannels.length === 0) return weekly;
    const map = new Map<string, { revenue: number; qty: number }>();
    weeklyByChannel
      .filter(r => selectedChannels.includes(r.channel))
      .forEach(r => {
        const e = map.get(r.week_start) ?? { revenue: 0, qty: 0 };
        e.revenue += r.revenue;
        e.qty     += r.qty;
        map.set(r.week_start, e);
      });
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([week_start, { revenue, qty }]) => ({ week_start, revenue, qty }));
  }, [weekly, weeklyByChannel, selectedChannels]);

  const effectiveDaily = useMemo(() => {
    if (selectedChannels.length === 0) return daily;
    const map = new Map<string, { revenue: number; qty: number }>();
    dailyByChannel
      .filter(r => selectedChannels.includes(r.channel))
      .forEach(r => {
        const e = map.get(r.date) ?? { revenue: 0, qty: 0 };
        e.revenue += r.revenue;
        e.qty     += r.qty;
        map.set(r.date, e);
      });
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, { revenue, qty }]) => ({ date, revenue, qty }));
  }, [daily, dailyByChannel, selectedChannels]);

  // Category revenue map
  const effectiveCatRevMap = useMemo(() => {
    const map: Record<string, number> = {};
    const source = selectedChannels.length === 0
      ? channelCategories
      : channelCategories.filter(cc => selectedChannels.includes(cc.channel));
    source.forEach(cc => { map[cc.category] = (map[cc.category] ?? 0) + cc.revenue; });
    return map;
  }, [selectedChannels, channelCategories]);

  // Top-8 items filtered by channel + category
  const effectiveItems = useMemo(() => {
    if (selectedChannels.length === 0) return items;
    const meta = new Map(items.map(i => [i.canonical_name, i]));
    const agg  = new Map<string, { qty: number; revenue: number }>();
    channelItems
      .filter(ci => selectedChannels.includes(ci.channel))
      .forEach(ci => {
        const e = agg.get(ci.canonical_name) ?? { qty: 0, revenue: 0 };
        e.qty     += ci.qty;
        e.revenue += ci.revenue;
        agg.set(ci.canonical_name, e);
      });
    return [...agg.entries()].map(([name, { qty, revenue }]) => ({
      ...(meta.get(name) ?? {
        canonical_name: name, menu_name: '', menu_group: '', channel: '',
        is_open_item: false, category: 'Other', sub_category: '',
        avg_price: 0, revenue_pct: 0, qty_pct: 0,
      }),
      qty, revenue,
    }));
  }, [selectedChannels, items, channelItems]);

  const top8 = useMemo(() => {
    const seen = new Map<string, { revenue: number; category: string }>();
    for (const i of effectiveItems) {
      const e = seen.get(i.canonical_name);
      if (e) e.revenue += i.revenue;
      else seen.set(i.canonical_name, { revenue: i.revenue, category: i.category ?? 'Other' });
    }
    let entries = [...seen.entries()];
    if (categoryFilter !== 'all') entries = entries.filter(([, v]) => v.category === categoryFilter);
    return entries
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .slice(0, 8)
      .map(([name, v]) => ({ name: name.slice(0, 24), value: v.revenue }));
  }, [effectiveItems, categoryFilter]);

  const catData = useMemo(() => {
    let entries = Object.entries(effectiveCatRevMap).sort((a, b) => b[1] - a[1]);
    if (categoryFilter !== 'all') entries = entries.filter(([cat]) => cat === categoryFilter);
    return entries.map(([name, value]) => ({ name, value }));
  }, [effectiveCatRevMap, categoryFilter]);

  const subCatData = useMemo(() => {
    if (categoryFilter === 'all') return [];
    const map: Record<string, number> = {};
    effectiveItems.forEach(i => {
      if ((i.category ?? 'Other') === categoryFilter) {
        const sub = i.sub_category || categoryFilter;
        map[sub] = (map[sub] ?? 0) + i.revenue;
      }
    });
    return Object.entries(map).filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value }));
  }, [effectiveItems, categoryFilter]);

  const effectiveChannels = useMemo(() =>
    selectedChannels.length === 0
      ? channels
      : channels.filter(c => selectedChannels.includes(c.channel)),
  [channels, selectedChannels]);

  // KPI totals from filtered channel data
  const kpiRevenue = useMemo(() =>
    selectedChannels.length === 0
      ? summary.total_revenue
      : effectiveChannels.reduce((s, c) => s + c.revenue, 0),
  [selectedChannels, summary, effectiveChannels]);

  const kpiQty = useMemo(() =>
    selectedChannels.length === 0
      ? summary.total_qty
      : effectiveChannels.reduce((s, c) => s + c.qty, 0),
  [selectedChannels, summary, effectiveChannels]);

  const rightChartData  = categoryFilter === 'all' ? catData : subCatData;
  const rightChartTitle = categoryFilter === 'all'
    ? 'Revenue by category' : `${categoryFilter} · sub-category`;

  // Filtered % for channel table (relative to filtered total, not grand total)
  const filteredTotal = effectiveChannels.reduce((s, c) => s + c.revenue, 0);

  return (
    <div>
      {/* KPI row */}
      <div className="krow">
        <div className="kc a">
          <div className="kl">Items Sold</div>
          <div className="kv">{Number(kpiQty).toLocaleString()}</div>
          {selectedChannels.length > 0 && <div className="ks">filtered</div>}
        </div>
        <div className="kc g">
          <div className="kl">Net Revenue</div>
          <div className="kv">{fmt$(kpiRevenue)}</div>
          {selectedChannels.length > 0 && <div className="ks">filtered</div>}
        </div>
        <div className="kc b">
          <div className="kl">Avg Margin</div>
          <div className="kv">{(avgMargin * 100).toFixed(1)}%</div>
          <div className="ks">blended · all items</div>
        </div>
        <div className="kc p">
          <div className="kl">Unique Items</div>
          <div className="kv">{summary.unique_items}</div>
          <div className="ks">real menu items</div>
        </div>
        <div className="kc pk">
          <div className="kl">Top Item</div>
          <div className="kv-sm">{summary.top_item}</div>
          <div className="ks">{summary.top_item_mix}% mix · {fmt$(summary.top_item_revenue)}</div>
        </div>
      </div>

      {/* Charts row 1 */}
      <div className="gr2">
        <div className="cc">
          <h3>Sales trend</h3>
          <WeeklyChart weekly={effectiveWeekly} daily={effectiveDaily} periods={periods} />
        </div>
        <div className="cc">
          <h3>Revenue by channel</h3>
          <div style={{ position: 'relative', height: 200 }}>
            <ChannelDonut data={effectiveChannels} />
          </div>
        </div>
      </div>

      {/* Charts row 2 */}
      <div className="gr22">
        <div className="cc">
          <h3>Top 8 items by revenue{categoryFilter !== 'all' && ` · ${categoryFilter}`}</h3>
          <div style={{ position: 'relative', height: 280 }}>
            <HBarChart data={top8} height={280} />
          </div>
        </div>
        <div className="cc">
          <h3>{rightChartTitle}</h3>
          <div style={{ position: 'relative', height: 280 }}>
            <HBarChart data={rightChartData} color="#7cb9ef" height={280} />
          </div>
        </div>
      </div>

      {/* Channel breakdown table */}
      <div className="tw">
        <div className="th2"><h3>Channel breakdown</h3></div>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Channel</th>
                <th>Revenue</th>
                <th>% of {selectedChannels.length > 0 ? 'Selected' : 'Total'}</th>
                <th>Items Sold</th>
                <th>Share</th>
              </tr>
            </thead>
            <tbody>
              {effectiveChannels.map(c => {
                const pct = filteredTotal > 0 ? (c.revenue / filteredTotal * 100).toFixed(1) : '0.0';
                return (
                  <tr key={c.channel}>
                    <td style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{
                        width: 8, height: 8, borderRadius: 2,
                        background: CHANNEL_COLOR[c.channel] ?? '#9ca3af',
                        display: 'inline-block', flexShrink: 0,
                      }} />
                      {CHANNEL_LABEL[c.channel] ?? c.channel}
                    </td>
                    <td>{fmt$(c.revenue)}</td>
                    <td>{pct}%</td>
                    <td>{c.qty.toLocaleString()}</td>
                    <td style={{ width: 120 }}>
                      <div className="bw">
                        <div className="bb">
                          <div className="bf" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
