'use client';
import { useMemo } from 'react';
import type { ModifierRow } from '@/lib/types';

const MOD_LABEL: Record<string, string> = {
  main: 'Main', base: 'Base', sauce: 'Sauce',
  veggie: 'Veggie', topping: 'Toppings', chutney: 'Chutney + Dressing',
};
const MOD_ORDER = ['main', 'base', 'sauce', 'veggie', 'topping', 'chutney'];

export default function BYOBreakdown({ modifiers }: { modifiers: ModifierRow[] }) {
  const byType = useMemo(() => {
    const m: Record<string, ModifierRow[]> = {};
    modifiers.forEach(r => {
      if (!m[r.mod_type]) m[r.mod_type] = [];
      m[r.mod_type].push(r);
    });
    return m;
  }, [modifiers]);

  const types = MOD_ORDER.filter(t => byType[t]?.length);

  if (!modifiers.length) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
        No BYO modifier data available for this period.
      </div>
    );
  }

  return (
    <div>
      <div className="info-banner yellow">
        <i className="ti ti-info-circle" aria-hidden="true" />
        Mains are logged on every order. Base · Sauce · Veggie · Topping · Chutney are online-only (App + 3PD). In-house records only the protein.
      </div>

      <div className="gr3">
        {types.map(t => {
          const rows = byType[t].slice(0, 10);
          const max = rows[0]?.pct ?? 1;
          return (
            <div key={t} className="byo-col">
              <h3>{MOD_LABEL[t] ?? t}</h3>
              {rows.map(r => (
                <div key={r.modifier_name} className="byo-item">
                  <span className="byo-name">{r.modifier_name}</span>
                  <div className="byo-bar-bg">
                    <div className="byo-bar-fill" style={{ width: `${(r.pct / max) * 100}%` }} />
                  </div>
                  <span className="byo-pct">{r.pct}%</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
