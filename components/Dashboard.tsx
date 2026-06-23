'use client';
import { useState, useMemo } from 'react';
import type { DashboardData, ItemRow, MERow } from '@/lib/types';
import { CHANNELS, CHANNEL_LABEL } from '@/lib/constants';
import DatePicker from './DatePicker';
import Overview from './tabs/Overview';
import ItemMix from './tabs/ItemMix';
import LocationCompare from './tabs/LocationCompare';
import ChannelMenu from './tabs/ChannelMenu';
import BYOBreakdown from './tabs/BYOBreakdown';
import PaymentSource from './tabs/PaymentSource';
import MenuEngineering from './tabs/MenuEngineering';
import CustomerRetention from './tabs/CustomerRetention';
import AllItems from './tabs/AllItems';
import RenamesAudit from './tabs/RenamesAudit';
import NeedsReview from './tabs/NeedsReview';
import OpenItems from './tabs/OpenItems';

const TABS = [
  { id: 'overview',   label: 'Overview',           icon: 'ti-layout-dashboard' },
  { id: 'itemmix',    label: 'Item Mix',            icon: 'ti-list' },
  { id: 'loccompare', label: 'Location Compare',    icon: 'ti-map-pin' },
  { id: 'chanmenu',   label: 'Channels',             icon: 'ti-chart-pie' },
  { id: 'byo',        label: 'BYO Breakdown',       icon: 'ti-salad' },
  { id: 'payment',    label: 'Payment Source',      icon: 'ti-credit-card' },
  { id: 'me',         label: 'Menu Engineering',    icon: 'ti-star' },
  { id: 'bikky',      label: 'Customer Retention',  icon: 'ti-users' },
  { id: 'allitems',   label: 'All Items',           icon: 'ti-table' },
  { id: 'renames',    label: 'Renames Audit',       icon: 'ti-refresh' },
  { id: 'needs',      label: 'Needs Review',        icon: 'ti-alert-triangle' },
  { id: 'openitems',  label: 'Open Items',          icon: 'ti-package' },
] as const;

type TabId = typeof TABS[number]['id'];

const fmt$ = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;

export default function Dashboard({ data }: { data: DashboardData }) {
  const [tab, setTab]                   = useState<TabId>('overview');
  const [selectedChannels, setChannels] = useState<string[]>([]);
  const [chOpen, setChOpen]             = useState(false);
  const [categoryFilter, setCategory]   = useState('all');

  const { dateRange: dr, summary } = data;

  const currentPeriod = data.periods.find(
    p => dr.start >= p.start_date && dr.end <= p.end_date,
  );

  function toggleChannel(code: string) {
    setChannels(prev =>
      prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code],
    );
  }

  const chLabel = selectedChannels.length === 0
    ? 'All Channels'
    : selectedChannels.length === 1
      ? CHANNEL_LABEL[selectedChannels[0]] ?? selectedChannels[0]
      : `${selectedChannels.length} Channels`;

  // Category options mirror exactly what ItemMix shows for the selected channels:
  // CATERING / CATERING_3PD / OFFSITE → category = menu_group (vendor/package name)
  // All other channels                → category = AppScript category (Entrees, Sides…)
  const VENDOR_CHANNELS = new Set(['CATERING', 'CATERING_3PD', 'OFFSITE']);
  const categoryOptions = useMemo(() => {
    const cats = new Set<string>();
    const chFilter = new Set(selectedChannels);
    data.items.forEach(i => {
      if (chFilter.size > 0 && !chFilter.has(i.channel)) return;
      const cat = VENDOR_CHANNELS.has(i.channel)
        ? (i.menu_group || 'Other')
        : (i.category   || 'Other');
      if (cat) cats.add(cat);
    });
    return [...cats].sort();
  }, [data.items, selectedChannels]);

  // Item meta map (canonical_name → item metadata)
  const itemMetaMap = useMemo(() => {
    const m = new Map<string, ItemRow>();
    data.items.forEach(i => { if (!m.has(i.canonical_name)) m.set(i.canonical_name, i); });
    return m;
  }, [data.items]);

  // Channel-filtered items (aggregated from channelItems)
  const channelFilteredItems = useMemo((): ItemRow[] => {
    if (selectedChannels.length === 0) return data.items;

    const agg = new Map<string, { qty: number; revenue: number }>();
    data.channelItems
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
  }, [selectedChannels, data.items, data.channelItems, itemMetaMap]);

  // Apply category filter
  const filteredItems = useMemo(() =>
    categoryFilter === 'all'
      ? channelFilteredItems
      : channelFilteredItems.filter(i => i.category === categoryFilter),
  [channelFilteredItems, categoryFilter]);

  // Channel-filtered channelItems
  const filteredChannelItems = useMemo(() => {
    let r = data.channelItems;
    if (selectedChannels.length > 0) r = r.filter(ci => selectedChannels.includes(ci.channel));
    if (categoryFilter !== 'all') {
      r = r.filter(ci => (itemMetaMap.get(ci.canonical_name)?.category ?? 'Other') === categoryFilter);
    }
    return r;
  }, [selectedChannels, categoryFilter, data.channelItems, itemMetaMap]);

  // Channel-filtered channels list
  const filteredChannels = useMemo(() =>
    selectedChannels.length === 0
      ? data.channels
      : data.channels.filter(c => selectedChannels.includes(c.channel)),
  [selectedChannels, data.channels]);

  // Channel-filtered channelCategories
  const filteredChannelCategories = useMemo(() =>
    selectedChannels.length === 0
      ? data.channelCategories
      : data.channelCategories.filter(cc => selectedChannels.includes(cc.channel)),
  [selectedChannels, data.channelCategories]);

  // Channel-filtered location items
  const filteredLocationItems = useMemo(() => {
    if (selectedChannels.length === 0 && categoryFilter === 'all') return data.locationItems;
    const allowedNames = new Set(channelFilteredItems.map(i => i.canonical_name));
    return data.locationItems.filter(li => {
      if (!allowedNames.has(li.canonical_name)) return false;
      if (categoryFilter !== 'all') {
        return (itemMetaMap.get(li.canonical_name)?.category ?? 'Other') === categoryFilter;
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
        : data.meItems.filter(i => i.category === categoryFilter);
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
      ? allItems : allItems.filter(i => i.category === categoryFilter);

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

  const filteredBikky = useMemo(() =>
    categoryFilter === 'all' ? data.bikky : data.bikky.filter(b => b.category === categoryFilter),
  [data.bikky, categoryFilter]);

  const filteredData = useMemo(() => ({
    ...data,
    channels:          filteredChannels,
    channelItems:      filteredChannelItems,
    channelCategories: filteredChannelCategories,
    locationItems:     filteredLocationItems,
    meItems:           filteredMEItems,
  }), [data, filteredChannels, filteredChannelItems, filteredChannelCategories, filteredLocationItems, filteredMEItems]);

  return (
    <div className="container">

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
        </div>
      </div>

      {/* ── FILTER BAR ── */}
      <div className="fb">
        <div className="fb-r">
          <span className="fb-lbl">Date range</span>
          <DatePicker dr={dr} periods={data.periods} />
          <div className="fb-sep" />

          {/* Channel multi-select */}
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

          <div className="fb-sep" />

          {/* Category filter */}
          <span className="fb-lbl">Category</span>
          <select className="fb-sel" value={categoryFilter} onChange={e => setCategory(e.target.value)}>
            <option value="all">All Categories</option>
            {categoryOptions.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>

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

      {/* ── TAB CONTENT ── */}
      {tab === 'overview'   && <Overview         data={data} selectedChannels={selectedChannels} categoryFilter={categoryFilter} />}
      {tab === 'itemmix'    && <ItemMix          items={data.items} meItems={data.meItems} selectedChannels={selectedChannels} categoryFilter={categoryFilter} />}
      {tab === 'loccompare' && <LocationCompare  data={filteredData} />}
      {tab === 'chanmenu'   && <ChannelMenu      data={filteredData} />}
      {tab === 'byo'        && <BYOBreakdown     modifiers={data.modifiers} items={data.items} />}
      {tab === 'payment'    && <PaymentSource    payments={data.payments} />}
      {tab === 'me'         && <MenuEngineering  meItems={filteredMEItems} />}
      {tab === 'bikky'      && <CustomerRetention bikky={filteredBikky} />}
      {tab === 'allitems'   && <AllItems         meItems={filteredMEItems} items={filteredItems} />}
      {tab === 'renames'    && <RenamesAudit     renames={data.renames} />}
      {tab === 'needs'      && <NeedsReview      needsReview={data.needsReview} uncategorizedItems={data.uncategorizedItems} />}
      {tab === 'openitems'  && <OpenItems        openItemsSummary={data.openItemsSummary} openItems={data.openItems} />}
    </div>
  );
}
