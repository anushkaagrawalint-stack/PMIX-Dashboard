export interface DateRange { start: string; end: string; label: string; dbMin: string; dbMax: string }

export interface Summary {
  total_qty: number;
  total_revenue: number;
  unique_items: number;
  last_date: string;
  top_item: string;
  top_item_revenue: number;
  top_item_mix: number;
}

export interface ChannelRow {
  channel_code: string;
  qty: number;
  revenue: number;
  pct: number;
}

export interface WeekRow {
  week_start: string;
  revenue: number;
  qty: number;
}

export interface ItemRow {
  canonical_name: string;
  menu_group: string;
  menu_name: string;
  category: string;
  sub_category: string;
  qty: number;
  revenue: number;
  avg_price: number;
  revenue_pct: number;
  qty_pct: number;
}

export interface LocationItemRow {
  canonical_name: string;
  location_code: string;
  qty: number;
  revenue: number;
  mix_pct: number;
}

export interface MERow {
  canonical_name: string;
  menu_group: string;
  category: string;
  sub_category: string;
  qty: number;
  net_sales: number;
  avg_price: number;
  avg_cost: number;
  total_cost: number;
  total_margin: number;
  margin_pct: number;
  cogs_pct: number;
  mix_pct: number;
  sls_pct_category: number;
  sls_pct_subcategory: number;
  quadrant: 'Star' | 'Plow Horse' | 'Puzzle' | 'Dog';
  margin_flag: 'High' | 'Low';
  mix_flag: 'High' | 'Low';
  margin_threshold: number;
  mix_threshold: number;
}

export interface ModifierRow {
  mod_type: string;
  modifier_name: string;
  qty: number;
  pct: number;
}

export interface PaymentRow {
  payment_source: string;
  payment_count: number;
  total_amount: number;
  pct: number;
  category: string;
}

export interface BikkyRow {
  item_name:    string;
  return_rate:  number;
  reorder_rate: number;
  period:       string;
  category:     string;
  revenue:      number;
  qty:          number;
}

export interface RenameRow {
  canonical_name:   string;
  all_names:        string[];
  lifetime_qty:     number;
  lifetime_revenue: number;
  location_count:   number;
  first_seen:       string;
}

export interface NeedsReviewRow {
  location:      string;
  business_date: string;
  channel_code:  string;
  amount:        number;
  item_count:    number;
  suggestion:    string;
}

export interface ChannelCategoryRow {
  channel_code: string;
  category:     string;
  revenue:      number;
}

export interface CategoryRow {
  category: string;
  revenue: number;
  qty: number;
}

export interface ChannelItemRow {
  canonical_name: string;
  channel_code: string;
  qty: number;
  revenue: number;
}

export interface LocationRow {
  location_code: string;
  display_name: string;
}

export interface FiscalPeriodRow {
  period:     number;
  fiscal_year: number;
  label:      string;  // e.g. "P5 2026"
  start_date: string;  // YYYY-MM-DD
  end_date:   string;  // YYYY-MM-DD
}

export interface DashboardData {
  dateRange:         DateRange;
  summary:           Summary;
  channels:          ChannelRow[];
  weekly:            WeekRow[];
  items:             ItemRow[];
  locationItems:     LocationItemRow[];
  meItems:           MERow[];
  modifiers:         ModifierRow[];
  payments:          PaymentRow[];
  bikky:             BikkyRow[];
  categories:        CategoryRow[];
  channelItems:      ChannelItemRow[];
  locations:         LocationRow[];
  periods:           FiscalPeriodRow[];
  renames:           RenameRow[];
  needsReview:       NeedsReviewRow[];
  channelCategories: ChannelCategoryRow[];
  avgMargin:         number;
}
