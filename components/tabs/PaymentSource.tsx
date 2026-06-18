'use client';
import { useState } from 'react';
import type { PaymentRow } from '@/lib/types';

const fmt$ = (v: number) =>
  v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M`
  : v >= 1_000   ? `$${(v / 1_000).toFixed(0)}K`
  : `$${v.toFixed(2)}`;

export default function PaymentSource({ payments }: { payments: PaymentRow[] }) {
  const [search, setSearch] = useState('');
  const filtered = payments.filter(p =>
    !search || p.payment_source.toLowerCase().includes(search.toLowerCase())
  );

  const totalRevenue = payments.reduce((s, p) => s + p.total_amount, 0);
  const cardRevenue  = payments.filter(p => p.category === 'Card').reduce((s, p) => s + p.total_amount, 0);
  const altRevenue   = payments.filter(p => p.category !== 'Card').reduce((s, p) => s + p.total_amount, 0);

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 12 }}>
        <div style={{ background: 'var(--card)', borderRadius: 'var(--radius)', padding: '14px 16px', boxShadow: 'var(--shadow)', borderLeft: '3px solid var(--accent)' }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 5 }}>Total Payments</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{fmt$(totalRevenue)}</div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>{payments.reduce((s, p) => s + p.payment_count, 0).toLocaleString()} transactions</div>
        </div>
        <div style={{ background: 'var(--card)', borderRadius: 'var(--radius)', padding: '14px 16px', boxShadow: 'var(--shadow)', borderLeft: '3px solid #7cb9ef' }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 5 }}>Card Payments</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{fmt$(cardRevenue)}</div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>{((cardRevenue / totalRevenue) * 100).toFixed(1)}% of total</div>
        </div>
        <div style={{ background: 'var(--card)', borderRadius: 'var(--radius)', padding: '14px 16px', boxShadow: 'var(--shadow)', borderLeft: '3px solid #f5a623' }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 5 }}>Alt Payments</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{fmt$(altRevenue)}</div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>{((altRevenue / totalRevenue) * 100).toFixed(1)}% of total</div>
        </div>
      </div>

      <div style={{ background: 'var(--card)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
          <h3 style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', margin: 0 }}>Payment sources</h3>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
            style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 11, width: 160, fontFamily: 'inherit', outline: 'none' }} />
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr>
              <th>Source</th><th>Type</th><th>Transactions</th><th>Revenue</th><th>Avg Ticket</th><th>% of Total</th><th>Share</th>
            </tr></thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.payment_source}>
                  <td style={{ fontWeight: 600 }}>{p.payment_source}</td>
                  <td>
                    <span style={{
                      fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                      background: p.category === 'Card' ? '#dbeafe' : '#fef3c7',
                      color: p.category === 'Card' ? '#1e40af' : '#92400e',
                      textTransform: 'uppercase',
                    }}>{p.category}</span>
                  </td>
                  <td>{p.payment_count.toLocaleString()}</td>
                  <td style={{ fontWeight: 600 }}>{fmt$(p.total_amount)}</td>
                  <td>${(p.total_amount / Math.max(p.payment_count, 1)).toFixed(2)}</td>
                  <td>{p.pct}%</td>
                  <td style={{ width: 100 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <div style={{ flex: 1, background: '#e5e7eb', borderRadius: 3, height: 5, minWidth: 40, overflow: 'hidden' }}>
                        <div style={{ height: '100%', borderRadius: 3, background: 'var(--accent)', width: `${p.pct}%` }} />
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
