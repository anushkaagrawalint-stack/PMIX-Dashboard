'use client';
import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { CHANNEL_LABEL, CHANNEL_COLOR, normalizeCategory } from '@/lib/constants';
import type { DashboardData, MakeItMealModifierRow } from '@/lib/types';

const WeeklyChart   = dynamic(() => import('../charts/WeeklyChart'),   { ssr: false });
const ChannelDonut  = dynamic(() => import('../charts/ChannelDonut'),  { ssr: false });
const CategoryDonut = dynamic(() => import('../charts/CategoryDonut'), { ssr: false });
const HBarChart     = dynamic(() => import('../charts/HBarChart'),     { ssr: false });

const fmt$ = (v: number) =>
  `$${Math.round(v).toLocaleString('en-US')}`;

interface Props {
  data: DashboardData;
  selectedChannels: string[];
  categoryFilter: string;
  selectedLocations: string[];
  makeItMealModifiers: MakeItMealModifierRow[];
}

function DeltaBadge({
  curr, prev, positiveGood = true, neutral = false, showCount = false, vsLabel,
}: { curr: number; prev: number; positiveGood?: boolean; neutral?: boolean; showCount?: boolean; vsLabel?: string | null }) {
  if (!prev) return null;
  const diff = curr - prev;
  const pct  = (diff / Math.abs(prev)) * 100;
  const up   = pct >= 0;
  const good = positiveGood ? up : !up;
  const color = neutral ? 'var(--muted)' : good ? '#16a34a' : '#dc2626';
  const vs    = vsLabel ? `vs ${vsLabel}` : 'vs prev';
  return (
    <div style={{ fontSize: 10, fontWeight: 600, marginTop: 1, color }}>
      {up ? '↑' : '↓'}{' '}
      {showCount
        ? `${Math.abs(Math.round(diff)).toLocaleString()} items`
        : `${Math.abs(pct).toFixed(1)}%`
      }{' '}{vs}
    </div>
  );
}

const mapCat = normalizeCategory;

export default function Overview({ data, selectedChannels, categoryFilter, selectedLocations, makeItMealModifiers }: Props) {
  const { summary, prevSummary, prevLabel, weekly, daily, periods, items, avgMargin,
          channelItems, weeklyByChannel, dailyByChannel,
          prevChannelItems, prevMEItems } = data;

  const [includeMakeItMeal, setIncludeMakeItMeal] = useState(false);
  // isFiltered already forces every KPI onto the client-computed (kpiItems) path
  // instead of the server-precomputed `summary` totals — Make It a Meal needs the
  // same treatment, since `summary.net_revenue` has no per-item hook to add the
  // modifier's price into. See ItemMix.tsx for the same qty-untouched, $-figures-
  // only convention this mirrors.
  const isFiltered = selectedChannels.length > 0 || categoryFilter !== 'all';
  const useComputedKpis = isFiltered || includeMakeItMeal;
  // channelItems/prevChannelItems/prevMEItems arrive from Dashboard.tsx already filtered
  // by the active channel/category/location selections, so deltas stay comparable
  // (filtered-vs-filtered) even while a filter is active.
  const showDelta = prevLabel !== null;
  const [showBottom, setShowBottom] = useState(false);

  // canonical_name|channel → total "make it a meal" modifier-pick qty + the
  // modifier's own real price (fact_modifiers.price) — same source/shape ItemMix uses.
  const makeItMealMap = useMemo(() => {
    const m = new Map<string, { qty: number; price: number }>();
    makeItMealModifiers.forEach(r => {
      const key = `${r.canonical_name}|${r.channel}`;
      const ex  = m.get(key) ?? { qty: 0, price: 0 };
      m.set(key, { qty: ex.qty + r.qty, price: ex.price + r.price });
    });
    return m;
  }, [makeItMealModifiers]);

  // Descriptive fields borrowed by canonical_name — needed for a synthetic row
  // when a Make It a Meal pick has no standalone line of its own in that channel.
  const descriptorByName = useMemo(() => {
    const m = new Map<string, { menu_name: string; menu_group: string; category: string; sub_category: string }>();
    items.forEach(i => {
      if (!m.has(i.canonical_name)) {
        m.set(i.canonical_name, { menu_name: i.menu_name, menu_group: i.menu_group, category: i.category, sub_category: i.sub_category });
      }
    });
    return m;
  }, [items]);

  // canonical_name → is_open_item, used to exclude open items from unique-item counts
  // (ChannelItemRow itself has no is_open_item field, so this comes from `items`).
  const isOpenItemMap = useMemo(() => {
    const m = new Map<string, boolean>();
    items.forEach(i => m.set(i.canonical_name, i.is_open_item));
    return m;
  }, [items]);

  // Weekly trend filtered by selected channels AND/OR locations AND/OR category —
  // previously ignored the category dropdown entirely since weeklyByChannel had no
  // category dimension (owner report 2026-07-14: "all charts should be dynamic wrt
  // to the global dropdowns").
  const effectiveWeekly = useMemo(() => {
    if (selectedChannels.length === 0 && selectedLocations.length === 0 && categoryFilter === 'all') return weekly;
    const map = new Map<string, { revenue: number; qty: number }>();
    weeklyByChannel
      .filter(r =>
        (selectedChannels.length === 0 || selectedChannels.includes(r.channel)) &&
        (selectedLocations.length === 0 || selectedLocations.includes(r.location_code)) &&
        (categoryFilter === 'all' || mapCat(r.category) === categoryFilter))
      .forEach(r => {
        const e = map.get(r.week_start) ?? { revenue: 0, qty: 0 };
        e.revenue += r.revenue;
        e.qty     += r.qty;
        map.set(r.week_start, e);
      });
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([week_start, { revenue, qty }]) => ({ week_start, revenue, qty }));
  }, [weekly, weeklyByChannel, selectedChannels, selectedLocations, categoryFilter]);

  const effectiveDaily = useMemo(() => {
    if (selectedChannels.length === 0 && selectedLocations.length === 0 && categoryFilter === 'all') return daily;
    const map = new Map<string, { revenue: number; qty: number }>();
    dailyByChannel
      .filter(r =>
        (selectedChannels.length === 0 || selectedChannels.includes(r.channel)) &&
        (selectedLocations.length === 0 || selectedLocations.includes(r.location_code)) &&
        (categoryFilter === 'all' || mapCat(r.category) === categoryFilter))
      .forEach(r => {
        const e = map.get(r.date) ?? { revenue: 0, qty: 0 };
        e.revenue += r.revenue;
        e.qty     += r.qty;
        map.set(r.date, e);
      });
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, { revenue, qty }]) => ({ date, revenue, qty }));
  }, [daily, dailyByChannel, selectedChannels, selectedLocations, categoryFilter]);

  // Top-8 items filtered by channel + category
  const baseEffectiveItems = useMemo(() => {
    if (selectedChannels.length === 0) return items;
    const meta = new Map(items.map(i => [i.canonical_name, i]));
    const agg  = new Map<string, { qty: number; revenue: number; refunds: number }>();
    channelItems
      .filter(ci => selectedChannels.includes(ci.channel))
      .forEach(ci => {
        const e = agg.get(ci.canonical_name) ?? { qty: 0, revenue: 0, refunds: 0 };
        e.qty     += ci.qty;
        e.revenue += ci.revenue;
        e.refunds += ci.refunds;
        agg.set(ci.canonical_name, e);
      });
    return [...agg.entries()].map(([name, { qty, revenue, refunds }]) => ({
      ...(meta.get(name) ?? {
        canonical_name: name, menu_name: '', menu_group: '', channel: '',
        is_open_item: false, category: 'Other', sub_category: '',
        avg_price: 0, revenue_pct: 0, qty_pct: 0,
      }),
      qty, revenue, refunds,
      net_after_refunds: Math.round((revenue - refunds) * 100) / 100,
    }));
  }, [selectedChannels, items, channelItems]);

  // Folds the Make It a Meal modifier price into revenue/net_after_refunds for
  // matching (canonical_name, channel) rows, and — same as ItemMix — adds a
  // synthetic row for a modifier-only pick that has no standalone line at all
  // in that channel (e.g. Naan picked as a Catering meal add-on). qty is left
  // untouched, matching ItemMix's convention that this is a $-figures-only toggle.
  const effectiveItems = useMemo(() => {
    const addedRevenue = (name: string, channel: string) =>
      includeMakeItMeal ? (makeItMealMap.get(`${name}|${channel}`)?.price ?? 0) : 0;

    const rows = baseEffectiveItems.map(i => {
      const added = addedRevenue(i.canonical_name, i.channel);
      return added === 0 ? i : {
        ...i,
        revenue: i.revenue + added,
        net_after_refunds: i.net_after_refunds + added,
      };
    });

    if (includeMakeItMeal) {
      const existingKeys = new Set(baseEffectiveItems.map(i => `${i.canonical_name}|${i.channel}`));
      makeItMealMap.forEach((mm, key) => {
        if (existingKeys.has(key)) return;
        const sep    = key.lastIndexOf('|');
        const name   = key.slice(0, sep);
        const channel = key.slice(sep + 1);
        const desc   = descriptorByName.get(name);
        rows.push({
          canonical_name: name,
          menu_name:      desc?.menu_name   ?? '',
          menu_group:     desc?.menu_group  ?? '',
          channel,
          category:       desc?.category     ?? 'Other',
          sub_category:   desc?.sub_category ?? '',
          qty:            0,
          revenue:        mm.price,
          avg_price:      0,
          revenue_pct:    0,
          qty_pct:        0,
          is_open_item:   false,
          refunds:            0,
          net_after_refunds:  mm.price,
        });
      });
    }
    return rows;
  }, [baseEffectiveItems, makeItMealMap, includeMakeItMeal, descriptorByName]);

  const top8 = useMemo(() => {
    const seen = new Map<string, { revenue: number; qty: number; category: string }>();
    for (const i of effectiveItems) {
      const e = seen.get(i.canonical_name);
      if (e) { e.revenue += i.revenue; e.qty += i.qty; }
      else seen.set(i.canonical_name, { revenue: i.revenue, qty: i.qty, category: mapCat(i.category ?? 'Other') });
    }
    let entries = [...seen.entries()];
    if (categoryFilter !== 'all') entries = entries.filter(([, v]) => v.category === categoryFilter);
    // % denominator is all items in the current filter scope (not just the 8 shown),
    // so it reads as "this item's share of everything", matching the chart's title.
    const total = entries.reduce((s, [, v]) => s + v.revenue, 0);
    return entries
      .sort((a, b) => showBottom ? a[1].revenue - b[1].revenue : b[1].revenue - a[1].revenue)
      .slice(0, 8)
      .map(([name, v]) => ({ name: name.slice(0, 24), value: v.revenue, qty: v.qty, pct: total > 0 ? (v.revenue / total) * 100 : 0 }));
  }, [effectiveItems, categoryFilter, showBottom]);

  const catData = useMemo(() => {
    const map: Record<string, { revenue: number; qty: number }> = {};
    effectiveItems.forEach(i => {
      const cat = mapCat(i.category ?? 'Other');
      const e = map[cat] ?? { revenue: 0, qty: 0 };
      e.revenue += i.revenue; e.qty += i.qty;
      map[cat] = e;
    });
    let entries = Object.entries(map).sort((a, b) => b[1].revenue - a[1].revenue);
    if (categoryFilter !== 'all') entries = entries.filter(([cat]) => cat === categoryFilter);
    const total = entries.reduce((s, [, v]) => s + v.revenue, 0);
    return entries.map(([name, v]) => ({ name, value: v.revenue, qty: v.qty, pct: total > 0 ? (v.revenue / total) * 100 : 0 }));
  }, [effectiveItems, categoryFilter]);

  const subCatData = useMemo(() => {
    if (categoryFilter === 'all') return [];
    const map: Record<string, { revenue: number; qty: number }> = {};
    effectiveItems.forEach(i => {
      if (mapCat(i.category ?? 'Other') === categoryFilter) {
        const sub = i.sub_category || categoryFilter;
        const e = map[sub] ?? { revenue: 0, qty: 0 };
        e.revenue += i.revenue; e.qty += i.qty;
        map[sub] = e;
      }
    });
    const entries = Object.entries(map).filter(([, v]) => v.revenue > 0).sort((a, b) => b[1].revenue - a[1].revenue);
    const total = entries.reduce((s, [, v]) => s + v.revenue, 0);
    return entries.map(([name, v]) => ({ name, value: v.revenue, qty: v.qty, pct: total > 0 ? (v.revenue / total) * 100 : 0 }));
  }, [effectiveItems, categoryFilter]);

  // Derived from channelItems (already channel+category+location filtered by
  // Dashboard.tsx) rather than the coarser `channels` field, which has no category
  // dimension at all — that's what made this table ignore the category filter.
  // Also folds in Make It a Meal revenue per channel (channelItems has no
  // canonical_name-level view here, so the add-on is summed straight per channel).
  const effectiveChannels = useMemo(() => {
    const map = new Map<string, { qty: number; revenue: number }>();
    channelItems.forEach(ci => {
      const e = map.get(ci.channel) ?? { qty: 0, revenue: 0 };
      e.qty     += ci.qty;
      e.revenue += ci.revenue;
      map.set(ci.channel, e);
    });
    if (includeMakeItMeal) {
      makeItMealMap.forEach((mm, key) => {
        const channel = key.slice(key.lastIndexOf('|') + 1);
        const e = map.get(channel) ?? { qty: 0, revenue: 0 };
        e.revenue += mm.price;
        e.qty     += mm.qty;
        map.set(channel, e);
      });
    }
    const total = [...map.values()].reduce((s, v) => s + v.revenue, 0);
    return [...map.entries()]
      .map(([channel, { qty, revenue }]) => ({ channel, qty, revenue, pct: total > 0 ? Math.round((revenue / total) * 1000) / 10 : 0 }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [channelItems, makeItMealMap, includeMakeItMeal]);

  // Items after both channel and category filter — basis for all KPI cards
  const kpiItems = useMemo(() => {
    if (categoryFilter === 'all') return effectiveItems;
    return effectiveItems.filter(i => mapCat(i.category ?? 'Other') === categoryFilter);
  }, [effectiveItems, categoryFilter]);

  // Net Revenue — Toast-exact (Gross - Discounts - Refunds). Unfiltered uses
  // summary.net_revenue (computed server-side via analytics.refund_sales);
  // filtered sums kpiItems' own net_after_refunds, since ItemRow now carries
  // exact per-item refunds too — total_revenue is intentionally left alone
  // elsewhere (other tabs still consume the pre-refund figure).
  const kpiRevenue = useMemo(() =>
    useComputedKpis ? kpiItems.reduce((s, i) => s + i.net_after_refunds, 0) : summary.net_revenue,
  [useComputedKpis, kpiItems, summary]);

  const kpiRefunds = useMemo(() =>
    useComputedKpis ? kpiItems.reduce((s, i) => s + i.refunds, 0) : summary.refunds,
  [useComputedKpis, kpiItems, summary]);

  const kpiQty = useMemo(() =>
    useComputedKpis ? kpiItems.reduce((s, i) => s + i.qty, 0) : summary.total_qty,
  [useComputedKpis, kpiItems, summary]);

  // How much of kpiQty is Make It a Meal picks — kpiItems already includes any
  // modifier-only synthetic rows (added in effectiveItems above) so this is a
  // straight per-row lookup, not a separate re-derivation; used only for the
  // "+X from Make It a Meal" note under the Items Sold KPI, kpiQty itself is
  // already the combined total.
  const kpiMakeItMealQty = useMemo(() => {
    if (!includeMakeItMeal) return 0;
    return kpiItems.reduce((s, i) => s + (makeItMealMap.get(`${i.canonical_name}|${i.channel}`)?.qty ?? 0), 0);
  }, [includeMakeItMeal, kpiItems, makeItMealMap]);

  // Deliberately keyed on isFiltered, NOT useComputedKpis: summary.unique_items
  // (server) is COUNT(DISTINCT canonical_name) over everything, open items
  // included, while the computed branch below excludes open items — two
  // different definitions. Checking "Include Make It a Meal" alone has
  // nothing to do with open items and shouldn't flip which one is shown
  // (that previously only happened when a channel/category filter was also
  // active, which is real, existing behavior — not what's being fixed here).
  const kpiUnique = useMemo(() =>
    isFiltered
      ? new Set(kpiItems.filter(i => !i.is_open_item).map(i => i.canonical_name)).size
      : summary.unique_items,
  [isFiltered, kpiItems, summary]);

  // Margin isn't adjusted for Make It a Meal — it comes from data.meItems (a
  // separate cost-modeling pipeline keyed off Pink Sheet/r365 costs, not raw
  // ItemRow revenue), which has no visibility into a modifier's own price. Only
  // isFiltered (not includeMakeItMeal) switches this off the blended default.
  const kpiAvgMargin = useMemo(() => {
    if (!isFiltered) return avgMargin;
    const totalSales = data.meItems.reduce((s, i) => s + i.net_sales, 0);
    const totalCost  = data.meItems.reduce((s, i) => s + i.total_cost, 0);
    return totalSales > 0 ? (totalSales - totalCost) / totalSales : avgMargin;
  }, [isFiltered, data.meItems, avgMargin]);

  const kpiTopItem = useMemo(() => {
    if (!useComputedKpis) return { name: summary.top_item, revenue: summary.top_item_revenue, mix: summary.top_item_mix };
    const byRev = new Map<string, number>();
    kpiItems.forEach(i => byRev.set(i.canonical_name, (byRev.get(i.canonical_name) ?? 0) + i.revenue));
    const totalRev = kpiItems.reduce((s, i) => s + i.revenue, 0);
    let topName = '', topRev = 0;
    byRev.forEach((rev, name) => { if (rev > topRev) { topRev = rev; topName = name; } });
    return { name: topName || summary.top_item, revenue: topRev, mix: totalRev > 0 ? (topRev / totalRev) * 100 : 0 };
  }, [useComputedKpis, kpiItems, summary]);

  // Prev-period equivalents of the KPI cards above, from prevChannelItems/prevMEItems
  // (already channel+category+location filtered by Dashboard.tsx) — the same shape as
  // kpiRevenue/kpiQty/kpiUnique/kpiAvgMargin/kpiTopItem, so deltas compare filtered vs
  // filtered rather than filtered vs an unfiltered prev-period total.
  const prevKpi = useMemo(() => {
    if (!showDelta) return null;
    // prevMEItems already reflects the category filter (or is the full blended set
    // when unfiltered), so margin is computed the same way in both cases.
    const totalSales = prevMEItems.reduce((s, i) => s + i.net_sales, 0);
    const totalCost  = prevMEItems.reduce((s, i) => s + i.total_cost, 0);
    const avgMargin  = totalSales > 0 ? (totalSales - totalCost) / totalSales : null;

    if (!isFiltered) {
      return {
        revenue: prevSummary!.net_revenue,
        refunds: prevSummary!.refunds,
        qty:     prevSummary!.total_qty,
        unique:  prevSummary!.unique_items,
        topName: prevSummary!.top_item,
        avgMargin,
      };
    }
    const revenue = prevChannelItems.reduce((s, i) => s + i.net_after_refunds, 0);
    const refunds = prevChannelItems.reduce((s, i) => s + i.refunds, 0);
    const qty     = prevChannelItems.reduce((s, i) => s + i.qty, 0);
    const unique  = new Set(
      prevChannelItems.filter(i => !isOpenItemMap.get(i.canonical_name)).map(i => i.canonical_name)
    ).size;
    const byRev = new Map<string, number>();
    prevChannelItems.forEach(i => byRev.set(i.canonical_name, (byRev.get(i.canonical_name) ?? 0) + i.revenue));
    let topName = '', topRev = 0;
    byRev.forEach((rev, name) => { if (rev > topRev) { topRev = rev; topName = name; } });
    return { revenue, refunds, qty, unique, topName: topName || prevSummary!.top_item, avgMargin };
  }, [showDelta, isFiltered, prevSummary, prevChannelItems, prevMEItems, isOpenItemMap]);

  const rightChartData  = categoryFilter === 'all' ? catData : subCatData;
  const rightChartTitle = categoryFilter === 'all'
    ? 'Revenue by category' : `${categoryFilter} · sub-category`;

  // Filtered % for channel table (relative to filtered total, not grand total)
  const filteredTotal = effectiveChannels.reduce((s, c) => s + c.revenue, 0);

  return (
    <div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, cursor: 'pointer', marginBottom: 8 }}>
        <input type="checkbox" checked={includeMakeItMeal} onChange={e => setIncludeMakeItMeal(e.target.checked)} />
        Include &quot;Make It a Meal&quot; picks in Revenue / Refunds (adds the modifier&apos;s own real price from fact_modifiers)
      </label>

      {/* KPI row */}
      <div className="krow" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
        <div className="kc a">
          <div className="kl">Items Sold</div>
          <div className="kv">{Number(kpiQty + kpiMakeItMealQty).toLocaleString()}</div>
          {showDelta
            ? <DeltaBadge curr={kpiQty} prev={prevKpi!.qty} vsLabel={prevLabel} />
            : useComputedKpis && <div className="ks">filtered</div>}
          {includeMakeItMeal && kpiMakeItMealQty > 0 && (
            <div className="ks">+{kpiMakeItMealQty.toLocaleString()} from Make It a Meal</div>
          )}
        </div>
        <div className="kc g">
          <div className="kl">Net Revenue</div>
          <div className="kv">{fmt$(kpiRevenue)}</div>
          {showDelta
            ? <DeltaBadge curr={kpiRevenue} prev={prevKpi!.revenue} vsLabel={prevLabel} />
            : useComputedKpis && <div className="ks">filtered</div>}
        </div>
        <div className="kc r">
          <div className="kl">Refunds</div>
          <div className="kv">{fmt$(kpiRefunds)}</div>
          {showDelta
            ? <DeltaBadge curr={kpiRefunds} prev={prevKpi!.refunds} positiveGood={false} vsLabel={prevLabel} />
            : useComputedKpis && <div className="ks">filtered</div>}
        </div>
        <div className="kc b">
          <div className="kl">Avg Margin</div>
          <div className="kv">{(kpiAvgMargin * 100).toFixed(1)}%</div>
          {showDelta && prevKpi!.avgMargin !== null
            ? <DeltaBadge curr={kpiAvgMargin} prev={prevKpi!.avgMargin} vsLabel={prevLabel} />
            : <div className="ks">{isFiltered ? 'filtered' : 'blended · all items'}</div>}
        </div>
        <div className="kc p">
          <div className="kl">Unique Items</div>
          <div className="kv">{kpiUnique}</div>
          {showDelta
            ? <DeltaBadge curr={kpiUnique} prev={prevKpi!.unique} neutral showCount vsLabel={prevLabel} />
            : isFiltered ? <div className="ks">filtered</div> : <div className="ks">real menu items</div>}
        </div>
        <div className="kc pk">
          <div className="kl">Top Item</div>
          <div className="kv-sm">{kpiTopItem.name}</div>
          <div className="ks">
            {kpiTopItem.mix.toFixed(1)}% mix · {fmt$(kpiTopItem.revenue)}
            {showDelta && prevKpi!.topName !== kpiTopItem.name && (
              <span style={{ marginLeft: 4, color: 'var(--muted)', fontStyle: 'italic' }}>
                (was {prevKpi!.topName})
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Trend chart — full width */}
      <div className="cc" style={{ marginBottom: 10 }}>
        <h3>Sales trend</h3>
        <WeeklyChart weekly={effectiveWeekly} daily={effectiveDaily} periods={periods} />
      </div>

      {/* Charts row 1 — two pie charts */}
      <div className="gr22">
        <div className="cc">
          <h3>Revenue by channel</h3>
          <div style={{ position: 'relative', height: 200 }}>
            <ChannelDonut data={effectiveChannels} />
          </div>
        </div>
        <div className="cc">
          <h3>Revenue by category</h3>
          <div style={{ position: 'relative', height: 200 }}>
            <CategoryDonut data={catData} />
          </div>
        </div>
      </div>

      {/* Charts row 2 */}
      <div className="gr22">
        <div className="cc">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <h3 style={{ margin: 0 }}>{showBottom ? 'Bottom' : 'Top'} 8 items by revenue{categoryFilter !== 'all' && ` · ${categoryFilter}`}</h3>
            <button className="drb" onClick={() => setShowBottom(b => !b)} style={{ minWidth: 0, padding: '3px 10px', fontSize: 11 }}>
              {showBottom ? 'Top' : 'Bottom'}
            </button>
          </div>
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
        <div className="tscroll">
          <table>
            <thead>
              <tr>
                <th>Channel</th>
                <th>Revenue</th>
                <th>Revenue Mix (%)</th>
                <th>Items Sold</th>
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
