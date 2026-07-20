import { parse } from 'csv-parse/sync';

// Bikky has shipped at least two header spellings for the *current-period*
// columns (confirmed by a real P6 upload 2026-07-20 — "Item" became "Menu
// item", "Item aov" became "AOV", etc.) while leaving the "previous"/
// "difference" suffixed columns on the old names. Each target field lists
// every header spelling seen in the wild; the first one present in a given
// file's header wins. Add to a field's alias list rather than replacing it
// if the export format shifts again — don't drop old aliases, old P1-P5
// files on disk still use them.
interface BikkyColSpec { aliases: string[]; kind: 'text' | 'numeric' | 'date' }

const BIKKY_COL_SPECS: Record<string, BikkyColSpec> = {
  item_name:            { aliases: ['Item', 'Menu item'], kind: 'text' },
  item_id:              { aliases: ['Item id'], kind: 'text' },
  revenue:              { aliases: ['Item revenue'], kind: 'numeric' },
  revenue_per_loc:      { aliases: ['Item revenue per location'], kind: 'numeric' },
  revenue_pct:          { aliases: ['Item revenue percentage', 'Item revenue (%)'], kind: 'numeric' },
  volume:               { aliases: ['Item volume'], kind: 'numeric' },
  volume_per_loc:       { aliases: ['Item volume per location', 'Items per location'], kind: 'numeric' },
  volume_pct:           { aliases: ['Item volume percentage', 'Item volume (%)'], kind: 'numeric' },
  aov:                  { aliases: ['Item aov', 'AOV'], kind: 'numeric' },
  guests:               { aliases: ['Item guests', 'Guests'], kind: 'numeric' },
  return_rate:          { aliases: ['N day item return rate', 'Item return rate'], kind: 'numeric' },
  reorder_rate:         { aliases: ['N day item reorder rate', 'Item re-order rate'], kind: 'numeric' },
  prev_period_start:    { aliases: ['Business date previous start'], kind: 'date' },
  prev_period_end:      { aliases: ['Business date previous end'], kind: 'date' },
  revenue_prev:         { aliases: ['Item revenue previous'], kind: 'numeric' },
  revenue_per_loc_prev: { aliases: ['Item revenue per location previous'], kind: 'numeric' },
  revenue_pct_prev:     { aliases: ['Item revenue percentage previous'], kind: 'numeric' },
  volume_prev:          { aliases: ['Item volume previous'], kind: 'numeric' },
  volume_per_loc_prev:  { aliases: ['Item volume per location previous'], kind: 'numeric' },
  volume_pct_prev:      { aliases: ['Item volume percentage previous'], kind: 'numeric' },
  aov_prev:             { aliases: ['Item aov previous'], kind: 'numeric' },
  guests_prev:          { aliases: ['Item guests previous'], kind: 'numeric' },
  return_rate_prev:     { aliases: ['N day item return rate previous'], kind: 'numeric' },
  reorder_rate_prev:    { aliases: ['N day item reorder rate previous'], kind: 'numeric' },
};

export interface BikkyCsvRow {
  item_name: string;
  item_id: string | null;
  revenue: number | null;
  revenue_per_loc: number | null;
  revenue_pct: number | null;
  volume: number | null;
  volume_per_loc: number | null;
  volume_pct: number | null;
  aov: number | null;
  guests: number | null;
  return_rate: number | null;
  reorder_rate: number | null;
  prev_period_start: string | null;
  prev_period_end: string | null;
  revenue_prev: number | null;
  revenue_per_loc_prev: number | null;
  revenue_pct_prev: number | null;
  volume_prev: number | null;
  volume_per_loc_prev: number | null;
  volume_pct_prev: number | null;
  aov_prev: number | null;
  guests_prev: number | null;
  return_rate_prev: number | null;
  reorder_rate_prev: number | null;
}

function coerce(raw: string | undefined, kind: BikkyColSpec['kind']): string | number | null {
  const v = (raw ?? '').trim();
  if (!v) return null;
  if (kind === 'date') return v; // ISO date string, e.g. '2024-09-02'
  if (kind === 'numeric') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return v;
}

/**
 * Validates and parses a Bikky export CSV (In-Store or 3PD+Loyalty format).
 * Throws with a descriptive message if no known alias of the item-name
 * column is present — this is the only integrity check left once Postgres's
 * column types/NOT NULL constraints are out of the picture.
 */
export function parseBikkyCsv(raw: string): BikkyCsvRow[] {
  let records: Record<string, string>[];
  try {
    records = parse(raw, { columns: true, skip_empty_lines: true, bom: true });
  } catch (err) {
    throw new Error(`Not a valid CSV file: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (records.length === 0) {
    throw new Error('CSV has no data rows');
  }

  // Resolve each target field to whichever alias this file's header actually
  // uses (fields with no matching alias in this file just come back null).
  const header = new Set(Object.keys(records[0]));
  const resolved: Partial<Record<keyof typeof BIKKY_COL_SPECS, string>> = {};
  for (const [dbCol, spec] of Object.entries(BIKKY_COL_SPECS)) {
    const found = spec.aliases.find(a => header.has(a));
    if (found) resolved[dbCol] = found;
  }
  if (!resolved.item_name) {
    throw new Error(
      `CSV header is missing an item-name column (expected one of: ${BIKKY_COL_SPECS.item_name.aliases.join(', ')}) — got: ${[...header].join(', ')}`,
    );
  }

  const rows: BikkyCsvRow[] = [];
  for (const raw_ of records) {
    const row: Record<string, string | number | null> = {};
    for (const [dbCol, spec] of Object.entries(BIKKY_COL_SPECS)) {
      const srcCol = resolved[dbCol];
      row[dbCol] = srcCol ? coerce(raw_[srcCol], spec.kind) : null;
    }
    if (row.item_name) rows.push(row as unknown as BikkyCsvRow);
  }

  if (rows.length === 0) {
    throw new Error('CSV parsed but every row is missing an item-name value');
  }
  return rows;
}

// Matches the Python loader's period_pattern regexes exactly.
const INSTORE_NAME_RE = /^P(\d{2})(\d{4})IS$/i;
const DEL3PD_NAME_RE  = /^P(\d{2})(\d{4})Del$/i;

export type BikkySource = 'instore' | '3pd_loyalty';

export function bikkyFileNameFor(source: BikkySource, period: number, fiscalYear: number): string {
  const pp = String(period).padStart(2, '0');
  return source === 'instore' ? `P${pp}${fiscalYear}IS.csv` : `P${pp}${fiscalYear}Del.csv`;
}

export function bikkyFolderFor(source: BikkySource): string {
  return source === 'instore' ? 'InStore' : '3PD+Loyalty';
}

/** Parses {period, fiscal_year} out of a Bikky filename stem (no extension). */
export function parseBikkyFileName(stem: string, source: BikkySource): { period: number; fiscalYear: number } | null {
  const m = stem.match(source === 'instore' ? INSTORE_NAME_RE : DEL3PD_NAME_RE);
  if (!m) return null;
  return { period: Number(m[1]), fiscalYear: Number(m[2]) };
}
