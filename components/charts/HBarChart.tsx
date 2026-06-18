'use client';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

interface HBarChartProps {
  data: { name: string; value: number }[];
  color?: string;
  formatter?: (v: number) => string;
  height?: number;
}

export default function HBarChart({ data, color = '#9f7cef', formatter, height = 220 }: HBarChartProps) {
  const fmt = formatter ?? ((v: number) => `$${(v / 1000).toFixed(0)}K`);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 40, left: 0, bottom: 0 }}>
        <CartesianGrid horizontal={false} stroke="#f3f4f6" />
        <XAxis type="number" tickFormatter={fmt} tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey="name" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} width={120} />
        <Tooltip formatter={(v) => [fmt(typeof v === 'number' ? v : 0), 'Revenue']} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
        <Bar dataKey="value" fill={color} radius={[0, 3, 3, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
