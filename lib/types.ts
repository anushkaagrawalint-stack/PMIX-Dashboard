import type { ChannelCode } from './constants';

// ─── Filter state ─────────────────────────────────────────────────────────────
export interface DateRange {
  start:  string;  // YYYY-MM-DD
  end:    string;
  label:  string;
  dbMin:  string;
  dbMax:  string;
}

// ─── Overview / Summary ───────────────────────────────────────────────────────
export interface Summary {
  total_qty:         number;
  total_revenue:     number;
  unique_items:      number;
  last_date:         string;
  top_item:          string;
  top_item_revenue:  number;
  top_item_mix:      number;
}

// ─── Channel breakdown ────────────────────────────────────────────────────────
export interface ChannelRow {
  channel:  string;   // derived from menu_name via CHANNEL_SQL
  qty:      number;
  revenue:  number;
  pct:      number;   // % of grand total revenue
}

// ─── Time series ──────────────────────────────────────────────────────────────
export interface WeekRow {
  week_start: string;
  revenue:    number;
  qty:        number;
}

export interface DailyRow {
  date:    string;
  revenue: number;
  qty:     number;
}

export interface WeeklyChannelRow {
  week_start:    string;
  channel:       string;
  location_code: string;
  revenue:       number;
  qty:           number;
}

export interface DailyChannelRow {
  date:          string;
  channel:       string;
  location_code: string;
  revenue:       number;
  qty:           number;
}

// ─── Items ────────────────────────────────────────────────────────────────────
export interface ItemRow {
  canonical_name: string;
  menu_name:      string;   // raw Toast menu name
  menu_group:     string;
  channel:        string;   // derived from menu_name
  category:       string;   // normalised category_1
  sub_category:   string;   // normalised category_2
  qty:            number;
  revenue:        number;   // line_total (net, after discounts)
  gross_sales:    number;   // pre_discount (true gross, ties to Toast reports)
  avg_price:      number;   // pre_discount / qty (matches AppScript + Toast)
  revenue_pct:    number;
  qty_pct:        number;
  is_open_item:   boolean;  // menu_name IS NULL
}

// Per-channel breakdown of an item (for channel filter in ME / Overview)
export interface ChannelItemRow {
  canonical_name: string;
  channel:        string;
  qty:            number;
  revenue:        number;   // line_total (net)
  gross_sales:    number;   // pre_discount (true gross)
}

// ─── Location compare ─────────────────────────────────────────────────────────
export interface LocationItemRow {
  canonical_name: string;
  location_code:  string;
  channel:        string;
  qty:            number;
  revenue:        number;
  mix_pct:        number;
}

export interface LocationRow {
  location_code: string;
  display_name:  string;
}

// ─── Menu Engineering ─────────────────────────────────────────────────────────
export interface MERow {
  canonical_name:      string;
  menu_group:          string;
  category:            string;
  sub_category:        string;
  // blended totals
  qty:                 number;
  net_sales:           number;
  avg_price:           number;
  avg_cost:            number;
  total_cost:          number;
  total_margin:        number;
  margin_pct:          number;
  cogs_pct:            number;
  mix_pct:             number;
  sls_pct_category:    number;
  // per-channel quantities
  qty_ih:              number;
  qty_lo:              number;
  qty_3pd:             number;
  // per-channel revenues
  net_sales_ih:        number;
  net_sales_lo:        number;
  net_sales_3pd:       number;
  // per-channel avg prices (3PD price includes ×1.22 markup)
  avg_price_ih:        number;
  avg_price_lo:        number;
  avg_price_3pd:       number;
  avg_price_bl:        number;
  // per-channel avg costs (3PD cost includes ×1.18 markup)
  avg_cost_ih:         number;
  avg_cost_lo:         number;
  avg_cost_3pd:        number;
  avg_cost_bl:         number;
  // per-channel total costs
  total_cost_ih:       number;
  total_cost_lo:       number;
  total_cost_3pd:      number;
  // BL (LO+3PD combined)
  qty_bl:              number;
  net_sales_bl:        number;
  total_cost_bl:       number;
  // ME classification (always blended)
  quadrant:            'Star' | 'Plow Horse' | 'Puzzle' | 'Dog';
  margin_flag:         'High' | 'Low';
  mix_flag:            'High' | 'Low';
  margin_threshold:    number;
  mix_threshold:       number;
  is_open_item:        boolean;
}

// ─── Pink Sheet modifier-level detail ────────────────────────────────────────
export interface PinkSheetDetailRow {
  parent_item:   string;
  section:       string;   // modifier_type (e.g. "Bowls - Bases", "Bowls - Main")
  modifier_name: string;
  channel:       string;   // 'online' | 'ih'
  qty:           number;
  unit_cost:     number;
  total_cost:    number;   // qty × unit_cost
}

// ─── Pink Sheets (cost breakdown per item) ───────────────────────────────────
export interface PinkSheetRow {
  canonical_name:     string;
  menu_group:         string;
  base_cost_ih:       number;   // r365 IH base cost (full recipe)
  base_cost_online:   number;   // r365 online/delivery base cost (packaging)
  total_mod_cost:     number;   // Σ mod_qty × mod_cost for online orders
  total_ih_mod_cost:  number;   // Σ mod_qty × mod_cost for IH orders
  online_qty:         number;   // LO + 3PD actual order count (pink sheet denominator)
  ih_qty:             number;   // IH actual order count
  avg_cost_ih:        number;   // = base_cost_ih + total_ih_mod_cost / ih_qty
  avg_cost_online:    number;   // = base_cost_online + total_mod_cost / online_qty
  avg_cost_3pd:       number;   // = avg_cost_online × 1.18
}

// ─── BYO modifiers ────────────────────────────────────────────────────────────
export interface ModifierRow {
  mod_type:      string;
  modifier_name: string;
  parent_item:   string;
  location_code: string;
  qty:           number;
  pct:           number;
  avg_cost:      number | null;
}

// ─── Payments ────────────────────────────────────────────────────────────────
export interface PaymentRow {
  payment_source: string;
  payment_count:  number;
  total_amount:   number;
  pct:            number;
  category:       string;  // 'Card' | 'Alt Payment'
}

export interface PaymentByLocationRow {
  location_code: string;
  display_name:  string;
  payment_count: number;
  total_amount:  number;
  card_amount:   number;
  alt_amount:    number;
}

export interface PaymentSourceLocationRow {
  location_code:  string;
  display_name:   string;
  payment_source: string;
  payment_count:  number;
  total_amount:   number;
  category:       string;  // 'Card' | 'Alt Payment'
}

// ─── Bikky retention ─────────────────────────────────────────────────────────
export interface BikkyRow {
  item_name:    string;
  return_rate:  number;
  reorder_rate: number;
  period:       string;
  source:       'instore' | '3pd_loyalty';
  category:     string;
  revenue:      number;
  qty:          number;
  guests:       number;
  return_rate_prev:  number;
  reorder_rate_prev: number;
}

// ─── Renames ─────────────────────────────────────────────────────────────────
export interface RenameRow {
  canonical_name:   string;
  all_names:        string[];
  category:         string;
  lifetime_qty:     number;
  lifetime_revenue: number;
  location_count:   number;
  first_seen:       string;
}

// ─── Needs Review ────────────────────────────────────────────────────────────
export interface NeedsReviewLineItem {
  selection_guid: string;          // matches a NeedsReviewFlaggedLine.selection_guid if this line is the flagged one
  canonical_name: string;
  menu_name:      string | null;  // raw Toast menu_name for this specific line — can differ within one order_guid
  channel:        string;         // this line's own derived channel (CHANNEL_SQL) — can differ line-to-line
  quantity:       number;
  line_total:     number;
}

export interface NeedsReviewFlaggedLine {
  selection_guid: string;  // the specific line an override applies to — NOT the whole order
  canonical_name: string;
}

export interface NeedsReviewRow {
  order_guid:       string;
  location:         string;
  business_date:    string;
  amount:           number;
  item_count:       number;
  issue_type:       string;
  current_channel:  string;
  override_channel: string | null;  // set once an admin has confirmed a channel fix; persists across reloads
  flagged_lines:    NeedsReviewFlaggedLine[];  // the specific mistracked line(s) — Confirm/Undo only ever touch these
  dining_option:    string;
  alt_payment_name: string;
  suggested_channel: string;
  line_items:       NeedsReviewLineItem[];
}

// ─── Open Items ───────────────────────────────────────────────────────────────
export interface OpenItemRow {
  canonical_name:  string;
  sales_category:  string | null;
  menu_group:      string | null;
  dining_option:   string | null;
  issue_types:     string[];   // ['NO COST', 'UNCATEGORIZED', 'MISSING MENU GROUP', ...]
  qty:             number;
  net_sales:       number;
  last_seen:       string;
  suggested_fix:   string;
}

export interface OpenItemsSummary {
  total:            number;
  revenue_affected: number;
  missing_cost:     number;
  uncategorized:    number;
}

// ─── Uncategorized items (not in item_lookup or modifier_type) ───────────────
export interface UncategorizedItemRow {
  canonical_name: string;
  channel:        string;
  qty:            number;
  revenue:        number;
  last_seen:      string;
}

// ─── Item base costs from r365 (fallback for items not in pink sheets / ME) ──
export interface ItemCostRow {
  canonical_name:      string;
  ih_cost:             number;
  online_cost:         number;
  catering_cost:       number;   // r365 menu = 'CATERING'
  catering_3pd_cost:   number;   // r365 menu = 'CATERING - 3PD'
  offsite_cost:        number;   // r365 menu = 'OFFSITE POP-UPS'
  open_items_cost:     number;   // r365 menu = 'Open items'
}

// ─── Channel × category revenue ───────────────────────────────────────────────
export interface ChannelCategoryRow {
  channel:   string;
  category:  string;
  revenue:   number;
}

// ─── Fiscal period ───────────────────────────────────────────────────────────
export interface FiscalPeriodRow {
  period:      number;
  fiscal_year: number;
  label:       string;   // 'P5 2026'
  start_date:  string;
  end_date:    string;
}

// ─── Category totals ─────────────────────────────────────────────────────────
export interface CategoryRow {
  category: string;
  revenue:  number;
  qty:      number;
}

// ─── Missing R365 item costs (admin cost-entry tool) ─────────────────────────
// One row per (item, sales bucket) that has real sales but no matching
// analytics.r365_item_cost row for that bucket's r365 "menu" value(s).
export interface MissingCostRow {
  canonical_name: string;
  category:       string;
  menu_group:     string;
  bucket:         'ih' | 'online' | 'catering' | 'catering_3pd' | 'offsite';
  qty:            number;
  net_sales:      number;
}

// ─── Catering / Offsite vendor breakdown ─────────────────────────────────────
export interface VendorRow {
  vendor:   string;   // alt_payment_name
  orders:   number;
  revenue:  number;
  aov:      number;
  pct:      number;
}

// ─── Root dashboard data bundle ───────────────────────────────────────────────
export interface DashboardData {
  dateRange:          DateRange;
  summary:            Summary;
  prevSummary:        Summary | null;   // previous comparable period for KPI deltas
  prevLabel:          string | null;    // human label of the prev period (e.g. "P4 2026")
  prevChannelItems:   ChannelItemRow[]; // prev-period, for channel/category-filtered KPI deltas
  prevLocationItems:  LocationItemRow[]; // prev-period, for location-filtered KPI deltas
  prevMEItems:        MERow[];          // prev-period, for channel/category-filtered margin delta
  channels:           ChannelRow[];
  weekly:             WeekRow[];
  daily:              DailyRow[];
  weeklyByChannel:    WeeklyChannelRow[];
  dailyByChannel:     DailyChannelRow[];
  items:              ItemRow[];
  channelItems:       ChannelItemRow[];
  locationItems:      LocationItemRow[];
  locations:          LocationRow[];
  meItems:            MERow[];
  avgMargin:          number;
  modifiers:          ModifierRow[];
  payments:                  PaymentRow[];
  paymentsByLocation:        PaymentByLocationRow[];
  paymentSourcesByLocation:  PaymentSourceLocationRow[];
  bikky:              BikkyRow[];
  categories:         CategoryRow[];
  channelCategories:  ChannelCategoryRow[];
  renames:            RenameRow[];
  needsReview:          NeedsReviewRow[];
  uncategorizedItems:   UncategorizedItemRow[];
  openItems:            OpenItemRow[];
  openItemsSummary:     OpenItemsSummary;
  pinkSheets:         PinkSheetRow[];
  pinkSheetDetails:   PinkSheetDetailRow[];
  periods:            FiscalPeriodRow[];
  cateringVendors:    VendorRow[];
  offsiteVendors:     VendorRow[];
  itemCosts:          ItemCostRow[];
  missingCosts:       MissingCostRow[];
}
