'use client';
import { useState, useMemo } from 'react';
import type { PinkSheetRow, PinkSheetDetailRow } from '@/lib/types';
import { buildSections, applyHalfHalfCosts, computeTotalModCost, isZeroBaseItem, type SectionData } from '@/lib/pinkSheetCost';

const fmt$ = (v: number, d = 4) =>
  `$${v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const fmt2 = (v: number) =>
  `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type ChannelMode = 'online' | 'ih';

interface Props {
  pinkSheets: PinkSheetRow[];
  details:    PinkSheetDetailRow[];
}

// Renders one section table — half sections (1/2 Base, 1/2 Main) get weighted-avg columns
function SectionTable({
  sec,
  hdrBg, hdrColor,
  totalBg, totalColor,
  forcePlain = false,
}: {
  sec: SectionData;
  hdrBg: string; hdrColor: string;
  totalBg: string; totalColor: string;
  forcePlain?: boolean;
}) {
  const isHalf   = (sec.rank === 2 || sec.rank === 4) && !forcePlain;
  const totalQty = sec.mods.reduce((s, m) => s + m.qty, 0);
  const weightedAvg = isHalf && totalQty > 0 ? sec.sectionTotal / totalQty : 0;

  return (
    <div className="tw" style={{ marginBottom: 8 }}>
      <table style={{ width: '100%' }}>
        <thead>
          <tr style={{ background: hdrBg }}>
            <td
              colSpan={isHalf ? 6 : 4}
              style={{
                fontWeight: 700, fontSize: 11, color: hdrColor,
                padding: '6px 8px', textTransform: 'uppercase', letterSpacing: '0.05em',
              }}
            >
              {sec.displayName}
            </td>
          </tr>
          <tr>
            <th style={{ minWidth: 220, textAlign: 'left' }}>Modifier</th>
            {isHalf ? (
              <>
                <th style={{ textAlign: 'center' }}>SUM of Qty</th>
                <th style={{ width: 20 }} />
                <th style={{ textAlign: 'center' }}>Cost</th>
                <th style={{ textAlign: 'center' }}>%</th>
                <th style={{ textAlign: 'center' }} />
              </>
            ) : (
              <>
                <th style={{ textAlign: 'center' }}>Qty</th>
                <th style={{ textAlign: 'center' }}>Unit Cost</th>
                <th style={{ textAlign: 'center' }}>Total Cost</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {isHalf ? (
            <>
              {sec.mods.map(m => {
                const share    = totalQty > 0 ? m.qty / totalQty : 0;
                const weighted = m.unit_cost * share;
                return (
                  <tr key={m.modifier_name}>
                    <td style={{ paddingLeft: 20 }}>{m.modifier_name}</td>
                    <td style={{ textAlign: 'center' }}>{m.qty.toLocaleString()}</td>
                    <td />
                    <td style={{ textAlign: 'center', color: m.unit_cost === 0 ? 'var(--muted)' : 'inherit' }}>
                      {fmt$(m.unit_cost)}
                    </td>
                    <td style={{ textAlign: 'center' }}>{fmt$(share)}</td>
                    <td style={{ textAlign: 'center' }}>{fmt$(weighted)}</td>
                  </tr>
                );
              })}
              <tr style={{ background: totalBg }}>
                <td style={{ fontWeight: 700, paddingLeft: 20, color: totalColor }}>Grand Total</td>
                <td style={{ textAlign: 'center', fontWeight: 700, color: totalColor }}>{totalQty.toLocaleString()}</td>
                <td /><td /><td />
                <td style={{ textAlign: 'center', fontWeight: 700, color: totalColor }}>{fmt$(weightedAvg)}</td>
              </tr>
            </>
          ) : (
            <>
              {sec.mods.map(m => (
                <tr key={m.modifier_name}>
                  <td style={{ paddingLeft: 20 }}>{m.modifier_name}</td>
                  <td style={{ textAlign: 'center' }}>{m.qty.toLocaleString()}</td>
                  <td style={{ textAlign: 'center', color: m.unit_cost === 0 ? 'var(--muted)' : 'inherit' }}>
                    {fmt$(m.unit_cost)}
                  </td>
                  <td style={{ textAlign: 'center', color: m.total_cost === 0 ? 'var(--muted)' : 'inherit' }}>
                    {fmt$(m.total_cost)}
                  </td>
                </tr>
              ))}
              <tr style={{ background: totalBg }}>
                <td style={{ fontWeight: 700, paddingLeft: 20, color: totalColor }}>Grand Total</td>
                <td style={{ textAlign: 'center', fontWeight: 700, color: totalColor }}>
                  {totalQty.toLocaleString()}
                </td>
                <td />
                <td style={{ textAlign: 'center', fontWeight: 700, color: totalColor }}>
                  {fmt$(sec.sectionTotal)}
                </td>
              </tr>
            </>
          )}
        </tbody>
      </table>
    </div>
  );
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

  // Zero-baseCost items (Sides, Homemade Juice) are channel-agnostic — their IH cost
  // mirrors the online weighted-average modifier cost exactly, never recomputed from
  // IH's own (often sparse or nonexistent) modifier orders. Homemade Juice specifically
  // has ZERO IH modifier rows at all (flavor choice only happens online), so computing
  // IH independently would give $0. `effectiveChannel` redirects the WHOLE breakdown
  // (sections, base cost, qty) to online for these items while still showing the
  // item's true IH order count in the header for information.
  const isActiveZeroBase = !!activeItem && isZeroBaseItem(activeItem.canonical_name);
  const effectiveChannel: ChannelMode = (channel === 'ih' && isActiveZeroBase) ? 'online' : channel;

  const rawSections = useMemo(() => {
    if (!activeItem) return [];
    const itemDets = dets.filter(
      d => d.parent_item === activeItem.canonical_name && d.channel === effectiveChannel,
    );
    return buildSections(itemDets);
  }, [activeItem, dets, effectiveChannel]);

  const sections = useMemo(() => applyHalfHalfCosts(rawSections), [rawSections]);

  const onlineQty    = activeItem?.online_qty ?? 0;
  const ihQty        = activeItem?.ih_qty     ?? 0;

  // Pattern 1 (BYO Greens+Grains): no real Base section → 1/2 Base IS the primary → include in cost
  // Pattern 2/3 (BYO Grain/Salad): real Base section exists → 1/2 Base is sub-table → exclude
  const { totalModCost, isPattern1 } = computeTotalModCost(sections);
  const baseCost     = effectiveChannel === 'ih' ? (activeItem?.base_cost_ih ?? 0) : (activeItem?.base_cost_online ?? 0);
  const activeQty    = effectiveChannel === 'ih' ? ihQty : onlineQty;
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
          /* ── IH Pink Sheet ── */
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
              {isActiveZeroBase && (
                <div style={{ fontSize: 10, color: '#166534', marginTop: 6, fontStyle: 'italic' }}>
                  Channel-agnostic item — cost below mirrors the Online weighted average (this item has no cost basis of its own in-house).
                </div>
              )}
            </div>

            {sections.map(sec => (
              <SectionTable
                key={sec.displayName}
                sec={sec}
                hdrBg="#f0fdf4"   hdrColor="#15803d"
                totalBg="#dcfce7" totalColor="#15803d"
                forcePlain={sec.rank === 2 && isPattern1}
              />
            ))}

            <div className="tw">
              <table style={{ width: '100%' }}>
                <tbody>
                  <tr style={{ background: '#dcfce7', borderTop: '2px solid #86efac' }}>
                    <td colSpan={2} style={{ fontWeight: 700, color: '#14532d', padding: '6px 8px' }}>
                      AVG COST OF {activeItem.canonical_name.toUpperCase()} (IN HOUSE)
                    </td>
                    <td style={{ fontSize: 10, color: 'var(--muted)', textAlign: 'center' }}>r365 IH base cost</td>
                    <td style={{ textAlign: 'center', fontWeight: 800, color: '#14532d' }}>
                      {fmt$(activeItem.base_cost_ih)}
                    </td>
                  </tr>
                  <tr style={{ background: '#fff7ed' }}>
                    <td colSpan={2} style={{ fontWeight: 700, color: '#c2410c', padding: '6px 8px' }}>
                      TOTAL MODIFIER COST
                    </td>
                    <td style={{ fontSize: 10, color: 'var(--muted)', textAlign: 'center' }}>Σ all section totals</td>
                    <td style={{ textAlign: 'center', fontWeight: 800, color: '#c2410c' }}>
                      {fmt$(totalModCost)}
                    </td>
                  </tr>
                  <tr style={{ background: '#eff6ff' }}>
                    <td colSpan={2} style={{ fontWeight: 700, color: '#1d4ed8', padding: '6px 8px' }}>
                      TOTAL AVG COST
                    </td>
                    <td style={{ fontSize: 10, color: 'var(--muted)', textAlign: 'center' }}>
                      base × IH qty ({ihQty.toLocaleString()})
                    </td>
                    <td style={{ textAlign: 'center', fontWeight: 800, color: '#1d4ed8' }}>
                      {fmt$(totalAvgCost)}
                    </td>
                  </tr>
                  <tr style={{ background: '#f0fdf4' }}>
                    <td colSpan={2} style={{ fontWeight: 700, color: '#15803d', padding: '6px 8px' }}>
                      MODIFIER + AVG COST
                    </td>
                    <td style={{ fontSize: 10, color: 'var(--muted)', textAlign: 'center' }}>
                      total mod cost + total avg cost
                    </td>
                    <td style={{ textAlign: 'center', fontWeight: 800, color: '#15803d' }}>
                      {fmt$(modPlusAvg)}
                    </td>
                  </tr>
                  <tr style={{ background: '#ecfdf5', borderTop: '2px solid #6ee7b7' }}>
                    <td colSpan={2} style={{ fontWeight: 800, fontSize: 13, color: '#065f46', padding: '8px 8px' }}>
                      FINAL AVG COST WITH MODIFIER (IN HOUSE)
                    </td>
                    <td style={{ fontSize: 10, color: 'var(--muted)', textAlign: 'center' }}>
                      (mod + avg) ÷ IH qty
                    </td>
                    <td style={{ textAlign: 'center', fontWeight: 900, fontSize: 14, color: '#065f46' }}>
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
              <>
                {sections.map(sec => (
                  <SectionTable
                    key={sec.displayName}
                    sec={sec}
                    hdrBg="#fdf4ff"   hdrColor="#7e22ce"
                    totalBg="#f5f3ff" totalColor="#5b21b6"
                    forcePlain={sec.rank === 2 && isPattern1}
                  />
                ))}

                <div className="tw">
                  <table style={{ width: '100%' }}>
                    <tbody>
                      <tr style={{ background: '#fce7f3', borderTop: '2px solid #f9a8d4' }}>
                        <td colSpan={2} style={{ fontWeight: 700, color: '#9d174d', padding: '6px 8px' }}>
                          AVG COST OF {activeItem.canonical_name.toUpperCase()}
                        </td>
                        <td style={{ fontSize: 10, color: 'var(--muted)', textAlign: 'center' }}>r365 base (delivery)</td>
                        <td style={{ textAlign: 'center', fontWeight: 800, color: '#9d174d' }}>
                          {fmt$(activeItem.base_cost_online)}
                        </td>
                      </tr>
                      <tr style={{ background: '#fff7ed' }}>
                        <td colSpan={2} style={{ fontWeight: 700, color: '#c2410c', padding: '6px 8px' }}>
                          TOTAL MODIFIER COST
                        </td>
                        <td style={{ fontSize: 10, color: 'var(--muted)', textAlign: 'center' }}>Σ all section totals</td>
                        <td style={{ textAlign: 'center', fontWeight: 800, color: '#c2410c' }}>
                          {fmt$(totalModCost)}
                        </td>
                      </tr>
                      <tr style={{ background: '#eff6ff' }}>
                        <td colSpan={2} style={{ fontWeight: 700, color: '#1d4ed8', padding: '6px 8px' }}>
                          TOTAL AVG COST
                        </td>
                        <td style={{ fontSize: 10, color: 'var(--muted)', textAlign: 'center' }}>
                          base × online qty ({activeQty.toLocaleString()})
                        </td>
                        <td style={{ textAlign: 'center', fontWeight: 800, color: '#1d4ed8' }}>
                          {fmt$(totalAvgCost)}
                        </td>
                      </tr>
                      <tr style={{ background: '#f0fdf4' }}>
                        <td colSpan={2} style={{ fontWeight: 700, color: '#15803d', padding: '6px 8px' }}>
                          MODIFIER + AVG COST
                        </td>
                        <td style={{ fontSize: 10, color: 'var(--muted)', textAlign: 'center' }}>
                          total mod cost + total avg cost
                        </td>
                        <td style={{ textAlign: 'center', fontWeight: 800, color: '#15803d' }}>
                          {fmt$(modPlusAvg)}
                        </td>
                      </tr>
                      <tr style={{ background: '#ecfdf5', borderTop: '2px solid #6ee7b7' }}>
                        <td colSpan={2} style={{ fontWeight: 800, fontSize: 13, color: '#065f46', padding: '8px 8px' }}>
                          FINAL AVG COST WITH MODIFIER
                        </td>
                        <td style={{ fontSize: 10, color: 'var(--muted)', textAlign: 'center' }}>
                          (mod + avg) ÷ online qty
                        </td>
                        <td style={{ textAlign: 'center', fontWeight: 900, fontSize: 14, color: '#065f46' }}>
                          {fmt2(finalAvgCost)}
                        </td>
                      </tr>
                      <tr style={{ background: '#f5f3ff' }}>
                        <td colSpan={2} style={{ fontWeight: 700, color: '#6d28d9', padding: '6px 8px' }}>
                          FINAL AVG COST — 3PD (×1.18)
                        </td>
                        <td style={{ fontSize: 10, color: 'var(--muted)', textAlign: 'center' }}>packaging uplift</td>
                        <td style={{ textAlign: 'center', fontWeight: 800, color: '#6d28d9' }}>
                          {fmt2(finalAvgCost * 1.18)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
