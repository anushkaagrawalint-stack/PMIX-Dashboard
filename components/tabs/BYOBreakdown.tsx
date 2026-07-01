'use client';
import { useState, useMemo } from 'react';
import type { ModifierRow, ItemRow, PinkSheetRow, MERow } from '@/lib/types';

const fmtCost = (v: number) =>
  `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtRev = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;
const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`;

// BYO parent_item names in orders vs canonical_name after byo_fix in pink sheet / ME queries
const BYO_DISPLAY_TO_CANONICAL: Record<string, string> = {
  'Grain Bowl':           'BYO Grain Bowl',
  'Greens + Grains Bowl': 'BYO Greens + Grains Bowl',
  'Salad Bowl':           'BYO Salad Bowl',
};
// reverse: canonical → display
const BYO_CANONICAL_TO_DISPLAY: Record<string, string> = Object.fromEntries(
  Object.entries(BYO_DISPLAY_TO_CANONICAL).map(([d, c]) => [c, d])
);

const MOD_LABEL: Record<string, string> = {
  main:       'Mains',
  half_main:  '½ Mains (Half & Half)',
  base_grain: 'Base',
  base_salad: 'Base',
  base_gg:    'Base',
  base_other: 'Base',
  sauce:      'Sauce',
  veggie:     'Veggie',
  topping:    'Toppings',
  chutney:    'Chutney + Dressing',
};

const MOD_PCT_DESC: Record<string, string> = {
  main:       '% share of all main selections in this bowl',
  half_main:  '% share of all ½-main selections in this bowl',
  base_grain: '% share of base selections in Grain Bowl orders',
  base_salad: '% share of base selections in Salad Bowl orders',
  base_gg:    '% share of base selections in Greens + Grains Bowl orders',
  base_other: '% share of base selections in other bowl types',
  sauce:      '% share of all sauce selections in this bowl',
  veggie:     '% share of all veggie selections in this bowl',
  topping:    '% share of all topping selections in this bowl',
  chutney:    '% share of all chutney + dressing selections in this bowl',
};

const MOD_ORDER = ['main','half_main','base_grain','base_salad','base_gg','base_other','sauce','veggie','topping','chutney'];

function PillToggle<T extends string>({
  options, value, onChange,
}: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div style={{ display: 'flex', gap: 1, background: '#e5e7eb', borderRadius: 7, padding: 3, border: '1px solid #d1d5db' }}>
      {options.map(o => (
        <button key={o.value} onClick={() => onChange(o.value)} style={{
          fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 5, border: 'none', cursor: 'pointer',
          background: value === o.value ? 'var(--accent)' : 'transparent',
          color: value === o.value ? '#fff' : '#6b7280',
          boxShadow: value === o.value ? '0 1px 4px rgba(99,102,241,.35)' : 'none',
          transition: 'all .15s',
        }}>{o.label}</button>
      ))}
    </div>
  );
}

type CostView = 'all' | 'ih' | 'online';
const COST_VIEW_LABELS: Record<CostView, string> = {
  all: 'Overall', ih: 'In-House', online: 'Online (LO+3PD)',
};

export default function BYOBreakdown({
  modifiers,
  items,
  pinkSheets,
  meItems,
}: {
  modifiers:  ModifierRow[];
  items:      ItemRow[];
  pinkSheets: PinkSheetRow[];
  meItems:    MERow[];
}) {
  const [selectedBowl, setSelectedBowl] = useState<string>('__all__');
  const [view,         setView]         = useState<'pct' | 'qty'>('pct');
  const [costView,     setCostView]     = useState<CostView>('all');

  const psMap = useMemo(() => {
    const m = new Map<string, PinkSheetRow>();
    (pinkSheets ?? []).forEach(p => {
      m.set(p.canonical_name, p);
      // Also register under display name so "Grain Bowl" lookup finds "BYO Grain Bowl" entry
      const displayName = BYO_CANONICAL_TO_DISPLAY[p.canonical_name];
      if (displayName) m.set(displayName, p);
    });
    return m;
  }, [pinkSheets]);

  // Fallback cost from ME query (base-only, no modifier adder) for items not in pink sheets
  const meCostMap = useMemo(() => {
    const m = new Map<string, { all: number; ih: number; online: number }>();
    (meItems ?? []).forEach(i => {
      const entry = { all: i.avg_cost, ih: i.avg_cost_ih, online: i.avg_cost_lo };
      m.set(i.canonical_name, entry);
      // Also register under display name for BYO-renamed items
      const displayName = BYO_CANONICAL_TO_DISPLAY[i.canonical_name];
      if (displayName) m.set(displayName, entry);
    });
    return m;
  }, [meItems]);

  // Unique bowls that have modifier data, sorted by total qty desc
  const bowls = useMemo(() => {
    const totals = new Map<string, number>();
    modifiers.forEach(r => {
      if (r.mod_type === 'main' || r.mod_type === 'half_main') {
        totals.set(r.parent_item, (totals.get(r.parent_item) ?? 0) + r.qty);
      }
    });
    return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  }, [modifiers]);

  // Item-level data (qty, revenue, avg_price) keyed by canonical_name
  const itemMap = useMemo(() => {
    const m = new Map<string, { qty: number; revenue: number; avgPrice: number }>();
    items.forEach(it => {
      const prev = m.get(it.canonical_name);
      if (prev) {
        prev.qty     += it.qty;
        prev.revenue += it.revenue;
        prev.avgPrice = prev.revenue / prev.qty;
      } else {
        m.set(it.canonical_name, { qty: it.qty, revenue: it.revenue, avgPrice: it.avg_price });
      }
    });
    return m;
  }, [items]);


  // Filtered modifiers for the selected bowl
  const filtered = useMemo(() =>
    selectedBowl === '__all__'
      ? modifiers
      : modifiers.filter(r => r.parent_item === selectedBowl),
  [modifiers, selectedBowl]);

  // Group by mod_type
  const byType = useMemo(() => {
    const m: Record<string, ModifierRow[]> = {};
    filtered.forEach(r => {
      if (!m[r.mod_type]) m[r.mod_type] = [];
      m[r.mod_type].push(r);
    });
    return m;
  }, [filtered]);

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
      {/* ── Summary Table ─────────────────────────────────────────── */}
      <div className="card tscroll" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
          <h3 style={{ fontSize: 13, margin: 0 }}>BYO Items — Overview</h3>
          {/* Channel cost toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600 }}>Cost view:</span>
            {(['all', 'ih', 'online'] as CostView[]).map(cv => (
              <button key={cv} onClick={() => setCostView(cv)}
                style={{
                  padding: '3px 10px', borderRadius: 6, border: '1px solid var(--border)',
                  fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                  background: costView === cv ? 'var(--accent)' : 'var(--card)',
                  color: costView === cv ? '#fff' : 'var(--muted)',
                }}>
                {COST_VIEW_LABELS[cv]}
              </button>
            ))}
          </div>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
              {['Bowl / Item','Qty','Revenue','Avg Price',`Avg Cost (w/ Mods) — ${COST_VIEW_LABELS[costView]}`,'COGS%'].map(h => (
                <th key={h} style={{
                  padding: '4px 10px', textAlign: h === 'Bowl / Item' ? 'left' : 'right',
                  fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase',
                  letterSpacing: '.04em', whiteSpace: 'nowrap',
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bowls.map((bowl, i) => {
              const it = itemMap.get(bowl);
              const ps = psMap.get(bowl);

              // Pink-sheet cost for the chosen channel view
              let psCost: number | null = null;
              if (ps) {
                if (costView === 'ih') {
                  psCost = ps.avg_cost_ih;
                } else if (costView === 'online') {
                  psCost = ps.avg_cost_online;
                } else {
                  const tq = ps.ih_qty + ps.online_qty;
                  psCost = tq > 0
                    ? (ps.avg_cost_ih * ps.ih_qty + ps.avg_cost_online * ps.online_qty) / tq
                    : ps.avg_cost_online;
                }
              }

              // Fallback: meItems cost (base only, no modifier adder) when pink sheet absent
              const meCosts     = ps ? null : meCostMap.get(bowl);
              const fallbackCost = meCosts
                ? (costView === 'ih' ? meCosts.ih : costView === 'online' ? meCosts.online : meCosts.all)
                : null;

              const displayCost = psCost ?? fallbackCost;
              const isEstimate  = displayCost != null && ps == null;
              const cogsPct     = displayCost != null && it ? displayCost / it.avgPrice : null;

              return (
                <tr
                  key={bowl}
                  onClick={() => setSelectedBowl(selectedBowl === bowl ? '__all__' : bowl)}
                  style={{
                    borderBottom: '1px solid #f3f4f6',
                    cursor: 'pointer',
                    background: selectedBowl === bowl ? 'rgba(99,102,241,.07)' : i % 2 === 0 ? '#fafafa' : '#fff',
                  }}
                >
                  <td style={{ padding: '6px 10px', fontWeight: 600, color: 'var(--text)' }}>
                    <span style={{
                      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                      background: selectedBowl === bowl ? 'var(--accent)' : '#d1d5db',
                      marginRight: 8, flexShrink: 0,
                    }} />
                    {bowl}
                  </td>
                  <td style={{ padding: '6px 10px', textAlign: 'center', color: 'var(--text)' }}>
                    {it ? it.qty.toLocaleString() : '—'}
                  </td>
                  <td style={{ padding: '6px 10px', textAlign: 'center', color: 'var(--text)' }}>
                    {it ? fmtRev(it.revenue) : '—'}
                  </td>
                  <td style={{ padding: '6px 10px', textAlign: 'center', color: 'var(--text)' }}>
                    {it ? fmtCost(it.avgPrice) : '—'}
                  </td>
                  <td style={{ padding: '6px 10px', textAlign: 'center', fontWeight: displayCost != null ? 600 : 400 }}>
                    {displayCost != null ? (
                      <span style={{ color: isEstimate ? '#92400e' : 'var(--text)' }}>
                        {fmtCost(displayCost)}
                        {isEstimate && (
                          <span style={{ fontSize: 9, fontWeight: 400, color: '#92400e', marginLeft: 3 }}>
                            (base)
                          </span>
                        )}
                      </span>
                    ) : '—'}
                  </td>
                  <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                    {cogsPct != null ? (
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                        background: cogsPct > 0.35 ? '#fee2e2' : cogsPct > 0.28 ? '#fef9c3' : '#dcfce7',
                        color: cogsPct > 0.35 ? '#991b1b' : cogsPct > 0.28 ? '#92400e' : '#14532d',
                      }}>
                        {fmtPct(cogsPct)}
                      </span>
                    ) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 6, fontStyle: 'italic' }}>
          Click a row to filter modifier cards below to that bowl. Click again to clear.
          <strong style={{ color: '#92400e' }}> (base)</strong> = no pink sheet entry — showing base cost only, modifier adder not included.
        </div>
      </div>

      {/* ── Bowl selector dropdown ────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Item</span>
        <select
          className="fb-sel"
          value={selectedBowl}
          onChange={e => setSelectedBowl(e.target.value)}
          style={{ minWidth: 220 }}
        >
          <option value="__all__">All</option>
          {bowls.map(bowl => (
            <option key={bowl} value={bowl}>{bowl}</option>
          ))}
        </select>
      </div>

      {/* ── Info banner ───────────────────────────────────────────── */}
      <div className="info-banner yellow" style={{ marginBottom: 8 }}>
        <i className="ti ti-info-circle" aria-hidden="true" />
        Mains are logged on every order. Base · Sauce · Veggie · Topping · Chutney are online-only (App + 3PD) — in-house records only the protein.
        ½ Mains are half-and-half protein choices. Modifier cost uses the pink sheet rule: ½ X = half the cost of X.
      </div>

      {/* ── Toggles ───────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: 10, gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, color: 'var(--muted)' }}>Selection</span>
          <PillToggle
            value={view}
            onChange={setView}
            options={[
              { value: 'pct', label: '% Share' },
              { value: 'qty', label: 'Qty' },
            ]}
          />
        </div>
      </div>

      {/* ── Modifier cards ────────────────────────────────────────── */}
      {types.length === 0 ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          No modifier data for this selection.
        </div>
      ) : (
        <div className="gr3">
          {types.map(t => {
            const rows = byType[t].slice(0, 10);

            return (
              <div key={t} className="byo-col">
                <div style={{ marginBottom: 6 }}>
                  <h3 style={{ marginBottom: 2 }}>{MOD_LABEL[t] ?? t}</h3>
                  <div style={{ fontSize: 9, color: 'var(--muted)', fontStyle: 'italic' }}>
                    {view === 'pct' ? (MOD_PCT_DESC[t] ?? '% share of selections') : 'exact qty ordered'}
                  </div>
                </div>

                {/* Column headers */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0 5px', borderBottom: '2px solid #e5e7eb', marginBottom: 2 }}>
                  <span style={{ flex: 1, fontSize: 9, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Modifier</span>
                  <span style={{ width: 56, fontSize: 9, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em', textAlign: 'right' }}>
                    {view === 'pct' ? '% Share' : 'Qty'}
                  </span>
                </div>

                {rows.map(r => (
                  <div key={r.modifier_name + r.parent_item} className="byo-item" style={{ alignItems: 'center' }}>
                    <span className="byo-name">{r.modifier_name}</span>
                    <span className="byo-pct" style={{ width: 44, textAlign: 'right', flexShrink: 0, marginLeft: 'auto' }}>
                      {view === 'pct' ? `${r.pct}%` : r.qty.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
