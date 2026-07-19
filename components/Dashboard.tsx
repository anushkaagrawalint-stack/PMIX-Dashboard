'use client';
import { useState, useMemo } from 'react';
import Image from 'next/image';
import type { DashboardData, ItemRow, MERow, ChannelRow, ChannelItemRow, ChannelCategoryRow } from '@/lib/types';
import { CHANNELS, CHANNEL_LABEL, normalizeCategory } from '@/lib/constants';
import { TAB_META } from '@/lib/tabsMeta';
import type { Role } from '@/lib/auth';
import DatePicker from './DatePicker';
import Overview from './tabs/Overview';
import ItemMix from './tabs/ItemMix';
import LocationCompare from './tabs/LocationCompare';
import ChannelMenu from './tabs/ChannelMenu';
import BYOBreakdown from './tabs/BYOBreakdown';
import PaymentSource from './tabs/PaymentSource';
import CustomerRetention from './tabs/CustomerRetention';
import RenamesAudit from './tabs/RenamesAudit';
import RenamesDemo from './tabs/RenamesDemo';
import NeedsReview from './tabs/NeedsReview';
import OpenItems from './tabs/OpenItems';
import MEOverall from './tabs/MEOverall';
import PinkSheets from './tabs/PinkSheets';
import EntreeMix from './tabs/EntreeMix';
import AdminPanel from './tabs/AdminPanel';
import AttachmentAnalytics from './tabs/AttachmentAnalytics';

// Which tabs each role can see now lives in analytics.tab_permissions (owner
// request 2026-07-10) — configurable by tester (Admin + User tabs) and admin
// (User tabs only) from the Admin Panel. Tester itself always sees every tab,
// unconditionally. TAB_META (id/label/icon) is the shared nav metadata; the
// actual visibility list for the current viewer arrives as the `visibleTabs`
// prop, computed server-side in app/page.tsx.
const TABS = TAB_META;

type TabId = typeof TABS[number]['id'];

// Channel codes that roll up into Menu Engineering's IH/LO/3PD split (IN_HOUSE→IH,
// APP→LO, TPD+TPD_MARKUP→3PD) — used as the default channel set when no explicit
// channel filter is selected but a location filter still needs the per-channel recompute.
const ME_CHANNELS = ['IN_HOUSE', 'APP', 'TPD', 'TPD_MARKUP'];

// Which universal filter controls are meaningful for each tab.
// Hidden when not applicable so the bar stays uncluttered.
const TAB_FILTERS: Record<TabId, { channel: boolean; category: boolean; location: boolean }> = {
  overview:   { channel: true,  category: true,  location: true  },
  itemmix:    { channel: true,  category: true,  location: true  },
  // Location dropdown disabled here pending v2 validation (owner request 2026-07-04)
  // — these 4 tabs always show blended, all-location data regardless of the global
  // location filter until re-enabled. Underlying scaling logic stays in place.
  entreemix:  { channel: false, category: false, location: false },
  loccompare: { channel: true,  category: true,  location: false },
  chanmenu:   { channel: true,  category: true,  location: true  },
  byo:        { channel: false, category: false, location: false },
  payment:    { channel: false, category: false, location: true  },
  meoverall:  { channel: false, category: false, location: false },
  pinksheets: { channel: false, category: false, location: false },
  bikky:      { channel: false, category: false, location: false },
  renames:    { channel: false, category: false, location: false },
  renamesdemo:{ channel: false, category: false, location: false },
  needs:      { channel: false, category: false, location: false },
  openitems:  { channel: false, category: false, location: false },
  admin:      { channel: false, category: false, location: false },
  attachment: { channel: true,  category: false, location: true  },
};

export default function Dashboard({ data, isAdmin, role, visibleTabs, currentEmail }: { data: DashboardData; isAdmin: boolean; role: Role; visibleTabs: string[]; currentEmail: string | null }) {
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

  // "Real Menu Items" quick-select — every channel except TPD_MARKUP (owner
  // request 2026-07-15), available wherever the channel filter shows since
  // it's this one shared component across tabs.
  const realMenuChannelCodes = useMemo(
    () => CHANNELS.filter(c => c.code !== 'TPD_MARKUP').map(c => c.code as string),
    [],
  );
  const isRealMenuSelected = selectedChannels.length > 0
    && selectedChannels.length === realMenuChannelCodes.length
    && realMenuChannelCodes.every(c => selectedChannels.includes(c));

  const locLabel = selectedLocations.length === 0
    ? 'All Locations'
    : selectedLocations.length === 1
      ? (data.locations.find(l => l.location_code === selectedLocations[0])?.display_name ?? selectedLocations[0])
      : `${selectedLocations.length} Locations`;

  // Tester-only "Open Locations" quick-select — always recomputed from the
  // live open/closed status (analytics.location_status via data.locations),
  // never a hardcoded list.
  const openLocationCodes = useMemo(
    () => data.locations.filter(l => l.is_open).map(l => l.location_code),
    [data.locations],
  );
  const isOpenLocationsSelected = selectedLocations.length > 0
    && selectedLocations.length === openLocationCodes.length
    && openLocationCodes.every(c => selectedLocations.includes(c));

  const normCat = normalizeCategory;

  // Category options: vendor channels (catering/offsite/markup) collapse to 'Other'
  // to keep the dropdown short. Only IH/RASA Digital/3PD show real categories.
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

    // Exact location totals per (canonical_name, channel) — denominator for scaling.
    // gross_sales scaled here too (owner report 2026-07-15: "location dropdown not
    // updating the gross item amount column") — it used to pass through unscaled
    // from the global item, so it never moved when a location filter was applied.
    const locChannelAgg = new Map<string, { qty: number; revenue: number; gross_sales: number; refunds: number }>();
    data.locationItems
      .filter(li => selectedLocations.includes(li.location_code))
      .forEach(li => {
        const key = `${li.canonical_name}||${li.channel}`;
        const e = locChannelAgg.get(key) ?? { qty: 0, revenue: 0, gross_sales: 0, refunds: 0 };
        e.qty         += li.qty;
        e.revenue     += li.revenue;
        e.gross_sales += li.gross_sales;
        e.refunds     += li.refunds; // exact per-location refunds — no scaling needed, unlike revenue/qty/gross_sales
        locChannelAgg.set(key, e);
      });

    // Global totals per (canonical_name, channel) from channelItems (already aggregated by channel)
    const totChannelAgg = new Map<string, { qty: number; revenue: number; gross_sales: number }>();
    data.channelItems.forEach(ci => {
      const key = `${ci.canonical_name}||${ci.channel}`;
      totChannelAgg.set(key, { qty: ci.qty, revenue: ci.revenue, gross_sales: ci.gross_sales });
    });

    const totalLocRev   = [...locChannelAgg.values()].reduce((s, v) => s + v.revenue, 0);
    const totalLocQty   = [...locChannelAgg.values()].reduce((s, v) => s + v.qty,     0);

    return data.items.flatMap(i => {
      const key = `${i.canonical_name}||${i.channel}`;
      const loc = locChannelAgg.get(key);
      if (!loc) return [];
      const tot        = totChannelAgg.get(key);
      const revScale   = tot && tot.revenue     > 0 ? loc.revenue     / tot.revenue     : 0;
      const qtyScale   = tot && tot.qty         > 0 ? loc.qty         / tot.qty         : 0;
      const grossScale = tot && tot.gross_sales > 0 ? loc.gross_sales / tot.gross_sales : 0;
      const qty         = Math.round(i.qty * qtyScale);
      const revenue     = Math.round(i.revenue * revScale * 100) / 100;
      const gross_sales = Math.round(i.gross_sales * grossScale * 100) / 100;
      if (qty === 0 && revenue === 0) return [];
      return [{
        ...i, qty, revenue, gross_sales,
        avg_price:   qty > 0 ? gross_sales / qty : i.avg_price,
        revenue_pct: totalLocRev > 0 ? (revenue / totalLocRev) * 100 : 0,
        qty_pct:     totalLocQty > 0 ? (qty     / totalLocQty) * 100 : 0,
        refunds:           loc.refunds,
        net_after_refunds: Math.round((revenue - loc.refunds) * 100) / 100,
      }];
    }).sort((a, b) => b.revenue - a.revenue);
  }, [selectedLocations, data.locationItems, data.channelItems, data.items]);

  // Summary KPIs adjusted for selected location(s)
  const locationAdjustedSummary = useMemo(() => {
    if (selectedLocations.length === 0) return data.summary;
    const locItems = data.locationItems.filter(li => selectedLocations.includes(li.location_code));
    const totalRev = locItems.reduce((s, li) => s + li.revenue, 0);
    const totalQty = locItems.reduce((s, li) => s + li.qty,     0);
    const totalRefunds = locItems.reduce((s, li) => s + li.refunds, 0);
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
      refunds:          totalRefunds,
      net_revenue:      Math.round((totalRev - totalRefunds) * 100) / 100,
    };
  }, [selectedLocations, data.locationItems, data.summary]);

  // Same location adjustment, for the previous-period comparison summary — without
  // this, Overview's "vs prev X" deltas compared a location-adjusted current period
  // against an all-locations previous period whenever only a location filter was active.
  const locationAdjustedPrevSummary = useMemo(() => {
    if (!data.prevSummary) return data.prevSummary;
    if (selectedLocations.length === 0) return data.prevSummary;
    const locItems = data.prevLocationItems.filter(li => selectedLocations.includes(li.location_code));
    const totalRev = locItems.reduce((s, li) => s + li.revenue, 0);
    const totalQty = locItems.reduce((s, li) => s + li.qty,     0);
    const totalRefunds = locItems.reduce((s, li) => s + li.refunds, 0);
    const uniqueItems = new Set(locItems.map(li => li.canonical_name)).size;
    const itemAgg = new Map<string, { qty: number; revenue: number }>();
    locItems.forEach(li => {
      const e = itemAgg.get(li.canonical_name) ?? { qty: 0, revenue: 0 };
      e.qty     += li.qty;
      e.revenue += li.revenue;
      itemAgg.set(li.canonical_name, e);
    });
    const topEntry = [...itemAgg.entries()].sort((a, b) => b[1].revenue - a[1].revenue)[0];
    return {
      ...data.prevSummary,
      total_revenue:    totalRev,
      total_qty:        totalQty,
      unique_items:     uniqueItems,
      top_item:         topEntry?.[0]           ?? data.prevSummary.top_item,
      top_item_revenue: topEntry?.[1].revenue   ?? data.prevSummary.top_item_revenue,
      top_item_mix:     totalQty > 0 ? ((topEntry?.[1].qty ?? 0) / totalQty) * 100 : data.prevSummary.top_item_mix,
      refunds:          totalRefunds,
      net_revenue:      Math.round((totalRev - totalRefunds) * 100) / 100,
    };
  }, [selectedLocations, data.prevLocationItems, data.prevSummary]);

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
      gross_sales:    i.gross_sales,
      refunds:            i.refunds,
      net_after_refunds:  i.net_after_refunds,
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

    const agg = new Map<string, { qty: number; revenue: number; gross_sales: number; refunds: number }>();
    locationAdjustedChannelItems
      .filter(ci => selectedChannels.includes(ci.channel))
      .forEach(ci => {
        const e = agg.get(ci.canonical_name) ?? { qty: 0, revenue: 0, gross_sales: 0, refunds: 0 };
        e.qty         += ci.qty;
        e.revenue     += ci.revenue;
        e.gross_sales += ci.gross_sales;
        e.refunds     += ci.refunds;
        agg.set(ci.canonical_name, e);
      });

    const totalRev = [...agg.values()].reduce((s, v) => s + v.revenue, 0);
    const totalQty = [...agg.values()].reduce((s, v) => s + v.qty,     0);

    return [...agg.entries()].map(([name, { qty, revenue, gross_sales, refunds }]) => {
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
        gross_sales,
        avg_price:   qty > 0 ? gross_sales / qty : 0,
        revenue_pct: totalRev > 0 ? (revenue / totalRev) * 100 : 0,
        qty_pct:     totalQty > 0 ? (qty / totalQty) * 100 : 0,
        refunds,
        net_after_refunds: Math.round((revenue - refunds) * 100) / 100,
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

  // ── Prev-period pipeline, mirroring the current-period one above, so Overview's
  // "vs prev X" KPI deltas can respect the same channel/category/location filters
  // instead of comparing a filtered current period against an unfiltered prev total.
  // Location: LocationItemRow already has exact per-location numbers, so this is a
  // direct filter+sum (no proportional scaling needed — Overview only needs
  // channel-level granularity, not the finer menu_group split locationBaseItems scales for).
  const prevLocationAdjustedChannelItems = useMemo((): ChannelItemRow[] => {
    if (selectedLocations.length === 0) return data.prevChannelItems;
    const agg = new Map<string, { qty: number; revenue: number; refunds: number }>();
    data.prevLocationItems
      .filter(li => selectedLocations.includes(li.location_code))
      .forEach(li => {
        const key = `${li.canonical_name}||${li.channel}`;
        const e = agg.get(key) ?? { qty: 0, revenue: 0, refunds: 0 };
        e.qty     += li.qty;
        e.revenue += li.revenue;
        e.refunds += li.refunds;
        agg.set(key, e);
      });
    return [...agg.entries()].map(([key, v]) => {
      const idx = key.indexOf('||');
      return {
        canonical_name: key.slice(0, idx),
        channel:        key.slice(idx + 2),
        qty:            v.qty,
        revenue:        v.revenue,
        gross_sales:    v.revenue, // not tracked per-location; unused downstream for prev-period deltas
        refunds:            v.refunds,
        net_after_refunds:  Math.round((v.revenue - v.refunds) * 100) / 100,
      };
    });
  }, [selectedLocations, data.prevChannelItems, data.prevLocationItems]);

  const prevFilteredChannelItems = useMemo(() => {
    let r = prevLocationAdjustedChannelItems;
    if (selectedChannels.length > 0) r = r.filter(ci => selectedChannels.includes(ci.channel));
    if (categoryFilter !== 'all')    r = r.filter(ci => normCat(itemMetaMap.get(ci.canonical_name)?.category) === categoryFilter);
    return r;
  }, [selectedChannels, categoryFilter, prevLocationAdjustedChannelItems, itemMetaMap]);

  // Prev-period ME items — same per-channel recompute as filteredMEItems, simplified
  // to just the fields Overview's margin delta needs (no quadrant/flag computation).
  const prevFilteredMEItems = useMemo((): MERow[] => {
    let base: MERow[];
    if (selectedChannels.length === 0) {
      base = data.prevMEItems;
    } else {
      const costMeta = new Map(data.prevMEItems.map(i => [i.canonical_name, i]));
      const acc = new Map<string, { qty: number; net_sales: number; total_cost: number }>();
      for (const ci of prevLocationAdjustedChannelItems) {
        if (!selectedChannels.includes(ci.channel)) continue;
        const meta = costMeta.get(ci.canonical_name);
        if (!meta) continue;
        const costMult = ci.channel === 'TPD' ? 1.18 : 1.0;
        const e = acc.get(ci.canonical_name) ?? { qty: 0, net_sales: 0, total_cost: 0 };
        e.qty        += ci.qty;
        e.net_sales  += ci.revenue;
        e.total_cost += ci.qty * meta.avg_cost * costMult;
        acc.set(ci.canonical_name, e);
      }
      base = [...acc.entries()].flatMap(([name, v]) => {
        const meta = costMeta.get(name);
        if (!meta || v.qty === 0) return [];
        return [{ ...meta, qty: v.qty, net_sales: v.net_sales, total_cost: v.total_cost,
                  total_margin: v.net_sales - v.total_cost }];
      });
    }
    const byCategory = categoryFilter === 'all' ? base : base.filter(i => normCat(i.category) === categoryFilter);
    // Location: presence filter only, matching finalMEItems' existing precedent
    // (restricts to items sold in the selected location; doesn't rescale $ to its share).
    if (selectedLocations.length === 0) return byCategory;
    const locNames = new Set(locationBaseItems.map(i => i.canonical_name));
    return byCategory.filter(i => locNames.has(i.canonical_name));
  }, [selectedChannels, categoryFilter, selectedLocations, data.prevMEItems, prevLocationAdjustedChannelItems, locationBaseItems]);

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

  // Channel-filtered location items — must filter each row by its OWN channel field,
  // not just whether the item sold in the selected channel(s) somewhere (that name-only
  // check let an item's In-House-only rows through the "3PD" filter too, as long as it
  // *also* sold via 3PD elsewhere — LocationCompare then summed every channel's revenue
  // for it, not just the selected one).
  const filteredLocationItems = useMemo(() => {
    if (selectedChannels.length === 0 && categoryFilter === 'all') return data.locationItems;
    return data.locationItems.filter(li => {
      if (selectedChannels.length > 0 && !selectedChannels.includes(li.channel)) return false;
      if (categoryFilter !== 'all') {
        return normCat(itemMetaMap.get(li.canonical_name)?.category) === categoryFilter;
      }
      return true;
    });
  }, [selectedChannels, categoryFilter, data.locationItems, itemMetaMap]);

  // ME items — channel-specific recompute following SOP formula chain. Also runs
  // (with the full IH+LO+3PD channel set) whenever a location filter is active, so
  // qty/net_sales/cost genuinely rescale to the location's share (via
  // locationAdjustedChannelItems, which already has exact per-location numbers)
  // instead of merely filtering which items are present.
  const filteredMEItems = useMemo((): MERow[] => {
    // Fast path: no channel or location filter — server (blended) values are already correct.
    if (selectedChannels.length === 0 && selectedLocations.length === 0) {
      return categoryFilter === 'all'
        ? data.meItems
        : data.meItems.filter(i => normCat(i.category) === categoryFilter);
    }

    // Per-channel recompute
    const costMeta = new Map(data.meItems.map(i => [i.canonical_name, i]));
    const channels = selectedChannels.length > 0 ? selectedChannels : ME_CHANNELS;

    const acc = new Map<string, { qty: number; net_sales: number; total_cost: number }>();
    for (const ci of locationAdjustedChannelItems) {
      if (!channels.includes(ci.channel)) continue;
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
    allItems.forEach(i => { const cat = normCat(i.category); catRev.set(cat, (catRev.get(cat) ?? 0) + i.net_sales); });

    const display = categoryFilter === 'all'
      ? allItems : allItems.filter(i => normCat(i.category) === categoryFilter);

    return display.map(i => {
      const mix_pct     = grand_qty > 0 ? i.qty / grand_qty : 0;
      const margin_flag = (i.margin_pct > margin_threshold ? 'High' : 'Low') as 'High' | 'Low';
      const mix_flag    = (mix_pct      > mix_threshold    ? 'High' : 'Low') as 'High' | 'Low';
      const quadrant    = i.is_open_item ? 'Dog' : (
        margin_flag === 'High' && mix_flag === 'High' ? 'Star'       :
        margin_flag === 'High' && mix_flag === 'Low'  ? 'Puzzle'     :
        margin_flag === 'Low'  && mix_flag === 'High' ? 'Plow Horse' : 'Dog'
      ) as MERow['quadrant'];
      const cat = normCat(i.category);
      return {
        ...i, mix_pct,
        sls_pct_category: (catRev.get(cat) ?? 0) > 0
          ? i.net_sales / catRev.get(cat)! : 0,
        quadrant, margin_flag, mix_flag, margin_threshold, mix_threshold,
      };
    });
  }, [selectedChannels, selectedLocations, categoryFilter, data.meItems, locationAdjustedChannelItems]);

  // Location scaling is now baked into filteredMEItems itself (see above) — kept as an
  // alias so downstream consumers/props don't need to change name.
  const finalMEItems = filteredMEItems;

  // Per-item qty scale ratios (IH bucket vs combined online bucket = APP+TPD+TPD_MARKUP)
  // for the selected location(s), built from the same exact per-location totals
  // (data.locationItems) used everywhere else, against the all-location total
  // (data.channelItems). Pink Sheet unit costs (avg_cost_ih/online/3pd) are genuinely
  // location-invariant — r365 costs carry no location dimension at all — so only qty
  // (and $ totals derived from qty × rate) can honestly be rescaled to a location's share.
  const pinkSheetLocationRatios = useMemo(() => {
    const m = new Map<string, { ih: number; online: number }>();
    if (selectedLocations.length === 0) return m; // empty map ⇒ callers treat as "no scaling"

    const isOnlineCh = (c: string) => c === 'APP' || c === 'TPD' || c === 'TPD_MARKUP';
    const locAgg = new Map<string, { ih: number; online: number }>();
    data.locationItems
      .filter(li => selectedLocations.includes(li.location_code))
      .forEach(li => {
        const e = locAgg.get(li.canonical_name) ?? { ih: 0, online: 0 };
        if (li.channel === 'IN_HOUSE') e.ih += li.qty;
        else if (isOnlineCh(li.channel)) e.online += li.qty;
        locAgg.set(li.canonical_name, e);
      });

    const totAgg = new Map<string, { ih: number; online: number }>();
    data.channelItems.forEach(ci => {
      const e = totAgg.get(ci.canonical_name) ?? { ih: 0, online: 0 };
      if (ci.channel === 'IN_HOUSE') e.ih += ci.qty;
      else if (isOnlineCh(ci.channel)) e.online += ci.qty;
      totAgg.set(ci.canonical_name, e);
    });

    new Set([...locAgg.keys(), ...totAgg.keys()]).forEach(name => {
      const loc = locAgg.get(name) ?? { ih: 0, online: 0 };
      const tot = totAgg.get(name) ?? { ih: 0, online: 0 };
      m.set(name, {
        ih:     tot.ih     > 0 ? loc.ih     / tot.ih     : 0,
        online: tot.online > 0 ? loc.online / tot.online : 0,
      });
    });
    return m;
  }, [selectedLocations, data.locationItems, data.channelItems]);

  // Pink Sheets, genuinely rescaled to the selected location(s): ih_qty/online_qty (and
  // the modifier cost totals, scaled by the same ratio so avg_cost stays mathematically
  // consistent) reflect the location's actual share of orders; unit-cost fields
  // (base_cost_*, avg_cost_*) are left untouched since they carry no location dimension.
  const locationFilteredPinkSheets = useMemo(() => {
    if (selectedLocations.length === 0) return data.pinkSheets;
    return data.pinkSheets.flatMap(p => {
      const r = pinkSheetLocationRatios.get(p.canonical_name);
      if (!r) return [];
      const ih_qty     = Math.round(p.ih_qty     * r.ih);
      const online_qty = Math.round(p.online_qty * r.online);
      if (ih_qty === 0 && online_qty === 0) return [];
      return [{
        ...p, ih_qty, online_qty,
        total_ih_mod_cost: p.total_ih_mod_cost * r.ih,
        total_mod_cost:    p.total_mod_cost    * r.online,
      }];
    });
  }, [data.pinkSheets, selectedLocations, pinkSheetLocationRatios]);

  // Pink Sheet modifier-level detail rows, scaled by the same per-item ratio as above
  // (ih rows by r.ih, online rows by r.online) — this keeps computeFinalAvgCost's
  // (totalModCost + baseCost·qty) / qty math exactly invariant (both scale by the same
  // factor) while genuinely reflecting the location's order volume in section subtotals.
  const locationFilteredPinkSheetDetails = useMemo(() => {
    if (selectedLocations.length === 0) return data.pinkSheetDetails;
    return data.pinkSheetDetails.flatMap(d => {
      const r = pinkSheetLocationRatios.get(d.parent_item);
      const ratio = d.channel === 'ih' ? (r?.ih ?? 0) : (r?.online ?? 0);
      const qty = Math.round(d.qty * ratio * 1000) / 1000; // fractional qty kept (weighted-avg math)
      if (qty === 0) return [];
      return [{ ...d, qty, total_cost: d.total_cost * ratio }];
    });
  }, [data.pinkSheetDetails, selectedLocations, pinkSheetLocationRatios]);

  // Same presence filter for itemCosts (Item Mix's cost fallback tier) — r365 costs
  // aren't tracked per location, so this restricts which items appear, not their cost.
  const locationFilteredItemCosts = useMemo(() => {
    if (selectedLocations.length === 0) return data.itemCosts;
    const locNames = new Set(locationBaseItems.map(i => i.canonical_name));
    return data.itemCosts.filter(c => locNames.has(c.canonical_name));
  }, [data.itemCosts, selectedLocations, locationBaseItems]);

  // makeItMealModifiers carries its own exact location_code (unlike pinkSheets/
  // itemCosts, no proportional scaling needed) — for Item Mix's "Make It a
  // Meal" checkbox.
  const locationFilteredMakeItMealModifiers = useMemo(() => {
    if (selectedLocations.length === 0) return data.makeItMealModifiers;
    return data.makeItMealModifiers.filter(m => selectedLocations.includes(m.location_code));
  }, [data.makeItMealModifiers, selectedLocations]);

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
    prevSummary:       locationAdjustedPrevSummary,
    items:             locationBaseItems,
    channels:          filteredChannels,
    channelItems:      filteredChannelItems,
    channelCategories: filteredChannelCategories,
    locationItems:     filteredLocationItems,
    meItems:           finalMEItems,
    prevChannelItems:  prevFilteredChannelItems,
    prevMEItems:       prevFilteredMEItems,
  }), [data, locationAdjustedSummary, locationAdjustedPrevSummary, locationBaseItems, filteredChannels, filteredChannelItems, filteredChannelCategories, filteredLocationItems, finalMEItems, prevFilteredChannelItems, prevFilteredMEItems]);

  return (
    <div className="container">

      {/* ── STICKY HEADER + FILTER BAR ── */}
      <div className="sticky-bar">

      {/* ── HEADER ── */}
      <div className="hdr">
        <div className="hdr-l">
          <div className="rasa-box">
            <Image src="/rasa-logo.png" alt="RASA" width={120} height={39} style={{ height: 20, width: 'auto', display: 'block' }} priority />
          </div>
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
          <span className="klogo">
            <Image src="/WhiteLogo.webp" alt="Kutlerri" width={120} height={39} style={{ height: 16, width: 'auto', display: 'block' }} priority />
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#fff', fontSize: 12, fontWeight: 600, borderLeft: '1px solid rgba(255,255,255,0.2)', paddingLeft: 10 }}>
            <i className="ti ti-user-circle" style={{ fontSize: 14, opacity: 0.7 }} aria-hidden="true" />
            {currentEmail}
          </span>
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
                      <label className="dr-it" style={{ gap: 8, userSelect: 'none' }}>
                        <input type="checkbox" checked={isOpenLocationsSelected}
                          onChange={() => setLocations([...openLocationCodes])} style={{ accentColor: 'var(--accent)' }} />
                        Open Locations
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

          {showCh && (
            <>
              <div className="fb-sep" />
              <label className="dr-it" style={{ gap: 7, userSelect: 'none' }}>
                <input type="checkbox" checked={isRealMenuSelected}
                  onChange={() => setChannels(isRealMenuSelected ? [] : [...realMenuChannelCodes])}
                  style={{ accentColor: 'var(--accent)' }} />
                Real Menu Items
              </label>
            </>
          )}

        </div>
      </div>

      {/* ── TABS ── */}
      <div className="tabs-o">
        <div className="tabs-i">
          {TABS.filter(t => visibleTabs.includes(t.id)).map(t => (
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
            </button>
          ))}
        </div>
      </div>

      </div>{/* end sticky-bar */}

      {/* ── TAB CONTENT ── */}
      {tab === 'overview'   && <Overview         data={filteredData} selectedChannels={selectedChannels} categoryFilter={categoryFilter} selectedLocations={selectedLocations} />}
      {tab === 'itemmix'    && <ItemMix          items={locationBaseItems} pinkSheets={locationFilteredPinkSheets} pinkSheetDetails={locationFilteredPinkSheetDetails} itemCosts={locationFilteredItemCosts} makeItMealModifiers={locationFilteredMakeItMealModifiers} selectedChannels={selectedChannels} categoryFilter={categoryFilter} />}
      {/* entreemix/byo/meoverall/pinksheets: location dropdown commented out pending v2
          validation — always pass blended, all-location data here regardless of the
          global location filter (the location-scaled memos stay wired for itemmix). */}
      {tab === 'entreemix'  && <EntreeMix        pinkSheets={data.pinkSheets} pinkSheetDetails={data.pinkSheetDetails} meItems={data.meItems} />}
      {tab === 'loccompare' && <LocationCompare  data={filteredData} />}
      {tab === 'chanmenu'   && <ChannelMenu      data={filteredData} />}
      {tab === 'byo'        && visibleTabs.includes('byo')        && <BYOBreakdown modifiers={data.modifiers} items={data.items} pinkSheets={data.pinkSheets} meItems={data.meItems} selectedLocations={[]} />}
      {tab === 'payment'    && <PaymentSource    payments={data.payments} paymentsByLocation={data.paymentsByLocation} paymentSourcesByLocation={data.paymentSourcesByLocation} selectedLocations={selectedLocations} />}
      {tab === 'meoverall'  && <MEOverall meItems={data.meItems} pinkSheets={data.pinkSheets} pinkSheetDetails={data.pinkSheetDetails} itemCosts={data.itemCosts} role={role} />}
      {tab === 'pinksheets' && visibleTabs.includes('pinksheets') && <PinkSheets pinkSheets={data.pinkSheets} details={data.pinkSheetDetails} />}
      {tab === 'bikky'      && <CustomerRetention bikky={filteredBikky} meItems={finalMEItems} items={locationBaseItems} period={activeBikkyPeriod} />}
      {tab === 'renames'    && <RenamesAudit     renames={data.renames} role={role} />}
      {tab === 'renamesdemo' && visibleTabs.includes('renamesdemo') && <RenamesDemo renames={data.renamesDemo} />}
      {tab === 'needs'      && <NeedsReview      needsReview={data.needsReview} uncategorizedItems={data.uncategorizedItems} missingCosts={data.missingCosts} periods={data.periods} isAdmin={isAdmin} />}
      {tab === 'openitems'  && <OpenItems        openItemsSummary={data.openItemsSummary} openItems={data.openItems} />}
      {tab === 'admin'      && visibleTabs.includes('admin')      && <AdminPanel currentEmail={currentEmail} currentRole={role} />}
      {tab === 'attachment' && visibleTabs.includes('attachment') && <AttachmentAnalytics data={data.attachment} prevData={data.prevAttachment} prevLabel={data.prevLabel} locations={data.locations} selectedLocations={selectedLocations} selectedChannels={selectedChannels} items={locationBaseItems} beverageModifiers={data.beverageModifiers} role={role} />}
    </div>
  );
}
