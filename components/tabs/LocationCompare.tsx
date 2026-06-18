'use client';
import { useMemo, useState } from 'react';
import type { DashboardData } from '@/lib/types';
import { LOC_COLOR_PALETTE } from '@/lib/constants';

const fmt$ = (v: number) => `$${(v / 1000).toFixed(0)}K`;

export default function LocationCompare({ data }: { data: DashboardData }) {
  const { locationItems, items, locations } = data;

  // Assign a stable color to each location by its position in the DB-ordered list
  const locMeta = useMemo(
    () => locations.map((l, i) => ({ ...l, color: LOC_COLOR_PALETTE[i % LOC_COLOR_PALETTE.length] })),
    [locations],
  );

  const [metric, setMetric] = useState<'mix_pct' | 'qty' | 'revenue'>('mix_pct');
  const [activeLocs, setActiveLocs] = useState<Set<string>>(
    () => new Set(locations.map(l => l.location_code)),
  );

  const toggle = (code: string) => setActiveLocs(prev => {
    const next = new Set(prev);
    next.has(code) ? next.delete(code) : next.add(code);
    return next;
  });

  // Top 20 unique items by total revenue
  const topItems = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const i of items) {
      if (!seen.has(i.canonical_name)) {
        seen.add(i.canonical_name);
        result.push(i.canonical_name);
        if (result.length >= 20) break;
      }
    }
    return result;
  }, [items]);

  // Build a map: item -> location -> row
  const dataMap = useMemo(() => {
    const m: Record<string, Record<string, { mix_pct: number; qty: number; revenue: number }>> = {};
    locationItems.forEach(r => {
      if (!m[r.canonical_name]) m[r.canonical_name] = {};
      m[r.canonical_name][r.location_code] = { mix_pct: r.mix_pct, qty: r.qty, revenue: r.revenue };
    });
    return m;
  }, [locationItems]);

  const activeMeta = locMeta.filter(l => activeLocs.has(l.location_code));
  const fmt = (v: number) => metric === 'mix_pct' ? `${v.toFixed(1)}%`
    : metric === 'revenue' ? fmt$(v) : v.toLocaleString();

  return (
    <div>
      {/* Location toggles */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        {locMeta.map(loc => (
          <button key={loc.location_code} onClick={() => toggle(loc.location_code)} style={{
            padding: '4px 12px', borderRadius: 20,
            border: `2px solid ${loc.color}`,
            background: activeLocs.has(loc.location_code) ? loc.color : 'transparent',
            color: activeLocs.has(loc.location_code) ? '#fff' : loc.color,
            fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
          }}>{loc.display_name}</button>
        ))}
        <div style={{ marginLeft: 8, display: 'flex', gap: 3, background: '#f3f0fb', borderRadius: 8, padding: 3 }}>
          {(['mix_pct', 'qty', 'revenue'] as const).map(k => (
            <button key={k} onClick={() => setMetric(k)} style={{
              padding: '4px 11px', borderRadius: 5, border: 'none',
              background: metric === k ? 'var(--accent)' : 'none',
              color: metric === k ? '#fff' : 'var(--muted)',
              fontFamily: 'inherit', fontSize: 10, fontWeight: 700, cursor: 'pointer',
            }}>{{ mix_pct: '% Mix', qty: 'Qty', revenue: 'Revenue' }[k]}</button>
          ))}
        </div>
      </div>

      <div style={{ background: 'var(--card)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr>
              <th style={{ textAlign: 'left' }}>Item</th>
              {activeMeta.map(l => (
                <th key={l.location_code} style={{ color: l.color }}>{l.display_name}</th>
              ))}
              <th>Avg</th>
            </tr></thead>
            <tbody>
              {topItems.map(name => {
                const vals = activeMeta.map(loc => {
                  const r = dataMap[name]?.[loc.location_code];
                  return r ? r[metric] : 0;
                });
                const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
                const max = Math.max(...vals);
                return (
                  <tr key={name}>
                    <td style={{ fontWeight: 600 }}>{name}</td>
                    {vals.map((v, i) => (
                      <td key={activeMeta[i].location_code} style={{
                        fontWeight: v === max && v > 0 ? 700 : 400,
                        color: v === max && v > 0 ? 'var(--accent)' : 'inherit',
                      }}>{fmt(v)}</td>
                    ))}
                    <td style={{ color: 'var(--muted)' }}>{fmt(avg)}</td>
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
