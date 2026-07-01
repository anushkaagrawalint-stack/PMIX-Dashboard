'use client';
import { useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { CHANNEL_LABEL, CHANNEL_COLOR } from '@/lib/constants';
import type { ChannelRow, ChannelItemRow, ChannelCategoryRow, MERow } from '@/lib/types';

const HBarChart = dynamic(() => import('../charts/HBarChart'), { ssr: false });

interface Props {
  channels:          ChannelRow[];
  channelItems:      ChannelItemRow[];
  channelCategories: ChannelCategoryRow[];
  meItems:           MERow[];
}

const fmt$ = (v: number) =>
  `$${Math.round(v).toLocaleString('en-US')}`;

type SortKey = 'total' | 'inhouse' | 'tpd' | 'app';

export default function ChannelsTab({ channels, channelItems, channelCategories, meItems }: Props) {
  const [sort, setSort] = useState<SortKey>('total');
  const [desc, setDesc] = useState(true);

  function toggleSort(key: SortKey) {
    if (sort === key) setDesc(d => !d);
    else { setSort(key); setDesc(true); }
  }
  const arrow = (key: SortKey) => sort === key ? (desc ? ' ↓' : ' ↑') : '';

  // Per-channel category data for charts
  const catForChannel = (code: string) =>
    channelCategories
      .filter(cc => cc.channel === code)
      .map(cc => ({ name: cc.category, value: cc.revenue }));

  // Item-level channel split
  const itemData = useMemo(() => {
    const map = new Map<string, { name: string; quadrant: string; inhouse: number; tpd: number; app: number; total: number }>();
    channelItems.forEach(ci => {
      if (!map.has(ci.canonical_name)) {
        const me = meItems.find(m => m.canonical_name === ci.canonical_name);
        map.set(ci.canonical_name, {
          name: ci.canonical_name,
          quadrant: me?.quadrant ?? 'Dog',
          inhouse: 0, tpd: 0, app: 0, total: 0,
        });
      }
      const item = map.get(ci.canonical_name)!;
      if (ci.channel === 'IN_HOUSE') item.inhouse += ci.revenue;
      else if (ci.channel === 'TPD')   item.tpd    += ci.revenue;
      else if (ci.channel === 'APP')   item.app    += ci.revenue;
      item.total = item.inhouse + item.tpd + item.app;
    });

    const arr = [...map.values()];
    arr.sort((a, b) => {
      const mul = desc ? -1 : 1;
      return mul * (a[sort] - b[sort]);
    });
    return arr.slice(0, 50);
  }, [channelItems, meItems, sort, desc]);

  const inHouseCats  = catForChannel('IN_HOUSE');
  const tpdCats      = catForChannel('TPD');
  const appCats      = catForChannel('APP');
  const cateringCats = catForChannel('CATERING');
  const offsiteCats  = catForChannel('OFFSITE');

  return (
    <div>
      {/* Channel KPI cards */}
      <div className="krow" style={{ gridTemplateColumns: `repeat(${channels.length}, 1fr)` }}>
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

      {/* Category breakdown charts — row 1: In-House, 3PD, App */}
      {(inHouseCats.length > 0 || tpdCats.length > 0 || appCats.length > 0) && (
        <div className="gr3">
          {inHouseCats.length > 0 && (
            <div className="cc">
              <h3>In-House by category</h3>
              <div style={{ position: 'relative', height: 200 }}>
                <HBarChart data={inHouseCats} color="#9f7cef" height={200} />
              </div>
            </div>
          )}
          {tpdCats.length > 0 && (
            <div className="cc">
              <h3>3PD by category</h3>
              <div style={{ position: 'relative', height: 200 }}>
                <HBarChart data={tpdCats} color="#ef7ccf" height={200} />
              </div>
            </div>
          )}
          {appCats.length > 0 && (
            <div className="cc">
              <h3>App by category</h3>
              <div style={{ position: 'relative', height: 200 }}>
                <HBarChart data={appCats} color="#7cb9ef" height={200} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Category breakdown charts — row 2: Catering, Offsite */}
      {(cateringCats.length > 0 || offsiteCats.length > 0) && (
        <div className="gr3">
          {cateringCats.length > 0 && (
            <div className="cc">
              <h3>Catering by category</h3>
              <div style={{ position: 'relative', height: 200 }}>
                <HBarChart data={cateringCats} color="#f59e0b" height={200} />
              </div>
            </div>
          )}
          {offsiteCats.length > 0 && (
            <div className="cc">
              <h3>Offsite by category</h3>
              <div style={{ position: 'relative', height: 200 }}>
                <HBarChart data={offsiteCats} color="#10b981" height={200} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Item-level channel split table */}
      <div className="tw">
        <div className="th2">
          <h3>Top 50 items · channel split</h3>
        </div>
        <div className="tscroll">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>ME</th>
                <th style={{ cursor: 'pointer', color: sort === 'total' ? 'var(--accent)' : undefined }} onClick={() => toggleSort('total')}>Total{arrow('total')}</th>
                <th style={{ cursor: 'pointer', color: sort === 'inhouse' ? 'var(--accent)' : undefined }} onClick={() => toggleSort('inhouse')}>In-House{arrow('inhouse')}</th>
                <th style={{ cursor: 'pointer', color: sort === 'tpd' ? 'var(--accent)' : undefined }} onClick={() => toggleSort('tpd')}>3PD{arrow('tpd')}</th>
                <th style={{ cursor: 'pointer', color: sort === 'app' ? 'var(--accent)' : undefined }} onClick={() => toggleSort('app')}>App{arrow('app')}</th>
                <th>Split</th>
              </tr>
            </thead>
            <tbody>
              {itemData.map(item => {
                const total = item.total || 1;
                const ihPct  = (item.inhouse / total) * 100;
                const tpdPct = (item.tpd    / total) * 100;
                const appPct = (item.app    / total) * 100;
                return (
                  <tr key={item.name}>
                    <td style={{ fontWeight: 600, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.name}
                    </td>
                    <td>
                      <span className={`mb mb-${item.quadrant.split(' ')[0]}`}>{item.quadrant}</span>
                    </td>
                    <td style={{ fontWeight: 600 }}>{fmt$(item.total)}</td>
                    <td style={{ color: item.inhouse > 0 ? 'var(--text)' : 'var(--muted)' }}>
                      {item.inhouse > 0 ? fmt$(item.inhouse) : '—'}
                    </td>
                    <td style={{ color: item.tpd > 0 ? 'var(--text)' : 'var(--muted)' }}>
                      {item.tpd > 0 ? fmt$(item.tpd) : '—'}
                    </td>
                    <td style={{ color: item.app > 0 ? 'var(--text)' : 'var(--muted)' }}>
                      {item.app > 0 ? fmt$(item.app) : '—'}
                    </td>
                    <td style={{ minWidth: 100 }}>
                      <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: '#f3f4f6' }}>
                        {ihPct  > 0 && <div style={{ width: `${ihPct}%`,  background: '#9f7cef' }} />}
                        {tpdPct > 0 && <div style={{ width: `${tpdPct}%`, background: '#ef7ccf' }} />}
                        {appPct > 0 && <div style={{ width: `${appPct}%`, background: '#7cb9ef' }} />}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Legend */}
        <div style={{ padding: '8px 14px', display: 'flex', gap: 16, borderTop: '1px solid var(--border)' }}>
          {[['#9f7cef', 'In-House'], ['#ef7ccf', '3PD'], ['#7cb9ef', 'App']].map(([color, label]) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'var(--muted)' }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: color }} />
              {label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
