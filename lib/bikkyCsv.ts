import { parse } from 'csv-parse/sync';

// Mirrors toast_pipeline/cli.py's _BIKKY_COL_MAP exactly — keep both in sync
// if the R365/Bikky export format ever changes its header names.
export const BIKKY_COL_MAP: Record<string, string> = {
  'Item':                               'item_name',
  'Item id':                            'item_id',
  'Item revenue':                       'revenue',
  'Item revenue per location':          'revenue_per_loc',
  'Item revenue percentage':            'revenue_pct',
  'Item volume':                        'volume',
  'Item volume per location':           'volume_per_loc',
  'Item volume percentage':             'volume_pct',
  'Item aov':                           'aov',
  'Item guests':                        'guests',
  'N day item return rate':             'return_rate',
  'N day item reorder rate':            'reorder_rate',
  'Business date previous start':       'prev_period_start',
  'Business date previous end':         'prev_period_end',
  'Item revenue previous':              'revenue_prev',
  'Item revenue per location previous': 'revenue_per_loc_prev',
  'Item revenue percentage previous':   'revenue_pct_prev',
  'Item volume previous':               'volume_prev',
  'Item volume per location previous':  'volume_per_loc_prev',
  'Item volume percentage previous':    'volume_pct_prev',
  'Item aov previous':                  'aov_prev',
  'Item guests previous':               'guests_prev',
  'N day item return rate previous':    'return_rate_prev',
  'N day item reorder rate previous':   'reorder_rate_prev',
};

const BIKKY_NUMERIC_COLS = new Set([
  'revenue', 'revenue_per_loc', 'revenue_pct',
  'volume', 'volume_per_loc', 'volume_pct',
  'aov', 'guests', 'return_rate', 'reorder_rate',
  'revenue_prev', 'revenue_per_loc_prev', 'revenue_pct_prev',
  'volume_prev', 'volume_per_loc_prev', 'volume_pct_prev',
  'aov_prev', 'guests_prev', 'return_rate_prev', 'reorder_rate_prev',
]);

const BIKKY_DATE_COLS = new Set(['prev_period_start', 'prev_period_end']);

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

function coerce(raw: string | undefined, col: string): string | number | null {
  const v = (raw ?? '').trim();
  if (!v) return null;
  if (BIKKY_DATE_COLS.has(col)) return v; // ISO date string, e.g. '2024-09-02'
  if (BIKKY_NUMERIC_COLS.has(col)) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return v;
}

/**
 * Validates and parses a Bikky export CSV (In-Store or 3PD+Loyalty format).
 * Throws with a descriptive message if the header doesn't match the expected
 * export shape — this is the only integrity check left once Postgres's
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
  if (!('Item' in records[0])) {
    throw new Error(`CSV header is missing the required "Item" column — got: ${Object.keys(records[0]).join(', ')}`);
  }

  const rows: BikkyCsvRow[] = [];
  for (const raw_ of records) {
    const row: Record<string, string | number | null> = {};
    for (const [csvCol, dbCol] of Object.entries(BIKKY_COL_MAP)) {
      row[dbCol] = coerce(raw_[csvCol], dbCol);
    }
    if (row.item_name) rows.push(row as unknown as BikkyCsvRow);
  }

  if (rows.length === 0) {
    throw new Error('CSV parsed but every row is missing an "Item" value');
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
