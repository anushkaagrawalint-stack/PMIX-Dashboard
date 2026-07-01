'use client';
import { useState, useMemo } from 'react';
import type { DashboardData, ItemRow, MERow, ChannelRow, ChannelItemRow, ChannelCategoryRow } from '@/lib/types';
import { CHANNELS, CHANNEL_LABEL } from '@/lib/constants';
import DatePicker from './DatePicker';
import Overview from './tabs/Overview';
import ItemMix from './tabs/ItemMix';
import LocationCompare from './tabs/LocationCompare';
import ChannelMenu from './tabs/ChannelMenu';
import BYOBreakdown from './tabs/BYOBreakdown';
import PaymentSource from './tabs/PaymentSource';
import CustomerRetention from './tabs/CustomerRetention';
import RenamesAudit from './tabs/RenamesAudit';
import NeedsReview from './tabs/NeedsReview';
import OpenItems from './tabs/OpenItems';
import MEOverall from './tabs/MEOverall';
import PinkSheets from './tabs/PinkSheets';

const TABS = [
  { id: 'overview',   label: 'Overview',           icon: 'ti-layout-dashboard' },
  { id: 'itemmix',    label: 'Item Mix',            icon: 'ti-list' },
  { id: 'loccompare', label: 'Location Compare',    icon: 'ti-map-pin' },
  { id: 'chanmenu',   label: 'Channels',             icon: 'ti-chart-pie' },
  { id: 'byo',        label: 'BYO Breakdown',       icon: 'ti-salad' },
  { id: 'payment',    label: 'Payment Source',      icon: 'ti-credit-card' },
  { id: 'meoverall',  label: 'Menu Engineering',    icon: 'ti-layout-grid' },
  { id: 'pinksheets', label: 'Pink Sheets',         icon: 'ti-file-spreadsheet' },
  { id: 'bikky',      label: 'Customer Retention',  icon: 'ti-users' },
  { id: 'renames',    label: 'Renames Audit',       icon: 'ti-refresh' },
  { id: 'needs',      label: 'Needs Review',        icon: 'ti-alert-triangle' },
  { id: 'openitems',  label: 'Open Items',          icon: 'ti-package' },
] as const;

type TabId = typeof TABS[number]['id'];

// Which universal filter controls are meaningful for each tab.
// Hidden when not applicable so the bar stays uncluttered.
const TAB_FILTERS: Record<TabId, { channel: boolean; category: boolean; location: boolean }> = {
  overview:   { channel: true,  category: true,  location: true  },
  itemmix:    { channel: true,  category: true,  location: true  },
  loccompare: { channel: true,  category: true,  location: false },
  chanmenu:   { channel: true,  category: true,  location: true  },
  byo:        { channel: false, category: false, location: true  },
  payment:    { channel: false, category: false, location: true  },
  meoverall:  { channel: true,  category: true,  location: true  },
  pinksheets: { channel: false, category: false, location: false },
  bikky:      { channel: false, category: false, location: false },
  renames:    { channel: false, category: false, location: false },
  needs:      { channel: false, category: false, location: false },
  openitems:  { channel: false, category: false, location: false },
};

const fmt$ = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;

export default function Dashboard({ data }: { data: DashboardData }) {
  const [tab, setTab]                       = useState<TabId>('overview');
  const [selectedChannels, setChannels]     = useState<string[]>([]);
  const [chOpen, setChOpen]                 = useState(false);
  const [categoryFilter, setCategory]       = useState('all');
  const [selectedLocations, setLocations]   = useState<string[]>([]);
  const [locOpen, setLocOpen]               = useState(false);

  const { dateRange: dr, summary } = data;

  const showCh  = TAB_FILTERS[tab].channel;
  const showCat = TAB_FILTERS[tab].category;
  const showLoc = TAB_FILTERS[tab].location;

  const currentPeriod = data.periods.find(
    p => dr.start >= p.start_date && dr.end <= p.end_date,
  );

  function toggleChannel(code: string) {
    setChannels(prev =>
      prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code],
    );
  }

  function toggleLocation(code: string) {
    setLocations(prev =>
      prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code],
    );
  }

  const chLabel = selectedChannels.length === 0
    ? 'All Channels'
    : selectedChannels.length === 1
      ? CHANNEL_LABEL[selectedChannels[0]] ?? selectedChannels[0]
      : `${selectedChannels.length} Channels`;

  const locLabel = selectedLocations.length === 0
    ? 'All Locations'
    : selectedLocations.length === 1
      ? (data.locations.find(l => l.location_code === selectedLocations[0])?.display_name ?? selectedLocations[0])
      : `${selectedLocations.length} Locations`;

  // Kids Meal is treated as Entrees everywhere in the UI
  const normCat = (c: string | null | undefined) => (c === 'Kids Meal' ? 'Entrees' : c || 'Other');

  // Category options: vendor channels (catering/offsite/markup) collapse to 'Other'
  // to keep the dropdown short. Only IH/Loyalty/3PD show real categories.
  const VENDOR_CHANNELS = new Set(['CATERING', 'CATERING_3PD', 'OFFSITE', 'TPD_MARKUP']);
  const categoryOptions = useMemo(() => {
    const cats = new Set<string>();
    const chFilter = new Set(selectedChannels);
    data.items.forEach(i => {
      if (chFilter.size > 0 && !chFilter.has(i.channel)) return;
      const cat = VENDOR_CHANNELS.has(i.channel)
        ? 'Other'
        : normCat(i.category);
      cats.add(cat);
    });
    return [...cats].sort();
  }, [data.items, selectedChannels]);

  // Item meta map (canonical_name → item metadata)
  const itemMetaMap = useMemo(() => {
    const m = new Map<string, ItemRow>();
    data.items.forEach(i => { if (!m.has(i.canonical_name)) m.set(i.canonical_name, i); });
    return m;
  }, [data.items]);

  // Location base items: per-channel rows from data.items, scaled to selected location(s).
  // Uses exact (canonical_name, channel) location totals from locationItems.
  // Proportional split is only needed within same (canonical_name, channel) across different
  // menu_groups — which is uncommon and much more accurate than channel-level approximation.
  const locationBaseItems = useMemo((): ItemRow[] => {
    if (selectedLocations.length === 0) return data.items;

    // Exact location totals per (canonical_name, channel) — denominator for scaling
    const locChannelAgg = new Map<string, { qty: number; revenue: number }>();
    data.locationItems
      .filter(li => selectedLocations.includes(li.location_code))
      .forEach(li => {
        const key = `${li.canonical_name}||${li.channel}`;
        const e = locChannelAgg.get(key) ?? { qty: 0, revenue: 0 };
        e.qty     += li.qty;
        e.revenue += li.revenue;
        locChannelAgg.set(key, e);
      });

    // Global totals per (canonical_name, channel) from channelItems (already aggregated by channel)
    const totChannelAgg = new Map<string, { qty: number; revenue: number }>();
    data.channelItems.forEach(ci => {
      const key = `${ci.canonical_name}||${ci.channel}`;
      totChannelAgg.set(key, { qty: ci.qty, revenue: ci.revenue });
    });

    const totalLocRev = [...locChannelAgg.values()].reduce((s, v) => s + v.revenue, 0);
    const totalLocQty = [...locChannelAgg.values()].reduce((s, v) => s + v.qty,     0);

    return data.items.flatMap(i => {
      const key = `${i.canonical_name}||${i.channel}`;
      const loc = locChannelAgg.get(key);
      if (!loc) return [];
      const tot      = totChannelAgg.get(key);
      const revScale = tot && tot.revenue > 0 ? loc.revenue / tot.revenue : 0;
      const qtyScale = tot && tot.qty     > 0 ? loc.qty     / tot.qty     : 0;
      const qty      = Math.round(i.qty * qtyScale);
      const revenue  = Math.round(i.revenue * revScale * 100) / 100;
      if (qty === 0 && revenue === 0) return [];
      return [{
        ...i, qty, revenue,
        avg_price:   qty > 0 ? revenue / qty : i.avg_price,
        revenue_pct: totalLocRev > 0 ? (revenue / totalLocRev) * 100 : 0,
        qty_pct:     totalLocQty > 0 ? (qty     / totalLocQty) * 100 : 0,
      }];
    }).sort((a, b) => b.revenue - a.revenue);
  }, [selectedLocations, data.locationItems, data.channelItems, data.items]);

  // Summary KPIs adjusted for selected location(s)
  const locationAdjustedSummary = useMemo(() => {
    if (selectedLocations.length === 0) return data.summary;
    const locItems = data.locationItems.filter(li => selectedLocations.includes(li.location_code));
    const totalRev = locItems.reduce((s, li) => s + li.revenue, 0);
    const totalQty = locItems.reduce((s, li) => s + li.qty,     0);
    const uniqueItems = new Set(locItems.map(li => li.canonical_name)).size;
    // Aggregate by canonical_name to get true per-item totals (locItems now has one row per item×channel)
    const itemAgg = new Map<string, { qty: number; revenue: number }>();
    locItems.forEach(li => {
      const e = itemAgg.get(li.canonical_name) ?? { qty: 0, revenue: 0 };
      e.qty     += li.qty;
      e.revenue += li.revenue;
      itemAgg.set(li.canonical_name, e);
    });
    const topEntry = [...itemAgg.entries()].sort((a, b) => b[1].revenue - a[1].revenue)[0];
    return {
      ...data.summary,
      total_revenue:    totalRev,
      total_qty:        totalQty,
      unique_items:     uniqueItems,
      top_item:         topEntry?.[0]           ?? data.summary.top_item,
      top_item_revenue: topEntry?.[1].revenue   ?? data.summary.top_item_revenue,
      top_item_mix:     totalQty > 0 ? ((topEntry?.[1].qty ?? 0) / totalQty) * 100 : data.summary.top_item_mix,
    };
  }, [selectedLocations, data.locationItems, data.summary]);

  // Location-adjusted channel revenue — computed directly from locationItems (which now has channel),
  // giving exact per-channel totals for the selected location instead of proportional approximation.
  const locationAdjustedChannels = useMemo((): ChannelRow[] => {
    if (selectedLocations.length === 0) return data.channels;
    const agg = new Map<string, { qty: number; revenue: number }>();
    data.locationItems
      .filter(li => selectedLocations.includes(li.location_code))
      .forEach(li => {
        const e = agg.get(li.channel) ?? { qty: 0, revenue: 0 };
        e.qty     += li.qty;
        e.revenue += li.revenue;
        agg.set(li.channel, e);
      });
    const totalRev = [...agg.values()].reduce((s, v) => s + v.revenue, 0);
    return [...agg.entries()].map(([channel, { qty, revenue }]) => ({
      channel, qty, revenue,
      pct: totalRev > 0 ? Math.round(revenue / totalRev * 1000) / 10 : 0,
    })).sort((a, b) => b.revenue - a.revenue);
  }, [selectedLocations, data.locationItems, data.channels]);

  // Location-adjusted per-channel item rows (locationBaseItems already has location-scaled per-channel revenue)
  const locationAdjustedChannelItems = useMemo((): ChannelItemRow[] => {
    if (selectedLocations.length === 0) return data.channelItems;
    return locationBaseItems.map(i => ({
      canonical_name: i.canonical_name,
      channel:        i.channel,
      qty:            i.qty,
      revenue:        i.revenue,
    }));
  }, [selectedLocations, locationBaseItems, data.channelItems]);

  // Location-adjusted channel × category revenue (aggregated from locationBaseItems)
  const locationAdjustedChannelCategories = useMemo((): ChannelCategoryRow[] => {
    if (selectedLocations.length === 0) return data.channelCategories;
    const agg = new Map<string, number>();
    locationBaseItems.forEach(i => {
      const key = `${i.channel}||${i.category || 'Other'}`;
      agg.set(key, (agg.get(key) ?? 0) + i.revenue);
    });
    return [...agg.entries()].map(([key, revenue]) => {
      const idx = key.indexOf('||');
      return { channel: key.slice(0, idx), category: key.slice(idx + 2), revenue };
    });
  }, [selectedLocations, locationBaseItems, data.channelCategories]);

  // Channel-filtered items — location already baked into locationAdjustedChannelItems
  const channelFilteredItems = useMemo((): ItemRow[] => {
    if (selectedChannels.length === 0) return locationBaseItems;

    const agg = new Map<string, { qty: number; revenue: number }>();
    locationAdjustedChannelItems
      .filter(ci => selectedChannels.includes(ci.channel))
      .forEach(ci => {
        const e = agg.get(ci.canonical_name) ?? { qty: 0, revenue: 0 };
        e.qty     += ci.qty;
        e.revenue += ci.revenue;
        agg.set(ci.canonical_name, e);
      });

    const totalRev = [...agg.values()].reduce((s, v) => s + v.revenue, 0);
    const totalQty = [...agg.values()].reduce((s, v) => s + v.qty,     0);

    return [...agg.entries()].map(([name, { qty, revenue }]) => {
      const meta = itemMetaMap.get(name);
      return {
        canonical_name: name,
        menu_name:    meta?.menu_name    ?? '',
        menu_group:   meta?.menu_group   ?? '',
        channel:      meta?.channel      ?? '',
        is_open_item: meta?.is_open_item ?? false,
        category:     meta?.category     ?? 'Other',
        sub_category: meta?.sub_category ?? '',
        qty,
        revenue,
        avg_price:   qty > 0 ? revenue / qty : 0,
        revenue_pct: totalRev > 0 ? (revenue / totalRev) * 100 : 0,
        qty_pct:     totalQty > 0 ? (qty / totalQty) * 100 : 0,
      };
    }).sort((a, b) => b.revenue - a.revenue);
  }, [selectedChannels, locationBaseItems, locationAdjustedChannelItems, itemMetaMap]);

  // Apply category filter on top of channel-filtered (location already baked in)
  const filteredItems = useMemo(() =>
    categoryFilter === 'all'
      ? channelFilteredItems
      : channelFilteredItems.filter(i => normCat(i.category) === categoryFilter),
  [channelFilteredItems, categoryFilter]);

  // Channel-filtered channelItems — location already baked into locationAdjustedChannelItems
  const filteredChannelItems = useMemo(() => {
    let r = locationAdjustedChannelItems;
    if (selectedChannels.length > 0) r = r.filter(ci => selectedChannels.includes(ci.channel));
    if (categoryFilter !== 'all')    r = r.filter(ci => normCat(itemMetaMap.get(ci.canonical_name)?.category) === categoryFilter);
    return r;
  }, [selectedChannels, categoryFilter, locationAdjustedChannelItems, itemMetaMap]);

  // Channel-filtered channels list — location already baked into locationAdjustedChannels
  const filteredChannels = useMemo(() =>
    selectedChannels.length === 0
      ? locationAdjustedChannels
      : locationAdjustedChannels.filter(c => selectedChannels.includes(c.channel)),
  [selectedChannels, locationAdjustedChannels]);

  // Channel-filtered channelCategories — location already baked into locationAdjustedChannelCategories
  const filteredChannelCategories = useMemo(() =>
    selectedChannels.length === 0
      ? locationAdjustedChannelCategories
      : locationAdjustedChannelCategories.filter(cc => selectedChannels.includes(cc.channel)),
  [selectedChannels, locationAdjustedChannelCategories]);

  // Channel-filtered location items
  const filteredLocationItems = useMemo(() => {
    if (selectedChannels.length === 0 && categoryFilter === 'all') return data.locationItems;
    const allowedNames = new Set(channelFilteredItems.map(i => i.canonical_name));
    return data.locationItems.filter(li => {
      if (!allowedNames.has(li.canonical_name)) return false;
      if (categoryFilter !== 'all') {
        return normCat(itemMetaMap.get(li.canonical_name)?.category) === categoryFilter;
      }
      return true;
    });
  }, [selectedChannels, categoryFilter, data.locationItems, channelFilteredItems, itemMetaMap]);

  // ME items — channel-specific recompute following SOP formula chain
  const filteredMEItems = useMemo((): MERow[] => {
    // Blended: server values are already correct
    if (selectedChannels.length === 0) {
      return categoryFilter === 'all'
        ? data.meItems
        : data.meItems.filter(i => normCat(i.category) === categoryFilter);
    }

    // Per-channel recompute
    const costMeta = new Map(data.meItems.map(i => [i.canonical_name, i]));

    const acc = new Map<string, { qty: number; net_sales: number; total_cost: number }>();
    for (const ci of data.channelItems) {
      if (!selectedChannels.includes(ci.channel)) continue;
      const meta = costMeta.get(ci.canonical_name);
      if (!meta) continue;
      // TPD: apply 1.18× cost uplift per SOP
      const costMult = ci.channel === 'TPD' ? 1.18 : 1.0;
      const e = acc.get(ci.canonical_name) ?? { qty: 0, net_sales: 0, total_cost: 0 };
      e.qty        += ci.qty;
      e.net_sales  += ci.revenue;
      e.total_cost += ci.qty * meta.avg_cost * costMult;
      acc.set(ci.canonical_name, e);
    }

    const allItems = [...acc.entries()].flatMap(([name, v]) => {
      const meta = costMeta.get(name);
      if (!meta || v.qty === 0) return [];
      const avg_price    = v.net_sales / v.qty;
      const avg_cost     = v.total_cost / v.qty;
      const total_margin = v.net_sales - v.total_cost;
      const cogs_pct     = v.net_sales > 0 ? v.total_cost / v.net_sales : 0;
      const margin_pct   = avg_price   > 0 ? (avg_price - avg_cost) / avg_price : 0;
      return [{ ...meta, qty: v.qty, net_sales: v.net_sales, avg_price, avg_cost,
                total_cost: v.total_cost, total_margin, cogs_pct, margin_pct }];
    });

    // Only non-open items count toward thresholds
    const meOnly = allItems.filter(i => !i.is_open_item);
    const grand_qty        = meOnly.reduce((s, i) => s + i.qty, 0);
    const n                = meOnly.length;
    const mix_threshold    = n > 0 ? (1 / n) * 0.7 : 0;
    const totalMarginAll   = meOnly.reduce((s, i) => s + i.total_margin, 0);
    const totalSalesAll    = meOnly.reduce((s, i) => s + i.net_sales, 0);
    const margin_threshold = totalSalesAll > 0 ? totalMarginAll / totalSalesAll : 0;

    const catRev = new Map<string, number>();
    allItems.forEach(i => catRev.set(i.category, (catRev.get(i.category) ?? 0) + i.net_sales));

    const display = categoryFilter === 'all'
      ? allItems : allItems.filter(i => normCat(i.category) === categoryFilter);

    return display.map(i => {
      const mix_pct     = grand_qty > 0 ? i.qty / grand_qty : 0;
      const margin_flag = (i.margin_pct >= margin_threshold ? 'High' : 'Low') as 'High' | 'Low';
      const mix_flag    = (mix_pct      >= mix_threshold    ? 'High' : 'Low') as 'High' | 'Low';
      const quadrant    = i.is_open_item ? 'Dog' : (
        margin_flag === 'High' && mix_flag === 'High' ? 'Star'       :
        margin_flag === 'High' && mix_flag === 'Low'  ? 'Puzzle'     :
        margin_flag === 'Low'  && mix_flag === 'High' ? 'Plow Horse' : 'Dog'
      ) as MERow['quadrant'];
      return {
        ...i, mix_pct,
        sls_pct_category: (catRev.get(i.category) ?? 0) > 0
          ? i.net_sales / catRev.get(i.category)! : 0,
        quadrant, margin_flag, mix_flag, margin_threshold, mix_threshold,
      };
    });
  }, [selectedChannels, categoryFilter, data.meItems, data.channelItems]);

  // Apply location filter on top of channel+category ME filter
  const finalMEItems = useMemo(() => {
    if (selectedLocations.length === 0) return filteredMEItems;
    const locNames = new Set(locationBaseItems.map(i => i.canonical_name));
    return filteredMEItems.filter(i => locNames.has(i.canonical_name));
  }, [filteredMEItems, selectedLocations, locationBaseItems]);

  // Find the most recent fiscal period that overlaps the selected date range
  const activeBikkyPeriod = useMemo(() => {
    const overlapping = data.periods.filter(
      p => dr.start <= p.end_date && dr.end >= p.start_date,
    );
    return overlapping.length > 0 ? overlapping[overlapping.length - 1].label : null;
  }, [data.periods, dr]);

  const filteredBikky = useMemo(() => {
    let rows = data.bikky;
    if (activeBikkyPeriod) rows = rows.filter(b => b.period === activeBikkyPeriod);
    if (categoryFilter !== 'all') rows = rows.filter(b => normCat(b.category) === categoryFilter);
    return rows;
  }, [data.bikky, activeBikkyPeriod, categoryFilter]);

  const filteredData = useMemo(() => ({
    ...data,
    summary:           locationAdjustedSummary,
    items:             locationBaseItems,
    channels:          filteredChannels,
    channelItems:      filteredChannelItems,
    channelCategories: filteredChannelCategories,
    locationItems:     filteredLocationItems,
    meItems:           finalMEItems,
  }), [data, locationAdjustedSummary, locationBaseItems, filteredChannels, filteredChannelItems, filteredChannelCategories, filteredLocationItems, finalMEItems]);

  return (
    <div className="container">

      {/* ── STICKY HEADER + FILTER BAR ── */}
      <div className="sticky-bar">

      {/* ── HEADER ── */}
      <div className="hdr">
        <div className="hdr-l">
          <div className="rasa-box">RASA</div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="hdr-title">Product Mix Dashboard</span>
              <span className="pbadge">{currentPeriod?.label ?? 'LIVE'}</span>
            </div>
            <div className="hdr-sub">{summary.unique_items} menu items · {dr.label}</div>
          </div>
        </div>
        <div className="hdr-r">
          <div className="hdr-status">
            <span className="status-dot" />
            Last data: {summary.last_date}
          </div>
          <button className="rbtn" onClick={() => window.location.reload()}>
            <i className="ti ti-refresh" aria-hidden="true" /> Refresh
          </button>
          <span className="klogo">Kutlerri</span>
          <button
            className="logout-btn"
            onClick={async () => {
              await fetch('/api/auth/logout', { method: 'POST' });
              window.location.href = '/login';
            }}
          >
            Sign out
          </button>
        </div>
      </div>

      {/* ── FILTER BAR ── */}
      <div className="fb">
        <div className="fb-r">
          <span className="fb-lbl">Date range</span>
          <DatePicker dr={dr} periods={data.periods} />
          {showCh && (
            <>
              <div className="fb-sep" />
              <span className="fb-lbl">Channel</span>
              <div className="drw" style={{ position: 'relative' }}>
                <button className="drb" onClick={() => setChOpen(o => !o)} style={{ minWidth: 130 }}>
                  {chLabel}
                  <i className="ti ti-chevron-down" style={{ fontSize: 11 }} />
                </button>
                {chOpen && (
                  <>
                    <div style={{ position: 'fixed', inset: 0, zIndex: 199 }} onClick={() => setChOpen(false)} />
                    <div className="drm open" style={{ minWidth: 170, zIndex: 200 }}>
                      <label className="dr-it" style={{ gap: 8, userSelect: 'none' }}>
                        <input type="checkbox" checked={selectedChannels.length === 0}
                          onChange={() => setChannels([])} style={{ accentColor: 'var(--accent)' }} />
                        All Channels
                      </label>
                      <div className="dr-div" />
                      {CHANNELS.map(({ code, label, color }) => (
                        <label key={code} className="dr-it" style={{ gap: 8, userSelect: 'none' }}>
                          <input type="checkbox" checked={selectedChannels.includes(code)}
                            onChange={() => toggleChannel(code)} style={{ accentColor: color }} />
                          <span style={{ width: 8, height: 8, borderRadius: 2, background: color, display: 'inline-block', flexShrink: 0 }} />
                          {label}
                        </label>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </>
          )}

          {showCat && (
            <>
              <div className="fb-sep" />
              <span className="fb-lbl">Category</span>
              <select className="fb-sel" value={categoryFilter} onChange={e => setCategory(e.target.value)}>
                <option value="all">All Categories</option>
                {categoryOptions.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </>
          )}

          {showLoc && data.locations.length > 1 && (
            <>
              <div className="fb-sep" />
              <span className="fb-lbl">Location</span>
              <div className="drw" style={{ position: 'relative' }}>
                <button className="drb" onClick={() => setLocOpen(o => !o)} style={{ minWidth: 120 }}>
                  {locLabel}
                  <i className="ti ti-chevron-down" style={{ fontSize: 11 }} />
                </button>
                {locOpen && (
                  <>
                    <div style={{ position: 'fixed', inset: 0, zIndex: 199 }} onClick={() => setLocOpen(false)} />
                    <div className="drm open" style={{ minWidth: 170, zIndex: 200 }}>
                      <label className="dr-it" style={{ gap: 8, userSelect: 'none' }}>
                        <input type="checkbox" checked={selectedLocations.length === 0}
                          onChange={() => setLocations([])} style={{ accentColor: 'var(--accent)' }} />
                        All Locations
                      </label>
                      <div className="dr-div" />
                      {data.locations.map(loc => (
                        <label key={loc.location_code} className="dr-it" style={{ gap: 8, userSelect: 'none' }}>
                          <input type="checkbox" checked={selectedLocations.includes(loc.location_code)}
                            onChange={() => toggleLocation(loc.location_code)}
                            style={{ accentColor: 'var(--accent)' }} />
                          {loc.display_name}
                        </label>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </>
          )}

          <div className="fb-sep" />
          <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 'auto' }}>
            Total revenue: <strong style={{ color: 'var(--text)' }}>{fmt$(summary.total_revenue)}</strong>
          </span>
        </div>
      </div>

      {/* ── TABS ── */}
      <div className="tabs-o">
        <div className="tabs-i">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} className={`tb${tab === t.id ? ' on' : ''}`}>
              <i className={`ti ${t.icon}`} aria-hidden="true" />
              {t.label}
              {t.id === 'openitems' && data.openItemsSummary.total > 0 && (
                <span style={{
                  background: '#f59e0b', color: '#fff',
                  fontSize: 9, fontWeight: 700,
                  padding: '1px 5px', borderRadius: 10, marginLeft: 3,
                }}>
                  {data.openItemsSummary.total}
                </span>
              )}
              {t.id === 'needs' && (data.needsReview.length + data.uncategorizedItems.length) > 0 && (
                <span style={{
                  background: '#ef4444', color: '#fff',
                  fontSize: 9, fontWeight: 700,
                  padding: '1px 5px', borderRadius: 10, marginLeft: 3,
                }}>
                  {data.needsReview.length + data.uncategorizedItems.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      </div>{/* end sticky-bar */}

      {/* ── TAB CONTENT ── */}
      {tab === 'overview'   && <Overview         data={filteredData} selectedChannels={selectedChannels} categoryFilter={categoryFilter} />}
      {tab === 'itemmix'    && <ItemMix          items={locationBaseItems} meItems={finalMEItems} selectedChannels={selectedChannels} categoryFilter={categoryFilter} />}
      {tab === 'loccompare' && <LocationCompare  data={filteredData} />}
      {tab === 'chanmenu'   && <ChannelMenu      data={filteredData} />}
      {tab === 'byo'        && <BYOBreakdown     modifiers={data.modifiers} items={locationBaseItems} pinkSheets={data.pinkSheets} meItems={finalMEItems} />}
      {tab === 'payment'    && <PaymentSource    payments={data.payments} paymentsByLocation={data.paymentsByLocation} paymentSourcesByLocation={data.paymentSourcesByLocation} selectedLocations={selectedLocations} />}
      {tab === 'meoverall'  && <MEOverall meItems={finalMEItems} pinkSheets={data.pinkSheets} />}
      {tab === 'pinksheets' && <PinkSheets pinkSheets={data.pinkSheets} details={data.pinkSheetDetails} />}
      {tab === 'bikky'      && <CustomerRetention bikky={filteredBikky} meItems={finalMEItems} items={locationBaseItems} period={activeBikkyPeriod} />}
      {tab === 'renames'    && <RenamesAudit     renames={data.renames} />}
      {tab === 'needs'      && <NeedsReview      needsReview={data.needsReview} uncategorizedItems={data.uncategorizedItems} />}
      {tab === 'openitems'  && <OpenItems        openItemsSummary={data.openItemsSummary} openItems={data.openItems} />}
    </div>
  );
}
