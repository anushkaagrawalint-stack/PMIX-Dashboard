import { parse } from 'csv-parse/sync';

// Bikky keeps renaming header text across exports (confirmed by a real P6
// upload 2026-07-20 — "Item" became "Menu item", "Item aov" became "AOV",
// etc.) AND has changed column count (P6 dropped the old "Item id" column
// entirely, shifting every later column one to the left) — so a fixed
// absolute letter position (e.g. always column J) is NOT safe across
// formats: J/K/L land on guests/return/reorder in the old 24-col layout but
// on return/reorder/a date string in the new 23-col layout. Instead these 3
// fields are found *relative to* "Business date previous start", the one
// header string that hasn't changed between formats — 3/2/1 columns before
// it, respectively. item_name is always column A regardless of format.
interface BikkyColSpec { aliases: string[]; kind: 'text' | 'numeric' | 'date' }

const PREV_START_ALIASES = ['Business date previous start'];
const ITEM_NAME_COL = 0; // column A, stable in every format seen

const BIKKY_COL_SPECS: Record<string, BikkyColSpec> = {
  item_id:              { aliases: ['Item id'], kind: 'text' },
  revenue:              { aliases: ['Item revenue'], kind: 'numeric' },
  revenue_per_loc:      { aliases: ['Item revenue per location'], kind: 'numeric' },
  revenue_pct:          { aliases: ['Item revenue percentage', 'Item revenue (%)'], kind: 'numeric' },
  volume:               { aliases: ['Item volume'], kind: 'numeric' },
  volume_per_loc:       { aliases: ['Item volume per location', 'Items per location'], kind: 'numeric' },
  volume_pct:           { aliases: ['Item volume percentage', 'Item volume (%)'], kind: 'numeric' },
  aov:                  { aliases: ['Item aov', 'AOV'], kind: 'numeric' },
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
 * item_name is always column A; guests/return_rate/reorder_rate are found
 * relative to the "Business date previous start" column (3/2/1 positions
 * before it) rather than a fixed letter, since column count differs between
 * the old and new export formats. Everything else still resolves by
 * header-name alias. Throws with a descriptive message if that anchor
 * column is missing or every row's column A is blank — this is the only
 * integrity check left once Postgres's column types/NOT NULL constraints
 * are out of the picture.
 */
export function parseBikkyCsv(raw: string): BikkyCsvRow[] {
  let records: string[][];
  try {
    records = parse(raw, { columns: false, skip_empty_lines: true, bom: true });
  } catch (err) {
    throw new Error(`Not a valid CSV file: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (records.length < 2) {
    throw new Error('CSV has no data rows');
  }

  const header = records[0];
  const dataRows = records.slice(1);

  const headerIndex = new Map<string, number>();
  header.forEach((h, i) => headerIndex.set(h, i));

  const prevStartIdx = PREV_START_ALIASES.map(a => headerIndex.get(a)).find(i => i !== undefined);
  if (prevStartIdx === undefined || prevStartIdx < 3) {
    throw new Error(
      `CSV header is missing the "${PREV_START_ALIASES[0]}" column (used to locate guests/return/reorder rate) — got: ${header.join(', ')}`,
    );
  }
  const guestsIdx      = prevStartIdx - 3;
  const returnRateIdx  = prevStartIdx - 2;
  const reorderRateIdx = prevStartIdx - 1;

  // Resolve each remaining name-based field to whichever alias this file's
  // header actually uses (fields with no matching alias come back null).
  const resolvedByName: Partial<Record<string, number>> = {};
  for (const [dbCol, spec] of Object.entries(BIKKY_COL_SPECS)) {
    const found = spec.aliases.find(a => headerIndex.has(a));
    if (found !== undefined) resolvedByName[dbCol] = headerIndex.get(found);
  }

  const rows: BikkyCsvRow[] = [];
  for (const cells of dataRows) {
    const row: Record<string, string | number | null> = {
      item_name:    coerce(cells[ITEM_NAME_COL], 'text'),
      guests:       coerce(cells[guestsIdx], 'numeric'),
      return_rate:  coerce(cells[returnRateIdx], 'numeric'),
      reorder_rate: coerce(cells[reorderRateIdx], 'numeric'),
    };
    for (const [dbCol, spec] of Object.entries(BIKKY_COL_SPECS)) {
      const idx = resolvedByName[dbCol];
      row[dbCol] = idx !== undefined ? coerce(cells[idx], spec.kind) : null;
    }
    if (row.item_name) rows.push(row as unknown as BikkyCsvRow);
  }

  if (rows.length === 0) {
    throw new Error('CSV parsed but every row is missing an item-name value (column A)');
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
