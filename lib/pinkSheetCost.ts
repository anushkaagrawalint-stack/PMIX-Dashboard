// Shared section-building + "final avg cost" logic — single source of truth for the
// number Pink Sheets displays as "FINAL AVG COST WITH MODIFIER". Extracted from
// PinkSheets.tsx so Menu Engineering / Item Mix can pull the EXACT same number instead
// of the backend's raw avg_cost_online/avg_cost_ih fields, which don't apply these
// rules (always exclude 1/2 Main, exclude 1/2 Base unless there's no real Base section,
// and re-price "1/2 and 1/2" composite rows from the other real half-modifiers' costs).
import type { PinkSheetRow, PinkSheetDetailRow } from './types';

const SECTION_RANK: [string, number][] = [
  ['1/2 base',      2],
  ['base',          1],
  ['extra main',    5],
  ['1/2 main',      4],
  ['main',          3],
  ['extra veggie',  6],
  ['sauce',         7],
  ['veggie',        8],
  ['topping',       9],
  ['chutney',      10],
  ['make it',      11],
];
export function sectionRank(s: string): number {
  const l = s.toLowerCase();
  for (const [k, r] of SECTION_RANK) if (l.includes(k)) return r;
  return 99;
}

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

export function effectiveDisplayName(s: string): string {
  const m = s.match(/^[^-]+-\s*(.+)$/);
  const stripped = m ? m[1].trim() : s;
  return CANONICAL[stripped.toLowerCase()] ?? stripped;
}

export interface SectionData {
  rawKeys:      string[];
  displayName:  string;
  rank:         number;
  mods:         PinkSheetDetailRow[];
  sectionTotal: number;
}

export function buildSections(dets: PinkSheetDetailRow[]): SectionData[] {
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

export function applyHalfHalfCosts(sections: SectionData[]): SectionData[] {
  const halfBase = sections.find(s => s.rank === 2);
  const halfMain = sections.find(s => s.rank === 4);
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
      if (l.startsWith('1/2 and 1/2') && !l.includes('main') && halfBaseAvgUnit > 0) {
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

// Given already-built (and half-half-adjusted) sections, the same inclusion rule
// PinkSheets.tsx uses for its displayed "TOTAL MODIFIER COST".
export function computeTotalModCost(sections: SectionData[]): { totalModCost: number; isPattern1: boolean } {
  const baseSection = sections.find(s => s.rank === 1);
  const hasRealBase = !!baseSection?.mods.some(m => !m.modifier_name.toLowerCase().startsWith('skip'));
  const isPattern1  = !hasRealBase && sections.some(s => s.rank === 2 && s.mods.length > 0);
  const totalModCost = sections
    .filter(s => {
      if (s.rank === 4) return false;                              // always exclude 1/2 Main
      if (s.rawKeys.some(k => k === 'Plate - Main')) return false;  // protein shown but not added to cost
      if (s.rank === 2) return isPattern1;                          // 1/2 Base: include only in Pattern 1
      return true;
    })
    .reduce((s, sec) => s + sec.sectionTotal, 0);
  return { totalModCost, isPattern1 };
}

// Zero-baseCost items (Sides, Homemade Juice) are channel-agnostic: their IH cost is
// EXACTLY the online weighted-average modifier cost, never recomputed from IH's own
// (often sparse or nonexistent) modifier orders. AppScript: "single online pink sheet
// ... valid for all channels." Homemade Juice specifically has ZERO IH modifier rows
// at all (flavor choice only happens online), so computing IH independently gives $0.
export const ZERO_BASE_ITEMS = new Set([
  'Side of Main', 'Side of Grain', 'Side of Sauce', 'Side of Veggie',
  'Homemade Juice', 'Handcrafted Juice for a Group - 1/2 Gallon',
]);
export function isZeroBaseItem(canonicalName: string): boolean {
  return ZERO_BASE_ITEMS.has(canonicalName);
}

// One-shot version for consumers (Menu Engineering, Item Mix) that just need the
// final number for an item/channel, not the section breakdown for rendering.
// Returns the exact same value Pink Sheets displays as "FINAL AVG COST WITH MODIFIER".
export function computeFinalAvgCost(
  ps: PinkSheetRow,
  allDetails: PinkSheetDetailRow[],
  channel: 'online' | 'ih',
): number {
  // Zero-base exception: IH mirrors online exactly, regardless of IH's own qty/detail.
  const effectiveChannel = (channel === 'ih' && isZeroBaseItem(ps.canonical_name)) ? 'online' : channel;
  const itemDets = allDetails.filter(d => d.parent_item === ps.canonical_name && d.channel === effectiveChannel);
  const sections = applyHalfHalfCosts(buildSections(itemDets));
  const { totalModCost } = computeTotalModCost(sections);
  const baseCost = effectiveChannel === 'ih' ? ps.base_cost_ih : ps.base_cost_online;
  const qty      = effectiveChannel === 'ih' ? ps.ih_qty : ps.online_qty;
  return qty > 0 ? (totalModCost + baseCost * qty) / qty : 0;
}
