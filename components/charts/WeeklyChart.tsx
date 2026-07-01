'use client';
import { useState, useMemo } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Label,
} from 'recharts';
import type { WeekRow, DailyRow, FiscalPeriodRow } from '@/lib/types';

type Mode = 'daily' | 'weekly' | 'periodic';

const fmtK = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;

function fiscalWeekLabel(weekStart: string, periods: FiscalPeriodRow[]): string {
  const wMs = new Date(weekStart + 'T00:00:00').getTime();
  for (const p of periods) {
    const pStart = new Date(p.start_date + 'T00:00:00').getTime();
    const pEnd   = new Date(p.end_date   + 'T00:00:00').getTime();
    if (wMs >= pStart && wMs <= pEnd) {
      const weekNum = Math.floor((wMs - pStart) / (7 * 24 * 3600 * 1000)) + 1;
      return `P${p.period}W${weekNum}`;
    }
  }
  return weekStart.slice(5);
}

export default function WeeklyChart({
  weekly, daily, periods,
}: { weekly: WeekRow[]; daily: DailyRow[]; periods: FiscalPeriodRow[] }) {
  const [mode, setMode] = useState<Mode>('weekly');

  const chartData = useMemo(() => {
    if (mode === 'daily') {
      return daily.map(r => ({ label: r.date.slice(5), revenue: r.revenue, qty: r.qty }));
    }
    if (mode === 'periodic') {
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
      return [...map.entries()]
        .sort((a, b) => a[1].fy !== b[1].fy ? a[1].fy - b[1].fy : a[1].period - b[1].period)
        .map(([label, v]) => ({ label, revenue: v.revenue, qty: v.qty }));
    }
    // weekly mode
    return weekly.map(r => ({
      label:   fiscalWeekLabel(r.week_start, periods),
      revenue: r.revenue,
      qty:     r.qty,
    }));
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
            formatter={(v, name) => {
              const n = typeof v === 'number' ? v : 0;
              return name === 'revenue'
                ? [`$${n.toLocaleString()}`, 'Revenue']
                : [n.toLocaleString(), 'Qty'];
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
