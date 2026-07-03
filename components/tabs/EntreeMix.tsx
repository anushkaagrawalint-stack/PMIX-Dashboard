'use client';
import { useState, useMemo, useRef, useEffect } from 'react';
import type { PinkSheetRow, PinkSheetDetailRow, MERow } from '@/lib/types';

// ─── Formatters ───────────────────────────────────────────────────────────────
const fmt$2 = (v: number) =>
  `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmt$4 = (v: number) =>
  `$${v.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;

// ─── Section rank / display name ─────────────────────────────────────────────
const SECTION_RANK: [string, number][] = [
  ['1/2 base', 2], ['base', 1], ['extra main', 5], ['1/2 main', 4], ['main', 3],
  ['extra veggie', 6], ['sauce', 7], ['veggie', 8], ['topping', 9],
  ['chutney', 10], ['make it', 11],
];
function sectionRank(s: string): number {
  const l = s.toLowerCase();
  for (const [k, r] of SECTION_RANK) if (l.includes(k)) return r;
  return 99;
}
const CANONICAL: Record<string, string> = {
  'bases':'Base','base':'Base','1/2 base':'1/2 Base','1/2 bases':'1/2 Base',
  'main':'Main','mains':'Main','1/2 main':'1/2 Main','1/2 mains':'1/2 Main',
  'extra main':'Extra Main','extra mains':'Extra Main',
  'sauce':'Sauce','sauces':'Sauce','veggie':'Veggie','veggies':'Veggie',
  'extra veggie':'Extra Veggie','extra veggies':'Extra Veggie',
  'topping':'Topping','toppings':'Topping',
  'chutney + dressing':'Chutney + Dressing','chutney and dressing':'Chutney + Dressing',
  'chutney & dressing':'Chutney + Dressing','chutney':'Chutney + Dressing',
  'make it meal':'Make It Meal','make it':'Make It Meal',
  'side':'Make It Meal','drink':'Make It Meal','sweet':'Make It Meal',
};
function effectiveDisplayName(s: string): string {
  const m = s.match(/^[^-]+-\s*(.+)$/);
  const stripped = m ? m[1].trim() : s;
  return CANONICAL[stripped.toLowerCase()] ?? stripped;
}

interface SectionData {
  rawKeys: string[]; displayName: string; rank: number;
  mods: PinkSheetDetailRow[]; sectionTotal: number;
}
function buildSections(dets: PinkSheetDetailRow[]): SectionData[] {
  const by: Record<string, { rawKeys: Set<string>; rank: number; mods: PinkSheetDetailRow[] }> = {};
  for (const d of dets) {
    const dn = effectiveDisplayName(d.section);
    if (!by[dn]) by[dn] = { rawKeys: new Set(), rank: sectionRank(d.section), mods: [] };
    by[dn].rawKeys.add(d.section);
    by[dn].mods.push(d);
  }
  return Object.entries(by)
    .sort(([, a], [, b]) => a.rank - b.rank)
    .map(([displayName, { rawKeys, rank, mods }]) => ({
      rawKeys: [...rawKeys], displayName, rank,
      mods: [...mods].sort((a, b) => b.qty - a.qty),
      sectionTotal: mods.reduce((s, m) => s + m.total_cost, 0),
    }));
}
function applyHalfHalf(sections: SectionData[]): SectionData[] {
  const hb = sections.find(s => s.rank === 2);
  const hm = sections.find(s => s.rank === 4);
  const hbA = hb ? hb.sectionTotal / Math.max(hb.mods.reduce((s, m) => s + m.qty, 0), 1) : 0;
  const hmA = hm ? hm.sectionTotal / Math.max(hm.mods.reduce((s, m) => s + m.qty, 0), 1) : 0;
  return sections.map(sec => {
    const fixed = sec.mods.map(m => {
      if (m.unit_cost > 0) return m;
      const l = m.modifier_name.toLowerCase();
      if (l.startsWith('1/2 and 1/2') && !l.includes('main') && hbA > 0)
        return { ...m, unit_cost: hbA, total_cost: hbA * m.qty };
      if ((l === '1/2 and 1/2 mains' || l === '1/2 and 1/2 main') && hmA > 0)
        return { ...m, unit_cost: hmA, total_cost: hmA * m.qty };
      return m;
    });
    return { ...sec, mods: fixed, sectionTotal: fixed.reduce((s, m) => s + m.total_cost, 0) };
  });
}

// ─── Sub-category theme colors ─────────────────────────────────────────────
const GROUP_THEME: Record<string, { bg: string; accent: string; light: string }> = {
  'BYO Bowls':           { bg: '#7c3aed', accent: '#6d28d9', light: '#ede9fe' },
  'Bowls':               { bg: '#2563eb', accent: '#1d4ed8', light: '#dbeafe' },
  'Classic Indian Plates':{ bg: '#d97706', accent: '#b45309', light: '#fef3c7' },
  'Plates':              { bg: '#d97706', accent: '#b45309', light: '#fef3c7' },
  'Burritos':            { bg: '#dc2626', accent: '#b91c1c', light: '#fee2e2' },
  'Sides':               { bg: '#0891b2', accent: '#0e7490', light: '#cffafe' },
  'Kids':                { bg: '#db2777', accent: '#be185d', light: '#fce7f3' },
  'Drinks':              { bg: '#0d9488', accent: '#0f766e', light: '#ccfbf1' },
  'Specialty Items':     { bg: '#7c3aed', accent: '#6d28d9', light: '#ede9fe' },
  'Retail':              { bg: '#64748b', accent: '#475569', light: '#f1f5f9' },
};
function groupTheme(grp: string) {
  return GROUP_THEME[grp] ?? { bg: '#374151', accent: '#1f2937', light: '#f3f4f6' };
}

type ChannelView = 'online' | 'ih';

const RECOGNIZED_SECTIONS = new Set([
  'Base','1/2 Base','Main','1/2 Main','Extra Main','Extra Veggie',
  'Sauce','Veggie','Topping','Chutney + Dressing','Make It Meal',
]);

function mergeSections(sections: SectionData[]): SectionData[] {
  const known   = sections.filter(s => RECOGNIZED_SECTIONS.has(s.displayName));
  const unknown = sections.filter(s => !RECOGNIZED_SECTIONS.has(s.displayName));
  const extraMods = unknown.flatMap(s => s.mods.filter(m => m.unit_cost > 0));
  if (extraMods.length === 0) return known;
  const tIdx = known.findIndex(s => s.displayName === 'Topping');
  if (tIdx >= 0) {
    const t = known[tIdx];
    const merged = [...t.mods, ...extraMods].sort((a, b) => b.qty - a.qty);
    known[tIdx] = { ...t, mods: merged, sectionTotal: merged.reduce((s, m) => s + m.total_cost, 0) };
  } else {
    const mods = [...extraMods].sort((a, b) => b.qty - a.qty);
    known.push({ rawKeys: ['Topping'], displayName: 'Topping', rank: 9, mods, sectionTotal: mods.reduce((s, m) => s + m.total_cost, 0) });
  }
  return known.sort((a, b) => a.rank - b.rank);
}

// ─── Reusable channel column ──────────────────────────────────────────────────
function ChCol({ label, qty, accent, bg, color, sections }: {
  label: string; qty: number; accent: string; bg: string; color: string; sections: SectionData[];
}) {
  return (
    <div style={{ padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase',
          letterSpacing: '.08em', color, background: bg, padding: '3px 8px', borderRadius: 4 }}>
          {label}
        </span>
        <span style={{ fontSize: 10, color: 'var(--muted)' }}>{qty.toLocaleString()} orders</span>
      </div>
      {sections.length === 0
        ? <div style={{ color: 'var(--muted)', fontSize: 11, fontStyle: 'italic', padding: '16px 0', textAlign: 'center' }}>No modifier data</div>
        : sections.map(s => <SecBlock key={s.displayName} sec={s} accent={accent} />)
      }
    </div>
  );
}

const GROUP_ORDER   = ['BYO Bowls','Bowls','Classic Indian Plates','Plates','Burritos','Specialty Items','Kids','Drinks','Sides','Retail'];
const ALL_MOD_TYPES = ['Base','1/2 Base','Main','1/2 Main','Extra Main','Extra Veggie','Sauce','Veggie','Topping','Chutney + Dressing','Make It Meal'];

// ─── Checkbox multi-select dropdown ──────────────────────────────────────────
function CheckDropdown({ label, options, selected, onChange, maxH = 260 }: {
  label: string; options: string[]; selected: Set<string>;
  onChange: (n: Set<string>) => void; maxH?: number;
}) {
  const [open, setOpen] = useState(false);
  const [q,    setQ]    = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) { setQ(''); return; }
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const allSel  = selected.size === 0 || selected.size === options.length;
  const visible = q ? options.filter(o => o.toLowerCase().includes(q.toLowerCase())) : options;

  function toggle(opt: string) {
    const nx = new Set(allSel ? options : selected);
    nx.has(opt) ? nx.delete(opt) : nx.add(opt);
    onChange(nx.size === options.length ? new Set() : nx);
  }

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button onClick={() => setOpen(o => !o)} className="drb" style={{
        background: !allSel ? '#ede9fe' : undefined,
        color: !allSel ? '#5b21b6' : undefined,
        borderColor: !allSel ? '#c4b5fd' : undefined,
        fontSize: 11,
      }}>
        {label}
        {!allSel && (
          <span style={{
            background: '#6d28d9', color: '#fff',
            fontSize: 9, fontWeight: 800, padding: '1px 5px', borderRadius: 10, marginLeft: 2,
          }}>{selected.size}</span>
        )}
        <span style={{ fontSize: 8, opacity: 0.5, marginLeft: 2 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 200, marginTop: 4,
          background: '#fff', border: '1px solid var(--border)',
          borderRadius: 10, boxShadow: '0 8px 32px rgba(0,0,0,.14)',
          minWidth: 210, padding: '6px 0',
        }}>
          {options.length > 8 && (
            <div style={{ padding: '0 8px 6px' }}>
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search…" autoFocus
                style={{ width: '100%', boxSizing: 'border-box', padding: '4px 8px', borderRadius: 5,
                  border: '1px solid var(--border)', fontSize: 11, fontFamily: 'inherit', outline: 'none' }} />
            </div>
          )}
          <div style={{ maxHeight: maxH, overflowY: 'auto' }}>
            {!q && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px',
                cursor: 'pointer', fontSize: 11, fontWeight: 700, color: 'var(--text)',
                borderBottom: '1px solid var(--border)', marginBottom: 2 }}>
                <input type="checkbox" checked={allSel} onChange={() => onChange(new Set())}
                  style={{ accentColor: '#6d28d9', width: 13, height: 13 }} />
                All
              </label>
            )}
            {visible.map(opt => {
              const checked = allSel || selected.has(opt);
              return (
                <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px',
                  cursor: 'pointer', fontSize: 11, color: 'var(--text)',
                  background: checked ? 'rgba(109,40,217,.05)' : 'transparent' }}>
                  <input type="checkbox" checked={checked} onChange={() => toggle(opt)}
                    style={{ accentColor: '#6d28d9', width: 13, height: 13 }} />
                  {opt}
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── COGS badge ───────────────────────────────────────────────────────────────
function CogsBadge({ pct }: { pct: number | null }) {
  if (pct == null) return <span style={{ color: 'var(--muted)', fontSize: 10 }}>—</span>;
  const bg    = pct > 0.35 ? '#fee2e2' : pct > 0.28 ? '#fef9c3' : '#dcfce7';
  const color = pct > 0.35 ? '#991b1b' : pct > 0.28 ? '#92400e' : '#14532d';
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: bg, color }}>
      {(pct * 100).toFixed(1)}%
    </span>
  );
}

// ─── One modifier section ─────────────────────────────────────────────────────
function SecBlock({ sec, accent }: { sec: SectionData; accent: string }) {
  const isHalf   = sec.rank === 2 || sec.rank === 4;
  const totalQty = sec.mods.reduce((s, m) => s + m.qty, 0);
  const wAvg     = isHalf && totalQty > 0 ? sec.sectionTotal / totalQty : 0;

  return (
    <div style={{ marginBottom: 12 }}>
      {/* Section label */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 4,
        borderBottom: `1px solid ${accent}22`, paddingBottom: 3 }}>
        <span style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase',
          letterSpacing: '.06em', color: accent }}>
          {sec.displayName}
        </span>
        <span style={{ fontSize: 9, color: 'var(--muted)' }}>
          {totalQty.toLocaleString()} sel.
        </span>
        {isHalf && (
          <span style={{ fontSize: 9, color: accent, marginLeft: 'auto', fontWeight: 700 }}>
            wtd. avg {fmt$4(wAvg)}
          </span>
        )}
      </div>

      {/* Option rows — name · % · cost, no bars */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {sec.mods.map((m, i) => {
          const pct = totalQty > 0 ? m.qty / totalQty : 0;
          return (
            <div key={m.modifier_name} style={{
              display: 'grid', gridTemplateColumns: '1fr 38px 68px',
              alignItems: 'center', gap: 6,
              padding: '2px 4px', borderRadius: 4,
              background: i % 2 === 0 ? 'transparent' : `${accent}08`,
            }}>
              <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--text)',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {m.modifier_name}
              </span>
              <span style={{ fontSize: 10, fontWeight: 700, textAlign: 'right',
                color: pct >= 0.3 ? accent : 'var(--text)' }}>
                {(pct * 100).toFixed(0)}%
              </span>
              <span style={{ fontSize: 9, textAlign: 'right',
                color: m.unit_cost > 0 ? 'var(--muted)' : 'transparent' }}>
                {m.unit_cost > 0 ? fmt$4(m.unit_cost) : '—'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Aggregate modifier sections across multiple items ────────────────────────
function aggregateSections(
  names: string[],
  ch: 'online' | 'ih',
  allDetails: PinkSheetDetailRow[],
  modTypeFilter: Set<string>,
): SectionData[] {
  // Sum qty + total_cost per (displayName, modifier_name) across all selected items
  const bySecMod: Record<string, Record<string, { qty: number; total_cost: number }>> = {};
  allDetails
    .filter(d => names.includes(d.parent_item) && d.channel === ch)
    .forEach(d => {
      const dn = effectiveDisplayName(d.section);
      if (!bySecMod[dn]) bySecMod[dn] = {};
      if (!bySecMod[dn][d.modifier_name]) bySecMod[dn][d.modifier_name] = { qty: 0, total_cost: 0 };
      bySecMod[dn][d.modifier_name].qty        += d.qty;
      bySecMod[dn][d.modifier_name].total_cost += d.total_cost;
    });

  const sections: SectionData[] = Object.entries(bySecMod).map(([displayName, modMap]) => {
    const mods: PinkSheetDetailRow[] = Object.entries(modMap).map(([modifier_name, { qty, total_cost }]) => ({
      parent_item: '__overall__', section: displayName, channel: ch,
      modifier_name, qty,
      unit_cost:   qty > 0 ? total_cost / qty : 0,
      total_cost,
    })).sort((a, b) => b.qty - a.qty);
    return {
      rawKeys: [displayName], displayName,
      rank: sectionRank(displayName),
      mods,
      sectionTotal: mods.reduce((s, m) => s + m.total_cost, 0),
    };
  }).sort((a, b) => a.rank - b.rank);

  const merged = mergeSections(sections);
  return modTypeFilter.size === 0
    ? merged
    : merged.filter(s => modTypeFilter.has(s.displayName));
}

// ─── Overall card (shown when multiple items selected) ────────────────────────
function OverallCard({
  selectedNames, psMap, pinkSheetDetails, modTypeFilter, mePriceMap, channelView,
}: {
  selectedNames: string[];
  psMap: Map<string, PinkSheetRow>;
  pinkSheetDetails: PinkSheetDetailRow[];
  modTypeFilter: Set<string>;
  mePriceMap: Map<string, { ih: number; lo: number }>;
  channelView: ChannelView;
}) {
  const [collapsed, setCollapsed] = useState(false);

  const sheets = selectedNames.map(n => psMap.get(n)).filter(Boolean) as PinkSheetRow[];

  const totalIH     = sheets.reduce((s, p) => s + p.ih_qty,     0);
  const totalOnline = sheets.reduce((s, p) => s + p.online_qty, 0);

  // Weighted avg cost across selected items
  const wtdCostIH = sheets.reduce((s, p) => s + p.avg_cost_ih * p.ih_qty, 0) /
                    Math.max(totalIH, 1);
  const wtdCostOnline = sheets.reduce((s, p) => s + p.avg_cost_online * p.online_qty, 0) /
                        Math.max(totalOnline, 1);

  // Weighted avg COGS%
  const wtdCogsIH = (() => {
    let wNum = 0, wDen = 0;
    sheets.forEach(p => {
      const me = mePriceMap.get(p.canonical_name);
      if (me && me.ih > 0 && p.avg_cost_ih > 0) {
        wNum += (p.avg_cost_ih / me.ih) * p.ih_qty;
        wDen += p.ih_qty;
      }
    });
    return wDen > 0 ? wNum / wDen : null;
  })();
  const wtdCogsOnline = (() => {
    let wNum = 0, wDen = 0;
    sheets.forEach(p => {
      const me = mePriceMap.get(p.canonical_name);
      if (me && me.lo > 0 && p.avg_cost_online > 0) {
        wNum += (p.avg_cost_online / me.lo) * p.online_qty;
        wDen += p.online_qty;
      }
    });
    return wDen > 0 ? wNum / wDen : null;
  })();

  const onlineSecs = aggregateSections(selectedNames, 'online', pinkSheetDetails, modTypeFilter);
  const ihSecs     = aggregateSections(selectedNames, 'ih',     pinkSheetDetails, modTypeFilter);

  return (
    <div style={{
      background: '#fff', borderRadius: 12, marginBottom: 12,
      border: '2px solid #6d28d9',
      boxShadow: '0 4px 20px rgba(109,40,217,.12)',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #1e1b4b 0%, #4c1d95 100%)',
        padding: '10px 14px', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 10,
      }} onClick={() => setCollapsed(c => !c)}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
            <span style={{ fontWeight: 800, fontSize: 13, color: '#fff' }}>
              Overall — {selectedNames.length} items
            </span>
            <span style={{ fontSize: 9, background: 'rgba(255,255,255,.15)', color: '#c4b5fd',
              padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>
              COMBINED
            </span>
          </div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            {[
              { l: 'IH orders',     v: totalIH.toLocaleString() },
              { l: 'Online orders', v: totalOnline.toLocaleString() },
              { l: 'Wtd. cost IH',     v: wtdCostIH > 0     ? fmt$2(wtdCostIH)     : '—' },
              { l: 'Wtd. cost Online', v: wtdCostOnline > 0 ? fmt$2(wtdCostOnline) : '—' },
            ].map(({ l, v }) => (
              <span key={l} style={{ fontSize: 10, color: 'rgba(255,255,255,.65)' }}>
                <span style={{ fontWeight: 700, color: '#fff' }}>{v}</span>{' '}{l}
              </span>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ fontSize: 9, color: 'rgba(255,255,255,.5)', fontWeight: 600 }}>IH</span>
            <CogsBadge pct={wtdCogsIH} />
          </div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ fontSize: 9, color: 'rgba(255,255,255,.5)', fontWeight: 600 }}>ONL</span>
            <CogsBadge pct={wtdCogsOnline} />
          </div>
        </div>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,.6)', marginLeft: 8,
          display: 'inline-block', transform: collapsed ? 'rotate(-90deg)' : 'none', transition: 'transform .2s' }}>
          ▼
        </span>
      </div>

      {/* Body */}
      {!collapsed && (
        <div>
          {channelView === 'online' && (
            <ChCol label="Online · LO + 3PD" qty={totalOnline} sections={onlineSecs}
              accent="#be185d" bg="#fce7f3" color="#9d174d" />
          )}
          {channelView === 'ih' && (
            <ChCol label="In-House" qty={totalIH} sections={ihSecs}
              accent="#15803d" bg="#dcfce7" color="#14532d" />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Item detail card ─────────────────────────────────────────────────────────
function ItemCard({
  ps, pinkSheetDetails, modTypeFilter, mePriceMap, onClose, theme, channelView,
}: {
  ps: PinkSheetRow; pinkSheetDetails: PinkSheetDetailRow[];
  modTypeFilter: Set<string>; mePriceMap: Map<string, { ih: number; lo: number }>;
  onClose: () => void; theme: { bg: string; accent: string; light: string };
  channelView: ChannelView;
}) {
  const [collapsed, setCollapsed] = useState(false);

  const getSections = (ch: 'online' | 'ih') => {
    const raw    = buildSections(pinkSheetDetails.filter(d => d.parent_item === ps.canonical_name && d.channel === ch));
    const full   = mergeSections(applyHalfHalf(raw));
    return modTypeFilter.size === 0 ? full : full.filter(s => modTypeFilter.has(s.displayName));
  };
  const onlineSecs = getSections('online');
  const ihSecs     = getSections('ih');

  const me         = mePriceMap.get(ps.canonical_name);
  const meIH       = me?.ih ?? 0;
  const meLO       = me?.lo ?? 0;
  const cogsIH     = meIH > 0 && ps.avg_cost_ih > 0     ? ps.avg_cost_ih / meIH     : null;
  const cogsOnline = meLO > 0 && ps.avg_cost_online > 0 ? ps.avg_cost_online / meLO : null;

  return (
    <div style={{
      background: '#fff', borderRadius: 12, marginBottom: 12,
      border: '1px solid var(--border)',
      boxShadow: '0 2px 8px rgba(0,0,0,.06)',
      overflow: 'hidden',
    }}>
      {/* Card header */}
      <div style={{
        background: `linear-gradient(135deg, ${theme.bg} 0%, ${theme.accent} 100%)`,
        padding: '10px 14px',
        display: 'flex', alignItems: 'center', gap: 10,
        cursor: 'pointer',
      }} onClick={() => setCollapsed(c => !c)}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: 13, color: '#fff', marginBottom: 2 }}>
            {ps.canonical_name}
          </div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            {[
              { l: 'IH',     v: ps.ih_qty > 0     ? ps.ih_qty.toLocaleString()     : '—' },
              { l: 'Online', v: ps.online_qty > 0  ? ps.online_qty.toLocaleString() : '—' },
              { l: 'Cost IH',     v: ps.avg_cost_ih > 0     ? fmt$2(ps.avg_cost_ih)     : '—' },
              { l: 'Cost Online', v: ps.avg_cost_online > 0 ? fmt$2(ps.avg_cost_online) : '—' },
              { l: 'Cost 3PD',    v: ps.avg_cost_3pd > 0    ? fmt$2(ps.avg_cost_3pd)    : '—' },
            ].map(({ l, v }) => (
              <span key={l} style={{ fontSize: 10, color: 'rgba(255,255,255,.75)' }}>
                <span style={{ fontWeight: 700, color: '#fff' }}>{v}</span>{' '}{l}
              </span>
            ))}
          </div>
        </div>
        {/* COGS badges */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ fontSize: 9, color: 'rgba(255,255,255,.6)', fontWeight: 600 }}>IH</span>
            <CogsBadge pct={cogsIH} />
          </div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ fontSize: 9, color: 'rgba(255,255,255,.6)', fontWeight: 600 }}>ONL</span>
            <CogsBadge pct={cogsOnline} />
          </div>
        </div>
        {/* Collapse + close */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 8 }}>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,.7)', transition: 'transform .2s',
            display: 'inline-block', transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>▼</span>
          <button onClick={e => { e.stopPropagation(); onClose(); }}
            style={{ background: 'rgba(255,255,255,.2)', border: 'none', borderRadius: 4,
              color: '#fff', fontSize: 13, cursor: 'pointer', padding: '2px 6px', lineHeight: 1 }}>
            ✕
          </button>
        </div>
      </div>

      {/* Body */}
      {!collapsed && (
        <div>
          {channelView === 'online' && (
            <ChCol label="Online · LO + 3PD" qty={ps.online_qty} sections={onlineSecs}
              accent="#be185d" bg="#fce7f3" color="#9d174d" />
          )}
          {channelView === 'ih' && (
            <ChCol label="In-House" qty={ps.ih_qty} sections={ihSecs}
              accent="#15803d" bg="#dcfce7" color="#14532d" />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Props ───────────────────────────────────────────────────────────────────
interface Props { pinkSheets: PinkSheetRow[]; pinkSheetDetails: PinkSheetDetailRow[]; meItems: MERow[]; }

export default function EntreeMix({ pinkSheets, pinkSheetDetails, meItems }: Props) {
  const [selected,      setSelected]      = useState<Set<string>>(new Set());
  const [collapsedGrps, setCollapsedGrps] = useState<Record<string, boolean>>({});
  const [search,        setSearch]        = useState('');
  const [modTypeFilter, setModTypeFilter] = useState<Set<string>>(new Set());
  const [channelView,   setChannelView]   = useState<ChannelView>('online');

  const mePriceMap = useMemo(() => {
    const m = new Map<string, { ih: number; lo: number }>();
    (meItems ?? []).forEach(i => m.set(i.canonical_name, { ih: i.avg_price_ih, lo: i.avg_price_lo }));
    return m;
  }, [meItems]);

  const psMap = useMemo(() => {
    const m = new Map<string, PinkSheetRow>();
    (pinkSheets ?? []).forEach(r => m.set(r.canonical_name, r));
    return m;
  }, [pinkSheets]);

  // Build grouped structure — filtered by selected channel
  const grouped = useMemo(() => {
    const q = search.toLowerCase();
    const g: Record<string, PinkSheetRow[]> = {};
    (pinkSheets ?? []).forEach(r => {
      if (q && !r.canonical_name.toLowerCase().includes(q)) return;
      if (channelView === 'online' && r.online_qty <= 0) return;
      if (channelView === 'ih'     && r.ih_qty     <= 0) return;
      const grp = r.menu_group || 'Other';
      if (!g[grp]) g[grp] = [];
      g[grp].push(r);
    });
    Object.values(g).forEach(arr =>
      arr.sort((a, b) => (b.online_qty + b.ih_qty) - (a.online_qty + a.ih_qty))
    );
    return g;
  }, [pinkSheets, search, channelView]);

  const groupOrder = useMemo(() => {
    const all = Object.keys(grouped);
    return [...GROUP_ORDER.filter(g => all.includes(g)), ...all.filter(g => !GROUP_ORDER.includes(g)).sort()];
  }, [grouped]);

  function toggleItem(name: string) {
    setSelected(s => {
      const nx = new Set(s);
      nx.has(name) ? nx.delete(name) : nx.add(name);
      return nx;
    });
  }
  function toggleGroup(grp: string) {
    const items = (grouped[grp] ?? []).map(r => r.canonical_name);
    const allIn = items.every(n => selected.has(n));
    setSelected(s => {
      const nx = new Set(s);
      if (allIn) items.forEach(n => nx.delete(n));
      else items.forEach(n => nx.add(n));
      return nx;
    });
  }
  function toggleCollapse(grp: string) {
    setCollapsedGrps(c => ({ ...c, [grp]: !c[grp] }));
  }
  function removeItem(name: string) {
    setSelected(s => { const nx = new Set(s); nx.delete(name); return nx; });
  }

  // Compute COGS health dot for each item in sidebar — respects channelView
  function cogsColor(ps: PinkSheetRow): string {
    const me = mePriceMap.get(ps.canonical_name);
    if (!me) return '#d1d5db';
    const pct = channelView === 'online' && me.lo > 0 && ps.avg_cost_online > 0
      ? ps.avg_cost_online / me.lo
      : channelView === 'ih' && me.ih > 0 && ps.avg_cost_ih > 0
      ? ps.avg_cost_ih / me.ih
      : null;
    if (pct == null) return '#d1d5db';
    return pct > 0.35 ? '#ef4444' : pct > 0.28 ? '#f59e0b' : '#10b981';
  }

  // Items to render on right, in group order
  const rightItems = useMemo(() => {
    const result: { ps: PinkSheetRow; theme: ReturnType<typeof groupTheme> }[] = [];
    groupOrder.forEach(grp => {
      (grouped[grp] ?? []).forEach(ps => {
        if (selected.has(ps.canonical_name)) result.push({ ps, theme: groupTheme(grp) });
      });
    });
    return result;
  }, [selected, grouped, groupOrder]);

  if (!pinkSheets?.length) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>No pink sheet data for this period.</div>;
  }

  const totalCount = Object.values(grouped).reduce((s, a) => s + a.length, 0);

  return (
    <div style={{ display: 'flex', gap: 0, alignItems: 'flex-start' }}>

      {/* ── LEFT SIDEBAR — sticky ─────────────────────────────────────────────── */}
      <div style={{
        width: 248, minWidth: 220, flexShrink: 0,
        display: 'flex', flexDirection: 'column',
        background: '#fafaf9',
        borderRight: '1px solid var(--border)',
        borderRadius: 12,
        overflow: 'hidden',
        position: 'sticky',
        top: 8,
        maxHeight: 'calc(100vh - 90px)',
      }}>
        {/* Sidebar header */}
        <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid var(--border)', background: '#fff' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 12, color: 'var(--text)' }}>Entree Mix</div>
              <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 1 }}>
                {totalCount} items · {selected.size} selected
              </div>
            </div>
            {selected.size > 0 && (
              <button onClick={() => setSelected(new Set())} style={{
                fontSize: 9, fontWeight: 700, color: '#6d28d9', border: '1px solid #c4b5fd',
                background: '#ede9fe', borderRadius: 5, padding: '3px 7px', cursor: 'pointer',
                fontFamily: 'inherit',
              }}>Clear</button>
            )}
          </div>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search items…" className="srch"
            style={{ width: '100%', boxSizing: 'border-box', fontSize: 11 }} />
        </div>

        {/* Grouped item list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {groupOrder.map(grp => {
            const rows   = grouped[grp] ?? [];
            const theme  = groupTheme(grp);
            const isOpen = !collapsedGrps[grp];
            const allIn  = rows.length > 0 && rows.every(r => selected.has(r.canonical_name));
            const someIn = rows.some(r => selected.has(r.canonical_name));

            return (
              <div key={grp}>
                {/* Group header */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px',
                  background: '#fff', borderBottom: '1px solid var(--border)',
                  borderLeft: `3px solid ${theme.bg}`, cursor: 'pointer',
                  userSelect: 'none',
                }}>
                  {/* Collapse toggle */}
                  <span onClick={() => toggleCollapse(grp)}
                    style={{ fontSize: 8, color: 'var(--muted)', transition: 'transform .15s',
                      display: 'inline-block', transform: isOpen ? 'rotate(90deg)' : 'none', flexShrink: 0 }}>
                    ▶
                  </span>
                  {/* Group checkbox */}
                  <span onClick={() => toggleGroup(grp)} style={{
                    width: 13, height: 13, borderRadius: 3, border: `1.5px solid ${allIn ? theme.bg : someIn ? theme.bg : '#d1d5db'}`,
                    background: allIn ? theme.bg : someIn ? theme.light : 'transparent',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0, cursor: 'pointer', transition: 'all .12s',
                  }}>
                    {allIn && <span style={{ fontSize: 8, color: '#fff', fontWeight: 900 }}>✓</span>}
                    {!allIn && someIn && <span style={{ width: 5, height: 5, borderRadius: 1, background: theme.bg, display: 'block' }} />}
                  </span>
                  <span onClick={() => toggleCollapse(grp)} style={{
                    flex: 1, fontSize: 10, fontWeight: 700, color: 'var(--text)',
                    textTransform: 'uppercase', letterSpacing: '.03em',
                  }}>
                    {grp}
                  </span>
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 10,
                    background: theme.light, color: theme.accent,
                  }}>{rows.length}</span>
                </div>

                {/* Item rows */}
                {isOpen && rows.map(ps => {
                  const isSel = selected.has(ps.canonical_name);
                  const dot   = cogsColor(ps);
                  return (
                    <div key={ps.canonical_name} onClick={() => toggleItem(ps.canonical_name)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 7, padding: '6px 10px 6px 18px',
                        cursor: 'pointer', borderBottom: '1px solid #f3f4f6',
                        background: isSel ? theme.light : 'transparent',
                        transition: 'background .1s',
                      }}>
                      {/* Checkbox */}
                      <span style={{
                        width: 12, height: 12, borderRadius: 3, flexShrink: 0,
                        border: `1.5px solid ${isSel ? theme.bg : '#d1d5db'}`,
                        background: isSel ? theme.bg : 'transparent',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'all .12s',
                      }}>
                        {isSel && <span style={{ fontSize: 7, color: '#fff', fontWeight: 900, lineHeight: 1 }}>✓</span>}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: 11, fontWeight: isSel ? 700 : 400, color: isSel ? theme.accent : 'var(--text)',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                          {ps.canonical_name}
                        </div>
                        <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 1 }}>
                          {channelView === 'ih'
                            ? (ps.ih_qty > 0 ? `${ps.ih_qty.toLocaleString()} orders` : '—')
                            : (ps.online_qty > 0 ? `${ps.online_qty.toLocaleString()} orders` : '—')}
                        </div>
                      </div>
                      {/* COGS health dot */}
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot, flexShrink: 0 }} title="COGS% health" />
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Sidebar footer — COGS legend */}
        <div style={{ padding: '7px 12px', borderTop: '1px solid var(--border)', background: '#fff',
          display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {[['#10b981','< 28%'],['#f59e0b','28–35%'],['#ef4444','> 35%']].map(([c,l]) => (
            <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: 'var(--muted)' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: c, display: 'inline-block' }} />
              {l}
            </span>
          ))}
        </div>
      </div>

      {/* ── RIGHT CONTENT ────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, paddingLeft: 14, minWidth: 0 }}>

        {/* Top bar */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
          paddingBottom: 10, borderBottom: '1px solid var(--border)', flexWrap: 'wrap',
        }}>
          {/* Channel view pills */}
          <div style={{ display: 'flex', background: '#f3f4f6', borderRadius: 8, padding: 3, gap: 2 }}>
            {([['online','Online'],['ih','In-House']] as [ChannelView,string][]).map(([v, l]) => (
              <button key={v} onClick={() => setChannelView(v)} style={{
                padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
                fontFamily: 'inherit', fontSize: 11, fontWeight: 700, transition: 'all .12s',
                background: channelView === v
                  ? (v === 'online' ? '#fce7f3' : '#dcfce7')
                  : 'transparent',
                color: channelView === v
                  ? (v === 'online' ? '#9d174d' : '#14532d')
                  : 'var(--muted)',
                boxShadow: channelView === v ? '0 1px 4px rgba(0,0,0,.1)' : 'none',
              }}>{l}</button>
            ))}
          </div>

          <CheckDropdown label="Modifier type" options={ALL_MOD_TYPES}
            selected={modTypeFilter} onChange={setModTypeFilter} />

          {selected.size > 0 && (
            <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 'auto' }}>
              {rightItems.length} item{rightItems.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Cards */}
        {selected.size === 0 ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', color: 'var(--muted)', textAlign: 'center', gap: 10 }}>
            <div style={{ fontSize: 32 }}>🍽️</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Select items to analyse</div>
            <div style={{ fontSize: 12 }}>
              Pick items from the sidebar — click individual rows or use the group checkbox to select all in a category.
            </div>
          </div>
        ) : (
          <>
            {/* Overall card — shown only when 2+ items selected */}
            {selected.size >= 2 && (
              <OverallCard
                selectedNames={rightItems.map(({ ps }) => ps.canonical_name)}
                psMap={psMap}
                pinkSheetDetails={pinkSheetDetails ?? []}
                modTypeFilter={modTypeFilter}
                mePriceMap={mePriceMap}
                channelView={channelView}
              />
            )}
            {/* Individual item cards */}
            {rightItems.map(({ ps, theme }) => (
              <ItemCard
                key={ps.canonical_name}
                ps={ps}
                pinkSheetDetails={pinkSheetDetails ?? []}
                modTypeFilter={modTypeFilter}
                mePriceMap={mePriceMap}
                onClose={() => removeItem(ps.canonical_name)}
                theme={theme}
                channelView={channelView}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
