'use client';
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import type { WeekRow } from '@/lib/types';

const fmtK = (v: number) => `$${(v / 1000).toFixed(0)}K`;

export default function WeeklyChart({ data }: { data: WeekRow[] }) {
  const chartData = data.map(r => ({
    week: r.week_start.slice(5),   // "MM-DD"
    revenue: r.revenue,
    qty: r.qty,
  }));
  return (
    <ResponsiveContainer width="100%" height={170}>
      <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="#f3f4f6" vertical={false} />
        <XAxis dataKey="week" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
        <YAxis yAxisId="left" tickFormatter={fmtK} tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
        <Tooltip
          formatter={(v, name) => {
            const n = typeof v === 'number' ? v : 0;
            return [name === 'revenue' ? fmtK(n) : n.toLocaleString(), String(name)];
          }}
          contentStyle={{ fontSize: 11, borderRadius: 8 }}
        />
        <Bar yAxisId="left" dataKey="revenue" fill="#c4b5fd" radius={[4, 4, 0, 0]} name="Revenue" />
        <Line yAxisId="right" dataKey="qty" stroke="#f5a623" dot={{ r: 3 }} strokeWidth={2} name="Qty" />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
