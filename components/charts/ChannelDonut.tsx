'use client';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { CHANNELS } from '@/lib/constants';
import type { ChannelRow } from '@/lib/types';

const COLOR_MAP: Record<string, string> = {
  IN_HOUSE: '#9f7cef', CATERING: '#f5a623', TPD: '#ef7ccf',
  APP: '#7cb9ef', OFFSITE: '#2ec4b6', OTHER: '#9ca3af',
};
const LABEL_MAP: Record<string, string> = {
  IN_HOUSE: 'In-House', CATERING: 'Catering', TPD: '3PD',
  APP: 'App', OFFSITE: 'Offsites', OTHER: 'Other',
};

export default function ChannelDonut({ data }: { data: ChannelRow[] }) {
  const chartData = data.map(r => ({
    name: LABEL_MAP[r.channel_code] ?? r.channel_code,
    value: r.revenue,
    pct: r.pct,
    fill: COLOR_MAP[r.channel_code] ?? '#9ca3af',
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
            return [`$${(rev / 1000).toFixed(0)}K (${pct}%)`, ''];
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
