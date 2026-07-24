'use client';
import { useState, useMemo, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import type { PaymentRow, PaymentByLocationRow, PaymentSourceLocationRow } from '@/lib/types';

const HBarChart = dynamic(() => import('../charts/HBarChart'), { ssr: false });

const fmt$  = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;
const fmt$2 = (v: number) => `$${v.toFixed(2)}`;

const CAT_COLORS: Record<string, string> = {
  'Card':        '#6366f1',
  'Alt Payment': '#f5a623',
};

type Basis = 'event' | 'paid';
const DEFAULT_STATUSES = ['CAPTURED', 'AUTHORIZED'];
const ALL_STATUSES = ['CAPTURED', 'AUTHORIZED', 'DENIED', 'VOIDED'];
const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

export default function PaymentSource({ payments, paymentsByLocation, paymentSourcesByLocation, selectedLocations = [], dateStart, dateEnd }: {
  payments: PaymentRow[]; paymentsByLocation: PaymentByLocationRow[]; paymentSourcesByLocation: PaymentSourceLocationRow[];
  selectedLocations?: string[]; dateStart: string; dateEnd: string;
}) {
  const [search, setSearch] = useState('');
  const [basis, setBasis] = useState<Basis>('event');
  const [statuses, setStatuses] = useState<string[]>(DEFAULT_STATUSES);
  const [statusOpen, setStatusOpen] = useState(false);
  const isDefault = basis === 'event' && statuses.length === DEFAULT_STATUSES.length
    && DEFAULT_STATUSES.every(s => statuses.includes(s));
  const statusLabel = statuses.length === ALL_STATUSES.length
    ? 'All Statuses'
    : statuses.map(titleCase).join(' + ');

  // PAYMENT_BASIS_TOGGLE_SPEC.md Part B.2: the default view stays the props
  // passed down from loadDashboardData (unchanged first paint); any other
  // basis/status combo fetches from /api/payments on demand. `fetched` tags
  // its own basis/statuses so staleness (and therefore the loading state) is
  // derived during render rather than tracked with a separate setState call
  // at the top of the effect (matches AdminPanel.tsx's loadFiles pattern).
  const statusesKey = statuses.join(',');
  const [fetched, setFetched] = useState<{
    basis: Basis; statusesKey: string;
    payments: PaymentRow[]; paymentsByLocation: PaymentByLocationRow[];
    paymentSourcesByLocation: PaymentSourceLocationRow[];
    deniedVoided: { count: number; amount: number };
  } | null>(null);

  useEffect(() => {
    if (isDefault) return; // no fetch needed — activePayments falls back to props below
    let cancelled = false;
    const params = new URLSearchParams({ start: dateStart, end: dateEnd, basis, statuses: statusesKey });
    fetch(`/api/payments?${params}`)
      .then(r => r.json())
      .then(json => { if (!cancelled) setFetched({ ...json, basis, statusesKey }); })
      .catch(err => console.error('payments fetch error:', err));
    return () => { cancelled = true; };
  }, [basis, statusesKey, dateStart, dateEnd, isDefault]);

  function toggleStatus(s: string) {
    setStatuses(prev => {
      if (prev.includes(s)) return prev.length > 1 ? prev.filter(x => x !== s) : prev;
      return [...prev, s];
    });
  }

  const isStale   = !fetched || fetched.basis !== basis || fetched.statusesKey !== statusesKey;
  const useFetched = !isDefault && !isStale;
  const loading    = !isDefault && isStale;
  const activePayments                 = useFetched ? fetched!.payments : payments;
  const activePaymentsByLocation       = useFetched ? fetched!.paymentsByLocation : paymentsByLocation;
  const activePaymentSourcesByLocation = useFetched ? fetched!.paymentSourcesByLocation : paymentSourcesByLocation;
  const deniedVoided = useFetched ? fetched!.deniedVoided : undefined;
  const showDeniedVoidedWarning = statuses.includes('DENIED') || statuses.includes('VOIDED');

  // When a location is selected, re-aggregate payment sources from per-location data
  const effectivePayments = useMemo<PaymentRow[]>(() => {
    if (selectedLocations.length === 0) return activePayments;
    const rows = activePaymentSourcesByLocation.filter(r => selectedLocations.includes(r.location_code));
    const map = new Map<string, { count: number; amount: number; tip: number; fees: number; withholdings: number; refunded: number; category: string }>();
    rows.forEach(r => {
      const e = map.get(r.payment_source) ?? { count: 0, amount: 0, tip: 0, fees: 0, withholdings: 0, refunded: 0, category: r.category };
      e.count        += r.payment_count;
      e.amount       += r.total_amount;
      e.tip          += r.tip_amount;
      e.fees         += r.fees;
      e.withholdings += r.withholdings;
      e.refunded     += r.refunded_amount;
      map.set(r.payment_source, e);
    });
    const grand = [...map.values()].reduce((s, v) => s + v.amount, 0);
    return [...map.entries()]
      .sort((a, b) => b[1].amount - a[1].amount)
      .map(([source, v]) => ({
        payment_source:  source,
        payment_count:   v.count,
        total_amount:    v.amount,
        tip_amount:      v.tip,
        fees:            v.fees,
        withholdings:    v.withholdings,
        refunded_amount: v.refunded,
        pct:             grand > 0 ? Math.round(v.amount / grand * 1000) / 10 : 0,
        category:        v.category,
      }));
  }, [activePayments, activePaymentSourcesByLocation, selectedLocations]);

  const filtered = effectivePayments.filter(p =>
    !search || p.payment_source.toLowerCase().includes(search.toLowerCase()),
  );

  const totalRevenue  = effectivePayments.reduce((s, p) => s + p.total_amount, 0);
  const totalTxns     = effectivePayments.reduce((s, p) => s + p.payment_count, 0);
  const totalTip      = effectivePayments.reduce((s, p) => s + p.tip_amount, 0);
  const totalFees     = effectivePayments.reduce((s, p) => s + p.fees, 0);
  const totalWithholdings = effectivePayments.reduce((s, p) => s + p.withholdings, 0);
  const totalRefunded = effectivePayments.reduce((s, p) => s + p.refunded_amount, 0);
  const cardRevenue   = effectivePayments.filter(p => p.category === 'Card').reduce((s, p) => s + p.total_amount, 0);
  const cardTip       = effectivePayments.filter(p => p.category === 'Card').reduce((s, p) => s + p.tip_amount, 0);
  const cardFees      = effectivePayments.filter(p => p.category === 'Card').reduce((s, p) => s + p.fees, 0);
  const cardWithholdings = effectivePayments.filter(p => p.category === 'Card').reduce((s, p) => s + p.withholdings, 0);
  const cardRefunded  = effectivePayments.filter(p => p.category === 'Card').reduce((s, p) => s + p.refunded_amount, 0);
  const cardAmountPlusTip = cardRevenue + cardTip;
  const cardNet       = cardAmountPlusTip - cardFees - cardWithholdings - cardRefunded;
  const altRevenue    = effectivePayments.filter(p => p.category !== 'Card').reduce((s, p) => s + p.total_amount, 0);
  const avgTicket     = totalTxns > 0 ? totalRevenue / totalTxns : 0;
  const amountPlusTip = totalRevenue + totalTip;
  const netAfterFeesAndRefunds = amountPlusTip - totalFees - totalWithholdings - totalRefunded;

  // Donut: Card vs Alt Payment
  const donutData = useMemo(() => {
    const map: Record<string, { amount: number; count: number }> = {};
    effectivePayments.forEach(p => {
      const cat = p.category || 'Other';
      if (!map[cat]) map[cat] = { amount: 0, count: 0 };
      map[cat].amount += p.total_amount;
      map[cat].count  += p.payment_count;
    });
    return Object.entries(map).map(([name, v]) => ({
      name,
      value: v.amount,
      count: v.count,
      pct:   totalRevenue > 0 ? (v.amount / totalRevenue * 100).toFixed(1) : '0',
      color: CAT_COLORS[name] ?? '#9ca3af',
    }));
  }, [effectivePayments, totalRevenue]);

  // Horizontal bar: top 10 sources by revenue
  const barData = useMemo(() =>
    [...effectivePayments]
      .sort((a, b) => b.total_amount - a.total_amount)
      .slice(0, 10)
      .map(p => ({
        name:  p.payment_source.length > 22 ? p.payment_source.slice(0, 20) + '…' : p.payment_source,
        value: p.total_amount,
      })),
  [effectivePayments]);

  // Avg ticket per category
  const avgByCategory = useMemo(() => {
    const map: Record<string, { amount: number; count: number }> = {};
    effectivePayments.forEach(p => {
      const cat = p.category || 'Other';
      if (!map[cat]) map[cat] = { amount: 0, count: 0 };
      map[cat].amount += p.total_amount;
      map[cat].count  += p.payment_count;
    });
    return map;
  }, [effectivePayments]);

  // Location stacked bar data — filtered by selectedLocations when active
  const locBarData = useMemo(() => {
    const rows = selectedLocations.length > 0
      ? activePaymentsByLocation.filter(l => selectedLocations.includes(l.location_code))
      : activePaymentsByLocation;
    return [...rows]
      .sort((a, b) => b.total_amount - a.total_amount)
      .map(l => ({
        name:  l.display_name.length > 20 ? l.display_name.slice(0, 18) + '…' : l.display_name,
        Card:  l.card_amount,
        Alt:   l.alt_amount,
        total: l.total_amount,
      }));
  }, [activePaymentsByLocation, selectedLocations]);

  return (
    <div>
      {/* ── Basis toggle + status filter — matches the app's filter-bar look (fb/drw/drm) ── */}
      <div className="fb">
        <div className="fb-r">
          <span className="fb-lbl">Basis</span>
          <div className="tgl-g">
            <button className={`tgl ${basis === 'event' ? 'on' : ''}`} onClick={() => setBasis('event')}>Business Date</button>
            <button className={`tgl ${basis === 'paid' ? 'on' : ''}`} onClick={() => setBasis('paid')}>Paid Date</button>
          </div>

          <div className="fb-sep" />
          <span className="fb-lbl">Status</span>
          <div className="drw" style={{ position: 'relative' }}>
            <button className="drb" onClick={() => setStatusOpen(o => !o)} style={{ minWidth: 150 }}>
              {statusLabel}
              <i className="ti ti-chevron-down" style={{ fontSize: 11 }} />
            </button>
            {statusOpen && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 199 }} onClick={() => setStatusOpen(false)} />
                <div className="drm open" style={{ minWidth: 170, zIndex: 200 }}>
                  {ALL_STATUSES.map(s => (
                    <label key={s} className="dr-it" style={{ gap: 8, userSelect: 'none' }}>
                      <input type="checkbox" checked={statuses.includes(s)} onChange={() => toggleStatus(s)} style={{ accentColor: 'var(--accent)' }} />
                      {titleCase(s)}
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>

          {loading && <span style={{ fontSize: 10, color: 'var(--muted)' }}>Refreshing…</span>}
        </div>

        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 8 }}>
          {basis === 'event'
            ? "Payments on the order's business date — catering on the event date. Matches revenue attribution on all other tabs."
            : "Payments on the day the money was collected. Matches Toast's Payments report."}
        </div>
        {basis === 'paid' && (
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
            Catering deposits appear here on their collection date, not the event date.
          </div>
        )}
        {showDeniedVoidedWarning && deniedVoided && deniedVoided.count > 0 && (
          <div style={{
            fontSize: 11, fontWeight: 600, color: '#92400e', background: '#fef3c7',
            border: '1px solid #fde68a', borderRadius: 6, padding: '6px 10px', marginTop: 10,
          }}>
            Includes {deniedVoided.count.toLocaleString()} denied/voided payment{deniedVoided.count === 1 ? '' : 's'} ({fmt$(deniedVoided.amount)}) — money that was never collected.
          </div>
        )}
      </div>

      {/* ── KPI row ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 12 }}>
        <div className="kc" style={{ borderLeft: '3px solid var(--accent)', borderLeftStyle: 'solid' }}>
          <div className="kl">Total Payments</div>
          <div className="kv">{totalTxns.toLocaleString()}</div>
          <div className="ks">transactions</div>
        </div>
        <div className="kc r" style={{ borderLeft: '3px solid #dc2626', borderLeftStyle: 'solid' }}>
          <div className="kl">Refunded</div>
          <div className="kv">{fmt$(totalRefunded)}</div>
        </div>
        <div className="kc" style={{ borderLeft: '3px solid #6366f1', borderLeftStyle: 'solid' }}>
          <div className="kl">Card</div>
          <div className="kv">{fmt$(cardAmountPlusTip)}</div>
          <div className="ks">
            {((cardRevenue / totalRevenue) * 100).toFixed(1)}% · avg {fmt$2(avgByCategory['Card']?.count ? avgByCategory['Card'].amount / avgByCategory['Card'].count : 0)}
          </div>
        </div>
        <div className="kc" style={{ borderLeft: '3px solid #f5a623', borderLeftStyle: 'solid' }}>
          <div className="kl">Alt Payments</div>
          <div className="kv">{fmt$(altRevenue)}</div>
          <div className="ks">
            {((altRevenue / totalRevenue) * 100).toFixed(1)}% · avg {fmt$2(avgByCategory['Alt Payment']?.count ? avgByCategory['Alt Payment'].amount / avgByCategory['Alt Payment'].count : 0)}
          </div>
        </div>
        <div className="kc" style={{ borderLeft: '3px solid #10b981', borderLeftStyle: 'solid' }}>
          <div className="kl">Avg Ticket</div>
          <div className="kv">{fmt$2(avgTicket)}</div>
          <div className="ks">across all payment types</div>
        </div>
        <div className="kc" style={{ borderLeft: '3px solid #0ea5e9', borderLeftStyle: 'solid' }}>
          <div className="kl">Amount + Tip</div>
          <div className="kv">{fmt$(amountPlusTip)}</div>
          <div className="ks">gross charged, tip included</div>
        </div>
        <div className="kc" style={{ borderLeft: '3px solid #f97316', borderLeftStyle: 'solid' }}>
          <div className="kl">Fees</div>
          <div className="kv">{fmt$(totalFees)}</div>
          <div className="ks">processing fees</div>
        </div>
        <div className="kc" style={{ borderLeft: '3px solid #a855f7', borderLeftStyle: 'solid' }}>
          <div className="kl">Withholdings</div>
          <div className="kv">{fmt$(totalWithholdings)}</div>
          <div className="ks">merchant cash advance repayment, held from payout</div>
        </div>
        <div className="kc" style={{ borderLeft: '3px solid #16a34a', borderLeftStyle: 'solid' }}>
          <div className="kl">Net (Amt+Tip−Fees−Withholdings−Refunds)</div>
          <div className="kv">{fmt$(netAfterFeesAndRefunds)}</div>
        </div>
        <div className="kc" style={{ borderLeft: '3px solid #4338ca', borderLeftStyle: 'solid' }}>
          <div className="kl">Card Net</div>
          <div className="kv">{fmt$(cardNet)}</div>
          <div className="ks">card only: amt+tip−fees−withholdings−refunds</div>
        </div>
      </div>

      {/* ── Charts row ── */}
      <div className="gr22" style={{ marginBottom: 12 }}>
        {/* Donut: card vs alt */}
        <div className="cc">
          <h3>Card vs Alt Payment split</h3>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={donutData} cx="40%" cy="50%"
                innerRadius={60} outerRadius={85}
                dataKey="value" stroke="none"
                paddingAngle={3}
              >
                {donutData.map((e, i) => <Cell key={i} fill={e.color} />)}
              </Pie>
              <Tooltip
                content={({ payload }) => {
                  const p = payload?.[0]?.payload as typeof donutData[0] | undefined;
                  if (!p) return null;
                  return (
                    <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 11 }}>
                      <div style={{ fontWeight: 700, color: p.color, marginBottom: 4 }}>{p.name}</div>
                      <div>{fmt$(p.value)}</div>
                      <div style={{ color: 'var(--muted)' }}>{p.pct}% of total</div>
                      <div style={{ color: 'var(--muted)' }}>{p.count.toLocaleString()} txns</div>
                    </div>
                  );
                }}
              />
              <Legend
                iconType="circle" iconSize={9}
                layout="vertical" align="right" verticalAlign="middle"
                formatter={(val, entry) => {
                  const d = entry.payload as typeof donutData[0];
                  return (
                    <span style={{ fontSize: 10 }}>
                      {val} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>· {d?.pct}%</span>
                    </span>
                  );
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Horizontal bar: top sources */}
        <div className="cc">
          <h3>Top 10 sources by revenue</h3>
          <HBarChart data={barData} color="#6366f1" height={220} />
        </div>
      </div>

      {/* ── Location breakdown ── */}
      {locBarData.length > 0 && (
        <div className="cc" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <h3 style={{ margin: 0 }}>Revenue by location</h3>
            <div style={{ display: 'flex', gap: 10, fontSize: 10, color: 'var(--muted)', alignItems: 'center' }}>
              <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#6366f1', marginRight: 4 }} />Card</span>
              <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#f5a623', marginRight: 4 }} />Alt Payment</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={Math.max(180, locBarData.length * 28)}>
            <BarChart data={locBarData} layout="vertical" margin={{ top: 0, right: 56, left: 0, bottom: 0 }}>
              <CartesianGrid horizontal={false} stroke="#f3f4f6" />
              <XAxis type="number" tickFormatter={v => `$${Math.round(v).toLocaleString('en-US')}`} tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} width={120} />
              <Tooltip
                content={({ payload, label }) => {
                  if (!payload?.length) return null;
                  const card = (payload.find(p => p.dataKey === 'Card')?.value as number) ?? 0;
                  const alt  = (payload.find(p => p.dataKey === 'Alt')?.value  as number) ?? 0;
                  const tot  = card + alt;
                  return (
                    <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 11 }}>
                      <div style={{ fontWeight: 700, marginBottom: 4 }}>{label}</div>
                      <div style={{ color: '#6366f1' }}>Card: {fmt$(card)} ({tot > 0 ? (card / tot * 100).toFixed(1) : 0}%)</div>
                      <div style={{ color: '#f5a623' }}>Alt:  {fmt$(alt)}  ({tot > 0 ? (alt  / tot * 100).toFixed(1) : 0}%)</div>
                      <div style={{ borderTop: '1px solid #e5e7eb', marginTop: 4, paddingTop: 4, fontWeight: 600 }}>Total: {fmt$(tot)}</div>
                    </div>
                  );
                }}
              />
              <Bar dataKey="Card" stackId="a" fill="#6366f1" radius={[0, 0, 0, 0]} />
              <Bar dataKey="Alt"  stackId="a" fill="#f5a623" radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Table ── */}
      <div style={{ background: 'var(--card)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
          <h3 style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', margin: 0 }}>
            Payment sources · {filtered.length} shown
          </h3>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search…"
            style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 11, width: 160, fontFamily: 'inherit', outline: 'none' }}
          />
        </div>
        <div className="tscroll">
          <table>
            <thead>
              <tr>
                <th>Source</th>
                <th>Type</th>
                <th>Transactions</th>
                <th>Revenue</th>
                <th>Avg Ticket</th>
                <th>Revenue Mix (%)</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => {
                const avg = p.payment_count > 0 ? p.total_amount / p.payment_count : 0;
                const revenue = p.total_amount + p.tip_amount - p.withholdings - p.refunded_amount - p.fees;
                return (
                  <tr key={p.payment_source}>
                    <td style={{ fontWeight: 600 }}>{p.payment_source}</td>
                    <td>
                      <span style={{
                        fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                        background: p.category === 'Card' ? '#e0e7ff' : '#fef3c7',
                        color: p.category === 'Card' ? '#3730a3' : '#92400e',
                        textTransform: 'uppercase',
                      }}>{p.category}</span>
                    </td>
                    <td>{p.payment_count.toLocaleString()}</td>
                    <td style={{ fontWeight: 600 }}>{fmt$(revenue)}</td>
                    <td>{fmt$2(avg)}</td>
                    <td>{p.pct}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
