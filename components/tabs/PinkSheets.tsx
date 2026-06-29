'use client';
import { useState, useMemo } from 'react';
import type { PinkSheetRow, PinkSheetDetailRow } from '@/lib/types';

const fmt$ = (v: number, d = 4) =>
  `$${v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const fmt2 = (v: number) =>
  `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Section rank — more specific patterns BEFORE shorter overlapping ones
const SECTION_RANK: [string, number][] = [
  ['1/2 base',      2],
  ['base',          1],
  ['extra main',    5],
  ['1/2 main',      4],
  ['main',          3],
  ['extra veggie',  6],   // right after Extra Main, before Sauce
  ['sauce',         7],
  ['veggie',        8],
  ['topping',       9],
  ['chutney',      10],
  ['make it',      11],
];
function sectionRank(s: string): number {
  const l = s.toLowerCase();
  for (const [k, r] of SECTION_RANK) if (l.includes(k)) return r;
  return 99;
}

// Canonical display names — normalize plural/variant forms so sections merge correctly
// e.g. "Chutney and Dressings" and "Chutney + Dressing" → same section
const CANONICAL: Record<string, string> = {
  'bases':                  'Base',
  'base':                   'Base',
  '1/2 base':               '1/2 Base',
  '1/2 bases':              '1/2 Base',
  'main':                   'Main',
  'mains':                  'Main',
  '1/2 main':               '1/2 Main',
  '1/2 mains':              '1/2 Main',
  'extra main':             'Extra Main',
  'extra mains':            'Extra Main',
  'sauce':                  'Sauce',
  'sauces':                 'Sauce',
  'veggie':                 'Veggie',
  'veggies':                'Veggie',
  'extra veggie':           'Extra Veggie',
  'extra veggies':          'Extra Veggie',
  'topping':                'Topping',
  'toppings':               'Topping',
  'chutney + dressing':     'Chutney + Dressing',
  'chutney + dressings':    'Chutney + Dressing',
  'chutney and dressing':   'Chutney + Dressing',
  'chutney and dressings':  'Chutney + Dressing',
  'chutney & dressing':     'Chutney + Dressing',
  'chutney':                'Chutney + Dressing',
  'make it meal':           'Make It Meal',
  'make it':                'Make It Meal',
  'side':                   'Make It Meal',
  'drink':                  'Make It Meal',
  'sweet':                  'Make It Meal',
};

function effectiveDisplayName(s: string): string {
  // Strip item-type prefix: "Bowls - Chutney and Dressings" → "Chutney and Dressings"
  const m = s.match(/^[^-]+-\s*(.+)$/);
  const stripped = m ? m[1].trim() : s;
  // Normalize to canonical form
  return CANONICAL[stripped.toLowerCase()] ?? stripped;
}

interface SectionData {
  rawKeys:     string[];   // original modifier_type values merged into this section
  displayName: string;
  rank:        number;
  mods:        PinkSheetDetailRow[];
  sectionTotal: number;
}

function buildSections(dets: PinkSheetDetailRow[]): SectionData[] {
  // Group by effectiveDisplayName first (merges Make It Meal variants)
  const byDisplay: Record<string, { rawKeys: Set<string>; rank: number; mods: PinkSheetDetailRow[] }> = {};

  for (const d of dets) {
    const dn   = effectiveDisplayName(d.section);
    const rank = sectionRank(d.section);
    if (!byDisplay[dn]) byDisplay[dn] = { rawKeys: new Set(), rank, mods: [] };
    byDisplay[dn].rawKeys.add(d.section);
    byDisplay[dn].mods.push(d);
  }

  return Object.entries(byDisplay)
    .sort(([, a], [, b]) => a.rank - b.rank || 0)
    .map(([displayName, { rawKeys, rank, mods }]) => ({
      rawKeys:      [...rawKeys],
      displayName,
      rank,
      mods:         mods.sort((a, b) => a.modifier_name.localeCompare(b.modifier_name)),
      sectionTotal: mods.reduce((s, m) => s + m.total_cost, 0),
    }));
}

// The AppScript assigns the weighted-avg cost of the "1/2 [X]" section to the
// "1/2 and 1/2 [X]" proxy modifier that has no direct r365 cost entry.
function applyHalfHalfCosts(sections: SectionData[]): SectionData[] {
  const halfBase = sections.find(s => s.rank === 2);  // 1/2 Base
  const halfMain = sections.find(s => s.rank === 4);  // 1/2 Main
  const halfBaseAvgUnit = halfBase
    ? halfBase.sectionTotal / Math.max(halfBase.mods.reduce((s, m) => s + m.qty, 0), 1)
    : 0;
  const halfMainAvgUnit = halfMain
    ? halfMain.sectionTotal / Math.max(halfMain.mods.reduce((s, m) => s + m.qty, 0), 1)
    : 0;

  return sections.map(sec => {
    const fixed = sec.mods.map(m => {
      if (m.unit_cost > 0) return m;
      const l = m.modifier_name.toLowerCase();
      if (l === '1/2 and 1/2 base' && halfBaseAvgUnit > 0) {
        const tc = halfBaseAvgUnit * m.qty;
        return { ...m, unit_cost: halfBaseAvgUnit, total_cost: tc };
      }
      if ((l === '1/2 and 1/2 mains' || l === '1/2 and 1/2 main') && halfMainAvgUnit > 0) {
        const tc = halfMainAvgUnit * m.qty;
        return { ...m, unit_cost: halfMainAvgUnit, total_cost: tc };
      }
      return m;
    });
    return { ...sec, mods: fixed, sectionTotal: fixed.reduce((s, m) => s + m.total_cost, 0) };
  });
}

type ChannelMode = 'online' | 'ih';

interface Props {
  pinkSheets: PinkSheetRow[];
  details:    PinkSheetDetailRow[];
}

export default function PinkSheets({ pinkSheets, details }: Props) {
  const rows    = pinkSheets ?? [];
  const dets    = details    ?? [];
  const [search,   setSearch]   = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [channel,  setChannel]  = useState<ChannelMode>('online');

  const filteredItems = useMemo(() => {
    const q = search.toLowerCase();
    const filtered = q ? rows.filter(r => r.canonical_name.toLowerCase().includes(q)) : rows;
    // For IH tab show items with IH qty; for online show items with online qty
    return channel === 'ih'
      ? filtered.filter(r => r.ih_qty > 0).sort((a, b) => b.ih_qty - a.ih_qty)
      : filtered.filter(r => r.online_qty > 0);
  }, [rows, search, channel]);

  const activeItem = useMemo(
    () => rows.find(r => r.canonical_name === selected) ??
          filteredItems[0] ??
          null,
    [selected, filteredItems, rows],
  );

  // Build and fix sections filtered by active channel
  const rawSections = useMemo(() => {
    if (!activeItem) return [];
    const itemDets = dets.filter(
      d => d.parent_item === activeItem.canonical_name && d.channel === channel,
    );
    return buildSections(itemDets);
  }, [activeItem, dets, channel]);

  const sections = useMemo(() => applyHalfHalfCosts(rawSections), [rawSections]);

  const onlineQty    = activeItem?.online_qty ?? 0;
  const ihQty        = activeItem?.ih_qty     ?? 0;

  // Footer varies by channel
  // Exclude 1/2 Base (rank 2) and 1/2 Main (rank 4) — their cost is already captured
  // by the proxy rows ("1/2 and 1/2 Base", "1/2 and 1/2 Mains") inside the Base/Main sections
  const totalModCost = sections
    .filter(s => s.rank !== 2 && s.rank !== 4)
    .reduce((s, sec) => s + sec.sectionTotal, 0);
  const baseCost     = channel === 'ih' ? (activeItem?.base_cost_ih ?? 0) : (activeItem?.base_cost_online ?? 0);
  const activeQty    = channel === 'ih' ? ihQty : onlineQty;
  const totalAvgCost = baseCost * activeQty;
  const modPlusAvg   = totalModCost + totalAvgCost;
  const finalAvgCost = activeQty > 0 ? modPlusAvg / activeQty : 0;

  if (!rows.length) return (
    <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>
      No pink sheet data for this period.
    </div>
  );

  return (
    <div style={{ display: 'flex', gap: 0, height: 'calc(100vh - 160px)', minHeight: 500 }}>

      {/* ── Left sidebar ─────────────────────────────────────────────────── */}
      <div style={{
        width: 230, minWidth: 210, flexShrink: 0,
        borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{ padding: '10px 10px 6px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 6 }}>Pink Sheets</div>

          {/* Channel tabs */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
            {(['online', 'ih'] as ChannelMode[]).map(ch => (
              <button key={ch} onClick={() => { setChannel(ch); setSelected(null); }}
                style={{
                  flex: 1, padding: '4px 0', borderRadius: 6,
                  border: '1px solid var(--border)', cursor: 'pointer',
                  fontFamily: 'inherit', fontSize: 10, fontWeight: 700,
                  background: channel === ch ? (ch === 'ih' ? '#dcfce7' : '#dbeafe') : 'var(--card)',
                  color: channel === ch ? (ch === 'ih' ? '#14532d' : '#1e3a8a') : 'var(--muted)',
                }}>
                {ch === 'online' ? 'ONLINE' : 'IN HOUSE'}
              </button>
            ))}
          </div>

          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search items…" className="srch"
            style={{ width: '100%', boxSizing: 'border-box' }} />
        </div>

        <div style={{ overflowY: 'auto', flex: 1 }}>
          {filteredItems.map(r => {
            const isActive = r.canonical_name === (activeItem?.canonical_name ?? '');
            const qty = channel === 'ih' ? r.ih_qty : r.online_qty;
            return (
              <button key={r.canonical_name} onClick={() => setSelected(r.canonical_name)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '7px 10px', border: 'none', cursor: 'pointer',
                  fontFamily: 'inherit', fontSize: 11,
                  borderBottom: '1px solid var(--border)',
                  background: isActive ? '#fce7f3' : 'var(--card)',
                  color:      isActive ? '#9d174d' : 'var(--fg)',
                  fontWeight: isActive ? 700 : 400,
                }}>
                <div>{r.canonical_name}</div>
                <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 1 }}>
                  {qty.toLocaleString()} orders · {r.menu_group}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Right: pink sheet detail ──────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px' }}>
        {!activeItem ? (
          <div style={{ color: 'var(--muted)', fontSize: 12, textAlign: 'center', marginTop: 40 }}>
            Select an item from the left to view its pink sheet.
          </div>
        ) : channel === 'ih' ? (
          /* ── IH Pink Sheet: same layout as online ── */
          <>
            <div style={{
              background: '#dcfce7', borderRadius: 8, padding: '10px 16px',
              marginBottom: 16, borderLeft: '4px solid #16a34a',
            }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#14532d' }}>
                {activeItem.canonical_name} — IN HOUSE
              </div>
              <div style={{ fontSize: 10, color: '#166534', marginTop: 3, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <span>IH qty: <strong>{ihQty.toLocaleString()}</strong></span>
                <span>Base cost IH: <strong>{fmt$(activeItem.base_cost_ih)}</strong></span>
                <span>Menu group: <strong>{activeItem.menu_group || '—'}</strong></span>
              </div>
            </div>

            <div className="tw">
              <table style={{ width: '100%' }}>
                {sections.length > 0 && (
                  <thead>
                    <tr>
                      <th style={{ minWidth: 220, textAlign: 'left' }}>Modifier</th>
                      <th style={{ textAlign: 'right' }}>Qty</th>
                      <th style={{ textAlign: 'right' }}>Unit Cost</th>
                      <th style={{ textAlign: 'right' }}>Total Cost</th>
                    </tr>
                  </thead>
                )}
                <tbody>
                  {sections.map(sec => (
                    <>
                      <tr key={`hdr-ih-${sec.displayName}`} style={{ background: '#f0fdf4' }}>
                        <td colSpan={4} style={{
                          fontWeight: 700, fontSize: 11, color: '#15803d',
                          padding: '6px 8px', textTransform: 'uppercase', letterSpacing: '0.05em',
                        }}>
                          {sec.displayName}
                        </td>
                      </tr>
                      {sec.mods.map(m => (
                        <tr key={`ih-${sec.displayName}-${m.modifier_name}`}>
                          <td style={{ paddingLeft: 20 }}>{m.modifier_name}</td>
                          <td style={{ textAlign: 'right' }}>{m.qty.toLocaleString()}</td>
                          <td style={{ textAlign: 'right', color: m.unit_cost === 0 ? 'var(--muted)' : 'inherit' }}>
                            {fmt$(m.unit_cost)}
                          </td>
                          <td style={{ textAlign: 'right', color: m.total_cost === 0 ? 'var(--muted)' : 'inherit' }}>
                            {fmt$(m.total_cost)}
                          </td>
                        </tr>
                      ))}
                      <tr key={`tot-ih-${sec.displayName}`} style={{ background: '#dcfce7' }}>
                        <td style={{ fontWeight: 700, paddingLeft: 20, color: '#15803d' }}>Grand Total</td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: '#15803d' }}>
                          {sec.mods.reduce((s, m) => s + m.qty, 0).toLocaleString()}
                        </td>
                        <td />
                        <td style={{ textAlign: 'right', fontWeight: 700, color: '#15803d' }}>
                          {fmt$(sec.sectionTotal)}
                        </td>
                      </tr>
                    </>
                  ))}

                  <tr style={{ height: 12 }}><td colSpan={4} /></tr>

                  <tr style={{ background: '#dcfce7', borderTop: '2px solid #86efac' }}>
                    <td colSpan={2} style={{ fontWeight: 700, color: '#14532d', padding: '6px 8px' }}>
                      AVG COST OF {activeItem.canonical_name.toUpperCase()} (IN HOUSE)
                    </td>
                    <td style={{ fontSize: 10, color: 'var(--muted)', textAlign: 'right' }}>r365 IH base cost</td>
                    <td style={{ textAlign: 'right', fontWeight: 800, color: '#14532d' }}>
                      {fmt$(activeItem.base_cost_ih)}
                    </td>
                  </tr>
                  <tr style={{ background: '#fff7ed' }}>
                    <td colSpan={2} style={{ fontWeight: 700, color: '#c2410c', padding: '6px 8px' }}>
                      TOTAL MODIFIER COST
                    </td>
                    <td style={{ fontSize: 10, color: 'var(--muted)', textAlign: 'right' }}>Σ all section totals</td>
                    <td style={{ textAlign: 'right', fontWeight: 800, color: '#c2410c' }}>
                      {fmt$(totalModCost)}
                    </td>
                  </tr>
                  <tr style={{ background: '#eff6ff' }}>
                    <td colSpan={2} style={{ fontWeight: 700, color: '#1d4ed8', padding: '6px 8px' }}>
                      TOTAL AVG COST
                    </td>
                    <td style={{ fontSize: 10, color: 'var(--muted)', textAlign: 'right' }}>
                      base × IH qty ({ihQty.toLocaleString()})
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 800, color: '#1d4ed8' }}>
                      {fmt$(totalAvgCost)}
                    </td>
                  </tr>
                  <tr style={{ background: '#f0fdf4' }}>
                    <td colSpan={2} style={{ fontWeight: 700, color: '#15803d', padding: '6px 8px' }}>
                      MODIFIER + AVG COST
                    </td>
                    <td style={{ fontSize: 10, color: 'var(--muted)', textAlign: 'right' }}>
                      total mod cost + total avg cost
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 800, color: '#15803d' }}>
                      {fmt$(modPlusAvg)}
                    </td>
                  </tr>
                  <tr style={{ background: '#ecfdf5', borderTop: '2px solid #6ee7b7' }}>
                    <td colSpan={2} style={{ fontWeight: 800, fontSize: 13, color: '#065f46', padding: '8px 8px' }}>
                      FINAL AVG COST WITH MODIFIER (IN HOUSE)
                    </td>
                    <td style={{ fontSize: 10, color: 'var(--muted)', textAlign: 'right' }}>
                      (mod + avg) ÷ IH qty
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 900, fontSize: 14, color: '#065f46' }}>
                      {fmt2(finalAvgCost)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        ) : (
          /* ── Online Pink Sheet ── */
          <>
            <div style={{
              background: '#fce7f3', borderRadius: 8, padding: '10px 16px',
              marginBottom: 16, borderLeft: '4px solid #ec4899',
            }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#9d174d' }}>
                {activeItem.canonical_name} — ONLINE
              </div>
              <div style={{ fontSize: 10, color: '#be185d', marginTop: 3, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <span>Online qty: <strong>{onlineQty.toLocaleString()}</strong></span>
                <span>Base cost (delivery): <strong>{fmt$(activeItem.base_cost_online)}</strong></span>
                <span>Base cost (IH): <strong>{activeItem.base_cost_ih > 0 ? fmt$(activeItem.base_cost_ih) : '—'}</strong></span>
                <span>Menu group: <strong>{activeItem.menu_group || '—'}</strong></span>
              </div>
            </div>

            {sections.length === 0 ? (
              <div style={{ color: 'var(--muted)', fontSize: 12 }}>
                No modifier detail found for this item in the selected period.
              </div>
            ) : (
              <div className="tw">
                <table style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th style={{ minWidth: 220, textAlign: 'left' }}>Modifier</th>
                      <th style={{ textAlign: 'right' }}>Qty</th>
                      <th style={{ textAlign: 'right' }}>Unit Cost</th>
                      <th style={{ textAlign: 'right' }}>Total Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sections.map(sec => (
                      <>
                        <tr key={`hdr-${sec.displayName}`} style={{ background: '#fdf4ff' }}>
                          <td colSpan={4} style={{
                            fontWeight: 700, fontSize: 11, color: '#7e22ce',
                            padding: '6px 8px', textTransform: 'uppercase', letterSpacing: '0.05em',
                          }}>
                            {sec.displayName}
                          </td>
                        </tr>

                        {sec.mods.map(m => (
                          <tr key={`${sec.displayName}-${m.modifier_name}`}>
                            <td style={{ paddingLeft: 20 }}>{m.modifier_name}</td>
                            <td style={{ textAlign: 'right' }}>{m.qty.toLocaleString()}</td>
                            <td style={{ textAlign: 'right', color: m.unit_cost === 0 ? 'var(--muted)' : 'inherit' }}>
                              {fmt$(m.unit_cost)}
                            </td>
                            <td style={{ textAlign: 'right', color: m.total_cost === 0 ? 'var(--muted)' : 'inherit' }}>
                              {fmt$(m.total_cost)}
                            </td>
                          </tr>
                        ))}

                        <tr key={`tot-${sec.displayName}`} style={{ background: '#f5f3ff' }}>
                          <td style={{ fontWeight: 700, paddingLeft: 20, color: '#5b21b6' }}>Grand Total</td>
                          <td style={{ textAlign: 'right', fontWeight: 700, color: '#5b21b6' }}>
                            {sec.mods.reduce((s, m) => s + m.qty, 0).toLocaleString()}
                          </td>
                          <td />
                          <td style={{ textAlign: 'right', fontWeight: 700, color: '#5b21b6' }}>
                            {fmt$(sec.sectionTotal)}
                          </td>
                        </tr>
                      </>
                    ))}

                    {/* ── Footer ──────────────────────────────────────── */}
                    <tr style={{ height: 12 }}><td colSpan={4} /></tr>

                    <tr style={{ background: '#fce7f3', borderTop: '2px solid #f9a8d4' }}>
                      <td colSpan={2} style={{ fontWeight: 700, color: '#9d174d', padding: '6px 8px' }}>
                        AVG COST OF {activeItem.canonical_name.toUpperCase()}
                      </td>
                      <td style={{ fontSize: 10, color: 'var(--muted)', textAlign: 'right' }}>r365 base (delivery)</td>
                      <td style={{ textAlign: 'right', fontWeight: 800, color: '#9d174d' }}>
                        {fmt$(activeItem.base_cost_online)}
                      </td>
                    </tr>

                    <tr style={{ background: '#fff7ed' }}>
                      <td colSpan={2} style={{ fontWeight: 700, color: '#c2410c', padding: '6px 8px' }}>
                        TOTAL MODIFIER COST
                      </td>
                      <td style={{ fontSize: 10, color: 'var(--muted)', textAlign: 'right' }}>Σ all section totals</td>
                      <td style={{ textAlign: 'right', fontWeight: 800, color: '#c2410c' }}>
                        {fmt$(totalModCost)}
                      </td>
                    </tr>

                    <tr style={{ background: '#eff6ff' }}>
                      <td colSpan={2} style={{ fontWeight: 700, color: '#1d4ed8', padding: '6px 8px' }}>
                        TOTAL AVG COST
                      </td>
                      <td style={{ fontSize: 10, color: 'var(--muted)', textAlign: 'right' }}>
                        base × online qty ({activeQty.toLocaleString()})
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 800, color: '#1d4ed8' }}>
                        {fmt$(totalAvgCost)}
                      </td>
                    </tr>

                    <tr style={{ background: '#f0fdf4' }}>
                      <td colSpan={2} style={{ fontWeight: 700, color: '#15803d', padding: '6px 8px' }}>
                        MODIFIER + AVG COST
                      </td>
                      <td style={{ fontSize: 10, color: 'var(--muted)', textAlign: 'right' }}>
                        total mod cost + total avg cost
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 800, color: '#15803d' }}>
                        {fmt$(modPlusAvg)}
                      </td>
                    </tr>

                    <tr style={{ background: '#ecfdf5', borderTop: '2px solid #6ee7b7' }}>
                      <td colSpan={2} style={{ fontWeight: 800, fontSize: 13, color: '#065f46', padding: '8px 8px' }}>
                        FINAL AVG COST WITH MODIFIER
                      </td>
                      <td style={{ fontSize: 10, color: 'var(--muted)', textAlign: 'right' }}>
                        (mod + avg) ÷ online qty
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 900, fontSize: 14, color: '#065f46' }}>
                        {fmt2(finalAvgCost)}
                      </td>
                    </tr>

                    <tr style={{ background: '#f5f3ff' }}>
                      <td colSpan={2} style={{ fontWeight: 700, color: '#6d28d9', padding: '6px 8px' }}>
                        FINAL AVG COST — 3PD (×1.18)
                      </td>
                      <td style={{ fontSize: 10, color: 'var(--muted)', textAlign: 'right' }}>packaging uplift</td>
                      <td style={{ textAlign: 'right', fontWeight: 800, color: '#6d28d9' }}>
                        {fmt2(finalAvgCost * 1.18)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
