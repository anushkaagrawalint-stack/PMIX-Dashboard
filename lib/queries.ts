import { Pool } from '@neondatabase/serverless';
import { cacheLife, cacheTag } from 'next/cache';
import {
  CHANNEL_SQL, CHANNEL_SQL_WITH_OVERRIDE, CHANNEL_OVERRIDE_JOIN_SQL,
  GRP_TO_CAT_SQL, ITEM_SUBCAT_SQL, GRP_TO_SUBCAT_SQL,
} from './constants';
import { modifierAliasCaseSQL } from './modifierCost';
import { listDir, getFileRaw } from './github';
import { parseBikkyCsv, bikkyFolderFor, parseBikkyFileName, bikkyPeriodLabel, type BikkySource } from './bikkyCsv';
import type {
  DateRange, Summary, ChannelRow, WeekRow, DailyRow,
  WeeklyChannelRow, DailyChannelRow,
  ItemRow, ChannelItemRow, LocationItemRow, LocationRow,
  MERow, ModifierRow, PaymentRow, PaymentByLocationRow, PaymentSourceLocationRow, BikkyRow,
  CategoryRow, ChannelCategoryRow,
  RenameRow, RenameNameHistoryEntry, RenameDemoRow, NeedsReviewRow, NeedsReviewLineItem,
  OpenItemRow, OpenItemsSummary,
  UncategorizedItemRow,
  FiscalPeriodRow, VendorRow, PinkSheetRow, PinkSheetDetailRow,
  ItemCostRow, MissingCostRow,
  AttachmentData, AttachmentBucketRow, AttachmentModifierRow, AttachmentItemRow, AttachmentCategoryRow,
  AttachmentTrendData, AttachmentTrendBucketRow, AttachmentTrendCategoryRow,
  BeverageModifierRow, MakeItMealModifierRow,
} from './types';

function pool() {
  return new Pool({ connectionString: process.env.DATABASE_URL! });
}

// ─── Channel CASE embedded in SQL ─────────────────────────────────────────────
// All queries use this instead of channel_code.
const CH = CHANNEL_SQL;

// Override-aware channel — prefers a Needs Review correction (analytics.
// channel_overrides, joined as `co`) over the raw menu_name derivation.
// Keyed on selection_guid (per-line), not order_guid, so fixing one mistracked
// line never touches that order's other, already-correct lines.
// Any query using CHO must also add CH_OVERRIDE_JOIN(<selection_guid column>).
const CHO = CHANNEL_SQL_WITH_OVERRIDE;
const CH_OVERRIDE_JOIN = CHANNEL_OVERRIDE_JOIN_SQL;

// modifier_type join — identifies modifier rows so they get 'Modifier' category
// item_lookup is NOT used for category (AppScript uses GRP_TO_CATEGORY instead)
const IL_JOIN = `
  LEFT JOIN (
    SELECT DISTINCT ON (modifier_name) modifier_name
    FROM analytics.modifier_type
    ORDER BY modifier_name
  ) mlt ON mlt.modifier_name = fol.canonical_name
`;

// Category — mirrors AppScript getMasterCategory_:
//   1. ITEM_CATEGORY_OVERRIDE by canonical_name
//   2. GRP_TO_CATEGORY by fol.menu_group
const CAT1 = `
  CASE
    WHEN fol.canonical_name IN ('That Fire Hot Sauce (Bottle)','That Fire Hot Sauce - Side')
      THEN 'Retail'
    WHEN fol.canonical_name IN ('Harvest Chicken Bowl','Spicy Chili Chicken Bowl','Chicken Tikka Burrito')
      THEN 'Entrees'
    ELSE COALESCE(${GRP_TO_CAT_SQL}, 'Other')
  END
`;

// Subcategory — mirrors AppScript getMasterSubCategory_ exactly:
//   1. ITEM_SUBCATEGORY_OVERRIDE + ITEM_SUBCATEGORY by canonical_name
//   2. GRP_TO_SUBCATEGORY by fol.menu_group
const CAT2 = `
  COALESCE(
    ${ITEM_SUBCAT_SQL},
    ${GRP_TO_SUBCAT_SQL},
    ''
  )
`;

// GRP_TO_CATEGORY TypeScript map (mirrors GRP_TO_CAT_SQL)
const GRP_TO_CAT_MAP: Record<string, string> = {
  'BOWLS':'Entrees','BUILD YOUR OWN BOWL':'Entrees','BYO':'Entrees',
  'PLATES':'Entrees','CLASSIC INDIAN PLATES':'Entrees','BURRITOS':'Entrees',
  'INDIAN BURRITOS':'Entrees','CHEF CURATED BOWLS':'Entrees',
  'SIDES':'Sides',
  'DRINKS':'NA Drinks','Cold Drinks':'NA Drinks','Hot Drinks':'NA Drinks',
  'SWEETS':'Sweets',
  'KIDS':'Kids Meal',
  'Beer':'Alc Drinks','Wine':'Alc Drinks','Liquor':'Alc Drinks','Gameday':'Alc Drinks',
};

// ITEM_SUBCATEGORY + ITEM_SUBCATEGORY_OVERRIDE TypeScript map (mirrors ITEM_SUBCAT_SQL)
const ITEM_SUBCAT_MAP: Record<string, string> = {
  'BYO Indian Burrito':'Burrito',
  'Garlic Naan':'Bread','Naan':'Bread','Roti':'Bread',
  'Mini Samosas':'Samosa','Samosa Chaat':'Samosa',
  'Cucumber Raita':'Raita',
  'Side of Main':'Main','Side of Grain':'Grain','Side of Veggie':'Veggie','Side of Sauce':'Sauce',
  'Chips + Chutney':'Chips',
  'That Fire Hot Sauce - Side':'Sauce Bottle','That Fire Hot Sauce (Bottle)':'Sauce Bottle',
  'Mango Lassi':'Lassi','Strawberry Lassi':'Lassi',
  'Vanilla Mango Lassi Soft Serve':'Soft Serve','Blossom Lassi':'Lassi',
  'Homemade Juice':'Juice','Handcrafted Juice for a Group - 1/2 Gallon':'Juice',
  'Maine Root Fountain Soda':'Canned Soda','Olipop - Cola':'Canned Soda',
  'Olipop - Lemon Lime':'Canned Soda','Olipop - Root Beer':'Canned Soda',
  'Spindrift - Lemon':'Canned Soda','Spindrift - Grapefruit':'Canned Soda',
  'LaCroix - Lime':'Canned Soda','LaCroix - Grapefruit':'Canned Soda',
  'Open Water Still Water':'Water','Open Water Sparkling Water':'Water',
  'Wild Kombucha - Mango Peach':'Kombucha','Wild Kombucha - Ginger':'Kombucha',
  'Masala Chai':'Chai','Masala Chai - Oat Milk':'Chai',
  'Iced Oat Masala Chai':'Chai','Icaro - Spearmint Yerba Mate':'Chai',
  'Chocolate Chai Soft Serve':'Chai',
  'Fresh Young Coconut':'Coconut',
  'Masala Chai Cookies':'Cookies',
  'Sweet Cardamom Yogurt':'Yogurt',
  'Swirl Soft Serve':'Soft Serve','Mango Lassi Soft Serve':'Soft Serve',
  'Masala Chai Soft Serve':'Soft Serve',
  'Spiked Lassi':'Liquor','Tamarind Margarita':'Liquor',
  'Pabst Blue Ribbon - Gameday':'Gameday',
};

// GRP_TO_SUBCATEGORY TypeScript map (mirrors GRP_TO_SUBCAT_SQL)
const GRP_TO_SUBCAT_MAP: Record<string, string> = {
  'BOWLS':'Bowl','BUILD YOUR OWN BOWL':'Bowl','BYO':'Bowl','CHEF CURATED BOWLS':'Bowl',
  'PLATES':'Plates','CLASSIC INDIAN PLATES':'Plates',
  'BURRITOS':'Burrito','INDIAN BURRITOS':'Burrito',
  'KIDS':'Kids Meal',
  'Beer':'Beer','Wine':'Wine','Liquor':'Liquor','Gameday':'Gameday',
};

// Row is an open item when menu_name IS NULL
const IS_OPEN = `(fol.menu_name IS NULL)`;

// Canonical name normalisations applied to fact_order_lines.canonical_name.
// Maps Toast raw names (online short names + IH "- In House" variants) to PMIX canonical names.
// Used in getItems / getChannelItems / getLocationItems so item rows merge correctly.
const BYO_FIX_CTE = `byo_fix(raw, clean) AS (VALUES
  ('Grain Bowl',                                  'BYO Grain Bowl'),
  ('Salad Bowl',                                  'BYO Salad Bowl'),
  ('Greens + Grains Bowl',                        'BYO Greens + Grains Bowl'),
  ('Cauliflower + Quinoa',                        'Spiced Cauli + Quinoa Bowl'),
  ('Cauliflower + Quinoa Bowl',                   'Spiced Cauli + Quinoa Bowl'),
  ('Kids BYO',                                    'Kids Meal'),
  ('Burrito',                                     'BYO Indian Burrito'),
  ('Grain Bowl - In House',                       'BYO Grain Bowl'),
  ('Salad Bowl - In House',                       'BYO Salad Bowl'),
  ('Greens + Grains Bowl - In House',             'BYO Greens + Grains Bowl'),
  ('Cauliflower + Quinoa - In House',             'Spiced Cauli + Quinoa Bowl'),
  ('Burrito - In House',                          'BYO Indian Burrito'),
  ('Kids BYO - In House',                         'Kids Meal'),
  ('Homemade Juice - In House',                   'Homemade Juice'),
  ('Chicken Tikka Bowl - In House',               'Chicken Tikka Bowl'),
  ('Spicy Chili Chicken Bowl - In House',         'Spicy Chili Chicken Bowl'),
  ('Paneer Tikka Bowl - In House',                'Paneer Tikka Bowl'),
  ('Lamb Kebab Bowl - In House',                  'Lamb Kebab Bowl'),
  ('Chicken Tikka + Avocado Salad - In House',    'Chicken Tikka + Avocado Salad'),
  ('Butter Chicken - In House',                   'Butter Chicken'),
  ('Chicken Tikka Masala - In House',             'Chicken Tikka Masala'),
  ('Aloo Gobhi - In House',                       'Aloo Gobhi'),
  ('Saag Paneer - In House',                      'Saag Paneer'),
  ('Paneer Butter Masala - In House',             'Paneer Butter Masala'),
  ('Saag Chole - In House',                       'Saag Chole'),
  ('Pick 2 Combo Plate - In House',               'Pick 2 Combo Plate'),
  ('Tandoori Paneer Burrito - In House',          'Tandoori Paneer Burrito'),
  ('Butter Chicken Burrito - In House',           'Butter Chicken Burrito'),
  -- Vendor-prefix consolidation (dashboard-display-only — fact_order_lines.canonical_name
  -- keeps the original vendor-labeled name; this layer normalizes for reporting only).
  -- Rule: same dish sold under 2+ vendor labels -> bare name. Single-vendor items left alone.
  ('HUNGRY Chicken Tikka Bowl',                   'Chicken Tikka Bowl'),
  ('Sharebite Chicken Tikka Bowl',                'Chicken Tikka Bowl'),
  ('HUNGRY Chicken Tikka + Avocado Salad',        'Chicken Tikka + Avocado Salad'),
  ('HUNGRY Lamb Kebab Bowl',                      'Lamb Kebab Bowl'),
  ('HUNGRY GO Lamb Kebab Bowl',                   'Lamb Kebab Bowl'),
  ('Sharebite Grain Bowl',                        'BYO Grain Bowl'),
  ('Sharebite Tandoori Paneer Bowl',              'Tandoori Paneer Bowl'),
  ('Cureate Tandoori Paneer Bowl',                'Tandoori Paneer Bowl'),
  ('Fooda Tandoori Paneer Bowl',                  'Tandoori Paneer Bowl'),
  ('Aramark Tandoori Paneer Bowl',                'Tandoori Paneer Bowl'),
  ('Aramark Marriott Tandoori Paneer Bowl',       'Tandoori Paneer Bowl'),
  ('HUNGRY Garlic Naan',                          'Garlic Naan'),
  ('HUNGRY Naan',                                 'Naan'),
  ('Offsite Pop-Up Mango Lassi',                  'Mango Lassi'),
  ('Aramark Mango Lassi',                         'Mango Lassi'),
  ('Eurest APL Mango Lassi',                      'Mango Lassi'),
  ('Aramark Marriott Chicken Tikka Masala',       'Chicken Tikka Masala'),
  ('Offsite Masala Chai Cookies',                 'Masala Chai Cookies'),
  ('Fooda BYO Spicy Chicken Bowl',                'BYO Spicy Chicken Bowl'),
  ('Aramark Marriott BYO Spicy Chicken Bowl',     'BYO Spicy Chicken Bowl'),
  ('Fooda Chicken Curry Bowl',                    'Chicken Curry Bowl'),
  ('Aramark Marriott Chicken Curry Bowl',         'Chicken Curry Bowl'),
  ('Fooda BYO Chicken Bowl',                      'BYO Chicken Bowl'),
  ('Aramark Marriott BYO Chicken Bowl',           'BYO Chicken Bowl'),
  ('Fooda BYO Harvest Veg Bowl',                  'BYO Harvest Veg Bowl'),
  ('Aramark Marriott BYO Harvest Veg Bowl',       'BYO Harvest Veg Bowl'),
  ('Aramark Chicken Bowl',                        'Chicken Bowl'),
  ('Cureate Chicken Bowl',                        'Chicken Bowl'),
  ('Fooda BYO Paneer Bowl',                       'BYO Paneer Bowl'),
  ('Aramark Marriott BYO Paneer Bowl',            'BYO Paneer Bowl'),
  ('Fooda Extra Chicken',                         'Extra Chicken'),
  ('Aramark Marriott Extra Chicken',              'Extra Chicken'),
  ('Fooda Extra Spicy Chicken',                   'Extra Spicy Chicken'),
  ('Aramark Marriott Extra Spicy Chicken',        'Extra Spicy Chicken'),
  ('Fooda Extra Paneer',                          'Extra Paneer'),
  ('Aramark Marriott Extra Paneer',               'Extra Paneer'),
  ('Eurest Premium Bowl',                         'Premium Bowl'),
  ('Eurest APL Premium Bowl',                     'Premium Bowl'),
  ('Eurest Bowl',                                 'Bowl'),
  ('Eurest APL Bowl',                             'Bowl'),
  ('Aramark Harvest Vegetables Bowl',             'Harvest Vegetables Bowl'),
  ('Cureate Harvest Vegetables Bowl',             'Harvest Vegetables Bowl'),
  ('Aramark Marriott Spicy Chicken Avocado Bowl', 'Spicy Chicken Avocado Bowl'),
  ('Fooda Guarantee',                             'Guarantee'),
  ('HUNGRY Guarantee',                            'Guarantee'),
  ('Aramark Marriott Avocado',                    'Avocado'),
  ('Fooda MOD Spicy Chili Chicken',               'Spicy Chili Chicken')
)`;

// Base WHERE for all main metric queries:
//   - not voided, not deferred
//   - either menu_name is a known menu OR (menu_name IS NULL AND sales_category IN ('Food','Drink'))
const BASE_WHERE = `
  NOT fol.is_voided
  AND NOT fol.is_deferred
  AND (
    fol.menu_name IN (
      'FOOD - IN HOUSE','DRINKS - IN HOUSE',
      'APP','FOOD - TOAST ONLINE ORDERING',
      'DELIVERY','3PD OPEN MARKUP',
      'CATERING','CATERING - 3PD','OFFSITE POP-UPS'
    )
    OR (fol.menu_name IS NULL AND fol.sales_category IN ('Food','Drink'))
  )
`;

// ─── Date range ───────────────────────────────────────────────────────────────
export async function getDateRange(
  override?: { start: string; end: string; label?: string }
): Promise<DateRange> {
  const db = pool();
  const { rows } = await db.query(`
    SELECT
      MIN(business_date)::TEXT AS min_date,
      MAX(business_date)::TEXT AS max_date
    FROM public.fact_order_lines
    WHERE NOT is_voided AND NOT is_deferred
  `);
  await db.end();
  const dbMin = rows[0].min_date as string;
  const dbMax = rows[0].max_date as string;

  if (override) {
    return {
      start: override.start,
      end:   override.end,
      label: override.label ?? `${override.start} → ${override.end}`,
      dbMin,
      dbMax,
    };
  }

  // Default: last 28 days of COMPLETED data. dbMax can sit in the future
  // (advance catering orders are attributed to their event date), so anchor
  // presets/defaults at today; future orders stay reachable via custom ranges.
  const today  = new Date().toISOString().slice(0, 10);
  const anchor = dbMax < today ? dbMax : today;
  const end   = new Date(anchor);
  const start = new Date(anchor);
  start.setDate(start.getDate() - 27);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end), label: `${fmt(start)} → ${fmt(end)}`, dbMin, dbMax };
}

// ─── Summary KPIs ─────────────────────────────────────────────────────────────
export async function getSummary(dr: DateRange): Promise<Summary> {
  const db = pool();
  const [sumRes, topRes] = await Promise.all([
    db.query(`
      WITH refunds AS (
        SELECT COALESCE(SUM(rs.sales_refund), 0) AS refunds
        FROM analytics.refund_sales rs
        JOIN public.fact_order_lines fol ON fol.selection_guid = rs.selection_guid
        WHERE ${BASE_WHERE}
          AND fol.business_date BETWEEN $1::DATE AND $2::DATE
      )
      SELECT
        SUM(fol.quantity)::BIGINT                                          AS total_qty,
        ROUND(SUM(fol.line_total)::NUMERIC, 2)                            AS total_revenue,
        COUNT(DISTINCT fol.canonical_name)::INT                           AS unique_items,
        MAX(fol.business_date)::TEXT                                      AS last_date,
        (SELECT refunds FROM refunds)                                     AS refunds,
        ROUND(SUM(fol.line_total)::NUMERIC - (SELECT refunds FROM refunds), 2) AS net_revenue
      FROM public.fact_order_lines fol
      WHERE ${BASE_WHERE}
        AND fol.business_date BETWEEN $1::DATE AND $2::DATE
    `, [dr.start, dr.end]),

    db.query(`
      WITH grand AS (
        SELECT SUM(line_total) AS total
        FROM public.fact_order_lines fol
        WHERE ${BASE_WHERE}
          AND fol.business_date BETWEEN $1::DATE AND $2::DATE
      )
      SELECT
        fol.canonical_name,
        ROUND(SUM(fol.line_total)::NUMERIC, 2)                          AS revenue,
        ROUND(SUM(fol.line_total)*100.0/NULLIF(g.total,0)::NUMERIC, 1) AS mix_pct
      FROM public.fact_order_lines fol, grand g
      WHERE ${BASE_WHERE}
        AND fol.business_date BETWEEN $1::DATE AND $2::DATE
      GROUP BY fol.canonical_name, g.total
      ORDER BY revenue DESC
      LIMIT 1
    `, [dr.start, dr.end]),
  ]);
  await db.end();

  const row = sumRes.rows[0];
  const top = topRes.rows[0];
  return {
    total_qty:        Number(row?.total_qty ?? 0),
    total_revenue:    Number(row?.total_revenue ?? 0),
    unique_items:     Number(row?.unique_items ?? 0),
    last_date:        (row?.last_date as string) ?? '',
    top_item:         (top?.canonical_name as string) ?? '',
    top_item_revenue: Number(top?.revenue ?? 0),
    top_item_mix:     Number(top?.mix_pct ?? 0),
    refunds:          Number(row?.refunds ?? 0),
    net_revenue:      Number(row?.net_revenue ?? 0),
  };
}

// ─── Channel breakdown ────────────────────────────────────────────────────────
export async function getChannels(dr: DateRange): Promise<ChannelRow[]> {
  const db = pool();
  const { rows } = await db.query(`
    WITH grand AS (
      SELECT SUM(line_total) AS total
      FROM public.fact_order_lines fol
      WHERE ${BASE_WHERE}
        AND fol.business_date BETWEEN $1::DATE AND $2::DATE
    )
    SELECT
      (${CHO}) AS channel,
      SUM(fol.quantity)::BIGINT                                        AS qty,
      ROUND(SUM(fol.line_total)::NUMERIC, 2)                          AS revenue,
      ROUND(SUM(fol.line_total)*100.0/NULLIF(g.total,0)::NUMERIC, 1) AS pct
    FROM public.fact_order_lines fol
    CROSS JOIN grand g
    ${CH_OVERRIDE_JOIN('fol.selection_guid')}
    WHERE ${BASE_WHERE}
      AND fol.business_date BETWEEN $1::DATE AND $2::DATE
    GROUP BY 1, g.total
    ORDER BY revenue DESC
  `, [dr.start, dr.end]);
  await db.end();
  return rows.map(r => ({
    channel: r.channel as string,
    qty:     Number(r.qty),
    revenue: Number(r.revenue),
    pct:     Number(r.pct),
  }));
}

// ─── Weekly trend ─────────────────────────────────────────────────────────────
export async function getWeekly(dr: DateRange): Promise<WeekRow[]> {
  const db = pool();
  const { rows } = await db.query(`
    WITH refund_totals AS (
      SELECT
        DATE_TRUNC('week', fol.business_date)::DATE AS week_start,
        SUM(rs.sales_refund)                        AS refunds
      FROM analytics.refund_sales rs
      JOIN public.fact_order_lines fol ON fol.selection_guid = rs.selection_guid
      WHERE ${BASE_WHERE}
        AND fol.business_date BETWEEN $1::DATE AND $2::DATE
      GROUP BY 1
    )
    SELECT
      DATE_TRUNC('week', fol.business_date)::DATE::TEXT AS week_start,
      ROUND(SUM(fol.line_total)::NUMERIC - COALESCE(MAX(rt.refunds), 0), 0) AS revenue,
      SUM(fol.quantity)::BIGINT                         AS qty
    FROM public.fact_order_lines fol
    LEFT JOIN refund_totals rt ON rt.week_start = DATE_TRUNC('week', fol.business_date)::DATE
    WHERE ${BASE_WHERE}
      AND fol.business_date BETWEEN $1::DATE AND $2::DATE
    GROUP BY 1
    ORDER BY 1
  `, [dr.start, dr.end]);
  await db.end();
  return rows.map(r => ({
    week_start: r.week_start as string,
    revenue:    Number(r.revenue),
    qty:        Number(r.qty),
  }));
}

export async function getDaily(dr: DateRange): Promise<DailyRow[]> {
  const db = pool();
  const { rows } = await db.query(`
    WITH refund_totals AS (
      SELECT
        fol.business_date    AS date,
        SUM(rs.sales_refund) AS refunds
      FROM analytics.refund_sales rs
      JOIN public.fact_order_lines fol ON fol.selection_guid = rs.selection_guid
      WHERE ${BASE_WHERE}
        AND fol.business_date BETWEEN $1::DATE AND $2::DATE
      GROUP BY 1
    )
    SELECT
      fol.business_date::TEXT                          AS date,
      ROUND(SUM(fol.line_total)::NUMERIC - COALESCE(MAX(rt.refunds), 0), 0) AS revenue,
      SUM(fol.quantity)::BIGINT                        AS qty
    FROM public.fact_order_lines fol
    LEFT JOIN refund_totals rt ON rt.date = fol.business_date
    WHERE ${BASE_WHERE}
      AND fol.business_date BETWEEN $1::DATE AND $2::DATE
    GROUP BY 1
    ORDER BY 1
  `, [dr.start, dr.end]);
  await db.end();
  return rows.map(r => ({
    date:    r.date as string,
    revenue: Number(r.revenue),
    qty:     Number(r.qty),
  }));
}

export async function getWeeklyByChannel(dr: DateRange): Promise<WeeklyChannelRow[]> {
  const db = pool();
  const { rows } = await db.query(`
    WITH refund_totals AS (
      SELECT
        DATE_TRUNC('week', fol.business_date)::DATE AS week_start,
        (${CHO})                                    AS channel,
        COALESCE(fol.location_code, '')             AS location_code,
        (${CAT1})                                   AS category,
        SUM(rs.sales_refund)                        AS refunds
      FROM analytics.refund_sales rs
      JOIN public.fact_order_lines fol ON fol.selection_guid = rs.selection_guid
      ${CH_OVERRIDE_JOIN('fol.selection_guid')}
      WHERE ${BASE_WHERE}
        AND fol.business_date BETWEEN $1::DATE AND $2::DATE
      GROUP BY 1, 2, 3, 4
    )
    SELECT
      DATE_TRUNC('week', fol.business_date)::DATE::TEXT AS week_start,
      (${CHO})                                          AS channel,
      COALESCE(fol.location_code, '')                   AS location_code,
      (${CAT1})                                         AS category,
      ROUND(SUM(fol.line_total)::NUMERIC - COALESCE(MAX(rt.refunds), 0), 0) AS revenue,
      SUM(fol.quantity)::BIGINT                         AS qty
    FROM public.fact_order_lines fol
    ${CH_OVERRIDE_JOIN('fol.selection_guid')}
    LEFT JOIN refund_totals rt
      ON rt.week_start = DATE_TRUNC('week', fol.business_date)::DATE
      AND rt.channel = (${CHO})
      AND rt.location_code = COALESCE(fol.location_code, '')
      AND rt.category = (${CAT1})
    WHERE ${BASE_WHERE}
      AND fol.business_date BETWEEN $1::DATE AND $2::DATE
    GROUP BY 1, 2, 3, 4
    ORDER BY 1, 2
  `, [dr.start, dr.end]);
  await db.end();
  return rows.map(r => ({
    week_start:    r.week_start    as string,
    channel:       r.channel       as string,
    location_code: r.location_code as string,
    category:      r.category      as string,
    revenue:       Number(r.revenue),
    qty:           Number(r.qty),
  }));
}

export async function getDailyByChannel(dr: DateRange): Promise<DailyChannelRow[]> {
  const db = pool();
  const { rows } = await db.query(`
    WITH refund_totals AS (
      SELECT
        fol.business_date               AS date,
        (${CHO})                        AS channel,
        COALESCE(fol.location_code, '') AS location_code,
        (${CAT1})                       AS category,
        SUM(rs.sales_refund)            AS refunds
      FROM analytics.refund_sales rs
      JOIN public.fact_order_lines fol ON fol.selection_guid = rs.selection_guid
      ${CH_OVERRIDE_JOIN('fol.selection_guid')}
      WHERE ${BASE_WHERE}
        AND fol.business_date BETWEEN $1::DATE AND $2::DATE
      GROUP BY 1, 2, 3, 4
    )
    SELECT
      fol.business_date::TEXT                          AS date,
      (${CHO})                                         AS channel,
      COALESCE(fol.location_code, '')                  AS location_code,
      (${CAT1})                                        AS category,
      ROUND(SUM(fol.line_total)::NUMERIC - COALESCE(MAX(rt.refunds), 0), 0) AS revenue,
      SUM(fol.quantity)::BIGINT                        AS qty
    FROM public.fact_order_lines fol
    ${CH_OVERRIDE_JOIN('fol.selection_guid')}
    LEFT JOIN refund_totals rt
      ON rt.date = fol.business_date
      AND rt.channel = (${CHO})
      AND rt.location_code = COALESCE(fol.location_code, '')
      AND rt.category = (${CAT1})
    WHERE ${BASE_WHERE}
      AND fol.business_date BETWEEN $1::DATE AND $2::DATE
    GROUP BY 1, 2, 3, 4
    ORDER BY 1, 2
  `, [dr.start, dr.end]);
  await db.end();
  return rows.map(r => ({
    date:          r.date          as string,
    channel:       r.channel       as string,
    location_code: r.location_code as string,
    category:      r.category      as string,
    revenue:       Number(r.revenue),
    qty:           Number(r.qty),
  }));
}

// ─── Items ────────────────────────────────────────────────────────────────────
export async function getItems(dr: DateRange): Promise<ItemRow[]> {
  const db = pool();
  // Substitute mapped name into category expressions so items with different raw names
  // but the same canonical name (e.g. "Salad Bowl" vs "BYO Salad Bowl") merge into one row.
  const mappedExpr = `COALESCE(bf.clean, fol.canonical_name)`;
  const cat1Mapped = CAT1.replace(/fol\.canonical_name/g, mappedExpr);
  const cat2Mapped = CAT2.replace(/fol\.canonical_name/g, mappedExpr);
  const { rows } = await db.query(`
    WITH
    ${BYO_FIX_CTE},
    grand AS (
      SELECT SUM(fol.line_total) AS total_rev, SUM(fol.quantity) AS total_qty
      FROM public.fact_order_lines fol
      WHERE ${BASE_WHERE}
        AND fol.business_date BETWEEN $1::DATE AND $2::DATE
    ),
    refund_totals AS (
      SELECT
        ${mappedExpr}       AS canonical_name,
        fol.menu_name       AS rt_menu_name,
        fol.menu_group      AS rt_menu_group,
        (${CHO})            AS channel,
        SUM(rs.sales_refund) AS refunds
      FROM analytics.refund_sales rs
      JOIN public.fact_order_lines fol ON fol.selection_guid = rs.selection_guid
      LEFT JOIN byo_fix bf ON bf.raw = fol.canonical_name
      ${CH_OVERRIDE_JOIN('fol.selection_guid')}
      WHERE ${BASE_WHERE}
        AND fol.business_date BETWEEN $1::DATE AND $2::DATE
      GROUP BY 1, 2, 3, 4
    )
    SELECT
      ${mappedExpr}                                                           AS canonical_name,
      fol.menu_name,
      COALESCE(fol.menu_group, '')                                           AS menu_group,
      (${CHO})                                                               AS channel,
      ${IS_OPEN}                                                             AS is_open_item,
      SUM(fol.quantity)::BIGINT                                              AS qty,
      ROUND(SUM(fol.line_total)::NUMERIC, 2)                                AS revenue,
      ROUND(SUM(fol.pre_discount)::NUMERIC, 2)                              AS gross_sales,
      ROUND(SUM(fol.pre_discount)/NULLIF(SUM(fol.quantity),0)::NUMERIC, 2)  AS avg_price,
      ROUND(SUM(fol.line_total)*100.0/NULLIF(g.total_rev,0)::NUMERIC, 2)    AS revenue_pct,
      ROUND(SUM(fol.quantity)*100.0/NULLIF(g.total_qty,0)::NUMERIC, 2)      AS qty_pct,
      ${cat1Mapped}                                                          AS category,
      ${cat2Mapped}                                                         AS sub_category,
      COALESCE(MAX(rt.refunds), 0)                                          AS refunds,
      ROUND(SUM(fol.line_total)::NUMERIC - COALESCE(MAX(rt.refunds), 0), 2) AS net_after_refunds
    FROM public.fact_order_lines fol
    LEFT JOIN byo_fix bf ON bf.raw = fol.canonical_name
    ${IL_JOIN}
    ${CH_OVERRIDE_JOIN('fol.selection_guid')}
    CROSS JOIN grand g
    LEFT JOIN refund_totals rt
      ON rt.canonical_name = ${mappedExpr}
      AND rt.rt_menu_name = fol.menu_name
      AND rt.rt_menu_group = fol.menu_group
      AND rt.channel = (${CHO})
    WHERE ${BASE_WHERE}
      AND fol.business_date BETWEEN $1::DATE AND $2::DATE
    GROUP BY
      ${mappedExpr}, fol.menu_name, fol.menu_group,
      mlt.modifier_name, co.correct_channel,
      g.total_rev, g.total_qty
    ORDER BY revenue DESC
  `, [dr.start, dr.end]);
  await db.end();
  return rows.map(r => ({
    canonical_name: r.canonical_name as string,
    menu_name:      (r.menu_name ?? '') as string,
    menu_group:     r.menu_group as string,
    channel:        r.channel as string,
    is_open_item:   r.is_open_item as boolean,
    qty:            Number(r.qty),
    revenue:        Number(r.revenue),
    gross_sales:    Number(r.gross_sales),
    avg_price:      Number(r.avg_price),
    revenue_pct:    Number(r.revenue_pct),
    qty_pct:        Number(r.qty_pct),
    category:       r.category as string,
    sub_category:   r.sub_category as string,
    refunds:            Number(r.refunds),
    net_after_refunds:  Number(r.net_after_refunds),
  }));
}

// ─── Per-channel item breakdown (for channel filter recompute) ────────────────
export async function getChannelItems(dr: DateRange): Promise<ChannelItemRow[]> {
  const db = pool();
  const { rows } = await db.query(`
    WITH
    ${BYO_FIX_CTE},
    refund_totals AS (
      SELECT
        COALESCE(bf.clean, fol.canonical_name) AS canonical_name,
        (${CHO})                               AS channel,
        SUM(rs.sales_refund)                   AS refunds
      FROM analytics.refund_sales rs
      JOIN public.fact_order_lines fol ON fol.selection_guid = rs.selection_guid
      LEFT JOIN byo_fix bf ON bf.raw = fol.canonical_name
      ${CH_OVERRIDE_JOIN('fol.selection_guid')}
      WHERE ${BASE_WHERE}
        AND fol.business_date BETWEEN $1::DATE AND $2::DATE
      GROUP BY 1, 2
    )
    SELECT
      COALESCE(bf.clean, fol.canonical_name) AS canonical_name,
      (${CHO}) AS channel,
      SUM(fol.quantity)::BIGINT               AS qty,
      ROUND(SUM(fol.line_total)::NUMERIC,2)   AS revenue,
      ROUND(SUM(fol.pre_discount)::NUMERIC,2) AS gross_sales,
      COALESCE(MAX(rt.refunds), 0)                                        AS refunds,
      ROUND(SUM(fol.line_total)::NUMERIC - COALESCE(MAX(rt.refunds), 0), 2) AS net_after_refunds
    FROM public.fact_order_lines fol
    LEFT JOIN byo_fix bf ON bf.raw = fol.canonical_name
    ${CH_OVERRIDE_JOIN('fol.selection_guid')}
    LEFT JOIN refund_totals rt
      ON rt.canonical_name = COALESCE(bf.clean, fol.canonical_name)
      AND rt.channel = (${CHO})
    WHERE ${BASE_WHERE}
      AND fol.business_date BETWEEN $1::DATE AND $2::DATE
    GROUP BY COALESCE(bf.clean, fol.canonical_name), 2
    ORDER BY revenue DESC
  `, [dr.start, dr.end]);
  await db.end();
  return rows.map(r => ({
    canonical_name: r.canonical_name as string,
    channel:        r.channel        as string,
    qty:            Number(r.qty),
    revenue:        Number(r.revenue),
    gross_sales:    Number(r.gross_sales),
    refunds:            Number(r.refunds),
    net_after_refunds:  Number(r.net_after_refunds),
  }));
}

// ─── Location items ───────────────────────────────────────────────────────────
export async function getLocationItems(dr: DateRange): Promise<LocationItemRow[]> {
  const db = pool();
  const { rows } = await db.query(`
    WITH
    ${BYO_FIX_CTE},
    loc_totals AS (
      SELECT location_code, SUM(quantity) AS loc_qty
      FROM public.fact_order_lines fol
      WHERE ${BASE_WHERE}
        AND fol.business_date BETWEEN $1::DATE AND $2::DATE
      GROUP BY location_code
    ),
    refund_totals AS (
      SELECT
        COALESCE(bf.clean, fol.canonical_name) AS canonical_name,
        fol.location_code,
        (${CHO})                               AS channel,
        SUM(rs.sales_refund)                   AS refunds
      FROM analytics.refund_sales rs
      JOIN public.fact_order_lines fol ON fol.selection_guid = rs.selection_guid
      LEFT JOIN byo_fix bf ON bf.raw = fol.canonical_name
      ${CH_OVERRIDE_JOIN('fol.selection_guid')}
      WHERE ${BASE_WHERE}
        AND fol.business_date BETWEEN $1::DATE AND $2::DATE
      GROUP BY 1, 2, 3
    )
    SELECT
      COALESCE(bf.clean, fol.canonical_name)                            AS canonical_name,
      fol.location_code,
      (${CHO})                                                           AS channel,
      SUM(fol.quantity)::BIGINT                                          AS qty,
      ROUND(SUM(fol.line_total)::NUMERIC, 2)                            AS revenue,
      ROUND(SUM(fol.pre_discount)::NUMERIC, 2)                          AS gross_sales,
      ROUND(SUM(fol.quantity)*100.0/NULLIF(lt.loc_qty,0)::NUMERIC, 2)  AS mix_pct,
      COALESCE(MAX(rt.refunds), 0)                                        AS refunds,
      ROUND(SUM(fol.line_total)::NUMERIC - COALESCE(MAX(rt.refunds), 0), 2) AS net_after_refunds
    FROM public.fact_order_lines fol
    LEFT JOIN byo_fix bf ON bf.raw = fol.canonical_name
    JOIN loc_totals lt ON lt.location_code = fol.location_code
    ${CH_OVERRIDE_JOIN('fol.selection_guid')}
    LEFT JOIN refund_totals rt
      ON rt.canonical_name = COALESCE(bf.clean, fol.canonical_name)
      AND rt.location_code = fol.location_code
      AND rt.channel = (${CHO})
    WHERE ${BASE_WHERE}
      AND fol.business_date BETWEEN $1::DATE AND $2::DATE
    GROUP BY COALESCE(bf.clean, fol.canonical_name), fol.location_code, (${CHO}), lt.loc_qty
    ORDER BY COALESCE(bf.clean, fol.canonical_name), fol.location_code
  `, [dr.start, dr.end]);
  await db.end();
  return rows.map(r => ({
    canonical_name: r.canonical_name as string,
    location_code:  r.location_code  as string,
    channel:        r.channel        as string,
    qty:            Number(r.qty),
    revenue:        Number(r.revenue),
    gross_sales:    Number(r.gross_sales),
    mix_pct:        Number(r.mix_pct),
    refunds:            Number(r.refunds),
    net_after_refunds:  Number(r.net_after_refunds),
  }));
}

export async function getLocations(): Promise<LocationRow[]> {
  const db = pool();
  const { rows } = await db.query(`
    SELECT location_code, display_name
    FROM public.dim_location
    ORDER BY display_name
  `);
  await db.end();
  // is_open is always TRUE here — this function is only ever called from inside
  // loadDashboardData, which is cached for hours (cacheLife('hours')). Real
  // open/closed status must never be baked into that cache, or a tester's
  // change can sit stale for up to an hour. The actual value is fetched fresh,
  // uncached, via getLocationsWithStatus() in app/page.tsx, which overwrites
  // data.locations before it ever reaches the client.
  return rows.map(r => ({
    location_code: r.location_code as string,
    display_name:  r.display_name  as string,
    is_open:       true,
  }));
}

// ─── Category totals ─────────────────────────────────────────────────────────
export async function getCategories(dr: DateRange): Promise<CategoryRow[]> {
  const db = pool();
  const { rows } = await db.query(`
    SELECT
      ${CAT1}                                AS category,
      ROUND(SUM(fol.line_total)::NUMERIC, 2) AS revenue,
      SUM(fol.quantity)::BIGINT              AS qty
    FROM public.fact_order_lines fol
    ${IL_JOIN}
    WHERE ${BASE_WHERE}
      AND fol.business_date BETWEEN $1::DATE AND $2::DATE
    GROUP BY 1
    ORDER BY revenue DESC
  `, [dr.start, dr.end]);
  await db.end();
  return rows.map(r => ({
    category: r.category as string,
    revenue:  Number(r.revenue),
    qty:      Number(r.qty),
  }));
}

// ─── Channel × category ───────────────────────────────────────────────────────
// CAT1 already handles OFFSITE via GRP_TO_CAT_SQL fallback on menu_group.
export async function getChannelCategories(dr: DateRange): Promise<ChannelCategoryRow[]> {
  const db = pool();
  const { rows } = await db.query(`
    WITH line_data AS (
      SELECT
        (${CHO})     AS channel,
        ${CAT1}      AS category,
        fol.line_total
      FROM public.fact_order_lines fol
      ${IL_JOIN}
      ${CH_OVERRIDE_JOIN('fol.selection_guid')}
      WHERE ${BASE_WHERE}
        AND fol.business_date BETWEEN $1::DATE AND $2::DATE
    )
    SELECT
      channel,
      category,
      ROUND(SUM(line_total)::NUMERIC, 2) AS revenue
    FROM line_data
    GROUP BY 1, 2
    ORDER BY 1, revenue DESC
  `, [dr.start, dr.end]);
  await db.end();
  return rows.map(r => ({
    channel:  r.channel  as string,
    category: r.category as string,
    revenue:  Number(r.revenue),
  }));
}

// ─── Catering vendor breakdown ───────────────────────────────────────────────
export async function getCateringVendors(dr: DateRange): Promise<VendorRow[]> {
  const db = pool();
  const { rows } = await db.query(`
    WITH catering_orders AS (
      SELECT DISTINCT fol.order_guid
      FROM public.fact_order_lines fol
      ${CH_OVERRIDE_JOIN('fol.selection_guid')}
      WHERE ${BASE_WHERE}
        AND (${CHO}) IN ('CATERING', 'CATERING_3PD')
        AND fol.business_date BETWEEN $1::DATE AND $2::DATE
    ),
    vendor_rev AS (
      SELECT
        COALESCE(NULLIF(TRIM(p.alt_payment_name),''), 'Direct') AS vendor,
        COUNT(DISTINCT p.order_guid)::INT                        AS orders,
        ROUND(SUM(p.amount)::NUMERIC, 2)                        AS revenue
      FROM public.br_order_payment p
      JOIN catering_orders co ON co.order_guid = p.order_guid
      WHERE p.business_date BETWEEN $1::DATE AND $2::DATE
      GROUP BY 1
    ),
    grand AS (SELECT SUM(revenue) AS total FROM vendor_rev)
    SELECT
      vr.vendor,
      vr.orders,
      vr.revenue,
      ROUND(vr.revenue/NULLIF(vr.orders,0)::NUMERIC, 2)        AS aov,
      ROUND(vr.revenue*100.0/NULLIF(g.total,0)::NUMERIC, 1)    AS pct
    FROM vendor_rev vr, grand g
    ORDER BY vr.revenue DESC
  `, [dr.start, dr.end]);
  await db.end();
  return rows.map(r => ({
    vendor:  r.vendor  as string,
    orders:  Number(r.orders),
    revenue: Number(r.revenue),
    aov:     Number(r.aov),
    pct:     Number(r.pct),
  }));
}

// ─── Offsite vendor breakdown ─────────────────────────────────────────────────
export async function getOffsiteVendors(dr: DateRange): Promise<VendorRow[]> {
  const db = pool();
  const { rows } = await db.query(`
    WITH offsite_orders AS (
      SELECT DISTINCT fol.order_guid
      FROM public.fact_order_lines fol
      ${CH_OVERRIDE_JOIN('fol.selection_guid')}
      WHERE ${BASE_WHERE}
        AND (${CHO}) = 'OFFSITE'
        AND fol.business_date BETWEEN $1::DATE AND $2::DATE
    ),
    vendor_rev AS (
      SELECT
        COALESCE(NULLIF(TRIM(p.alt_payment_name),''), 'Direct') AS vendor,
        COUNT(DISTINCT p.order_guid)::INT                        AS orders,
        ROUND(SUM(p.amount)::NUMERIC, 2)                        AS revenue
      FROM public.br_order_payment p
      JOIN offsite_orders oo ON oo.order_guid = p.order_guid
      WHERE p.business_date BETWEEN $1::DATE AND $2::DATE
      GROUP BY 1
    ),
    grand AS (SELECT SUM(revenue) AS total FROM vendor_rev)
    SELECT
      vr.vendor,
      vr.orders,
      vr.revenue,
      ROUND(vr.revenue/NULLIF(vr.orders,0)::NUMERIC, 2)      AS aov,
      ROUND(vr.revenue*100.0/NULLIF(g.total,0)::NUMERIC, 1)  AS pct
    FROM vendor_rev vr, grand g
    ORDER BY vr.revenue DESC
  `, [dr.start, dr.end]);
  await db.end();
  return rows.map(r => ({
    vendor:  r.vendor  as string,
    orders:  Number(r.orders),
    revenue: Number(r.revenue),
    aov:     Number(r.aov),
    pct:     Number(r.pct),
  }));
}

// ─── Menu Engineering ─────────────────────────────────────────────────────────
// Mirrors AppScript v2 pipeline: Steps 1-7 (Raw MB → Clean MB → Pink Cost → Channel Masters → Blended Master)
export async function getMEItems(dr: DateRange): Promise<MERow[]> {
  const db = pool();
  const { rows } = await db.query(`
    WITH
    ${BYO_FIX_CTE},

    -- Step 1/3: Channel-tagged sales per item × period
    -- Only known menu_names → channels IH / LO / 3PD
    -- Open items (no menu_name) excluded — AppScript skips rows with no menu
    cs AS (
      SELECT
        COALESCE(bf.clean, fol.canonical_name)                                AS canonical_name,
        MIN(fol.menu_group)                                                    AS menu_group,
        -- Override-aware: map the full 8-value channel (co.correct_channel if a
        -- Needs Review fix exists, else the natural menu_name derivation) into
        -- ME's narrower IH/LO/3PD split. TPD + TPD_MARKUP both roll into 3PD.
        CASE (${CHO})
          WHEN 'IN_HOUSE'   THEN 'IH'
          WHEN 'APP'        THEN 'LO'
          WHEN 'TPD'        THEN '3PD'
          WHEN 'TPD_MARKUP' THEN '3PD'
        END                                                                    AS channel,
        'P'||LPAD(fp.period::TEXT,2,'0')||'-'||fp.fiscal_year::TEXT            AS cost_period,
        SUM(fol.quantity)                                                       AS qty,
        SUM(fol.pre_discount)                                                   AS gross_sales,
        SUM(fol.line_total)                                                     AS net_sales
      FROM public.fact_order_lines fol
      LEFT JOIN byo_fix bf ON bf.raw = fol.canonical_name
      LEFT JOIN public.dim_fiscal_period fp
             ON fol.business_date >= fp.start_date::DATE
            AND fol.business_date <= fp.end_date::DATE
      ${CH_OVERRIDE_JOIN('fol.selection_guid')}
      WHERE NOT fol.is_voided
        AND NOT fol.is_deferred
        AND (${CHO}) IN ('IN_HOUSE', 'APP', 'TPD', 'TPD_MARKUP')
        AND COALESCE(fol.menu_group,'') NOT IN (
          'Aramark','BAG TAX','Cater Cow','Catering Bundles',
          'Catering Packages - BYO Bowl Bar',
          'EzCater + Relish Individually Packaged Bowls','EzCater Additional Items',
          'EzCater Catering Packages','EzCater Drinks','EzCater Sides + Sweets',
          'Fooda','HUNGRY','Metz','Sharebite','Taher','TERRITORY','ZeroCater',
          'Club Feast','Cureate','EF Tours','Eurest',
          'Individually Packaged Bowls','Individually Packaged Indian Burritos',
          'Individually Packaged Plates','Indian Burrito Boxes',
          '3PD MARKUPS','Additional Items'
        )
        AND fol.business_date BETWEEN $1::DATE AND $2::DATE
      GROUP BY COALESCE(bf.clean, fol.canonical_name), channel, cost_period
    ),

    -- Step 2: Base item costs from r365_item_cost, channel-aware, period-matched
    -- AppScript getR365ItemCost_: IH prefers IN HOUSE menu; LO/3PD prefer DELIVERY
    -- Period-specific rows used first; _latest fallback for periods with no cost entry
    ih_base AS (
      SELECT DISTINCT ON (item_name_updated, period)
        item_name_updated, period, avg_cost
      FROM analytics.r365_item_cost
      WHERE menu IN ('FOOD - IN HOUSE','DRINKS - IN HOUSE') AND avg_cost > 0 AND item_name <> 'Harvest Chicken Bowl - In House'
      ORDER BY item_name_updated, period
    ),
    online_base AS (
      SELECT DISTINCT ON (item_name_updated, period)
        item_name_updated, period, avg_cost
      FROM analytics.r365_item_cost
      WHERE menu IN ('DELIVERY','3PD OPEN MARKUP') AND avg_cost > 0 AND item_name <> 'Harvest Chicken Bowl - In House'
      ORDER BY item_name_updated, period
    ),
    any_base AS (
      SELECT DISTINCT ON (item_name_updated, period)
        item_name_updated, period, avg_cost
      FROM analytics.r365_item_cost
      WHERE avg_cost > 0 AND item_name <> 'Harvest Chicken Bowl - In House'
      ORDER BY item_name_updated, period
    ),
    -- Harvest Chicken Bowl is its own displayed item (PMIX_AppScript.txt ITEMS list)
    -- but r365_item_cost gives it the SAME item_name_updated as the real Greens+Grains
    -- recipe ('BYO Greens + Grains Bowl') at the same period/menu — matching on
    -- item_name_updated alone is ambiguous; match on item_name instead.
    harvest_chicken_cost AS (
      SELECT period, avg_cost
      FROM analytics.r365_item_cost
      WHERE item_name = 'Harvest Chicken Bowl - In House' AND avg_cost > 0
    ),
    -- Online modifier cost per item × period (LO+3PD orders only)
    -- Reads the precomputed daily grain (analytics.pc_modifier_daily) instead of
    -- joining fact_modifiers x fact_order_lines live — see lib/modifierCost.ts
    -- and PMIX-Pipeline's sql/pc_refresh.sql for the rules baked into include_cmc.
    cmc AS (
      SELECT
        COALESCE(bf.clean, d.raw_parent)                                AS parent_item,
        'P'||LPAD((d.pnum % 100)::TEXT,2,'0')||'-'||(d.pnum / 100)::TEXT AS cost_period,
        SUM(d.qty * COALESCE(uc.unit_cost, 0))                          AS total_mod_cost
      FROM analytics.pc_modifier_daily d
      LEFT JOIN byo_fix bf ON bf.raw = d.raw_parent
      LEFT JOIN analytics.pc_modifier_unit_cost uc
             ON uc.norm_name = d.mod_norm AND uc.pnum = d.pnum
      WHERE d.business_date BETWEEN $1::DATE AND $2::DATE
        AND d.channel IN ('APP', 'TPD', 'TPD_MARKUP')
        AND d.include_cmc
        AND d.in_byo_scope
      GROUP BY 1, 2
    ),

    -- IH modifier cost per item × period
    cmc_ih AS (
      SELECT
        COALESCE(bf.clean, d.raw_parent)                                AS parent_item,
        'P'||LPAD((d.pnum % 100)::TEXT,2,'0')||'-'||(d.pnum / 100)::TEXT AS cost_period,
        SUM(d.qty * COALESCE(uc.unit_cost, 0))                          AS total_ih_mod_cost
      FROM analytics.pc_modifier_daily d
      LEFT JOIN byo_fix bf ON bf.raw = d.raw_parent
      LEFT JOIN analytics.pc_modifier_unit_cost uc
             ON uc.norm_name = d.mod_norm AND uc.pnum = d.pnum
      WHERE d.business_date BETWEEN $1::DATE AND $2::DATE
        AND d.channel = 'IN_HOUSE'
        AND d.include_cmc
        AND d.in_byo_scope
      GROUP BY 1, 2
    ),

    -- Online (LO+3PD) qty per item × period: denominator for pink-sheet avg cost
    online_qty AS (
      SELECT canonical_name, cost_period, SUM(qty) AS total_qty
      FROM cs
      WHERE channel IN ('LO','3PD')
      GROUP BY canonical_name, cost_period
    ),

    -- IH qty per item × period: denominator for IH modifier adder
    ih_qty AS (
      SELECT canonical_name, cost_period, SUM(qty) AS total_qty
      FROM cs
      WHERE channel = 'IH'
      GROUP BY canonical_name, cost_period
    ),

    -- Step 6: Total cost per channel × period (pink-sheet formula for all channels)
    cwc AS (
      SELECT
        cs.canonical_name,
        cs.channel,
        cs.menu_group,
        cs.qty,
        cs.gross_sales,
        cs.net_sales,
        cs.cost_period,
        cs.qty * (
          CASE WHEN cs.channel = 'IH'
            THEN COALESCE(hc.avg_cost, hcl.avg_cost, ib.avg_cost, ibl.avg_cost, ab.avg_cost, abl.avg_cost, 0)
                 + CASE
                     WHEN (
                       UPPER(cs.menu_group) IN (
                         'BOWLS','BUILD YOUR OWN BOWL','BYO','CHEF CURATED BOWLS',
                         'PLATES','CLASSIC INDIAN PLATES',
                         'BURRITOS','INDIAN BURRITOS',
                         'KIDS','KIDS MEAL'
                       )
                       OR cs.canonical_name IN (
                         'Side of Main','Side of Grain','Side of Sauce','Side of Veggie',
                         'Homemade Juice','Handcrafted Juice for a Group - 1/2 Gallon'
                       )
                     )
                     THEN COALESCE(cmc_ih.total_ih_mod_cost, 0) / NULLIF(iq.total_qty, 0)
                     ELSE 0
                   END
            ELSE COALESCE(ob.avg_cost, obl.avg_cost, ab.avg_cost, abl.avg_cost, 0)
                 + CASE
                     WHEN (
                       UPPER(cs.menu_group) IN (
                         'BOWLS','BUILD YOUR OWN BOWL','BYO','CHEF CURATED BOWLS',
                         'PLATES','CLASSIC INDIAN PLATES',
                         'BURRITOS','INDIAN BURRITOS',
                         'KIDS','KIDS MEAL'
                       )
                       OR cs.canonical_name IN (
                         'Side of Main','Side of Grain','Side of Sauce','Side of Veggie',
                         'Homemade Juice','Handcrafted Juice for a Group - 1/2 Gallon'
                       )
                     )
                     THEN COALESCE(cmc.total_mod_cost, 0) / NULLIF(oq.total_qty, 0)
                     ELSE 0
                   END
          END
        )                                                                      AS total_cost
      FROM cs
      LEFT JOIN LATERAL (
        SELECT avg_cost FROM harvest_chicken_cost
        WHERE cs.canonical_name = 'Harvest Chicken Bowl' AND period = cs.cost_period
      ) hc ON true
      LEFT JOIN LATERAL (
        SELECT avg_cost FROM harvest_chicken_cost
        WHERE cs.canonical_name = 'Harvest Chicken Bowl'
          AND RIGHT(period,4)::INT * 100 + SUBSTRING(period,2,2)::INT
              <= RIGHT(cs.cost_period,4)::INT * 100 + SUBSTRING(cs.cost_period,2,2)::INT
        ORDER BY RIGHT(period,4)::INT DESC, SUBSTRING(period,2,2)::INT DESC LIMIT 1
      ) hcl ON true
      LEFT JOIN ih_base           ib  ON ib.item_name_updated  = cs.canonical_name AND ib.period  = cs.cost_period
      LEFT JOIN LATERAL (
        SELECT avg_cost FROM analytics.r365_item_cost
        WHERE menu IN ('FOOD - IN HOUSE','DRINKS - IN HOUSE') AND avg_cost > 0 AND item_name <> 'Harvest Chicken Bowl - In House'
          AND item_name_updated = cs.canonical_name
          AND RIGHT(period,4)::INT * 100 + SUBSTRING(period,2,2)::INT
              <= RIGHT(cs.cost_period,4)::INT * 100 + SUBSTRING(cs.cost_period,2,2)::INT
        ORDER BY RIGHT(period,4)::INT DESC, SUBSTRING(period,2,2)::INT DESC LIMIT 1
      ) ibl ON true
      LEFT JOIN online_base       ob  ON ob.item_name_updated  = cs.canonical_name AND ob.period  = cs.cost_period
      LEFT JOIN LATERAL (
        SELECT avg_cost FROM analytics.r365_item_cost
        WHERE menu IN ('DELIVERY','3PD OPEN MARKUP') AND avg_cost > 0 AND item_name <> 'Harvest Chicken Bowl - In House'
          AND item_name_updated = cs.canonical_name
          AND RIGHT(period,4)::INT * 100 + SUBSTRING(period,2,2)::INT
              <= RIGHT(cs.cost_period,4)::INT * 100 + SUBSTRING(cs.cost_period,2,2)::INT
        ORDER BY RIGHT(period,4)::INT DESC, SUBSTRING(period,2,2)::INT DESC LIMIT 1
      ) obl ON true
      LEFT JOIN any_base          ab  ON ab.item_name_updated  = cs.canonical_name AND ab.period  = cs.cost_period
      LEFT JOIN LATERAL (
        SELECT avg_cost FROM analytics.r365_item_cost
        WHERE avg_cost > 0 AND item_name <> 'Harvest Chicken Bowl - In House'
          AND item_name_updated = cs.canonical_name
          AND RIGHT(period,4)::INT * 100 + SUBSTRING(period,2,2)::INT
              <= RIGHT(cs.cost_period,4)::INT * 100 + SUBSTRING(cs.cost_period,2,2)::INT
        ORDER BY RIGHT(period,4)::INT DESC, SUBSTRING(period,2,2)::INT DESC LIMIT 1
      ) abl ON true
      LEFT JOIN cmc                ON cmc.parent_item        = cs.canonical_name
                                  AND cmc.cost_period        = cs.cost_period
                                  AND cs.channel            <> 'IH'
      LEFT JOIN online_qty  oq     ON oq.canonical_name     = cs.canonical_name
                                  AND oq.cost_period         = cs.cost_period
                                  AND cs.channel            <> 'IH'
      LEFT JOIN cmc_ih             ON cmc_ih.parent_item     = cs.canonical_name
                                  AND cmc_ih.cost_period     = cs.cost_period
                                  AND cs.channel             = 'IH'
      LEFT JOIN ih_qty      iq     ON iq.canonical_name      = cs.canonical_name
                                  AND iq.cost_period          = cs.cost_period
                                  AND cs.channel              = 'IH'
    ),

    -- Aggregate per item × channel across all periods in the date range
    by_ch AS (
      SELECT
        canonical_name,
        channel,
        MIN(menu_group)  AS menu_group,
        SUM(qty)         AS qty,
        SUM(gross_sales) AS gross_sales,
        SUM(total_cost)  AS total_cost
      FROM cwc
      GROUP BY canonical_name, channel
    ),

    -- Step 6→7: Pivot to one row per item; apply 3PD cost markup ×1.18
    -- avg_price = pre_discount / qty (gross_sales / qty), 3PD ×1.22 price markup
    --   applied on top (owner request 2026-07-14) — reflects the true 3PD menu
    --   premium. net_sales/net_sales_3pd/net_sales_bl carry the SAME ×1.22 for
    --   3PD, so avg_price × qty = net_sales stays true everywhere, and every
    --   figure derived from net_sales below (total_margin, margin_threshold,
    --   COGS% in the frontend) reflects the markup consistently.
    -- avg_cost 3PD = online_pink_cost × 1.18 (packaging/delivery cost uplift)
    pivoted AS (
      SELECT
        canonical_name,
        MIN(menu_group)   AS menu_group,
        SUM(qty)          AS qty,
        -- blended net sales (gross_sales = pre-discount; 3PD ×1.22 price markup,
        -- matching AppScript ns = ap×qty — now that avg_price includes the 3PD
        -- markup, net_sales must too so avg_price × qty = net_sales stays true,
        -- and COGS%/margin/thresholds below (all derived from net_sales) follow)
        SUM(CASE WHEN channel='3PD' THEN gross_sales * 1.22 ELSE gross_sales END) AS net_sales,
        -- blended total cost: 3PD cost × 1.18
        SUM(CASE WHEN channel='3PD' THEN total_cost * 1.18 ELSE total_cost END) AS total_cost,
        -- per-channel quantities
        SUM(CASE WHEN channel='IH'  THEN qty  ELSE 0 END) AS qty_ih,
        SUM(CASE WHEN channel='LO'  THEN qty  ELSE 0 END) AS qty_lo,
        SUM(CASE WHEN channel='3PD' THEN qty  ELSE 0 END) AS qty_3pd,
        -- per-channel revenues (pre-discount; 3PD ×1.22 price markup)
        SUM(CASE WHEN channel='IH'  THEN gross_sales ELSE 0 END) AS net_sales_ih,
        SUM(CASE WHEN channel='LO'  THEN gross_sales ELSE 0 END) AS net_sales_lo,
        SUM(CASE WHEN channel='3PD' THEN gross_sales * 1.22 ELSE 0 END) AS net_sales_3pd,
        -- per-channel total costs (3PD ×1.18)
        SUM(CASE WHEN channel='IH'  THEN total_cost        ELSE 0 END) AS total_cost_ih,
        SUM(CASE WHEN channel='LO'  THEN total_cost        ELSE 0 END) AS total_cost_lo,
        SUM(CASE WHEN channel='3PD' THEN total_cost * 1.18 ELSE 0 END) AS total_cost_3pd,
        -- BL (LO+3PD) combined
        SUM(CASE WHEN channel IN ('LO','3PD') THEN qty ELSE 0 END) AS qty_bl,
        SUM(CASE WHEN channel='LO'  THEN gross_sales
                 WHEN channel='3PD' THEN gross_sales * 1.22 ELSE 0 END) AS net_sales_bl,
        SUM(CASE WHEN channel='LO'  THEN total_cost
                 WHEN channel='3PD' THEN total_cost * 1.18 ELSE 0 END) AS total_cost_bl,
        -- blended avg price: gross_sales / qty (qty-weighted; 3PD ×1.22 price markup)
        SUM(CASE WHEN channel='3PD' THEN gross_sales * 1.22 ELSE gross_sales END)
          / NULLIF(SUM(qty),0)                                              AS avg_price,
        -- blended avg cost (qty-weighted; 3PD ×1.18)
        SUM(CASE WHEN channel='3PD' THEN total_cost * 1.18 ELSE total_cost END)
          / NULLIF(SUM(qty),0)                                             AS avg_cost,
        -- per-channel avg price (gross_sales / qty; 3PD ×1.22)
        SUM(CASE WHEN channel='IH'  THEN gross_sales ELSE 0 END)
          / NULLIF(SUM(CASE WHEN channel='IH'  THEN qty ELSE 0 END),0)    AS avg_price_ih,
        SUM(CASE WHEN channel='LO'  THEN gross_sales ELSE 0 END)
          / NULLIF(SUM(CASE WHEN channel='LO'  THEN qty ELSE 0 END),0)    AS avg_price_lo,
        SUM(CASE WHEN channel='3PD' THEN gross_sales * 1.22 ELSE 0 END)
          / NULLIF(SUM(CASE WHEN channel='3PD' THEN qty ELSE 0 END),0)    AS avg_price_3pd,
        SUM(CASE WHEN channel='LO'  THEN gross_sales
                 WHEN channel='3PD' THEN gross_sales * 1.22 ELSE 0 END)
          / NULLIF(SUM(CASE WHEN channel IN ('LO','3PD') THEN qty ELSE 0 END),0) AS avg_price_bl,
        -- per-channel avg cost (3PD ×1.18)
        SUM(CASE WHEN channel='IH'  THEN total_cost        ELSE 0 END)
          / NULLIF(SUM(CASE WHEN channel='IH'  THEN qty ELSE 0 END),0)    AS avg_cost_ih,
        SUM(CASE WHEN channel='LO'  THEN total_cost        ELSE 0 END)
          / NULLIF(SUM(CASE WHEN channel='LO'  THEN qty ELSE 0 END),0)    AS avg_cost_lo,
        SUM(CASE WHEN channel='3PD' THEN total_cost * 1.18 ELSE 0 END)
          / NULLIF(SUM(CASE WHEN channel='3PD' THEN qty ELSE 0 END),0)    AS avg_cost_3pd,
        SUM(CASE WHEN channel='LO'  THEN total_cost
                 WHEN channel='3PD' THEN total_cost * 1.18 ELSE 0 END)
          / NULLIF(SUM(CASE WHEN channel IN ('LO','3PD') THEN qty ELSE 0 END),0) AS avg_cost_bl
      FROM by_ch
      GROUP BY canonical_name
    ),

    -- Step 7: ME thresholds on the blended master (all items)
    -- medM  = (totNS − totTC) / totNS   revenue-weighted avg margin
    -- medMM = (1/n) × 0.7               n = distinct item count in blended master
    item_count AS (SELECT COUNT(*) AS n FROM pivoted),
    thresholds AS (
      SELECT
        SUM(net_sales - total_cost) / NULLIF(SUM(net_sales),0) AS margin_threshold,
        (1.0 / NULLIF(MAX(ic.n),0)) * 0.7                      AS mix_threshold,
        SUM(qty)                                                 AS grand_qty
      FROM pivoted, item_count ic
    )

    SELECT
      p.canonical_name,
      p.menu_group,
      p.qty::BIGINT                                                            AS qty,
      -- Net Sales = Avg Price × Qty, derived from the SAME rounded avg_price shown
      -- below (owner request 2026-07-14) — guarantees the two displayed numbers
      -- multiply out exactly instead of drifting apart via two independently-
      -- rounded SUMs (which matters now that 3PD's avg_price carries a ×1.22 markup).
      ROUND(ROUND(p.avg_price::NUMERIC, 2) * p.qty, 2)                          AS net_sales,
      ROUND(p.avg_price::NUMERIC,    2)                                        AS avg_price,
      ROUND(p.avg_cost::NUMERIC,     4)                                        AS avg_cost,
      ROUND(p.total_cost::NUMERIC,   2)                                        AS total_cost,
      ROUND((ROUND(p.avg_price::NUMERIC, 2) * p.qty - p.total_cost)::NUMERIC, 2) AS total_margin,
      COALESCE(p.qty_ih,  0)::BIGINT                                           AS qty_ih,
      COALESCE(p.qty_lo,  0)::BIGINT                                           AS qty_lo,
      COALESCE(p.qty_3pd, 0)::BIGINT                                           AS qty_3pd,
      ROUND(ROUND(COALESCE(p.avg_price_ih,  0)::NUMERIC, 2) * COALESCE(p.qty_ih,  0), 2) AS net_sales_ih,
      ROUND(ROUND(COALESCE(p.avg_price_lo,  0)::NUMERIC, 2) * COALESCE(p.qty_lo,  0), 2) AS net_sales_lo,
      ROUND(ROUND(COALESCE(p.avg_price_3pd, 0)::NUMERIC, 2) * COALESCE(p.qty_3pd, 0), 2) AS net_sales_3pd,
      ROUND(COALESCE(p.avg_price_ih,  0)::NUMERIC, 2)                          AS avg_price_ih,
      ROUND(COALESCE(p.avg_price_lo,  0)::NUMERIC, 2)                          AS avg_price_lo,
      ROUND(COALESCE(p.avg_price_3pd, 0)::NUMERIC, 2)                          AS avg_price_3pd,
      ROUND(COALESCE(p.avg_price_bl,  0)::NUMERIC, 2)                          AS avg_price_bl,
      ROUND(COALESCE(p.avg_cost_ih,   0)::NUMERIC, 4)                          AS avg_cost_ih,
      ROUND(COALESCE(p.avg_cost_lo,   0)::NUMERIC, 4)                          AS avg_cost_lo,
      ROUND(COALESCE(p.avg_cost_3pd,  0)::NUMERIC, 4)                          AS avg_cost_3pd,
      ROUND(COALESCE(p.avg_cost_bl,   0)::NUMERIC, 4)                          AS avg_cost_bl,
      ROUND(COALESCE(p.total_cost_ih,  0)::NUMERIC, 2)                         AS total_cost_ih,
      ROUND(COALESCE(p.total_cost_lo,  0)::NUMERIC, 2)                         AS total_cost_lo,
      ROUND(COALESCE(p.total_cost_3pd, 0)::NUMERIC, 2)                         AS total_cost_3pd,
      COALESCE(p.qty_bl, 0)::BIGINT                                             AS qty_bl,
      ROUND(ROUND(COALESCE(p.avg_price_bl,  0)::NUMERIC, 2) * COALESCE(p.qty_bl,  0), 2) AS net_sales_bl,
      ROUND(COALESCE(p.total_cost_bl, 0)::NUMERIC, 2)                          AS total_cost_bl,
      ROUND(((p.net_sales - p.total_cost) / NULLIF(p.net_sales,0))::NUMERIC, 4) AS margin_pct,
      ROUND((p.total_cost / NULLIF(p.net_sales,0))::NUMERIC, 4)                 AS cogs_pct,
      ROUND((p.qty / NULLIF(t.grand_qty,0))::NUMERIC, 4)                        AS mix_pct,
      ROUND(t.margin_threshold::NUMERIC, 4)                                      AS margin_threshold,
      ROUND(t.mix_threshold::NUMERIC,    4)                                      AS mix_threshold,
      CASE
        WHEN (p.qty/NULLIF(t.grand_qty,0)) >  t.mix_threshold
         AND ((p.net_sales-p.total_cost)/NULLIF(p.net_sales,0)) >  t.margin_threshold THEN 'Star'
        WHEN (p.qty/NULLIF(t.grand_qty,0)) >  t.mix_threshold
         AND ((p.net_sales-p.total_cost)/NULLIF(p.net_sales,0)) <= t.margin_threshold THEN 'Plow Horse'
        WHEN (p.qty/NULLIF(t.grand_qty,0)) <= t.mix_threshold
         AND ((p.net_sales-p.total_cost)/NULLIF(p.net_sales,0)) >  t.margin_threshold THEN 'Puzzle'
        ELSE 'Dog'
      END                                                                        AS quadrant,
      CASE WHEN ((p.net_sales-p.total_cost)/NULLIF(p.net_sales,0)) > t.margin_threshold
           THEN 'High' ELSE 'Low' END                                           AS margin_flag,
      CASE WHEN (p.qty/NULLIF(t.grand_qty,0)) > t.mix_threshold
           THEN 'High' ELSE 'Low' END                                           AS mix_flag
    FROM pivoted p
    CROSS JOIN thresholds t
    ORDER BY p.net_sales DESC
  `, [dr.start, dr.end]);
  await db.end();

  function resolveCategory(name: string, menuGroup: string): string {
    if (name === 'That Fire Hot Sauce (Bottle)' || name === 'That Fire Hot Sauce - Side') return 'Retail';
    if (name === 'Harvest Chicken Bowl' || name === 'Spicy Chili Chicken Bowl' || name === 'Chicken Tikka Burrito') return 'Entrees';
    return GRP_TO_CAT_MAP[menuGroup] ?? 'Other';
  }

  const catRev: Record<string, number> = {};
  rows.forEach(r => {
    const cat = resolveCategory(r.canonical_name as string, (r.menu_group ?? '') as string);
    catRev[cat] = (catRev[cat] ?? 0) + Number(r.net_sales);
  });

  const CAT_SUBCAT_FALLBACK: Record<string, string> = {
    'Sides':      'Side',
    'Sweets':     'Sweet',
    'NA Drinks':  'Drink',
    'Alc Drinks': 'Alc Drink',
    'Kids Meal':  'Kids',
    'Retail':     'Retail',
  };

  return rows.map(r => {
    const cat    = resolveCategory(r.canonical_name as string, (r.menu_group ?? '') as string);
    const name   = r.canonical_name as string;
    const grp    = (r.menu_group ?? '') as string;
    const subCat = ITEM_SUBCAT_MAP[name] ?? GRP_TO_SUBCAT_MAP[grp] ?? CAT_SUBCAT_FALLBACK[cat] ?? '';
    return {
      canonical_name:    name,
      menu_group:        grp,
      category:          cat,
      sub_category:      subCat,
      is_open_item:      false,
      qty:               Number(r.qty),
      net_sales:         Number(r.net_sales),
      avg_price:         Number(r.avg_price),
      avg_cost:          Number(r.avg_cost),
      total_cost:        Number(r.total_cost),
      total_margin:      Number(r.total_margin),
      margin_pct:        Number(r.margin_pct),
      cogs_pct:          Number(r.cogs_pct),
      mix_pct:           Number(r.mix_pct),
      sls_pct_category:  catRev[cat] > 0 ? Number(r.net_sales) / catRev[cat] : 0,
      qty_ih:            Number(r.qty_ih),
      qty_lo:            Number(r.qty_lo),
      qty_3pd:           Number(r.qty_3pd),
      net_sales_ih:      Number(r.net_sales_ih),
      net_sales_lo:      Number(r.net_sales_lo),
      net_sales_3pd:     Number(r.net_sales_3pd),
      avg_price_ih:      Number(r.avg_price_ih),
      avg_price_lo:      Number(r.avg_price_lo),
      avg_price_3pd:     Number(r.avg_price_3pd),
      avg_price_bl:      Number(r.avg_price_bl),
      avg_cost_ih:       Number(r.avg_cost_ih),
      avg_cost_lo:       Number(r.avg_cost_lo),
      avg_cost_3pd:      Number(r.avg_cost_3pd),
      avg_cost_bl:       Number(r.avg_cost_bl),
      total_cost_ih:     Number(r.total_cost_ih),
      total_cost_lo:     Number(r.total_cost_lo),
      total_cost_3pd:    Number(r.total_cost_3pd),
      qty_bl:            Number(r.qty_bl),
      net_sales_bl:      Number(r.net_sales_bl),
      total_cost_bl:     Number(r.total_cost_bl),
      quadrant:          r.quadrant    as MERow['quadrant'],
      margin_flag:       r.margin_flag as 'High' | 'Low',
      mix_flag:          r.mix_flag    as 'High' | 'Low',
      margin_threshold:  Number(r.margin_threshold),
      mix_threshold:     Number(r.mix_threshold),
    };
  });
}

// ─── Pink Sheets (cost breakdown per item) ────────────────────────────────────
export async function getMEPinkSheets(dr: DateRange): Promise<PinkSheetRow[]> {
  const db = pool();
  const { rows } = await db.query(`
    WITH
    ${BYO_FIX_CTE},
    -- True online order qty per parent item — NOT from the modifier join (that overcounts)
    online_orders AS (
      SELECT
        COALESCE(bf.clean, fol.canonical_name) AS parent_item,
        MIN(fol.menu_group)                    AS menu_group,
        SUM(fol.quantity)                      AS online_qty
      FROM public.fact_order_lines fol
      LEFT JOIN byo_fix bf ON bf.raw = fol.canonical_name
      ${CH_OVERRIDE_JOIN('fol.selection_guid')}
      WHERE NOT fol.is_voided AND NOT fol.is_deferred
        AND (${CHO}) IN ('APP', 'TPD', 'TPD_MARKUP')
        AND (
          UPPER(fol.menu_group) IN (
            'BOWLS','BUILD YOUR OWN BOWL','BYO','CHEF CURATED BOWLS',
            'PLATES','CLASSIC INDIAN PLATES','BURRITOS','INDIAN BURRITOS','KIDS','KIDS MEAL'
          )
          OR fol.canonical_name IN (
            'Side of Main','Side of Grain','Side of Sauce','Side of Veggie',
            'Homemade Juice','Handcrafted Juice for a Group - 1/2 Gallon'
          )
        )
        AND fol.business_date BETWEEN $1::DATE AND $2::DATE
      GROUP BY COALESCE(bf.clean, fol.canonical_name)
    ),
    -- IH order qty per parent item
    ih_orders AS (
      SELECT
        COALESCE(bf.clean, fol.canonical_name) AS parent_item,
        MIN(fol.menu_group)                    AS menu_group,
        SUM(fol.quantity)                      AS ih_qty
      FROM public.fact_order_lines fol
      LEFT JOIN byo_fix bf ON bf.raw = fol.canonical_name
      ${CH_OVERRIDE_JOIN('fol.selection_guid')}
      WHERE NOT fol.is_voided AND NOT fol.is_deferred
        AND (${CHO}) = 'IN_HOUSE'
        AND (
          UPPER(fol.menu_group) IN (
            'BOWLS','BUILD YOUR OWN BOWL','BYO','CHEF CURATED BOWLS',
            'PLATES','CLASSIC INDIAN PLATES','BURRITOS','INDIAN BURRITOS','KIDS','KIDS MEAL'
          )
          OR fol.canonical_name IN (
            'Side of Main','Side of Grain','Side of Sauce','Side of Veggie',
            'Homemade Juice','Handcrafted Juice for a Group - 1/2 Gallon'
          )
        )
        AND fol.business_date BETWEEN $1::DATE AND $2::DATE
      GROUP BY COALESCE(bf.clean, fol.canonical_name)
    ),
    -- Most recent fiscal period overlapping the date range (§2.4 display rule)
    selected_period AS (
      SELECT
        'P'||LPAD(period::TEXT,2,'0')||'-'||fiscal_year::TEXT AS pkey,
        fiscal_year * 100 + period                            AS pnum
      FROM public.dim_fiscal_period
      WHERE start_date::DATE <= $2::DATE
        AND end_date::DATE   >= $1::DATE
      ORDER BY fiscal_year DESC, period DESC
      LIMIT 1
    ),
    -- Period-specific online qty (denominator for avg_cost_online, §2 RC1)
    online_orders_sp AS (
      SELECT COALESCE(bf.clean, fol.canonical_name) AS parent_item, SUM(fol.quantity) AS qty
      FROM public.fact_order_lines fol
      LEFT JOIN byo_fix bf ON bf.raw = fol.canonical_name
      CROSS JOIN selected_period sp
      LEFT JOIN public.dim_fiscal_period fp
             ON fol.business_date >= fp.start_date::DATE
            AND fol.business_date <= fp.end_date::DATE
      ${CH_OVERRIDE_JOIN('fol.selection_guid')}
      WHERE NOT fol.is_voided AND NOT fol.is_deferred
        AND (${CHO}) IN ('APP', 'TPD', 'TPD_MARKUP')
        AND (
          UPPER(fol.menu_group) IN (
            'BOWLS','BUILD YOUR OWN BOWL','BYO','CHEF CURATED BOWLS',
            'PLATES','CLASSIC INDIAN PLATES','BURRITOS','INDIAN BURRITOS','KIDS','KIDS MEAL'
          )
          OR fol.canonical_name IN (
            'Side of Main','Side of Grain','Side of Sauce','Side of Veggie',
            'Homemade Juice','Handcrafted Juice for a Group - 1/2 Gallon'
          )
        )
        AND fol.business_date BETWEEN $1::DATE AND $2::DATE
        AND 'P'||LPAD(fp.period::TEXT,2,'0')||'-'||fp.fiscal_year::TEXT = sp.pkey
      GROUP BY COALESCE(bf.clean, fol.canonical_name)
    ),
    -- Period-specific IH qty (denominator for avg_cost_ih, §2 RC1)
    ih_orders_sp AS (
      SELECT COALESCE(bf.clean, fol.canonical_name) AS parent_item, SUM(fol.quantity) AS qty
      FROM public.fact_order_lines fol
      LEFT JOIN byo_fix bf ON bf.raw = fol.canonical_name
      CROSS JOIN selected_period sp
      LEFT JOIN public.dim_fiscal_period fp
             ON fol.business_date >= fp.start_date::DATE
            AND fol.business_date <= fp.end_date::DATE
      ${CH_OVERRIDE_JOIN('fol.selection_guid')}
      WHERE NOT fol.is_voided AND NOT fol.is_deferred
        AND (${CHO}) = 'IN_HOUSE'
        AND (
          UPPER(fol.menu_group) IN (
            'BOWLS','BUILD YOUR OWN BOWL','BYO','CHEF CURATED BOWLS',
            'PLATES','CLASSIC INDIAN PLATES','BURRITOS','INDIAN BURRITOS','KIDS','KIDS MEAL'
          )
          OR fol.canonical_name IN (
            'Side of Main','Side of Grain','Side of Sauce','Side of Veggie',
            'Homemade Juice','Handcrafted Juice for a Group - 1/2 Gallon'
          )
        )
        AND fol.business_date BETWEEN $1::DATE AND $2::DATE
        AND 'P'||LPAD(fp.period::TEXT,2,'0')||'-'||fp.fiscal_year::TEXT = sp.pkey
      GROUP BY COALESCE(bf.clean, fol.canonical_name)
    ),
    -- Online modifier cost, priced AND scoped at the selected period (§2.4 display rule):
    -- reads analytics.pc_modifier_daily instead of the live fact_modifiers join.
    -- d.pnum = sp.pnum restricts to orders whose OWN period is the selected period —
    -- matches the original CTE's "GROUP BY cost_period" + outer join on cost_period=sp.pkey,
    -- which discarded any other period's rows even when the date range spanned several.
    cmc AS (
      SELECT
        COALESCE(bf.clean, d.raw_parent) AS parent_item,
        sp.pkey                          AS cost_period,
        SUM(d.qty * COALESCE(uc.unit_cost, 0)) AS total_mod_cost
      FROM analytics.pc_modifier_daily d
      CROSS JOIN selected_period sp
      LEFT JOIN byo_fix bf ON bf.raw = d.raw_parent
      LEFT JOIN analytics.pc_modifier_unit_cost uc
             ON uc.norm_name = d.mod_norm AND uc.pnum = sp.pnum
      WHERE d.business_date BETWEEN $1::DATE AND $2::DATE
        AND d.pnum = sp.pnum
        AND d.channel IN ('APP', 'TPD', 'TPD_MARKUP')
        AND d.include_cmc
        AND d.in_byo_scope
      GROUP BY 1, 2
    ),
    -- IH modifier cost, priced AND scoped at the selected period
    cmc_ih AS (
      SELECT
        COALESCE(bf.clean, d.raw_parent) AS parent_item,
        sp.pkey                          AS cost_period,
        SUM(d.qty * COALESCE(uc.unit_cost, 0)) AS total_ih_mod_cost
      FROM analytics.pc_modifier_daily d
      CROSS JOIN selected_period sp
      LEFT JOIN byo_fix bf ON bf.raw = d.raw_parent
      LEFT JOIN analytics.pc_modifier_unit_cost uc
             ON uc.norm_name = d.mod_norm AND uc.pnum = sp.pnum
      WHERE d.business_date BETWEEN $1::DATE AND $2::DATE
        AND d.pnum = sp.pnum
        AND d.channel = 'IN_HOUSE'
        AND d.include_cmc
        AND d.in_byo_scope
      GROUP BY 1, 2
    ),
    -- Range-wide IH modifier cost per item (fallback for items with no selected-period IH orders)
    cmc_ih_range AS (
      SELECT parent_item, SUM(total_ih_mod_cost) AS total_ih_mod_cost
      FROM cmc_ih GROUP BY parent_item
    ),
    -- Zero-baseCost items (AppScript: "Sides, Homemade Juice") — their avg cost is the
    -- weighted average of their modifier costs, not base + mods/qty.
    zero_base(nm) AS (VALUES
      ('Side of Main'),('Side of Grain'),('Side of Sauce'),('Side of Veggie'),
      ('Homemade Juice'),('Handcrafted Juice for a Group - 1/2 Gallon')
    ),
    -- Weighted avg modifier cost per zero-base item: qty weights are range-wide,
    -- unit costs from the selected period (§2.4 — never blend costs across periods).
    -- One shared value for IN_HOUSE, RASA DIGITAL(APP) and 3PD alike — computed from ALL
    -- online orders (APP+DELIVERY+3PD) combined, per AppScript's "single online pink
    -- sheet ... valid for all channels" rule. IH does NOT get its own separate
    -- weighted average even when it has modifier data of its own — owner-confirmed
    -- 2026-07-03: same modifier cost for all 3 channels, 3PD still gets its usual
    -- ×1.18 uplift on top (applied in the final SELECT below).
    wavg_online AS (
      SELECT COALESCE(bf.clean, d.raw_parent) AS parent_item,
             SUM(d.qty * uc.unit_cost) / NULLIF(SUM(d.qty), 0) AS wavg
      FROM analytics.pc_modifier_daily d
      LEFT JOIN byo_fix bf ON bf.raw = d.raw_parent
      CROSS JOIN selected_period sp
      JOIN analytics.pc_modifier_unit_cost uc
        ON uc.norm_name = d.mod_norm
       AND uc.pnum      = sp.pnum
      WHERE d.channel IN ('APP', 'TPD', 'TPD_MARKUP')
        AND COALESCE(bf.clean, d.raw_parent) IN (SELECT nm FROM zero_base)
        AND d.business_date BETWEEN $1::DATE AND $2::DATE
        AND uc.unit_cost > 0
      GROUP BY COALESCE(bf.clean, d.raw_parent)
    ),
    -- Base item costs, freshest row ≤ selected period (§2 RC1 display rule)
    ih_base AS (
      SELECT DISTINCT ON (item_name_updated) item_name_updated, avg_cost
      FROM analytics.r365_item_cost, selected_period sp
      WHERE menu IN ('FOOD - IN HOUSE','DRINKS - IN HOUSE') AND avg_cost > 0 AND item_name <> 'Harvest Chicken Bowl - In House'
        AND RIGHT(period,4)::INT * 100 + SUBSTRING(period,2,2)::INT <= sp.pnum
      ORDER BY item_name_updated, RIGHT(period,4)::INT DESC, SUBSTRING(period,2,2)::INT DESC
    ),
    online_base AS (
      SELECT DISTINCT ON (item_name_updated) item_name_updated, avg_cost
      FROM analytics.r365_item_cost, selected_period sp
      WHERE menu IN ('DELIVERY','3PD OPEN MARKUP') AND avg_cost > 0 AND item_name <> 'Harvest Chicken Bowl - In House'
        AND RIGHT(period,4)::INT * 100 + SUBSTRING(period,2,2)::INT <= sp.pnum
      ORDER BY item_name_updated, RIGHT(period,4)::INT DESC, SUBSTRING(period,2,2)::INT DESC
    ),
    any_base AS (
      SELECT DISTINCT ON (item_name_updated) item_name_updated, avg_cost
      FROM analytics.r365_item_cost, selected_period sp
      WHERE avg_cost > 0 AND item_name <> 'Harvest Chicken Bowl - In House'
        AND RIGHT(period,4)::INT * 100 + SUBSTRING(period,2,2)::INT <= sp.pnum
      ORDER BY item_name_updated, RIGHT(period,4)::INT DESC, SUBSTRING(period,2,2)::INT DESC
    ),
    -- Harvest Chicken Bowl is its own displayed item (PMIX_AppScript.txt ITEMS list —
    -- rawIH 'Harvest Chicken Bowl - In House', name 'Harvest Chicken Bowl', IH-only)
    -- but r365_item_cost stores it with item_name_updated = 'BYO Greens + Grains Bowl'
    -- — the SAME item_name_updated the real Greens+Grains recipe uses, at the SAME
    -- period/menu, just a different item_name. Matching on item_name_updated alone is
    -- ambiguous (picks an arbitrary one of the two rows); match on item_name instead.
    harvest_chicken_ih AS (
      SELECT avg_cost
      FROM analytics.r365_item_cost, selected_period sp
      WHERE item_name = 'Harvest Chicken Bowl - In House' AND avg_cost > 0
        AND RIGHT(period,4)::INT * 100 + SUBSTRING(period,2,2)::INT <= sp.pnum
      ORDER BY RIGHT(period,4)::INT DESC, SUBSTRING(period,2,2)::INT DESC
      LIMIT 1
    ),
    -- All items: FULL OUTER JOIN so IH-only items (no online orders) still appear
    all_items AS (
      SELECT
        COALESCE(oo.parent_item, ih.parent_item)   AS parent_item,
        COALESCE(oo.menu_group,  ih.menu_group)    AS menu_group,
        COALESCE(oo.online_qty, 0)                 AS online_qty,
        COALESCE(ih.ih_qty,     0)                 AS ih_qty
      FROM online_orders oo
      FULL OUTER JOIN ih_orders ih ON ih.parent_item = oo.parent_item
    )

    -- §2.4 display rule: costs from the selected period; qty display stays range-wide.
    SELECT
      ai.parent_item                                         AS canonical_name,
      ai.menu_group,
      COALESCE(hc.avg_cost, ib.avg_cost, 0)                  AS base_cost_ih,
      COALESCE(ob.avg_cost, ab.avg_cost, 0)                  AS base_cost_online,
      ROUND(COALESCE(c_sp.total_mod_cost, 0)::NUMERIC, 4)    AS total_mod_cost,
      ROUND(COALESCE(cih_sp.total_ih_mod_cost, 0)::NUMERIC, 4) AS total_ih_mod_cost,
      ai.online_qty::BIGINT                                  AS online_qty,
      ai.ih_qty::BIGINT                                      AS ih_qty,
      -- Zero-base items (Sides, Homemade Juice): SAME weighted-avg modifier cost for
      -- IN_HOUSE, RASA DIGITAL(APP) and 3PD (owner-confirmed 2026-07-03) — IH does NOT get
      -- its own separate figure even when it has modifier data of its own.
      -- Other items — avg_cost_ih: period-specific when available; falls back to range-wide
      -- so items with no selected-period IH orders still show cost.
      CASE WHEN zb.nm IS NOT NULL
           THEN ROUND(COALESCE(won.wavg, 0)::NUMERIC, 4)
           ELSE ROUND((COALESCE(hc.avg_cost, ib.avg_cost, ab.avg_cost, 0)
             + CASE WHEN ihs.qty IS NOT NULL
                    THEN COALESCE(cih_sp.total_ih_mod_cost, 0) / NULLIF(ihs.qty, 0)
                    ELSE COALESCE(cir.total_ih_mod_cost, 0) / NULLIF(ai.ih_qty, 0)
               END)::NUMERIC, 4)
      END AS avg_cost_ih,
      CASE WHEN zb.nm IS NOT NULL
           THEN ROUND(COALESCE(won.wavg, 0)::NUMERIC, 4)
           ELSE ROUND((COALESCE(ob.avg_cost, ab.avg_cost, 0)
             + COALESCE(c_sp.total_mod_cost, 0) / NULLIF(oos.qty, 0))::NUMERIC, 4)
      END AS avg_cost_online,
      -- 3PD still gets its usual ×1.18 packaging uplift on the shared modifier cost
      -- (owner-confirmed 2026-07-03 — reverses the earlier "no uplift" treatment).
      CASE WHEN zb.nm IS NOT NULL
           THEN ROUND((COALESCE(won.wavg, 0) * 1.18)::NUMERIC, 4)
           ELSE ROUND(((COALESCE(ob.avg_cost, ab.avg_cost, 0)
             + COALESCE(c_sp.total_mod_cost, 0) / NULLIF(oos.qty, 0)) * 1.18)::NUMERIC, 4)
      END AS avg_cost_3pd
    FROM all_items ai
    CROSS JOIN selected_period sp
    LEFT JOIN zero_base    zb     ON zb.nm              = ai.parent_item
    LEFT JOIN wavg_online  won    ON won.parent_item    = ai.parent_item
    LEFT JOIN cmc          c_sp   ON c_sp.parent_item   = ai.parent_item AND c_sp.cost_period   = sp.pkey
    LEFT JOIN cmc_ih       cih_sp ON cih_sp.parent_item = ai.parent_item AND cih_sp.cost_period = sp.pkey
    LEFT JOIN cmc_ih_range cir    ON cir.parent_item    = ai.parent_item
    LEFT JOIN ih_base  ib     ON ib.item_name_updated  = ai.parent_item
    LEFT JOIN online_base ob  ON ob.item_name_updated  = ai.parent_item
    LEFT JOIN any_base ab     ON ab.item_name_updated  = ai.parent_item
    LEFT JOIN LATERAL (
      SELECT avg_cost FROM harvest_chicken_ih WHERE ai.parent_item = 'Harvest Chicken Bowl'
    ) hc ON true
    LEFT JOIN online_orders_sp oos ON oos.parent_item  = ai.parent_item
    LEFT JOIN ih_orders_sp     ihs ON ihs.parent_item  = ai.parent_item
    ORDER BY ai.online_qty DESC, ai.ih_qty DESC
  `, [dr.start, dr.end]);
  await db.end();

  return rows.map(r => ({
    canonical_name:      r.canonical_name as string,
    menu_group:          (r.menu_group ?? '') as string,
    base_cost_ih:        Number(r.base_cost_ih),
    base_cost_online:    Number(r.base_cost_online),
    total_mod_cost:      Number(r.total_mod_cost),
    total_ih_mod_cost:   Number(r.total_ih_mod_cost),
    online_qty:          Number(r.online_qty),
    ih_qty:              Number(r.ih_qty),
    avg_cost_ih:         Number(r.avg_cost_ih),
    avg_cost_online:     Number(r.avg_cost_online),
    avg_cost_3pd:        Number(r.avg_cost_3pd),
  }));
}

// ─── Pink Sheet Detail (modifier-level breakdown per item) ───────────────────
export async function getMEPinkSheetDetails(dr: DateRange): Promise<PinkSheetDetailRow[]> {
  const db = pool();
  const { rows } = await db.query(`
    WITH
    ${BYO_FIX_CTE},
    -- Most recent fiscal period overlapping the date range (§2.4 display rule) —
    -- detail rows are costed at this period so they reconcile with the summary.
    sp AS (
      SELECT fiscal_year * 100 + period AS pnum
      FROM public.dim_fiscal_period
      WHERE start_date::DATE <= $2::DATE
        AND end_date::DATE   >= $1::DATE
      ORDER BY fiscal_year DESC, period DESC
      LIMIT 1
    ),
    -- Reads the precomputed daily grain (analytics.pc_modifier_daily) instead of the
    -- live fact_modifiers x fact_order_lines join + per-row modifier_type resolution —
    -- section_base/mod_norm/from_item_type/pit_item_type already bake in that logic.
    rows_ AS (
      SELECT
        COALESCE(bf.clean, d.raw_parent) AS parent_item,
        CASE WHEN d.from_item_type AND COALESCE(uc.unit_cost, 0) > 0
                  AND d.pit_item_type ILIKE '%online%'
             THEN CASE WHEN d.pit_item_type ILIKE 'kids meal%' THEN 'Drink' ELSE 'Topping' END
             ELSE d.section_base
        END AS section,
        d.mod_display AS modifier_name,
        CASE WHEN d.channel IN ('APP', 'TPD', 'TPD_MARKUP')
             THEN 'online' ELSE 'ih' END AS channel,
        d.qty,
        d.qty * COALESCE(uc.unit_cost, 0) AS cost
      FROM analytics.pc_modifier_daily d
      CROSS JOIN sp
      LEFT JOIN byo_fix bf ON bf.raw = d.raw_parent
      LEFT JOIN analytics.pc_modifier_unit_cost uc
             ON uc.norm_name = d.mod_norm AND uc.pnum = sp.pnum
      WHERE d.business_date BETWEEN $1::DATE AND $2::DATE
        AND d.channel IN ('IN_HOUSE', 'APP', 'TPD', 'TPD_MARKUP')
        AND d.in_byo_scope
    )
    SELECT
      parent_item, section, modifier_name, channel,
      SUM(qty)::BIGINT AS qty,
      ROUND(SUM(cost)::NUMERIC, 4) AS total_cost
    FROM rows_
    WHERE section IS NOT NULL AND section NOT IN ('Online', 'NA', 'ZeroCater')
    GROUP BY 1, 2, 3, 4
    ORDER BY parent_item, channel, section, modifier_name
  `, [dr.start, dr.end]);
  await db.end();

  return rows.map(r => ({
    parent_item:   r.parent_item   as string,
    section:       r.section       as string,
    modifier_name: r.modifier_name as string,
    channel:       r.channel       as string,
    qty:           Number(r.qty),
    unit_cost:     Number(r.qty) > 0 ? Number(r.total_cost) / Number(r.qty) : 0,
    total_cost:    Number(r.total_cost),
  }));
}

// ─── Beverage Modifiers (drinks added as a free modifier, e.g. kids-meal drink) ─
// Reuses the same section-resolution CASE as getMEPinkSheetDetails so "what
// counts as a drink modifier" stays consistent everywhere it's derived.
// Always $0 revenue (bundled into the parent item's price) — qty only.
export async function getBeverageModifiers(dr: DateRange): Promise<BeverageModifierRow[]> {
  const db = pool();
  // No section filter here — "make it a meal" drink picks and any other
  // BYO-scoped modifier choice are all returned; the caller narrows down to
  // actual beverage names (matching against ItemRow's 'NA Drinks' category)
  // instead of relying on the derived section label, which was too narrow
  // (missed drink picks whose section_base wasn't the literal string 'Drink').
  const { rows } = await db.query(`
    SELECT d.mod_display AS name, d.channel, COALESCE(d.location_code, '') AS location_code, SUM(d.qty)::BIGINT AS qty
    FROM analytics.pc_modifier_daily d
    WHERE d.business_date BETWEEN $1::DATE AND $2::DATE
      AND d.channel IN ('IN_HOUSE', 'APP', 'TPD', 'TPD_MARKUP')
      AND d.in_byo_scope
    GROUP BY 1, 2, 3
    ORDER BY name, channel
  `, [dr.start, dr.end]);
  await db.end();
  return rows.map(r => ({
    name:          r.name          as string,
    channel:       r.channel       as string,
    location_code: r.location_code as string,
    qty:           Number(r.qty),
  }));
}

// ─── Make It a Meal modifiers (Item Mix admin/tester-only checkbox) ─────────────
// public.fact_modifiers WHERE option_group_name = 'Make it a Meal' — the raw
// modifier line itself, with its own real `price` (verified against the live
// DB: already a line-level total, e.g. qty=2, price=$1.00 for a $0.50 item —
// NOT a per-unit price, so SUM(price) directly, never SUM(price) * qty).
// This is a different, more direct source than getBeverageModifiers() above
// (which reads the precomputed analytics.pc_modifier_daily and has no price
// at all) — deliberately not reused, since only fact_modifiers carries price.
export async function getMakeItMealModifiers(dr: DateRange): Promise<MakeItMealModifierRow[]> {
  const db = pool();
  const { rows } = await db.query(`
    SELECT
      fm.canonical_name,
      (${CHO})          AS channel,
      fm.location_code,
      SUM(fm.quantity)::BIGINT              AS qty,
      ROUND(SUM(fm.price)::NUMERIC, 2)      AS price
    FROM public.fact_modifiers fm
    JOIN public.fact_order_lines fol ON fol.selection_guid = fm.parent_selection
    ${CH_OVERRIDE_JOIN('fol.selection_guid')}
    WHERE fm.option_group_name = 'Make it a Meal'
      AND NOT fm.is_voided
      AND ${BASE_WHERE}
      AND fm.business_date BETWEEN $1::DATE AND $2::DATE
    GROUP BY 1, 2, 3
  `, [dr.start, dr.end]);
  await db.end();
  return rows.map(r => ({
    canonical_name: r.canonical_name as string,
    channel:        r.channel        as string,
    location_code:  r.location_code  as string,
    qty:            Number(r.qty),
    price:          Number(r.price),
  }));
}

// ─── BYO Modifiers ────────────────────────────────────────────────────────────
export async function getModifiers(dr: DateRange): Promise<ModifierRow[]> {
  const db = pool();
  try {
    const { rows } = await db.query(`
      WITH raw_mods AS (
        SELECT
          byo_type          AS raw_type,
          mod_display        AS modifier_name,
          qty                AS quantity,
          raw_parent         AS parent_item,
          COALESCE(location_code, '') AS location_code
        FROM analytics.pc_modifier_daily
        WHERE byo_type IS NOT NULL
          AND business_date BETWEEN $1::DATE AND $2::DATE
      ),
      byo_mods AS (
        SELECT
          CASE
            WHEN LOWER(raw_type) = 'chutney + dressing'                              THEN 'chutney'
            WHEN LOWER(raw_type) = '1/2 main'                                        THEN 'half_main'
            WHEN LOWER(raw_type) IN ('base','1/2 base')
              AND parent_item ILIKE '%Salad Bowl%'                                    THEN 'base_salad'
            WHEN LOWER(raw_type) IN ('base','1/2 base')
              AND parent_item ILIKE '%Greens%'                                        THEN 'base_gg'
            WHEN LOWER(raw_type) IN ('base','1/2 base')
              AND parent_item ILIKE '%Grain Bowl%'                                    THEN 'base_grain'
            WHEN LOWER(raw_type) IN ('base','1/2 base')                              THEN 'base_other'
            ELSE LOWER(raw_type)
          END AS mod_type,
          modifier_name,
          parent_item,
          location_code,
          SUM(quantity) AS qty
        FROM raw_mods
        GROUP BY 1, modifier_name, parent_item, location_code
      ),
      type_totals AS (
        SELECT mod_type, parent_item, SUM(qty) AS type_qty FROM byo_mods GROUP BY mod_type, parent_item
      ),
      -- r365_item_cost: fallback for modifiers not in r365_modifier_cost (RC4)
      item_cost_fallback AS (
        SELECT DISTINCT ON (item_name_updated)
          item_name_updated, avg_cost
        FROM analytics.r365_item_cost
        ORDER BY item_name_updated, RIGHT(period,4)::INT DESC, SUBSTRING(period,2,2)::INT DESC
      ),
      -- Cost resolution: r365_modifier_cost MI rows primary (freshest, with aliases), r365_item_cost fallback (RC4)
      -- Resolved once per DISTINCT modifier_name (not once per byo_mods row) — the CASE
      -- below is a pure function of modifier_name, so deduping first avoids re-running
      -- the same correlated subqueries against r365_modifier_cost for every
      -- (parent_item, location_code) combination a name happens to appear in.
      distinct_mod_names AS (
        SELECT DISTINCT modifier_name FROM byo_mods
      ),
      mod_costs_resolved AS (
        SELECT
          mn.modifier_name,
          CASE
            WHEN mn.modifier_name ILIKE 'Skip %' OR mn.modifier_name ILIKE 'No %'
              THEN 0.0
            ELSE COALESCE(
              -- Primary: freshest MI row across {direct name, alias}; tie → direct name wins
              (SELECT r.cost_per_portion
               FROM analytics.r365_modifier_cost r
               WHERE r.recipe_name LIKE 'MI %' AND r.cost_per_portion > 0
                 AND LOWER(r.clean_name) IN (
                   LOWER(mn.modifier_name),
                   ${modifierAliasCaseSQL('LOWER(mn.modifier_name)')}
                 )
               ORDER BY RIGHT(r.period,4)::INT * 100 + SUBSTRING(r.period,2,2)::INT DESC,
                        (LOWER(r.clean_name) = LOWER(mn.modifier_name)) DESC
               LIMIT 1),
              -- '1/2 X' → half cost of 'X' from MI (native R365 1/2 rows resolve at primary above)
              CASE WHEN mn.modifier_name ILIKE '1/2 %'
                THEN (SELECT r.cost_per_portion / 2.0
                      FROM analytics.r365_modifier_cost r
                      WHERE r.recipe_name LIKE 'MI %' AND r.cost_per_portion > 0
                        AND LOWER(r.clean_name) = LOWER(REGEXP_REPLACE(mn.modifier_name, '^1/2 (and )?', '', 'i'))
                      ORDER BY RIGHT(r.period,4)::INT * 100 + SUBSTRING(r.period,2,2)::INT DESC
                      LIMIT 1)
              END,
              -- 'Extra X' → cost of 'X' from MI
              CASE WHEN mn.modifier_name ILIKE 'Extra %'
                THEN (SELECT r.cost_per_portion
                      FROM analytics.r365_modifier_cost r
                      WHERE r.recipe_name LIKE 'MI %' AND r.cost_per_portion > 0
                        AND LOWER(r.clean_name) = LOWER(SUBSTR(mn.modifier_name, 7))
                      ORDER BY RIGHT(r.period,4)::INT * 100 + SUBSTRING(r.period,2,2)::INT DESC
                      LIMIT 1)
              END,
              -- Hardcode: Spicy Mango Chutney
              CASE WHEN LOWER(mn.modifier_name) IN ('spicy mango chutney', 'spicy mango chutney - side') THEN 0.1777 END,
              -- Fallback: r365_item_cost direct match
              ic_direct.avg_cost
            )
          END AS avg_cost
        FROM distinct_mod_names mn
        LEFT JOIN item_cost_fallback ic_direct ON LOWER(ic_direct.item_name_updated) = LOWER(mn.modifier_name)
      ),
      -- AppScript subWeightedAvg: composite modifier cost = weighted avg of constituent halves
      -- "1/2 and 1/2 Mains"         → avg of half_main entries per parent_item
      -- "1/2 and 1/2 Grains/Greens" → avg of '1/2 X' base entries per (parent_item, mod_type)
      composite_costs AS (
        SELECT bm.parent_item, 'half_main'::text AS cc_key,
          SUM(bm.qty * COALESCE(mcr.avg_cost, 0)) / NULLIF(SUM(bm.qty), 0) AS weighted_avg
        FROM byo_mods bm
        JOIN mod_costs_resolved mcr ON mcr.modifier_name = bm.modifier_name
        WHERE bm.mod_type = 'half_main'
        GROUP BY bm.parent_item
        UNION ALL
        SELECT bm.parent_item, (bm.mod_type || '_half')::text AS cc_key,
          SUM(bm.qty * COALESCE(mcr.avg_cost, 0)) / NULLIF(SUM(bm.qty), 0) AS weighted_avg
        FROM byo_mods bm
        JOIN mod_costs_resolved mcr ON mcr.modifier_name = bm.modifier_name
        WHERE bm.mod_type IN ('base_grain','base_salad','base_gg','base_other')
          AND bm.modifier_name ILIKE '1/2 %'
          AND NOT bm.modifier_name ILIKE '1/2 and 1/2 %'
        GROUP BY bm.parent_item, bm.mod_type
      )
      SELECT
        bm.mod_type,
        bm.modifier_name,
        bm.parent_item,
        bm.location_code,
        bm.qty::BIGINT                                                        AS qty,
        ROUND((bm.qty*100.0/NULLIF(tt.type_qty,0))::NUMERIC, 1)              AS pct,
        CASE
          WHEN bm.modifier_name ILIKE '1/2 and 1/2 Mains'
            THEN (SELECT weighted_avg FROM composite_costs WHERE parent_item = bm.parent_item AND cc_key = 'half_main' LIMIT 1)
          WHEN bm.modifier_name ILIKE '1/2 and 1/2 %'
           AND bm.mod_type IN ('base_grain','base_salad','base_gg','base_other')
            THEN (SELECT weighted_avg FROM composite_costs WHERE parent_item = bm.parent_item AND cc_key = bm.mod_type || '_half' LIMIT 1)
          ELSE mcr.avg_cost
        END AS avg_cost
      FROM byo_mods bm
      JOIN type_totals tt ON tt.mod_type = bm.mod_type AND tt.parent_item = bm.parent_item
      LEFT JOIN mod_costs_resolved mcr ON mcr.modifier_name = bm.modifier_name
      ORDER BY bm.parent_item, bm.mod_type, bm.qty DESC
    `, [dr.start, dr.end]);
    await db.end();
    return rows.map(r => ({
      mod_type:      r.mod_type      as string,
      modifier_name: r.modifier_name as string,
      parent_item:   r.parent_item   as string,
      location_code: r.location_code as string,
      qty:           Number(r.qty),
      pct:           Number(r.pct),
      avg_cost:      r.avg_cost != null ? Number(r.avg_cost) : null,
    }));
  } catch (err) {
    console.error('getModifiers error:', err);
    await db.end().catch(() => {}); // connection may already be broken; don't let cleanup crash the request
    return [];
  }
}

// ─── Payments ─────────────────────────────────────────────────────────────────
// PAYMENT_STATUS_SPEC.md: exclude DENIED/VOIDED payment attempts (never
// actually collected — a denied card swipe or a voided payment has no bearing
// on real revenue, regardless of the underlying order's own state) and surface
// refunds as their own figure rather than silently netting them out of the
// total (so "collected" and "refunded later" stay distinguishable). Superseds
// the earlier is_voided/is_deferred + analytics.refund_sales approach — that
// was a proxy for a problem this directly-sourced payment status and
// pipeline-populated refund_amount solve more precisely.
export async function getPayments(dr: DateRange): Promise<PaymentRow[]> {
  const db = pool();
  const { rows } = await db.query(`
    WITH grand AS (
      SELECT SUM(amount) AS total
      FROM public.br_order_payment
      WHERE business_date BETWEEN $1::DATE AND $2::DATE
        AND COALESCE(paid_status, 'CAPTURED') NOT IN ('DENIED', 'VOIDED')
    )
    SELECT
      COALESCE(NULLIF(TRIM(alt_payment_name),''), payment_type, 'Unknown') AS payment_source,
      payment_type,
      COUNT(*)::INT                                                          AS payment_count,
      ROUND(SUM(amount)::NUMERIC, 2)                                        AS total_amount,
      ROUND(COALESCE(SUM(refund_amount), 0)::NUMERIC, 2)                    AS refunded_amount,
      ROUND(SUM(amount)*100.0/NULLIF(g.total,0)::NUMERIC, 1)               AS pct
    FROM public.br_order_payment, grand g
    WHERE business_date BETWEEN $1::DATE AND $2::DATE
      AND COALESCE(paid_status, 'CAPTURED') NOT IN ('DENIED', 'VOIDED')
    GROUP BY 1, 2, g.total
    ORDER BY total_amount DESC
    LIMIT 30
  `, [dr.start, dr.end]);
  await db.end();
  return rows.map(r => ({
    payment_source:  r.payment_source as string,
    payment_count:   Number(r.payment_count),
    total_amount:    Number(r.total_amount),
    refunded_amount: Number(r.refunded_amount),
    pct:             Number(r.pct),
    category:        (r.payment_type as string) === 'CREDIT' ? 'Card' : 'Alt Payment',
  }));
}

// ─── Payments by location ────────────────────────────────────────────────────
// Same DENIED/VOIDED exclusion as getPayments above. location_code already
// lives on br_order_payment itself (populated from the same order every line/
// check/payment of it shares), so this no longer needs a fact_order_lines join
// just to attach it.
export async function getPaymentsByLocation(dr: DateRange): Promise<PaymentByLocationRow[]> {
  const db = pool();
  const { rows } = await db.query(`
    SELECT
      p.location_code,
      COALESCE(dl.display_name, p.location_code)            AS display_name,
      COUNT(DISTINCT p.order_guid)::INT                      AS payment_count,
      ROUND(SUM(p.amount)::NUMERIC, 2)                       AS total_amount,
      ROUND(SUM(CASE WHEN p.payment_type = 'CREDIT' THEN p.amount ELSE 0 END)::NUMERIC, 2) AS card_amount,
      ROUND(SUM(CASE WHEN p.payment_type != 'CREDIT' THEN p.amount ELSE 0 END)::NUMERIC, 2) AS alt_amount,
      ROUND(COALESCE(SUM(p.refund_amount), 0)::NUMERIC, 2)   AS refunded_amount
    FROM public.br_order_payment p
    LEFT JOIN public.dim_location dl ON dl.location_code = p.location_code
    WHERE p.business_date BETWEEN $1::DATE AND $2::DATE
      AND COALESCE(p.paid_status, 'CAPTURED') NOT IN ('DENIED', 'VOIDED')
    GROUP BY p.location_code, dl.display_name
    ORDER BY total_amount DESC
  `, [dr.start, dr.end]);
  await db.end();
  return rows.map(r => ({
    location_code:   r.location_code as string,
    display_name:    r.display_name  as string,
    payment_count:   Number(r.payment_count),
    total_amount:    Number(r.total_amount),
    card_amount:     Number(r.card_amount),
    alt_amount:      Number(r.alt_amount),
    refunded_amount: Number(r.refunded_amount),
  }));
}

// ─── Payments by location × source ──────────────────────────────────────────
// Same DENIED/VOIDED exclusion and location_code simplification as above.
export async function getPaymentSourcesByLocation(dr: DateRange): Promise<PaymentSourceLocationRow[]> {
  const db = pool();
  const { rows } = await db.query(`
    SELECT
      p.location_code,
      COALESCE(dl.display_name, p.location_code)                              AS display_name,
      COALESCE(NULLIF(TRIM(p.alt_payment_name),''), p.payment_type, 'Unknown') AS payment_source,
      p.payment_type,
      COUNT(*)::INT                                                           AS payment_count,
      ROUND(SUM(p.amount)::NUMERIC, 2)                                       AS total_amount,
      ROUND(COALESCE(SUM(p.refund_amount), 0)::NUMERIC, 2)                   AS refunded_amount
    FROM public.br_order_payment p
    LEFT JOIN public.dim_location dl ON dl.location_code = p.location_code
    WHERE p.business_date BETWEEN $1::DATE AND $2::DATE
      AND COALESCE(p.paid_status, 'CAPTURED') NOT IN ('DENIED', 'VOIDED')
    GROUP BY p.location_code, dl.display_name, 3, p.payment_type
    ORDER BY p.location_code, total_amount DESC
  `, [dr.start, dr.end]);
  await db.end();
  return rows.map(r => ({
    location_code:   r.location_code  as string,
    display_name:    r.display_name   as string,
    payment_source:  r.payment_source as string,
    payment_count:   Number(r.payment_count),
    total_amount:    Number(r.total_amount),
    refunded_amount: Number(r.refunded_amount),
    category:        (r.payment_type as string) === 'CREDIT' ? 'Card' : 'Alt Payment',
  }));
}

// ─── Bikky retention ─────────────────────────────────────────────────────────
// Reads git-committed CSVs directly (see BIKKY_ADMIN_UPLOAD_PLAN.md) — no
// Postgres table involved. Returns every uploaded period across both sources,
// same "no filter" shape as the old SQL version; CustomerRetention.tsx
// filters/aggregates client-side. Invalidated via cacheTag('dashboard-data')
// on loadDashboardData (this function has no cache directive of its own —
// it inherits that scope) after an upload/delete in app/api/admin/bikky.
type BikkyRowSortable = BikkyRow & { _periodSort: number; _fiscalYear: number; _returnRateRaw: number | null };

async function readBikkySource(source: BikkySource): Promise<BikkyRowSortable[]> {
  const entries = await listDir(`Data/Bikkydata/${bikkyFolderFor(source)}`);
  const csvFiles = entries.filter(e => e.type === 'file' && e.name.toLowerCase().endsWith('.csv'));

  const perFile = await Promise.all(csvFiles.map(async (entry): Promise<BikkyRowSortable[]> => {
    const stem = entry.name.replace(/\.csv$/i, '');
    const parsed = parseBikkyFileName(stem, source);
    if (!parsed) return [];

    const raw = await getFileRaw(entry.path);
    if (!raw) return [];

    let csvRows;
    try {
      csvRows = parseBikkyCsv(raw);
    } catch (err) {
      console.error(`getBikky: skipping malformed ${entry.path}:`, err);
      return [];
    }

    return csvRows.map(r => ({
      item_name:         r.item_name,
      return_rate:       r.return_rate       ?? 0,
      reorder_rate:      r.reorder_rate      ?? 0,
      return_rate_prev:  r.return_rate_prev  ?? 0,
      reorder_rate_prev: r.reorder_rate_prev ?? 0,
      guests:            r.guests            ?? 0,
      period:            bikkyPeriodLabel(parsed),
      source,
      category:          '',
      revenue:           0,
      qty:               0,
      // YTD sorts after every discrete period within its fiscal year (it's
      // the cumulative whole-year figure, shown as the "final" bucket).
      _periodSort:       parsed.period === 'YTD' ? 999 : parsed.period,
      _fiscalYear:       parsed.fiscalYear,
      _returnRateRaw:    r.return_rate,
    }));
  }));

  return perFile.flat();
}

export async function getBikky(): Promise<BikkyRow[]> {
  try {
    const [instoreRows, del3pdRows] = await Promise.all([
      readBikkySource('instore'),
      readBikkySource('3pd_loyalty'),
    ]);

    return [...instoreRows, ...del3pdRows]
      .sort((a, b) =>
        (b._fiscalYear - a._fiscalYear) ||
        (b._periodSort - a._periodSort) ||
        // mirrors ORDER BY return_rate DESC NULLS LAST
        ((b._returnRateRaw ?? -Infinity) - (a._returnRateRaw ?? -Infinity)))
      .map(({ _periodSort, _fiscalYear, _returnRateRaw, ...row }) => row);
  } catch (err) {
    console.error('getBikky error:', err);
    return [];
  }
}

// ─── Renames ──────────────────────────────────────────────────────────────────
// Detection reads analytics.item_name_history — a view over the raw Toast
// payloads keyed by Toast's per-dish item GUID, which stays stable across
// renames and across menus (item_key gets a new value per menu placement, and
// canonical_name is post-cleaning so our own consolidation hides renames from
// it). One view row per GUID × display name with the date range that name was
// in use; a GUID with >1 name is a genuine POS rename/relabel. Covers the raw
// data window (Dec 2025 onward). The most recently seen name is the current
// canonical; earlier names are historical.
export async function getRenames(): Promise<RenameRow[]> {
  const db = pool();
  try {
    const { rows } = await db.query(`
      SELECT item_guid, display_name,
             first_seen::TEXT AS first_used, last_seen::TEXT AS last_used,
             lifetime_qty, lifetime_gross, locations
      FROM analytics.item_name_history
      WHERE names_for_item > 1
      ORDER BY item_guid, first_seen
    `);
    await db.end();

    const byGuid = new Map<string, typeof rows>();
    rows.forEach(r => {
      const k = r.item_guid as string;
      if (!byGuid.has(k)) byGuid.set(k, []);
      byGuid.get(k)!.push(r);
    });

    return [...byGuid.values()].map(g => {
      // rows arrive chronological (ORDER BY first_seen) — the name_history contract
      const current = [...g].sort((a, b) =>
        (b.last_used as string).localeCompare(a.last_used as string) ||
        Number(b.lifetime_qty) - Number(a.lifetime_qty))[0];
      return {
        canonical_name:   current.display_name as string,
        all_names:        g.map(r => r.display_name as string),
        name_history:     g.map(r => ({
          name:       r.display_name as string,
          first_used: r.first_used as string,
          last_used:  r.last_used as string,
        })) as RenameNameHistoryEntry[],
        category:         '',
        lifetime_qty:     g.reduce((s, r) => s + Number(r.lifetime_qty), 0),
        lifetime_revenue: g.reduce((s, r) => s + Number(r.lifetime_gross), 0),
        location_count:   Math.max(...g.map(r => Number(r.locations))),
        first_seen:       g[0].first_used as string,
      };
    }).sort((a, b) => b.lifetime_qty - a.lifetime_qty);
  } catch (err) {
    console.error('getRenames error:', err);
    await db.end().catch(() => {}); // connection may already be broken; don't let cleanup crash the request
    return [];
  }
}

// ─── Renames demo (tester-only, 2026-07-17) ───────────────────────────────────
// getRenames() above only catches a literal canonical_name change on the SAME
// item_key — genuinely rare, since item_key in this Toast account is really
// "one entry per menu the item was added to" (IH/Online/Catering all get their
// own item_key for the same dish), not a stable per-dish ID. This demo instead
// groups by canonical_name and synthesizes a "variant label" by appending the
// catering/offsite vendor (alt_payment_name) or a Gameday tag when present —
// matching what a since-departed team member's separate dashboard was showing
// as "historical names" (owner report 2026-07-17: items like Kingfisher /
// Kingfisher - Gameday weren't in our list — turned out that suffix doesn't
// exist in canonical_name at all, it was being synthesized there).
const CATERING_VENDORS = [
  'EzCater','Ez Cater','HUNGRY','Sharebite','Territory Foods','Cater Cow',
  'WCK','Food Fleet','ZeroCater','Cater2Me','Fooda','Aramark','Eurest',
  'Metz Corp','Taher','Foodworks','Cureate','Guest Services',
];
export async function getRenamesDemo(): Promise<RenameDemoRow[]> {
  const db = pool();
  try {
    const { rows } = await db.query(`
      WITH tagged AS (
        SELECT
          fol.canonical_name,
          fol.menu_group,
          fol.quantity,
          fol.line_total,
          fol.location_code,
          fol.business_date,
          p.alt_payment_name
        FROM public.fact_order_lines fol
        LEFT JOIN LATERAL (
          SELECT alt_payment_name FROM public.br_order_payment
          WHERE order_guid = fol.order_guid AND alt_payment_name IS NOT NULL
          ORDER BY amount DESC LIMIT 1
        ) p ON TRUE
        WHERE NOT fol.is_voided
          AND fol.canonical_name IS NOT NULL
          AND fol.menu_name      IS NOT NULL
      ),
      variant AS (
        SELECT
          canonical_name, quantity, line_total, location_code, business_date,
          CASE
            WHEN alt_payment_name = ANY($1::TEXT[])
              THEN canonical_name || ' - ' || alt_payment_name
            WHEN menu_group ILIKE '%gameday%'
              THEN canonical_name || ' - Gameday'
            ELSE canonical_name
          END AS variant_label
        FROM tagged
      ),
      -- Most recent menu_group per canonical_name, for the category column —
      -- same "pick the latest row's menu_group" approach as getRenames() above.
      latest_group AS (
        SELECT DISTINCT ON (canonical_name) canonical_name, menu_group
        FROM public.fact_order_lines
        WHERE NOT is_voided AND canonical_name IS NOT NULL AND menu_name IS NOT NULL
        ORDER BY canonical_name, business_date DESC
      )
      SELECT
        v.canonical_name,
        lg.menu_group,
        STRING_AGG(DISTINCT v.variant_label, '|||' ORDER BY v.variant_label) AS all_labels_str,
        COUNT(DISTINCT v.variant_label)::INT                                 AS label_count,
        SUM(v.quantity)::BIGINT                                              AS lifetime_qty,
        ROUND(SUM(v.line_total)::NUMERIC, 2)                                AS lifetime_revenue,
        COUNT(DISTINCT v.location_code)::INT                                AS location_count,
        MIN(v.business_date)::TEXT                                          AS first_seen,
        MAX(v.business_date)::TEXT                                         AS last_seen
      FROM variant v
      JOIN latest_group lg ON lg.canonical_name = v.canonical_name
      GROUP BY v.canonical_name, lg.menu_group
      HAVING COUNT(DISTINCT v.variant_label) > 1
      ORDER BY SUM(v.quantity) DESC
    `, [CATERING_VENDORS]);
    await db.end();

    return rows.map(r => {
      const name      = r.canonical_name as string;
      const menuGroup = (r.menu_group ?? '') as string;
      const category  = name === 'That Fire Hot Sauce (Bottle)' || name === 'That Fire Hot Sauce - Side'
        ? 'Retail'
        : (GRP_TO_CAT_MAP[menuGroup] ?? 'Other');
      return {
        canonical_name:   name,
        category,
        variant_labels:   (r.all_labels_str as string).split('|||'),
        lifetime_qty:     Number(r.lifetime_qty),
        lifetime_revenue: Number(r.lifetime_revenue),
        location_count:   Number(r.location_count),
        first_seen:       r.first_seen as string,
        last_seen:        r.last_seen as string,
      };
    });
  } catch (err) {
    console.error('getRenamesDemo error:', err);
    await db.end().catch(() => {});
    return [];
  }
}

// ─── Needs Review ────────────────────────────────────────────────────────────
// Items where the derived channel (menu_name) and channel_code disagree,
// or where alt_payment_name contradicts the menu_name channel.
export async function getNeedsReview(dr: DateRange): Promise<NeedsReviewRow[]> {
  const db = pool();
  try {
    // Flagged at the LINE level: a line qualifies if IT is on an In-House menu
    // and its order was paid via a known catering/offsite vendor. An order can
    // have several already-correct lines (e.g. Catering-3PD) alongside one
    // mistracked line — only the mistracked line(s) show up here, which is what
    // the Confirm/Undo actions below actually operate on (never the whole order).
    const { rows } = await db.query(`
      WITH order_stats AS (
        SELECT
          order_guid,
          ROUND(SUM(line_total)::NUMERIC, 2)  AS amount,
          COUNT(DISTINCT canonical_name)::INT  AS item_count
        FROM public.fact_order_lines
        WHERE NOT is_voided
          AND NOT is_deferred
          AND business_date BETWEEN $1::DATE AND $2::DATE
        GROUP BY order_guid
      )
      SELECT
        fol.order_guid,
        fol.selection_guid,
        fol.canonical_name,
        fol.location_code                                    AS location,
        fol.business_date::TEXT                              AS business_date,
        co.correct_channel                                   AS override_channel,
        fol.dining_option,
        os.amount,
        os.item_count,
        COALESCE(p.alt_payment_name,'')                      AS alt_payment_name,
        CASE
          WHEN p.alt_payment_name IN ('EzCater','Ez Cater','HUNGRY','Sharebite',
            'Territory Foods','Cater Cow','WCK','Food Fleet','ZeroCater','Cater2Me')
          THEN 'CATERING'
          WHEN p.alt_payment_name IN ('Fooda','Aramark','Eurest','Metz Corp',
            'Taher','Foodworks','Cureate','Guest Services')
          THEN 'OFFSITE'
          ELSE NULL
        END AS suggested_channel
      FROM public.fact_order_lines fol
      JOIN order_stats os ON os.order_guid = fol.order_guid
      LEFT JOIN LATERAL (
        SELECT alt_payment_name FROM public.br_order_payment
        WHERE order_guid = fol.order_guid AND alt_payment_name IS NOT NULL
        ORDER BY amount DESC LIMIT 1
      ) p ON TRUE
      ${CH_OVERRIDE_JOIN('fol.selection_guid')}
      WHERE ${BASE_WHERE}
        AND fol.business_date BETWEEN $1::DATE AND $2::DATE
        AND (${CH}) = 'IN_HOUSE'
        AND (
          p.alt_payment_name IN ('EzCater','Ez Cater','HUNGRY','Sharebite',
            'Territory Foods','Cater Cow','WCK','Food Fleet','ZeroCater','Cater2Me')
          OR
          p.alt_payment_name IN ('Fooda','Aramark','Eurest','Metz Corp',
            'Taher','Foodworks','Cureate','Guest Services')
        )
      ORDER BY fol.order_guid, fol.line_total DESC
      LIMIT 500
    `, [dr.start, dr.end]);

    // Group flagged lines by order — the card is still one-per-order, but the
    // fix (and its undo) only ever touches the specific flagged selection_guids.
    type Group = {
      location: string; business_date: string; amount: number; item_count: number;
      dining_option: string; alt_payment_name: string; suggested_channel: string;
      flagged_lines: { selection_guid: string; canonical_name: string }[];
      override_channels: (string | null)[];
    };
    const byOrder = new Map<string, Group>();
    for (const r of rows) {
      const guid = r.order_guid as string;
      let g = byOrder.get(guid);
      if (!g) {
        g = {
          location:          r.location as string,
          business_date:     r.business_date as string,
          amount:            Number(r.amount),
          item_count:        Number(r.item_count),
          dining_option:     (r.dining_option ?? '') as string,
          alt_payment_name:  r.alt_payment_name as string,
          suggested_channel: (r.suggested_channel ?? '') as string,
          flagged_lines:     [],
          override_channels: [],
        };
        byOrder.set(guid, g);
      }
      g.flagged_lines.push({
        selection_guid: r.selection_guid as string,
        canonical_name: r.canonical_name as string,
      });
      g.override_channels.push((r.override_channel ?? null) as string | null);
    }

    // Line-level detail per flagged order (ALL lines, not just the flagged ones) —
    // lets the UI show the full order for context alongside which specific lines
    // are the actual problem.
    const orderGuids = [...byOrder.keys()];
    const lineItemsByOrder: Record<string, NeedsReviewLineItem[]> = {};
    if (orderGuids.length > 0) {
      const { rows: lineRows } = await db.query(`
        SELECT order_guid, selection_guid, canonical_name, menu_name, quantity, line_total, (${CH}) AS channel
        FROM public.fact_order_lines
        WHERE order_guid = ANY($1::TEXT[])
          AND NOT is_voided AND NOT is_deferred
        ORDER BY order_guid, line_total DESC
      `, [orderGuids]);
      for (const lr of lineRows) {
        const guid = lr.order_guid as string;
        (lineItemsByOrder[guid] ??= []).push({
          selection_guid: lr.selection_guid as string,
          canonical_name: lr.canonical_name as string,
          menu_name:      (lr.menu_name ?? null) as string | null,
          channel:        lr.channel as string,
          quantity:       Number(lr.quantity),
          line_total:     Number(lr.line_total),
        });
      }
    }

    await db.end();
    return orderGuids.map(order_guid => {
      const g = byOrder.get(order_guid)!;
      // "Done" only if every flagged line in this order shares the same
      // override value — Confirm/Undo always act on all of an order's flagged
      // lines together, so this should never actually be partial in practice.
      const allOverridden = g.override_channels.every(v => v !== null);
      const distinctValues = new Set(g.override_channels);
      const override_channel = allOverridden && distinctValues.size === 1
        ? g.override_channels[0]
        : null;
      return {
        order_guid,
        location:         g.location,
        business_date:    g.business_date,
        amount:           g.amount,
        item_count:       g.item_count,
        issue_type:       'CATERING-PAYMENT-WITH-WRONG-CHANNEL',
        current_channel:  'IN_HOUSE', // guaranteed by the WHERE clause above
        override_channel,
        dining_option:    g.dining_option,
        alt_payment_name: g.alt_payment_name,
        suggested_channel: g.suggested_channel,
        flagged_lines:    g.flagged_lines,
        line_items:       lineItemsByOrder[order_guid] ?? [],
      };
    });
  } catch (err) {
    console.error('getNeedsReview error:', err);
    await db.end().catch(() => {}); // connection may already be broken; don't let cleanup crash the request
    return [];
  }
}

// ─── Open Items ───────────────────────────────────────────────────────────────
export async function getOpenItems(dr: DateRange): Promise<{ summary: OpenItemsSummary; items: OpenItemRow[] }> {
  const db = pool();
  try {
    const { rows } = await db.query(`
      WITH open_raw AS (
        SELECT
          fol.canonical_name,
          fol.sales_category,
          fol.menu_group,
          fol.dining_option,
          fol.quantity,
          fol.line_total,
          fol.business_date
        FROM public.fact_order_lines fol
        WHERE NOT fol.is_voided
          AND NOT fol.is_deferred
          AND fol.menu_name IS NULL
          AND fol.business_date BETWEEN $1::DATE AND $2::DATE
      ),
      has_cost AS (
        SELECT DISTINCT item_name_updated FROM analytics.r365_item_cost
      ),
      in_lookup AS (
        SELECT DISTINCT raw_item_name FROM analytics.item_lookup
      ),
      agg AS (
        SELECT
          o.canonical_name,
          MIN(o.sales_category)           AS sales_category,
          MIN(o.menu_group)               AS menu_group,
          MIN(o.dining_option)            AS dining_option,
          SUM(o.quantity)::BIGINT         AS qty,
          ROUND(SUM(o.line_total)::NUMERIC,2) AS net_sales,
          MAX(o.business_date)::TEXT      AS last_seen,
          BOOL_OR(hc.item_name_updated IS NULL) AS missing_cost,
          BOOL_OR(il.raw_item_name IS NULL)     AS uncategorized
        FROM open_raw o
        LEFT JOIN has_cost hc ON hc.item_name_updated = o.canonical_name
        LEFT JOIN in_lookup il ON il.raw_item_name    = o.canonical_name
        GROUP BY o.canonical_name
      )
      SELECT
        a.*,
        ARRAY_REMOVE(ARRAY[
          CASE WHEN a.missing_cost   THEN 'NO COST'           END,
          CASE WHEN a.uncategorized  THEN 'UNCATEGORIZED'     END,
          CASE WHEN a.menu_group IS NULL OR a.menu_group = '' THEN 'MISSING MENU GROUP' END
        ], NULL) AS issue_types
      FROM agg a
      ORDER BY a.net_sales DESC
    `, [dr.start, dr.end]);
    await db.end();

    const items: OpenItemRow[] = rows.map(r => ({
      canonical_name: r.canonical_name as string,
      sales_category: r.sales_category as string | null,
      menu_group:     r.menu_group     as string | null,
      dining_option:  r.dining_option  as string | null,
      issue_types:    r.issue_types    as string[],
      qty:            Number(r.qty),
      net_sales:      Number(r.net_sales),
      last_seen:      r.last_seen      as string,
      suggested_fix:  r.uncategorized
        ? `Add to item_lookup with appropriate category`
        : r.missing_cost
        ? `Add cost in R365 for item: ${r.canonical_name}`
        : 'Review item setup in Toast',
    }));

    const summary: OpenItemsSummary = {
      total:            items.length,
      revenue_affected: items.reduce((s, i) => s + i.net_sales, 0),
      missing_cost:     items.filter(i => i.issue_types.includes('NO COST')).length,
      uncategorized:    items.filter(i => i.issue_types.includes('UNCATEGORIZED')).length,
    };

    return { summary, items };
  } catch (err) {
    console.error('getOpenItems error:', err);
    await db.end().catch(() => {}); // connection may already be broken; don't let cleanup crash the request
    return {
      summary: { total: 0, revenue_affected: 0, missing_cost: 0, uncategorized: 0 },
      items: [],
    };
  }
}

// ─── Fiscal periods ───────────────────────────────────────────────────────────
export async function getPeriods(): Promise<FiscalPeriodRow[]> {
  const db = pool();
  const { rows } = await db.query(`
    SELECT period, fiscal_year, quarter, start_date::TEXT, end_date::TEXT
    FROM public.dim_fiscal_period
    ORDER BY fiscal_year DESC, period DESC
    LIMIT 26
  `);
  await db.end();
  return rows.map(r => ({
    period:      Number(r.period),
    fiscal_year: Number(r.fiscal_year),
    quarter:     Number(r.quarter),
    label:       `P${r.period} ${r.fiscal_year}`,
    start_date:  r.start_date as string,
    end_date:    r.end_date   as string,
  }));
}

// ─── Uncategorized items ──────────────────────────────────────────────────────
// Items not in item_lookup AND not in modifier_type, excluding OFFSITE (uses menu_group)
// and OPEN_ITEMS (already shown in the Open Items tab).
export async function getUncategorizedItems(dr: DateRange): Promise<UncategorizedItemRow[]> {
  const db = pool();
  try {
    const { rows } = await db.query(`
      SELECT
        fol.canonical_name,
        (${CHO}) AS channel,
        SUM(fol.quantity)::BIGINT              AS qty,
        ROUND(SUM(fol.line_total)::NUMERIC, 2) AS revenue,
        MAX(fol.business_date)::TEXT           AS last_seen
      FROM public.fact_order_lines fol
      LEFT JOIN (
        SELECT DISTINCT raw_item_name FROM analytics.item_lookup
      ) il ON il.raw_item_name = fol.canonical_name
      LEFT JOIN (
        SELECT DISTINCT modifier_name FROM analytics.modifier_type
      ) mlt ON mlt.modifier_name = fol.canonical_name
      ${CH_OVERRIDE_JOIN('fol.selection_guid')}
      WHERE ${BASE_WHERE}
        AND fol.business_date BETWEEN $1::DATE AND $2::DATE
        AND (${CHO}) NOT IN ('OFFSITE', 'OPEN_ITEMS')
        AND il.raw_item_name  IS NULL
        AND mlt.modifier_name IS NULL
        AND (${GRP_TO_CAT_SQL}) IS NULL
        AND fol.canonical_name NOT IN ('That Fire Hot Sauce (Bottle)', 'That Fire Hot Sauce - Side')
      GROUP BY fol.canonical_name, 2
      ORDER BY revenue DESC
    `, [dr.start, dr.end]);
    await db.end();
    return rows.map(r => ({
      canonical_name: r.canonical_name as string,
      channel:        r.channel        as string,
      qty:            Number(r.qty),
      revenue:        Number(r.revenue),
      last_seen:      r.last_seen      as string,
    }));
  } catch (err) {
    console.error('getUncategorizedItems error:', err);
    await db.end().catch(() => {}); // connection may already be broken; don't let cleanup crash the request
    return [];
  }
}

// ─── Previous-period date range for KPI comparison ────────────────────────────
function addDaysStr(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

function computePrevDateRange(
  dr: DateRange,
  periods: FiscalPeriodRow[],
): { start: string; end: string; label: string } | null {
  const label = dr.label;

  // Fiscal period "P5 2026"
  const pm = label.match(/^P(\d+)\s+(\d{4})$/);
  if (pm) {
    const p = parseInt(pm[1]);
    const y = parseInt(pm[2]);
    const prev = periods.find(r =>
      r.fiscal_year === (p === 1 ? y - 1 : y) &&
      r.period      === (p === 1 ? 13  : p - 1)
    );
    return prev ? { start: prev.start_date, end: prev.end_date, label: prev.label } : null;
  }

  // Quarter "Q2 2026"
  const qm = label.match(/^Q([1-4])\s+(\d{4})$/);
  if (qm) {
    const q = parseInt(qm[1]);
    const y = parseInt(qm[2]);
    const starts = ['01-01', '04-01', '07-01', '10-01'];
    const ends   = ['03-31', '06-30', '09-30', '12-31'];
    if (q === 1) return { start: `${y - 1}-10-01`, end: `${y - 1}-12-31`, label: `Q4 ${y - 1}` };
    return { start: `${y}-${starts[q - 2]}`, end: `${y}-${ends[q - 2]}`, label: `Q${q - 1} ${y}` };
  }

  // Rolling presets
  const days = label === 'Last 7 Days' ? 7 : label === 'Last 14 Days' ? 14 : label === 'Last 4 Weeks' ? 28 : 0;
  if (days > 0) {
    return {
      start: addDaysStr(dr.start, -days),
      end:   addDaysStr(dr.end,   -days),
      label: `prev ${days}d`,
    };
  }

  return null;
}

// ─── Item base costs (r365_item_cost + r365_modifier_cost MI recipes) ────────
// Third-tier fallback in Item Mix. Uses latest period <= date range end.
export async function getItemCosts(dr: DateRange): Promise<ItemCostRow[]> {
  const db = pool();
  const { rows } = await db.query(`
    WITH
    ${BYO_FIX_CTE},
    max_pk AS (
      SELECT COALESCE(
        (SELECT fiscal_year * 100 + period
         FROM public.dim_fiscal_period
         WHERE $1::DATE > start_date::DATE AND $1::DATE <= end_date::DATE
         LIMIT 1),
        (SELECT fiscal_year * 100 + period
         FROM public.dim_fiscal_period
         ORDER BY fiscal_year DESC, period DESC LIMIT 1)
      ) AS pk
    ),
    ih_base AS (
      SELECT DISTINCT ON (canonical)
        canonical AS name, avg_cost AS cost
      FROM (
        SELECT
          COALESCE(bf.clean, item_name_updated) AS canonical,
          avg_cost, period
        FROM analytics.r365_item_cost
        LEFT JOIN byo_fix bf ON bf.raw = item_name_updated
        CROSS JOIN max_pk
        WHERE menu IN ('FOOD - IN HOUSE','DRINKS - IN HOUSE') AND avg_cost > 0 AND item_name <> 'Harvest Chicken Bowl - In House'
          AND (RIGHT(period,4)::INT * 100 + SUBSTRING(period,2,2)::INT) <= max_pk.pk
      ) t
      ORDER BY canonical,
               RIGHT(period,4)::INT DESC, SUBSTRING(period,2,2)::INT DESC
    ),
    online_base AS (
      SELECT DISTINCT ON (canonical)
        canonical AS name, avg_cost AS cost
      FROM (
        SELECT
          COALESCE(bf.clean, item_name_updated) AS canonical,
          avg_cost, period
        FROM analytics.r365_item_cost
        LEFT JOIN byo_fix bf ON bf.raw = item_name_updated
        CROSS JOIN max_pk
        WHERE menu IN ('DELIVERY','3PD OPEN MARKUP') AND avg_cost > 0 AND item_name <> 'Harvest Chicken Bowl - In House'
          AND (RIGHT(period,4)::INT * 100 + SUBSTRING(period,2,2)::INT) <= max_pk.pk
      ) t
      ORDER BY canonical,
               RIGHT(period,4)::INT DESC, SUBSTRING(period,2,2)::INT DESC
    ),
    fallback_base AS (
      SELECT DISTINCT ON (canonical)
        canonical AS name, avg_cost AS cost
      FROM (
        SELECT
          COALESCE(bf.clean, item_name_updated) AS canonical,
          avg_cost, period
        FROM analytics.r365_item_cost
        LEFT JOIN byo_fix bf ON bf.raw = item_name_updated
        CROSS JOIN max_pk
        WHERE avg_cost > 0 AND item_name <> 'Harvest Chicken Bowl - In House'
          AND (RIGHT(period,4)::INT * 100 + SUBSTRING(period,2,2)::INT) <= max_pk.pk
      ) t
      ORDER BY canonical,
               RIGHT(period,4)::INT DESC, SUBSTRING(period,2,2)::INT DESC
    ),
    mi_base AS (
      SELECT DISTINCT ON (canonical)
        canonical AS name, cost_per_portion AS cost
      FROM (
        SELECT
          COALESCE(bf.clean, clean_name) AS canonical,
          cost_per_portion, period
        FROM analytics.r365_modifier_cost
        LEFT JOIN byo_fix bf ON bf.raw = clean_name
        CROSS JOIN max_pk
        WHERE recipe_name LIKE 'MI %' AND cost_per_portion > 0
          AND (RIGHT(period,4)::INT * 100 + SUBSTRING(period,2,2)::INT) <= max_pk.pk
      ) t
      ORDER BY canonical,
               RIGHT(period,4)::INT DESC, SUBSTRING(period,2,2)::INT DESC
    ),
    -- CATERING, CATERING - 3PD, OFFSITE POP-UPS, and Open items are each their OWN
    -- r365 menu value with their own costs — they must NOT be blended together or
    -- fall back to fallback_base/mi_base (which pick an arbitrary menu's cost with no
    -- regard for which channel is actually being costed). Each gets its own bucket,
    -- period-aware (freshest <= selected period), sourced strictly from its own menu.
    catering_base AS (
      SELECT DISTINCT ON (canonical)
        canonical AS name, avg_cost AS cost
      FROM (
        SELECT
          COALESCE(bf.clean, item_name_updated) AS canonical,
          avg_cost, period
        FROM analytics.r365_item_cost
        LEFT JOIN byo_fix bf ON bf.raw = item_name_updated
        CROSS JOIN max_pk
        WHERE menu = 'CATERING' AND avg_cost > 0 AND item_name <> 'Harvest Chicken Bowl - In House'
          AND (RIGHT(period,4)::INT * 100 + SUBSTRING(period,2,2)::INT) <= max_pk.pk
      ) t
      ORDER BY canonical,
               RIGHT(period,4)::INT DESC, SUBSTRING(period,2,2)::INT DESC
    ),
    catering_3pd_base AS (
      SELECT DISTINCT ON (canonical)
        canonical AS name, avg_cost AS cost
      FROM (
        SELECT
          COALESCE(bf.clean, item_name_updated) AS canonical,
          avg_cost, period
        FROM analytics.r365_item_cost
        LEFT JOIN byo_fix bf ON bf.raw = item_name_updated
        CROSS JOIN max_pk
        WHERE menu = 'CATERING - 3PD' AND avg_cost > 0 AND item_name <> 'Harvest Chicken Bowl - In House'
          AND (RIGHT(period,4)::INT * 100 + SUBSTRING(period,2,2)::INT) <= max_pk.pk
      ) t
      ORDER BY canonical,
               RIGHT(period,4)::INT DESC, SUBSTRING(period,2,2)::INT DESC
    ),
    offsite_base AS (
      SELECT DISTINCT ON (canonical)
        canonical AS name, avg_cost AS cost
      FROM (
        SELECT
          COALESCE(bf.clean, item_name_updated) AS canonical,
          avg_cost, period
        FROM analytics.r365_item_cost
        LEFT JOIN byo_fix bf ON bf.raw = item_name_updated
        CROSS JOIN max_pk
        WHERE menu = 'OFFSITE POP-UPS' AND avg_cost > 0 AND item_name <> 'Harvest Chicken Bowl - In House'
          AND (RIGHT(period,4)::INT * 100 + SUBSTRING(period,2,2)::INT) <= max_pk.pk
      ) t
      ORDER BY canonical,
               RIGHT(period,4)::INT DESC, SUBSTRING(period,2,2)::INT DESC
    ),
    open_items_base AS (
      SELECT DISTINCT ON (canonical)
        canonical AS name, avg_cost AS cost
      FROM (
        SELECT
          COALESCE(bf.clean, item_name_updated) AS canonical,
          avg_cost, period
        FROM analytics.r365_item_cost
        LEFT JOIN byo_fix bf ON bf.raw = item_name_updated
        CROSS JOIN max_pk
        WHERE menu = 'Open items' AND avg_cost > 0 AND item_name <> 'Harvest Chicken Bowl - In House'
          AND (RIGHT(period,4)::INT * 100 + SUBSTRING(period,2,2)::INT) <= max_pk.pk
      ) t
      ORDER BY canonical,
               RIGHT(period,4)::INT DESC, SUBSTRING(period,2,2)::INT DESC
    ),
    all_names AS (
      SELECT name FROM ih_base
      UNION SELECT name FROM online_base
      UNION SELECT name FROM fallback_base
      UNION SELECT name FROM mi_base
      UNION SELECT name FROM catering_base
      UNION SELECT name FROM catering_3pd_base
      UNION SELECT name FROM offsite_base
      UNION SELECT name FROM open_items_base
    )
    SELECT
      n.name                                                    AS canonical_name,
      COALESCE(ih.cost, fb.cost, mi.cost, 0)::NUMERIC          AS ih_cost,
      COALESCE(ol.cost, fb.cost, mi.cost, 0)::NUMERIC          AS online_cost,
      COALESCE(ct.cost, 0)::NUMERIC                             AS catering_cost,
      COALESCE(c3.cost, 0)::NUMERIC                             AS catering_3pd_cost,
      COALESCE(off.cost, 0)::NUMERIC                            AS offsite_cost,
      COALESCE(oi.cost, 0)::NUMERIC                             AS open_items_cost
    FROM all_names n
    LEFT JOIN ih_base          ih  ON LOWER(ih.name)  = LOWER(n.name)
    LEFT JOIN online_base      ol  ON LOWER(ol.name)  = LOWER(n.name)
    LEFT JOIN fallback_base    fb  ON LOWER(fb.name)  = LOWER(n.name)
    LEFT JOIN mi_base          mi  ON LOWER(mi.name)  = LOWER(n.name)
    LEFT JOIN catering_base    ct  ON LOWER(ct.name)  = LOWER(n.name)
    LEFT JOIN catering_3pd_base c3 ON LOWER(c3.name)  = LOWER(n.name)
    LEFT JOIN offsite_base     off ON LOWER(off.name) = LOWER(n.name)
    LEFT JOIN open_items_base  oi  ON LOWER(oi.name)  = LOWER(n.name)
    WHERE COALESCE(ih.cost, ol.cost, ct.cost, c3.cost, off.cost, oi.cost, fb.cost, mi.cost, 0) > 0
  `, [dr.end]);
  await db.end();
  return rows.map(r => ({
    canonical_name:      r.canonical_name as string,
    ih_cost:             Number(r.ih_cost),
    online_cost:         Number(r.online_cost),
    catering_cost:       Number(r.catering_cost),
    catering_3pd_cost:   Number(r.catering_3pd_cost),
    offsite_cost:        Number(r.offsite_cost),
    open_items_cost:     Number(r.open_items_cost),
  }));
}

// ─── Missing R365 item costs (admin cost-entry tool) ─────────────────────────
// Broader than Open Items' "NO COST" flag (which only covers items with no
// menu_name at all): checks every normally-channeled item × sales bucket
// (IH / online / catering / catering-3PD / offsite) against analytics.r365_item_cost
// using the SAME menu-value mapping getItemCosts already uses for each bucket, so
// "missing" here means the exact thing downstream cost lookups would also fail to find.
export async function getMissingItemCosts(dr: DateRange): Promise<MissingCostRow[]> {
  const db = pool();
  const { rows } = await db.query(`
    WITH
    ${BYO_FIX_CTE},
    sales AS (
      SELECT
        COALESCE(bf.clean, fol.canonical_name) AS canonical_name,
        MIN(${CAT1})                           AS category,
        MIN(fol.menu_group)                    AS menu_group,
        CASE
          WHEN fol.menu_name IN ('FOOD - IN HOUSE','DRINKS - IN HOUSE')                      THEN 'ih'
          WHEN fol.menu_name IN ('APP','FOOD - TOAST ONLINE ORDERING','DELIVERY','3PD OPEN MARKUP') THEN 'online'
          WHEN fol.menu_name = 'CATERING'                                                     THEN 'catering'
          WHEN fol.menu_name = 'CATERING - 3PD'                                               THEN 'catering_3pd'
          WHEN fol.menu_name = 'OFFSITE POP-UPS'                                              THEN 'offsite'
        END AS bucket,
        SUM(fol.quantity)::BIGINT                AS qty,
        ROUND(SUM(fol.line_total)::NUMERIC, 2)   AS net_sales
      FROM public.fact_order_lines fol
      LEFT JOIN byo_fix bf ON bf.raw = fol.canonical_name
      WHERE NOT fol.is_voided AND NOT fol.is_deferred
        AND fol.menu_name IN (
          'FOOD - IN HOUSE','DRINKS - IN HOUSE',
          'APP','FOOD - TOAST ONLINE ORDERING','DELIVERY','3PD OPEN MARKUP',
          'CATERING','CATERING - 3PD','OFFSITE POP-UPS'
        )
        AND fol.business_date BETWEEN $1::DATE AND $2::DATE
      GROUP BY COALESCE(bf.clean, fol.canonical_name), bucket
    ),
    has_ih AS (
      SELECT DISTINCT item_name_updated FROM analytics.r365_item_cost
      WHERE menu IN ('FOOD - IN HOUSE','DRINKS - IN HOUSE') AND avg_cost > 0
    ),
    has_online AS (
      SELECT DISTINCT item_name_updated FROM analytics.r365_item_cost
      WHERE menu IN ('DELIVERY','3PD OPEN MARKUP') AND avg_cost > 0
    ),
    has_catering AS (
      SELECT DISTINCT item_name_updated FROM analytics.r365_item_cost
      WHERE menu = 'CATERING' AND avg_cost > 0
    ),
    has_catering_3pd AS (
      SELECT DISTINCT item_name_updated FROM analytics.r365_item_cost
      WHERE menu = 'CATERING - 3PD' AND avg_cost > 0
    ),
    has_offsite AS (
      SELECT DISTINCT item_name_updated FROM analytics.r365_item_cost
      WHERE menu = 'OFFSITE POP-UPS' AND avg_cost > 0
    )
    SELECT s.canonical_name, s.category, s.menu_group, s.bucket, s.qty, s.net_sales
    FROM sales s
    LEFT JOIN has_ih           hih  ON hih.item_name_updated  = s.canonical_name
    LEFT JOIN has_online       honl ON honl.item_name_updated = s.canonical_name
    LEFT JOIN has_catering     hcat ON hcat.item_name_updated = s.canonical_name
    LEFT JOIN has_catering_3pd hc3  ON hc3.item_name_updated  = s.canonical_name
    LEFT JOIN has_offsite      hoff ON hoff.item_name_updated = s.canonical_name
    WHERE s.bucket IS NOT NULL
      AND (
        (s.bucket = 'ih'           AND hih.item_name_updated  IS NULL) OR
        (s.bucket = 'online'       AND honl.item_name_updated IS NULL) OR
        (s.bucket = 'catering'     AND hcat.item_name_updated IS NULL) OR
        (s.bucket = 'catering_3pd' AND hc3.item_name_updated  IS NULL) OR
        (s.bucket = 'offsite'      AND hoff.item_name_updated IS NULL)
      )
    ORDER BY s.net_sales DESC
  `, [dr.start, dr.end]);
  await db.end();
  return rows.map(r => ({
    canonical_name: r.canonical_name as string,
    category:       (r.category ?? 'Other') as string,
    menu_group:     (r.menu_group ?? '') as string,
    bucket:         r.bucket as MissingCostRow['bucket'],
    qty:            Number(r.qty),
    net_sales:      Number(r.net_sales),
  }));
}

// ─── Attachment Analytics (tester-only) ───────────────────────────────────────
// menu_group buckets used to classify a line as a "main" item (denominator for
// all three reports) or a Drink/Sweet/Side attachment target — a self-contained
// classification distinct from GRP_TO_CAT_SQL, carried over as-is from the
// hand-verified reference tool this feature was rebuilt from.
const ATTACHMENT_MAIN_GROUPS = [
  'BOWLS', 'BUILD YOUR OWN BOWL', 'BURRITOS', 'BYO', 'CHEF CURATED BOWLS',
  'CLASSIC INDIAN PLATES', 'PLATES', 'INDIAN BURRITOS', 'KIDS',
];
const ATTACHMENT_DRINK_GROUPS = ['Cold Drinks', 'Hot Drinks', 'DRINKS', 'Beer', 'Wine', 'Liquor'];

const sqlList = (vals: string[]) => vals.map(v => `'${v.replace(/'/g, "''")}'`).join(',');
const ATTACH_MAIN_LIST  = sqlList(ATTACHMENT_MAIN_GROUPS);
const ATTACH_DRINK_LIST = sqlList(ATTACHMENT_DRINK_GROUPS);

export async function getAttachmentData(dr: DateRange): Promise<AttachmentData> {
  const db = pool();
  const { rows } = await db.query(`
    WITH
    main_lines AS (
      SELECT fol.check_guid, fol.location_code, fol.selection_guid, (${CHO}) AS channel
      FROM public.fact_order_lines fol
      ${CH_OVERRIDE_JOIN('fol.selection_guid')}
      WHERE NOT fol.is_voided AND NOT fol.is_deferred
        AND fol.menu_group IN (${ATTACH_MAIN_LIST})
        AND fol.business_date BETWEEN $1::DATE AND $2::DATE
    ),
    main_checks AS (
      SELECT DISTINCT ON (check_guid) check_guid, location_code, channel
      FROM main_lines
      ORDER BY check_guid
    ),
    buckets AS (
      SELECT location_code, channel, COUNT(*)::int AS n
      FROM main_checks
      GROUP BY 1, 2
    ),
    item_lines AS (
      SELECT
        mc.location_code, mc.channel,
        CASE
          WHEN fol.menu_group IN (${ATTACH_DRINK_LIST}) AND fol.menu_name <> 'CATERING' THEN 'Drink'
          WHEN fol.menu_group = 'SWEETS' THEN 'Sweet'
          WHEN fol.menu_group = 'SIDES'  THEN 'Side'
          WHEN fol.menu_group IN (${ATTACH_MAIN_LIST}) THEN 'Main'
        END AS category,
        fol.canonical_name AS name,
        fol.check_guid
      FROM public.fact_order_lines fol
      JOIN main_checks mc ON mc.check_guid = fol.check_guid
      WHERE NOT fol.is_voided AND NOT fol.is_deferred
        AND fol.business_date BETWEEN $1::DATE AND $2::DATE
        AND (
          (fol.menu_group IN (${ATTACH_DRINK_LIST}) AND fol.menu_name <> 'CATERING')
          OR fol.menu_group = 'SWEETS'
          OR fol.menu_group = 'SIDES'
          OR fol.menu_group IN (${ATTACH_MAIN_LIST})
        )
    ),
    items AS (
      SELECT location_code, channel, category, name, COUNT(DISTINCT check_guid)::int AS n
      FROM item_lines
      GROUP BY 1, 2, 3, 4
    ),
    -- fact_modifiers.parent_selection joins 100% to fact_order_lines.selection_guid
    -- (verified: no fallback to order_guid needed, unlike the original reference tool).
    -- Restricted to main_checks (like item_lines) so a modifier on a check that
    -- doesn't even have a qualifying entree line (e.g. a catering order whose
    -- menu_group naming isn't in ATTACH_MAIN_LIST) can't leak into the
    -- attachment count — the whole metric is "entree-tickets that also got X".
    mod_lines AS (
      SELECT fol.check_guid, fol.location_code, (${CHO}) AS channel, fm.canonical_name AS name
      FROM public.fact_modifiers fm
      JOIN public.fact_order_lines fol ON fol.selection_guid = fm.parent_selection
      JOIN main_checks mc ON mc.check_guid = fol.check_guid
      ${CH_OVERRIDE_JOIN('fol.selection_guid')}
      WHERE NOT fm.is_voided AND NOT fol.is_voided AND NOT fol.is_deferred
        AND fm.business_date BETWEEN $1::DATE AND $2::DATE
    ),
    modifiers AS (
      SELECT location_code, channel, name, COUNT(DISTINCT check_guid)::int AS n
      FROM mod_lines
      GROUP BY 1, 2, 3
    ),
    -- Modifier picks don't carry their own category (fact_modifiers has no
    -- menu_group) — matched against item_lines by name, same merge-by-name
    -- convention as the per-item report below.
    name_category AS (
      SELECT DISTINCT name, category FROM item_lines
    ),
    mod_cat_lines AS (
      SELECT ml.check_guid, ml.location_code, ml.channel, nc.category
      FROM mod_lines ml
      JOIN name_category nc ON nc.name = ml.name
    ),
    category_checks AS (
      SELECT location_code, channel, category, COUNT(DISTINCT check_guid)::int AS n
      FROM (
        SELECT check_guid, location_code, channel, category FROM item_lines
        UNION ALL
        SELECT check_guid, location_code, channel, category FROM mod_cat_lines
      ) combined
      GROUP BY 1, 2, 3
    ),
    category_mod_checks AS (
      SELECT location_code, channel, category, COUNT(DISTINCT check_guid)::int AS n
      FROM mod_cat_lines
      GROUP BY 1, 2, 3
    )
    SELECT 'bucket' AS kind, location_code, channel, NULL::text AS category, NULL::text AS name, n FROM buckets
    UNION ALL
    SELECT 'item', location_code, channel, category, name, n FROM items
    UNION ALL
    SELECT 'modifier', location_code, channel, NULL::text, name, n FROM modifiers
    UNION ALL
    SELECT 'category', location_code, channel, category, NULL::text, n FROM category_checks
    UNION ALL
    SELECT 'category_mod', location_code, channel, category, NULL::text, n FROM category_mod_checks
  `, [dr.start, dr.end]);
  await db.end();

  const buckets: AttachmentBucketRow[] = [];
  const items: AttachmentItemRow[] = [];
  const modifiers: AttachmentModifierRow[] = [];
  const categoryChecks: AttachmentCategoryRow[] = [];
  const categoryModChecks: AttachmentCategoryRow[] = [];
  for (const r of rows) {
    const location_code = r.location_code as string;
    const channel        = r.channel as string;
    const n               = Number(r.n);
    if (r.kind === 'bucket') {
      buckets.push({ location_code, channel, main_checks: n });
    } else if (r.kind === 'item') {
      items.push({ location_code, channel, category: r.category as AttachmentItemRow['category'], item: r.name as string, checks_with: n });
    } else if (r.kind === 'modifier') {
      modifiers.push({ location_code, channel, modifier: r.name as string, checks_with: n });
    } else if (r.kind === 'category') {
      categoryChecks.push({ location_code, channel, category: r.category as AttachmentCategoryRow['category'], checks: n });
    } else {
      categoryModChecks.push({ location_code, channel, category: r.category as AttachmentCategoryRow['category'], checks: n });
    }
  }
  return { buckets, items, modifiers, categoryChecks, categoryModChecks };
}

// ─── Attachment trend (weekly, within the selected date range) ────────────────
// Same main-checks/item/modifier logic as getAttachmentData, bucketed by week
// instead of collapsed to one total — category only (no per-item breakdown,
// a trend line doesn't need it). name_category maps a modifier's canonical
// name to a category by matching it against item_lines within this same date
// range, exactly like getAttachmentData's merged-by-name approach.
export async function getAttachmentTrend(dr: DateRange): Promise<AttachmentTrendData> {
  const db = pool();
  const { rows } = await db.query(`
    WITH
    main_lines AS (
      SELECT fol.check_guid, fol.location_code, fol.business_date, fol.selection_guid, (${CHO}) AS channel
      FROM public.fact_order_lines fol
      ${CH_OVERRIDE_JOIN('fol.selection_guid')}
      WHERE NOT fol.is_voided AND NOT fol.is_deferred
        AND fol.menu_group IN (${ATTACH_MAIN_LIST})
        AND fol.business_date BETWEEN $1::DATE AND $2::DATE
    ),
    main_checks AS (
      SELECT DISTINCT ON (check_guid) check_guid, location_code, channel, business_date
      FROM main_lines
      ORDER BY check_guid
    ),
    buckets AS (
      SELECT DATE_TRUNC('week', business_date)::DATE AS week_start, location_code, channel, COUNT(*)::int AS n
      FROM main_checks
      GROUP BY 1, 2, 3
    ),
    item_lines AS (
      SELECT
        mc.check_guid, mc.location_code, mc.channel, mc.business_date,
        CASE
          WHEN fol.menu_group IN (${ATTACH_DRINK_LIST}) AND fol.menu_name <> 'CATERING' THEN 'Drink'
          WHEN fol.menu_group = 'SWEETS' THEN 'Sweet'
          WHEN fol.menu_group = 'SIDES'  THEN 'Side'
        END AS category,
        fol.canonical_name AS name
      FROM public.fact_order_lines fol
      JOIN main_checks mc ON mc.check_guid = fol.check_guid
      WHERE NOT fol.is_voided AND NOT fol.is_deferred
        AND fol.business_date BETWEEN $1::DATE AND $2::DATE
        AND (
          (fol.menu_group IN (${ATTACH_DRINK_LIST}) AND fol.menu_name <> 'CATERING')
          OR fol.menu_group = 'SWEETS'
          OR fol.menu_group = 'SIDES'
        )
    ),
    name_category AS (
      SELECT DISTINCT name, category FROM item_lines
    ),
    mod_lines AS (
      SELECT fm.canonical_name AS name, mc.check_guid, mc.location_code, mc.channel, mc.business_date
      FROM public.fact_modifiers fm
      JOIN public.fact_order_lines fol ON fol.selection_guid = fm.parent_selection
      JOIN main_checks mc ON mc.check_guid = fol.check_guid
      ${CH_OVERRIDE_JOIN('fol.selection_guid')}
      WHERE NOT fm.is_voided AND NOT fol.is_voided AND NOT fol.is_deferred
        AND fm.business_date BETWEEN $1::DATE AND $2::DATE
    ),
    attach_lines AS (
      SELECT check_guid, location_code, channel, business_date, category FROM item_lines
      UNION ALL
      SELECT ml.check_guid, ml.location_code, ml.channel, ml.business_date, nc.category
      FROM mod_lines ml
      JOIN name_category nc ON nc.name = ml.name
    ),
    categories AS (
      SELECT DATE_TRUNC('week', business_date)::DATE AS week_start, location_code, channel, category, COUNT(DISTINCT check_guid)::int AS n
      FROM attach_lines
      GROUP BY 1, 2, 3, 4
    )
    SELECT 'bucket' AS kind, week_start::TEXT, location_code, channel, NULL::text AS category, n FROM buckets
    UNION ALL
    SELECT 'category', week_start::TEXT, location_code, channel, category, n FROM categories
  `, [dr.start, dr.end]);
  await db.end();

  const buckets: AttachmentTrendBucketRow[] = [];
  const categories: AttachmentTrendCategoryRow[] = [];
  for (const r of rows) {
    const week_start    = r.week_start    as string;
    const location_code = r.location_code as string;
    const channel        = r.channel        as string;
    const n               = Number(r.n);
    if (r.kind === 'bucket') {
      buckets.push({ week_start, location_code, channel, main_checks: n });
    } else {
      categories.push({ week_start, location_code, channel, category: r.category as AttachmentTrendCategoryRow['category'], checks_with: n });
    }
  }
  return { buckets, categories };
}

// ─── Master loader ────────────────────────────────────────────────────────────
export async function loadDashboardData(
  override?: { start: string; end: string; label?: string }
) {
  'use cache';
  cacheLife('hours');
  cacheTag('dashboard-data');
  // Get date range + periods first so we can compute prev range for comparison
  const [dr, periods] = await Promise.all([
    getDateRange(override),
    getPeriods(),
  ]);

  const prevRange = computePrevDateRange(dr, periods);

  const prevDr = prevRange ? { ...dr, start: prevRange.start, end: prevRange.end, label: prevRange.label } : null;

  const [
    summary, prevSummaryResult,
    channels, weekly, daily,
    weeklyByChannel, dailyByChannel,
    items, channelItems, locationItems, locations,
    meItems, pinkSheets, pinkSheetDetails, modifiers, payments, paymentsByLocation, paymentSourcesByLocation, bikky,
    categories, channelCategories,
    renames, renamesDemo, needsReview,
    openItemsResult,
    uncategorizedItems,
    cateringVendors, offsiteVendors,
    itemCosts, missingCosts,
    prevChannelItems, prevLocationItems, prevMEItems,
    attachment, prevAttachment, attachmentTrend,
    beverageModifiers, makeItMealModifiers,
  ] = await Promise.all([
    getSummary(dr),
    prevDr ? getSummary(prevDr) : Promise.resolve(null),
    getChannels(dr),
    getWeekly(dr),
    getDaily(dr),
    getWeeklyByChannel(dr),
    getDailyByChannel(dr),
    getItems(dr),
    getChannelItems(dr),
    getLocationItems(dr),
    getLocations(),
    getMEItems(dr),
    getMEPinkSheets(dr),
    getMEPinkSheetDetails(dr),
    getModifiers(dr),
    getPayments(dr),
    getPaymentsByLocation(dr),
    getPaymentSourcesByLocation(dr),
    getBikky(),
    getCategories(dr),
    getChannelCategories(dr),
    getRenames(),
    getRenamesDemo(),
    getNeedsReview(dr),
    getOpenItems(dr),
    getUncategorizedItems(dr),
    getCateringVendors(dr),
    getOffsiteVendors(dr),
    getItemCosts(dr),
    getMissingItemCosts(dr),
    // Prev-period granular data — lets Overview compute "vs prev X" deltas that
    // respect the active channel/category/location filters instead of comparing
    // a filtered current period against an unfiltered prev-period total.
    prevDr ? getChannelItems(prevDr)  : Promise.resolve([]),
    prevDr ? getLocationItems(prevDr) : Promise.resolve([]),
    prevDr ? getMEItems(prevDr)       : Promise.resolve([]),
    getAttachmentData(dr),
    prevDr ? getAttachmentData(prevDr) : Promise.resolve(null),
    getAttachmentTrend(dr),
    getBeverageModifiers(dr),
    getMakeItMealModifiers(dr),
  ]);

  const totalMargin   = meItems.reduce((s, i) => s + i.total_margin, 0);
  const totalNetSales = meItems.reduce((s, i) => s + i.net_sales,    0);
  const avgMargin     = totalNetSales > 0 ? totalMargin / totalNetSales : 0;

  return {
    dateRange: dr,
    summary,
    prevSummary: prevSummaryResult,
    prevLabel:   prevRange?.label ?? null,
    prevChannelItems, prevLocationItems, prevMEItems,
    channels,
    weekly, daily, weeklyByChannel, dailyByChannel,
    items, channelItems, locationItems, locations,
    meItems, pinkSheets, pinkSheetDetails, avgMargin,
    modifiers, payments, paymentsByLocation, paymentSourcesByLocation, bikky,
    categories, channelCategories,
    renames, renamesDemo, needsReview,
    uncategorizedItems,
    openItems:        openItemsResult.items,
    openItemsSummary: openItemsResult.summary,
    periods,
    cateringVendors, offsiteVendors,
    itemCosts, missingCosts,
    attachment, prevAttachment, attachmentTrend,
    beverageModifiers, makeItMealModifiers,
  };
}
