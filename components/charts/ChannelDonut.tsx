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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          content={({ payload }) => {
            const p = payload?.[0]?.payload as any;
            if (!p) return null;
            return (
              <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 11 }}>
                <div style={{ fontWeight: 700, marginBottom: 3, color: p.fill }}>{p.name}</div>
                <div>${Math.round(p.value).toLocaleString('en-US')}</div>
                <div style={{ color: 'var(--muted)' }}>{p.pct}% of total</div>
              </div>
            );
          }}
        />
        <Legend iconType="square" iconSize={8}
          formatter={(val) => <span style={{ fontSize: 9 }}>{val}</span>}
          layout="vertical" align="right" verticalAlign="middle"
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
