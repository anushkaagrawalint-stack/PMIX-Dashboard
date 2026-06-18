'use client';
import dynamic from 'next/dynamic';
import type { DashboardData } from '@/lib/types';

const WeeklyChart = dynamic(() => import('../charts/WeeklyChart'), { ssr: false });
const ChannelDonut = dynamic(() => import('../charts/ChannelDonut'), { ssr: false });
const HBarChart    = dynamic(() => import('../charts/HBarChart'),    { ssr: false });

const fmt$ = (v: number) =>
  v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M`
  : v >= 1_000   ? `$${(v / 1_000).toFixed(0)}K`
  : `$${v.toFixed(0)}`;

const CHANNEL_LABELS: Record<string, string> = {
  IN_HOUSE: 'In-House', TPD: '3PD Delivery', APP: 'App', OTHER: 'Other',
};

export default function Overview({ data }: { data: DashboardData }) {
  const { summary, channels, weekly, items, categories, avgMargin } = data;

  // Top 8 items — deduplicate by canonical_name
  const top8 = (() => {
    const seen = new Map<string, number>();
    for (const i of items) {
      seen.set(i.canonical_name, (seen.get(i.canonical_name) ?? 0) + i.revenue);
    }
    return [...seen.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, value]) => ({ name: name.slice(0, 22), value }));
  })();

  // Category data — consolidate by category name
  const catMap: Record<string, number> = {};
  categories.forEach(c => { catMap[c.category] = (catMap[c.category] ?? 0) + c.revenue; });
  const catData = Object.entries(catMap)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({ name, value }));

  return (
    <div>
      {/* KPI row */}
      <div className="krow">
        <div className="kc a">
          <div className="kl">Items Sold</div>
          <div className="kv">{Number(summary.total_qty).toLocaleString()}</div>
        </div>
        <div className="kc g">
          <div className="kl">Net Revenue</div>
          <div className="kv">{fmt$(summary.total_revenue)}</div>
        </div>
        <div className="kc b">
          <div className="kl">Unique Items</div>
          <div className="kv">{summary.unique_items}</div>
          <div className="ks">real menu items</div>
        </div>
        <div className="kc p">
          <div className="kl">Avg Margin</div>
          <div className="kv">{(avgMargin * 100).toFixed(1)}%</div>
          <div className="ks">blended · all items</div>
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
          <h3>Weekly sales trend</h3>
          <div style={{ position: 'relative', height: 170 }}>
            <WeeklyChart data={weekly} />
          </div>
        </div>
        <div className="cc">
          <h3>Revenue by channel</h3>
          <div style={{ position: 'relative', height: 180 }}>
            <ChannelDonut data={channels} />
          </div>
        </div>
      </div>

      {/* Charts row 2 */}
      <div className="gr22">
        <div className="cc">
          <h3>Top 8 items by revenue</h3>
          <div style={{ position: 'relative', height: 280 }}>
            <HBarChart data={top8} height={280} />
          </div>
        </div>
        <div className="cc">
          <h3>Revenue by category</h3>
          <div style={{ position: 'relative', height: 280 }}>
            <HBarChart data={catData} color="#7cb9ef" height={280} />
          </div>
        </div>
      </div>

      {/* Channel table */}
      <div className="tw">
        <div className="th2">
          <h3>Channel breakdown</h3>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Channel</th>
                <th>Revenue</th>
                <th>% of Total</th>
                <th>Items Sold</th>
                <th>Share</th>
              </tr>
            </thead>
            <tbody>
              {channels.map(c => (
                <tr key={c.channel_code}>
                  <td style={{ fontWeight: 600 }}>{CHANNEL_LABELS[c.channel_code] ?? c.channel_code}</td>
                  <td>{fmt$(c.revenue)}</td>
                  <td>{c.pct}%</td>
                  <td>{c.qty.toLocaleString()}</td>
                  <td style={{ width: 120 }}>
                    <div className="bw">
                      <div className="bb">
                        <div className="bf" style={{ width: `${c.pct}%` }} />
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
