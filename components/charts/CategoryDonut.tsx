'use client';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';

const PALETTE = ['#7c3aed', '#7cb9ef', '#f59e0b', '#16a34a', '#ef4444', '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1'];

interface CategoryDonutDatum { name: string; value: number; qty: number; pct: number }

export default function CategoryDonut({ data }: { data: CategoryDonutDatum[] }) {
  const chartData = data.map((r, i) => ({ ...r, fill: PALETTE[i % PALETTE.length] }));
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
                <div>{p.qty.toLocaleString('en-US')} qty</div>
                <div style={{ color: 'var(--muted)' }}>{p.pct.toFixed(1)}% of total revenue</div>
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
