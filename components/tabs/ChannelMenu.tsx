'use client';
import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import type { DashboardData } from '@/lib/types';

const HBarChart = dynamic(() => import('../charts/HBarChart'), { ssr: false });

const fmt$ = (v: number) =>
  v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M`
  : v >= 1_000   ? `$${(v / 1_000).toFixed(0)}K`
  : `$${v.toFixed(0)}`;

const CHANNEL_COLORS: Record<string, string> = {
  IN_HOUSE: '#9f7cef', CATERING: '#f5a623', TPD: '#ef7ccf',
  APP: '#7cb9ef', OFFSITE: '#2ec4b6', OTHER: '#9ca3af',
};
const CHANNEL_LABELS: Record<string, string> = {
  IN_HOUSE: 'In-House', CATERING: 'Catering', TPD: '3PD Delivery',
  APP: 'App', OFFSITE: 'Offsites', OTHER: 'Other',
};

const cc = { background: 'var(--card)', borderRadius: 'var(--radius)', padding: '14px 16px', boxShadow: 'var(--shadow)' };

export default function ChannelMenu({ data }: { data: DashboardData }) {
  const { channels, channelItems } = data;
  const topItemRows = useTopItems(channelItems, 20);

  // Top items per channel
  const topByChannel = useMemo(() => {
    const map: Record<string, Array<{ name: string; value: number; pct: number }>> = {};
    const chanTotal: Record<string, number> = {};
    channelItems.forEach(r => {
      chanTotal[r.channel_code] = (chanTotal[r.channel_code] ?? 0) + r.revenue;
    });
    channelItems.forEach(r => {
      if (!map[r.channel_code]) map[r.channel_code] = [];
      const list = map[r.channel_code];
      if (list.length < 10) {
        list.push({
          name: r.canonical_name.slice(0, 24),
          value: r.revenue,
          pct: Math.round((r.revenue / (chanTotal[r.channel_code] ?? 1)) * 1000) / 10,
        });
      }
    });
    return map;
  }, [channelItems]);

  // Revenue by menu_name (proxy for "by menu")
  const menuRevBar = useMemo(() => {
    const map: Record<string, number> = {};
    channelItems.forEach(r => { map[r.channel_code] = (map[r.channel_code] ?? 0) + r.revenue; });
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .map(([name, value]) => ({ name: CHANNEL_LABELS[name] ?? name, value }));
  }, [channelItems]);

  return (
    <div>
      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 10, marginBottom: 12 }}>
        {channels.map(ch => (
          <div key={ch.channel_code} style={{
            background: 'var(--card)', borderRadius: 'var(--radius)', padding: '14px 16px',
            boxShadow: 'var(--shadow)', borderLeft: `3px solid ${CHANNEL_COLORS[ch.channel_code] ?? '#9ca3af'}`,
          }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 5 }}>
              {CHANNEL_LABELS[ch.channel_code] ?? ch.channel_code}
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1 }}>{fmt$(ch.revenue)}</div>
            <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>{ch.pct}% of total</div>
          </div>
        ))}
      </div>

      {/* Top items per channel - first 3 channels */}
      <div className="gr3">
        {channels.slice(0, 3).map(ch => {
          const top = topByChannel[ch.channel_code] ?? [];
          return (
            <div key={ch.channel_code} className="cc">
              <h3>Top items — {CHANNEL_LABELS[ch.channel_code]}</h3>
              {top.map((item, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px solid #f3f4f6' }}>
                  <div style={{ flex: 1, fontSize: 11 }}>{item.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600, minWidth: 34 }}>{item.pct}%</div>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {/* Revenue by channel bar */}
      <div className="cc">
        <h3>Revenue by channel</h3>
        <HBarChart data={menuRevBar} color="#9f7cef" height={220} />
      </div>

      {/* Item-level channel table */}
      <div className="tw" style={{ marginTop: 10 }}>
        <div className="th2">
          <h3>Item-level channel breakdown (top 20)</h3>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr>
              <th>Item</th>
              {channels.map(ch => <th key={ch.channel_code}>{CHANNEL_LABELS[ch.channel_code] ?? ch.channel_code} $</th>)}
            </tr></thead>
            <tbody>
              {topItemRows.map(row => (
                <tr key={row.name}>
                  <td style={{ fontWeight: 600 }}>{row.name}</td>
                  {channels.map(ch => (
                    <td key={ch.channel_code}>{row.byChannel[ch.channel_code] ? fmt$(row.byChannel[ch.channel_code]) : '—'}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function useTopItems(channelItems: DashboardData['channelItems'], n: number) {
  return useMemo(() => {
    const totals: Record<string, number> = {};
    const byChannel: Record<string, Record<string, number>> = {};
    channelItems.forEach(r => {
      totals[r.canonical_name] = (totals[r.canonical_name] ?? 0) + r.revenue;
      if (!byChannel[r.canonical_name]) byChannel[r.canonical_name] = {};
      byChannel[r.canonical_name][r.channel_code] = r.revenue;
    });
    return Object.entries(totals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([name]) => ({ name, byChannel: byChannel[name] ?? {} }));
  }, [channelItems]);
}
