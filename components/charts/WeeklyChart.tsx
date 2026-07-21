'use client';
import { useState, useMemo } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Label,
} from 'recharts';
import type { WeekRow, DailyRow, FiscalPeriodRow } from '@/lib/types';
import { fiscalWeekLabel } from '@/lib/fiscal';

type Mode = 'daily' | 'weekly' | 'periodic';

const fmtK = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;

export default function WeeklyChart({
  weekly, daily, periods,
}: { weekly: WeekRow[]; daily: DailyRow[]; periods: FiscalPeriodRow[] }) {
  const [mode, setMode] = useState<Mode>('weekly');

  const chartData = useMemo(() => {
    let raw: { label: string; revenue: number; qty: number }[];
    if (mode === 'daily') {
      raw = daily.map(r => ({ label: r.date.slice(5), revenue: r.revenue, qty: r.qty }));
    } else if (mode === 'periodic') {
      const map = new Map<string, { revenue: number; qty: number; period: number; fy: number }>();
      weekly.forEach(r => {
        const wMs = new Date(r.week_start + 'T00:00:00').getTime();
        const p = periods.find(fp => {
          const s = new Date(fp.start_date + 'T00:00:00').getTime();
          const e = new Date(fp.end_date   + 'T00:00:00').getTime();
          return wMs >= s && wMs <= e;
        });
        const key = p ? `P${p.period} ${p.fiscal_year}` : r.week_start.slice(0, 7);
        const entry = map.get(key) ?? { revenue: 0, qty: 0, period: p?.period ?? 99, fy: p?.fiscal_year ?? 0 };
        entry.revenue += r.revenue;
        entry.qty     += r.qty;
        map.set(key, entry);
      });
      raw = [...map.entries()]
        .sort((a, b) => a[1].fy !== b[1].fy ? a[1].fy - b[1].fy : a[1].period - b[1].period)
        .map(([label, v]) => ({ label, revenue: v.revenue, qty: v.qty }));
    } else {
      // weekly mode
      raw = weekly.map(r => ({
        label:   fiscalWeekLabel(r.week_start, periods),
        revenue: r.revenue,
        qty:     r.qty,
      }));
    }
    // % of the total revenue across the currently visible range (daily/weekly/periodic)
    const total = raw.reduce((s, r) => s + r.revenue, 0);
    return raw.map(r => ({ ...r, pct: total > 0 ? (r.revenue / total) * 100 : 0 }));
  }, [mode, weekly, daily, periods]);

  const xLabel = mode === 'daily' ? 'Date' : mode === 'weekly' ? 'Fiscal Week' : 'Fiscal Period';

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <div style={{ display: 'flex', gap: 12, fontSize: 9, color: 'var(--muted)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: '#c4b5fd', display: 'inline-block' }} />
            Revenue
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 16, height: 2, background: '#f5a623', display: 'inline-block' }} />
            Qty
          </span>
        </div>
        <select
          className="fb-sel"
          value={mode}
          onChange={e => setMode(e.target.value as Mode)}
          style={{ fontSize: 10, height: 26, padding: '2px 7px' }}
        >
          <option value="daily">Daily Trend</option>
          <option value="weekly">Weekly Trend</option>
          <option value="periodic">Periodic Trend</option>
        </select>
      </div>
      <ResponsiveContainer width="100%" height={155}>
        <ComposedChart data={chartData} margin={{ top: 4, right: 40, left: 4, bottom: 24 }}>
          <CartesianGrid stroke="#f3f4f6" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 9 }} tickLine={false} axisLine={false}
            interval="preserveStartEnd" minTickGap={28}>
            <Label value={xLabel} position="insideBottom" offset={-12} style={{ fontSize: 9, fill: '#94a3b8' }} />
          </XAxis>
          <YAxis yAxisId="left" tickFormatter={fmtK} tick={{ fontSize: 9 }} tickLine={false} axisLine={false} width={58} />
          <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} width={36} />
          <Tooltip
            content={({ payload, label }) => {
              const p = payload?.[0]?.payload as { revenue: number; qty: number; pct: number } | undefined;
              if (!p) return null;
              return (
                <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 11 }}>
                  <div style={{ fontWeight: 700, marginBottom: 3 }}>{label}</div>
                  <div>${p.revenue.toLocaleString()}</div>
                  <div>{p.qty.toLocaleString()} qty</div>
                  <div style={{ color: 'var(--muted)' }}>{p.pct.toFixed(1)}% of total revenue</div>
                </div>
              );
            }}
            contentStyle={{ fontSize: 11, borderRadius: 8 }}
          />
          <Bar yAxisId="left" dataKey="revenue" fill="#c4b5fd" radius={[4, 4, 0, 0]} name="revenue" />
          <Line yAxisId="right" dataKey="qty" stroke="#f5a623" dot={{ r: 2 }} strokeWidth={2} name="qty" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
