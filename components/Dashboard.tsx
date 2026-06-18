'use client';
import { useState, useMemo } from 'react';
import type { DashboardData, ItemRow } from '@/lib/types';
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
import ChannelsTab from './tabs/ChannelsTab';

const TABS = [
  { id: 'overview',   label: 'Overview',           icon: 'ti-layout-dashboard' },
  { id: 'itemmix',    label: 'Item Mix',            icon: 'ti-list' },
  { id: 'loccompare', label: 'Location Compare',    icon: 'ti-map-pin' },
  { id: 'chanmenu',   label: 'Channel & Menu',      icon: 'ti-arrows-split-2' },
  { id: 'channels',   label: 'Channels',            icon: 'ti-chart-pie' },
  { id: 'byo',        label: 'BYO Breakdown',       icon: 'ti-salad' },
  { id: 'payment',    label: 'Payment Source',      icon: 'ti-credit-card' },
  { id: 'me',         label: 'Menu Engineering',    icon: 'ti-star' },
  { id: 'bikky',      label: 'Customer Retention',  icon: 'ti-users' },
  { id: 'allitems',   label: 'All Items',           icon: 'ti-table' },
  { id: 'renames',    label: 'Renames Audit',       icon: 'ti-refresh' },
  { id: 'needs',      label: 'Needs Review',        icon: 'ti-alert-triangle' },
] as const;

type TabId = typeof TABS[number]['id'];

const fmt$ = (v: number) =>
  v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M`
  : v >= 1_000   ? `$${(v / 1_000).toFixed(0)}K`
  : `$${v.toFixed(0)}`;

const CHANNEL_CODE_MAP: Record<string, string> = { ih: 'IN_HOUSE', app: 'APP', tpd: 'TPD' };

export default function Dashboard({ data }: { data: DashboardData }) {
  const [tab, setTab]         = useState<TabId>('overview');
  const [channel, setChannel] = useState<string>('all');

  const { dateRange: dr, summary } = data;

  // Detect if current date range is a known fiscal period
  const currentPeriod = data.periods.find(
    p => dr.start === p.start_date && dr.end === p.end_date,
  );

  const channelFilteredItems = useMemo((): ItemRow[] => {
    if (channel === 'all') return data.items;
    const code = CHANNEL_CODE_MAP[channel];
    const chanRows = data.channelItems.filter(ci => ci.channel_code === code);
    const chanTotalRev = chanRows.reduce((s, r) => s + r.revenue, 0);
    const chanTotalQty = chanRows.reduce((s, r) => s + r.qty, 0);
    const meta: Record<string, Pick<ItemRow, 'menu_group' | 'menu_name' | 'category' | 'sub_category'>> = {};
    data.items.forEach(i => { if (!meta[i.canonical_name]) meta[i.canonical_name] = i; });
    return chanRows
      .map(ci => ({
        canonical_name: ci.canonical_name,
        menu_group:   meta[ci.canonical_name]?.menu_group   ?? 'Other',
        menu_name:    meta[ci.canonical_name]?.menu_name    ?? 'Other',
        category:     meta[ci.canonical_name]?.category     ?? 'Other',
        sub_category: meta[ci.canonical_name]?.sub_category ?? '',
        qty:         ci.qty,
        revenue:     ci.revenue,
        avg_price:   ci.qty > 0 ? Math.round((ci.revenue / ci.qty) * 100) / 100 : 0,
        revenue_pct: chanTotalRev > 0 ? Math.round(ci.revenue / chanTotalRev * 10000) / 100 : 0,
        qty_pct:     chanTotalQty > 0 ? Math.round(ci.qty    / chanTotalQty * 10000) / 100 : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [channel, data.items, data.channelItems]);

  return (
    <div className="container">

      {/* ── HEADER ── */}
      <div className="hdr">
        <div className="hdr-l">
          <div className="rasa-box">RASA</div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="hdr-title">Product Mix Dashboard</span>
              <span className="pbadge">{currentPeriod ? currentPeriod.label : 'LIVE'}</span>
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
          <span className="fb-lbl">Channel</span>
          <div className="chp">
            {[
              { k: 'all', l: 'All',      cls: 'all' },
              { k: 'ih',  l: 'In-House', cls: 'ih'  },
              { k: 'app', l: 'App',      cls: 'app' },
              { k: 'tpd', l: '3PD',      cls: 'tpd' },
            ].map(({ k, l, cls }) => (
              <button
                key={k}
                onClick={() => setChannel(k)}
                className={`cp ${cls}${channel === k ? ' on' : ''}`}
              >{l}</button>
            ))}
          </div>
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
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`tb${tab === t.id ? ' on' : ''}`}
            >
              <i className={`ti ${t.icon}`} aria-hidden="true" />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── TAB CONTENT ── */}
      {tab === 'overview'   && <Overview   data={data} />}
      {tab === 'itemmix'    && <ItemMix    items={channelFilteredItems} />}
      {tab === 'loccompare' && <LocationCompare data={data} />}
      {tab === 'chanmenu'   && <ChannelMenu data={data} />}
      {tab === 'channels'   && <ChannelsTab channels={data.channels} channelItems={data.channelItems} channelCategories={data.channelCategories} meItems={data.meItems} />}
      {tab === 'byo'        && <BYOBreakdown modifiers={data.modifiers} />}
      {tab === 'payment'    && <PaymentSource payments={data.payments} />}
      {tab === 'me'         && <MenuEngineering meItems={data.meItems} />}
      {tab === 'bikky'      && <CustomerRetention bikky={data.bikky} />}
      {tab === 'allitems'   && <AllItems meItems={data.meItems} items={data.items} />}
      {tab === 'renames'    && <RenamesAudit renames={data.renames} />}
      {tab === 'needs'      && <NeedsReview needsReview={data.needsReview} />}
    </div>
  );
}
