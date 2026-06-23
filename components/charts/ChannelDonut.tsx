'use client';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { CHANNEL_LABEL, CHANNEL_COLOR } from '@/lib/constants';
import type { ChannelRow } from '@/lib/types';

export default function ChannelDonut({ data }: { data: ChannelRow[] }) {
  const chartData = data.map(r => ({
    name:  CHANNEL_LABEL[r.channel] ?? r.channel,
    value: r.revenue,
    pct:   r.pct,
    fill:  CHANNEL_COLOR[r.channel] ?? '#9ca3af',
  }));
  return (
    <ResponsiveContainer width="100%" height={160}>
      <PieChart>
        <Pie data={chartData} cx="40%" cy="50%" innerRadius={45} outerRadius={65}
          dataKey="value" stroke="none">
          {chartData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
        </Pie>
        <Tooltip
          formatter={(v, _n, entry) => {
            const rev = typeof v === 'number' ? v : 0;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const pct = (entry as any)?.payload?.pct ?? 0;
            return [`$${Math.round(rev).toLocaleString('en-US')} (${pct}%)`, ''];
          }}
          contentStyle={{ fontSize: 11, borderRadius: 8 }}
        />
        <Legend iconType="square" iconSize={8}
          formatter={(val) => <span style={{ fontSize: 9 }}>{val}</span>}
          layout="vertical" align="right" verticalAlign="middle"
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
