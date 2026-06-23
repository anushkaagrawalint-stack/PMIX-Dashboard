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
  week_start: string;
  channel:    string;
  revenue:    number;
  qty:        number;
}

export interface DailyChannelRow {
  date:    string;
  channel: string;
  revenue: number;
  qty:     number;
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
  revenue:        number;
  avg_price:      number;
  revenue_pct:    number;
  qty_pct:        number;
  is_open_item:   boolean;  // menu_name IS NULL
}

// Per-channel breakdown of an item (for channel filter in ME / Overview)
export interface ChannelItemRow {
  canonical_name: string;
  channel:        string;
  qty:            number;
  revenue:        number;
}

// ─── Location compare ─────────────────────────────────────────────────────────
export interface LocationItemRow {
  canonical_name: string;
  location_code:  string;
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
  quadrant:            'Star' | 'Plow Horse' | 'Puzzle' | 'Dog';
  margin_flag:         'High' | 'Low';
  mix_flag:            'High' | 'Low';
  margin_threshold:    number;
  mix_threshold:       number;
  is_open_item:        boolean;
}

// ─── BYO modifiers ────────────────────────────────────────────────────────────
export interface ModifierRow {
  mod_type:      string;
  modifier_name: string;
  parent_item:   string;
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
export interface NeedsReviewRow {
  order_guid:       string;
  location:         string;
  business_date:    string;
  amount:           number;
  item_count:       number;
  issue_type:       string;
  current_channel:  string;
  dining_option:    string;
  alt_payment_name: string;
  suggested_channel: string;
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
  payments:           PaymentRow[];
  bikky:              BikkyRow[];
  categories:         CategoryRow[];
  channelCategories:  ChannelCategoryRow[];
  renames:            RenameRow[];
  needsReview:          NeedsReviewRow[];
  uncategorizedItems:   UncategorizedItemRow[];
  openItems:            OpenItemRow[];
  openItemsSummary:     OpenItemsSummary;
  periods:            FiscalPeriodRow[];
  cateringVendors:    VendorRow[];
  offsiteVendors:     VendorRow[];
}
