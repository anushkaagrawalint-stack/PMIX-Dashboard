'use client';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

interface HBarChartProps {
  data: { name: string; value: number; qty?: number; pct?: number }[];
  color?: string;
  formatter?: (v: number) => string;
  height?: number;
}

export default function HBarChart({ data, color = '#9f7cef', formatter, height = 220 }: HBarChartProps) {
  const fmt = formatter ?? ((v: number) => `$${Math.round(v).toLocaleString('en-US')}`);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 40, left: 0, bottom: 0 }}>
        <CartesianGrid horizontal={false} stroke="#f3f4f6" />
        <XAxis type="number" tickFormatter={fmt} tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey="name" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} width={120} />
        <Tooltip
          content={({ payload }) => {
            const p = payload?.[0]?.payload as { name: string; value: number; qty?: number; pct?: number } | undefined;
            if (!p) return null;
            return (
              <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 11 }}>
                <div style={{ fontWeight: 700, marginBottom: 3 }}>{p.name}</div>
                <div>{fmt(p.value)}</div>
                {p.qty !== undefined && <div>{p.qty.toLocaleString('en-US')} qty</div>}
                {p.pct !== undefined && <div style={{ color: 'var(--muted)' }}>{p.pct.toFixed(1)}% of total revenue</div>}
              </div>
            );
          }}
          contentStyle={{ fontSize: 11, borderRadius: 8 }}
        />
        <Bar dataKey="value" fill={color} radius={[0, 3, 3, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
