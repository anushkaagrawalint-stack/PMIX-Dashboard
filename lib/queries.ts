import { Pool } from '@neondatabase/serverless';
import {
  CHANNEL_SQL,
  GRP_TO_CAT_SQL, ITEM_SUBCAT_SQL, GRP_TO_SUBCAT_SQL,
} from './constants';
import type {
  DateRange, Summary, ChannelRow, WeekRow, DailyRow,
  WeeklyChannelRow, DailyChannelRow,
  ItemRow, ChannelItemRow, LocationItemRow, LocationRow,
  MERow, ModifierRow, PaymentRow, BikkyRow,
  CategoryRow, ChannelCategoryRow,
  RenameRow, NeedsReviewRow,
  OpenItemRow, OpenItemsSummary,
  UncategorizedItemRow,
  FiscalPeriodRow, VendorRow, PinkSheetRow, PinkSheetDetailRow,
} from './types';

function pool() {
  return new Pool({ connectionString: process.env.DATABASE_URL! });
}

// ─── Channel CASE embedded in SQL ─────────────────────────────────────────────
// All queries use this instead of channel_code.
const CH = CHANNEL_SQL;

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
  'Vanilla Mango Lassi Soft Serve':'Lassi','Blossom Lassi':'Lassi',
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

  // Default: last 28 days from latest data
  const end   = new Date(dbMax);
  const start = new Date(dbMax);
  start.setDate(start.getDate() - 27);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end), label: `${fmt(start)} → ${fmt(end)}`, dbMin, dbMax };
}

// ─── Summary KPIs ─────────────────────────────────────────────────────────────
export async function getSummary(dr: DateRange): Promise<Summary> {
  const db = pool();
  const [sumRes, topRes] = await Promise.all([
    db.query(`
      SELECT
        SUM(fol.quantity)::BIGINT                       AS total_qty,
        ROUND(SUM(fol.line_total)::NUMERIC, 2)          AS total_revenue,
        COUNT(DISTINCT fol.canonical_name)::INT         AS unique_items,
        MAX(fol.business_date)::TEXT                    AS last_date
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
      (${CH}) AS channel,
      SUM(fol.quantity)::BIGINT                                        AS qty,
      ROUND(SUM(fol.line_total)::NUMERIC, 2)                          AS revenue,
      ROUND(SUM(fol.line_total)*100.0/NULLIF(g.total,0)::NUMERIC, 1) AS pct
    FROM public.fact_order_lines fol, grand g
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
    SELECT
      DATE_TRUNC('week', fol.business_date)::DATE::TEXT AS week_start,
      ROUND(SUM(fol.line_total)::NUMERIC, 0)            AS revenue,
      SUM(fol.quantity)::BIGINT                         AS qty
    FROM public.fact_order_lines fol
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
    SELECT
      fol.business_date::TEXT                          AS date,
      ROUND(SUM(fol.line_total)::NUMERIC, 0)          AS revenue,
      SUM(fol.quantity)::BIGINT                        AS qty
    FROM public.fact_order_lines fol
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
    SELECT
      DATE_TRUNC('week', fol.business_date)::DATE::TEXT AS week_start,
      (${CH})                                           AS channel,
      ROUND(SUM(fol.line_total)::NUMERIC, 0)            AS revenue,
      SUM(fol.quantity)::BIGINT                         AS qty
    FROM public.fact_order_lines fol
    WHERE ${BASE_WHERE}
      AND fol.business_date BETWEEN $1::DATE AND $2::DATE
    GROUP BY 1, 2
    ORDER BY 1, 2
  `, [dr.start, dr.end]);
  await db.end();
  return rows.map(r => ({
    week_start: r.week_start as string,
    channel:    r.channel    as string,
    revenue:    Number(r.revenue),
    qty:        Number(r.qty),
  }));
}

export async function getDailyByChannel(dr: DateRange): Promise<DailyChannelRow[]> {
  const db = pool();
  const { rows } = await db.query(`
    SELECT
      fol.business_date::TEXT                          AS date,
      (${CH})                                          AS channel,
      ROUND(SUM(fol.line_total)::NUMERIC, 0)          AS revenue,
      SUM(fol.quantity)::BIGINT                        AS qty
    FROM public.fact_order_lines fol
    WHERE ${BASE_WHERE}
      AND fol.business_date BETWEEN $1::DATE AND $2::DATE
    GROUP BY 1, 2
    ORDER BY 1, 2
  `, [dr.start, dr.end]);
  await db.end();
  return rows.map(r => ({
    date:    r.date    as string,
    channel: r.channel as string,
    revenue: Number(r.revenue),
    qty:     Number(r.qty),
  }));
}

// ─── Items ────────────────────────────────────────────────────────────────────
export async function getItems(dr: DateRange): Promise<ItemRow[]> {
  const db = pool();
  const { rows } = await db.query(`
    WITH grand AS (
      SELECT SUM(fol.line_total) AS total_rev, SUM(fol.quantity) AS total_qty
      FROM public.fact_order_lines fol
      WHERE ${BASE_WHERE}
        AND fol.business_date BETWEEN $1::DATE AND $2::DATE
    )
    SELECT
      fol.canonical_name,
      fol.menu_name,
      COALESCE(fol.menu_group, '')                                        AS menu_group,
      (${CH})                                                             AS channel,
      ${IS_OPEN}                                                          AS is_open_item,
      SUM(fol.quantity)::BIGINT                                           AS qty,
      ROUND(SUM(fol.line_total)::NUMERIC, 2)                             AS revenue,
      ROUND(SUM(fol.line_total)/NULLIF(SUM(fol.quantity),0)::NUMERIC, 2) AS avg_price,
      ROUND(SUM(fol.line_total)*100.0/NULLIF(g.total_rev,0)::NUMERIC, 2) AS revenue_pct,
      ROUND(SUM(fol.quantity)*100.0/NULLIF(g.total_qty,0)::NUMERIC, 2)   AS qty_pct,
      ${CAT1}                                                             AS category,
      ${CAT2}                                                             AS sub_category
    FROM public.fact_order_lines fol
    ${IL_JOIN}
    , grand g
    WHERE ${BASE_WHERE}
      AND fol.business_date BETWEEN $1::DATE AND $2::DATE
    GROUP BY
      fol.canonical_name, fol.menu_name, fol.menu_group,
      mlt.modifier_name,
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
    avg_price:      Number(r.avg_price),
    revenue_pct:    Number(r.revenue_pct),
    qty_pct:        Number(r.qty_pct),
    category:       r.category as string,
    sub_category:   r.sub_category as string,
  }));
}

// ─── Per-channel item breakdown (for channel filter recompute) ────────────────
export async function getChannelItems(dr: DateRange): Promise<ChannelItemRow[]> {
  const db = pool();
  const { rows } = await db.query(`
    SELECT
      fol.canonical_name,
      (${CH}) AS channel,
      SUM(fol.quantity)::BIGINT             AS qty,
      ROUND(SUM(fol.line_total)::NUMERIC,2) AS revenue
    FROM public.fact_order_lines fol
    WHERE ${BASE_WHERE}
      AND fol.business_date BETWEEN $1::DATE AND $2::DATE
    GROUP BY fol.canonical_name, 2
    ORDER BY revenue DESC
  `, [dr.start, dr.end]);
  await db.end();
  return rows.map(r => ({
    canonical_name: r.canonical_name as string,
    channel:        r.channel        as string,
    qty:            Number(r.qty),
    revenue:        Number(r.revenue),
  }));
}

// ─── Location items ───────────────────────────────────────────────────────────
export async function getLocationItems(dr: DateRange): Promise<LocationItemRow[]> {
  const db = pool();
  const { rows } = await db.query(`
    WITH loc_totals AS (
      SELECT location_code, SUM(quantity) AS loc_qty
      FROM public.fact_order_lines fol
      WHERE ${BASE_WHERE}
        AND fol.business_date BETWEEN $1::DATE AND $2::DATE
      GROUP BY location_code
    )
    SELECT
      fol.canonical_name,
      fol.location_code,
      SUM(fol.quantity)::BIGINT                                          AS qty,
      ROUND(SUM(fol.line_total)::NUMERIC, 2)                            AS revenue,
      ROUND(SUM(fol.quantity)*100.0/NULLIF(lt.loc_qty,0)::NUMERIC, 2)  AS mix_pct
    FROM public.fact_order_lines fol
    JOIN loc_totals lt ON lt.location_code = fol.location_code
    WHERE ${BASE_WHERE}
      AND fol.business_date BETWEEN $1::DATE AND $2::DATE
    GROUP BY fol.canonical_name, fol.location_code, lt.loc_qty
    ORDER BY fol.canonical_name, fol.location_code
  `, [dr.start, dr.end]);
  await db.end();
  return rows.map(r => ({
    canonical_name: r.canonical_name as string,
    location_code:  r.location_code  as string,
    qty:            Number(r.qty),
    revenue:        Number(r.revenue),
    mix_pct:        Number(r.mix_pct),
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
  return rows.map(r => ({
    location_code: r.location_code as string,
    display_name:  r.display_name  as string,
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
        (${CH})      AS channel,
        ${CAT1}      AS category,
        fol.line_total
      FROM public.fact_order_lines fol
      ${IL_JOIN}
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
      WHERE ${BASE_WHERE}
        AND fol.menu_name IN ('CATERING','CATERING - 3PD')
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
      WHERE ${BASE_WHERE}
        AND fol.menu_name = 'OFFSITE POP-UPS'
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
    -- BYO_NAME_MAP: DB short names → PMIX clean names (AppScript Step 3 Clean MB)
    byo_fix(raw, clean) AS (VALUES
      ('Grain Bowl',                'BYO Grain Bowl'),
      ('Salad Bowl',                'BYO Salad Bowl'),
      ('Greens + Grains Bowl',      'BYO Greens + Grains Bowl'),
      ('Cauliflower + Quinoa',      'Spiced Cauli + Quinoa Bowl'),
      ('Cauliflower + Quinoa Bowl', 'Spiced Cauli + Quinoa Bowl'),
      ('Kids BYO',                  'Kids Meal'),
      ('Burrito',                   'BYO Indian Burrito')
    ),

    -- Step 1/3: Channel-tagged sales per item × period
    -- Only known menu_names → channels IH / LO / 3PD
    -- Open items (no menu_name) excluded — AppScript skips rows with no menu
    cs AS (
      SELECT
        COALESCE(bf.clean, fol.canonical_name)                                AS canonical_name,
        MIN(fol.menu_group)                                                    AS menu_group,
        CASE
          WHEN fol.menu_name IN ('FOOD - IN HOUSE','DRINKS - IN HOUSE') THEN 'IH'
          WHEN fol.menu_name IN ('APP','FOOD - TOAST ONLINE ORDERING')  THEN 'LO'
          WHEN fol.menu_name IN ('DELIVERY','3PD OPEN MARKUP')          THEN '3PD'
        END                                                                    AS channel,
        'P'||LPAD(fp.period::TEXT,2,'0')||'-'||fp.fiscal_year::TEXT            AS cost_period,
        SUM(fol.quantity)                                                       AS qty,
        SUM(fol.pre_discount)                                                   AS gross_sales,
        SUM(fol.line_total)                                                     AS net_sales
      FROM public.fact_order_lines fol
      LEFT JOIN byo_fix bf ON bf.raw = fol.canonical_name
      LEFT JOIN public.dim_fiscal_period fp
             ON fol.business_date >  fp.start_date::DATE
            AND fol.business_date <= fp.end_date::DATE
      WHERE NOT fol.is_voided
        AND NOT fol.is_deferred
        AND fol.menu_name IN (
          'FOOD - IN HOUSE','DRINKS - IN HOUSE',
          'APP','FOOD - TOAST ONLINE ORDERING',
          'DELIVERY','3PD OPEN MARKUP'
        )
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
      WHERE menu IN ('FOOD - IN HOUSE','DRINKS - IN HOUSE') AND avg_cost > 0
      ORDER BY item_name_updated, period
    ),
    ih_base_latest AS (
      SELECT DISTINCT ON (item_name_updated)
        item_name_updated, avg_cost
      FROM analytics.r365_item_cost
      WHERE menu IN ('FOOD - IN HOUSE','DRINKS - IN HOUSE') AND avg_cost > 0
      ORDER BY item_name_updated, period DESC
    ),
    online_base AS (
      SELECT DISTINCT ON (item_name_updated, period)
        item_name_updated, period, avg_cost
      FROM analytics.r365_item_cost
      WHERE menu IN ('DELIVERY','3PD OPEN MARKUP') AND avg_cost > 0
      ORDER BY item_name_updated, period
    ),
    online_base_latest AS (
      SELECT DISTINCT ON (item_name_updated)
        item_name_updated, avg_cost
      FROM analytics.r365_item_cost
      WHERE menu IN ('DELIVERY','3PD OPEN MARKUP') AND avg_cost > 0
      ORDER BY item_name_updated, period DESC
    ),
    any_base AS (
      SELECT DISTINCT ON (item_name_updated, period)
        item_name_updated, period, avg_cost
      FROM analytics.r365_item_cost
      WHERE avg_cost > 0
      ORDER BY item_name_updated, period
    ),
    any_base_latest AS (
      SELECT DISTINCT ON (item_name_updated)
        item_name_updated, avg_cost
      FROM analytics.r365_item_cost
      WHERE avg_cost > 0
      ORDER BY item_name_updated, period DESC
    ),

    -- Step 3: Modifier unit costs from r365_modifier_cost (MI rows = menu item recipes)
    rmc AS (
      SELECT DISTINCT ON (clean_name, period)
        clean_name, period, cost_per_portion
      FROM analytics.r365_modifier_cost
      WHERE recipe_name LIKE 'MI %' AND cost_per_portion > 0
      ORDER BY clean_name, period
    ),
    rmc_latest AS (
      SELECT DISTINCT ON (clean_name)
        clean_name, cost_per_portion
      FROM analytics.r365_modifier_cost
      WHERE recipe_name LIKE 'MI %' AND cost_per_portion > 0
      ORDER BY clean_name, period DESC
    ),
    extra_costs AS (
      SELECT 'Extra ' || clean_name AS extra_name, cost_per_portion FROM rmc_latest
    ),
    organic_costs AS (
      SELECT 'Organic ' || clean_name AS organic_name, cost_per_portion FROM rmc_latest
    ),
    side_costs AS (
      SELECT clean_name || ' - Side' AS side_name, cost_per_portion FROM rmc_latest
    ),

    -- Online modifier cost per item × period (LO+3PD orders only)
    cmc AS (
      SELECT
        COALESCE(bf.clean, fol.canonical_name)                                AS parent_item,
        'P'||LPAD(fp.period::TEXT,2,'0')||'-'||fp.fiscal_year::TEXT            AS cost_period,
        SUM(fm.quantity * COALESCE(
          (SELECT r.cost_per_portion FROM rmc r
           WHERE r.clean_name = fm.canonical_name
             AND r.period = 'P'||LPAD(fp.period::TEXT,2,'0')||'-'||fp.fiscal_year::TEXT
           LIMIT 1),
          (SELECT r.cost_per_portion FROM rmc_latest r WHERE r.clean_name = fm.canonical_name),
          (SELECT r.cost_per_portion FROM extra_costs r WHERE r.extra_name = fm.canonical_name),
          (SELECT r.cost_per_portion FROM organic_costs r WHERE r.organic_name = fm.canonical_name),
          (SELECT r.cost_per_portion FROM side_costs r WHERE r.side_name = fm.canonical_name),
          0
        ))                                                                     AS total_mod_cost
      FROM public.fact_modifiers fm
      JOIN public.fact_order_lines fol ON fm.parent_selection = fol.selection_guid
      LEFT JOIN byo_fix bf ON bf.raw = fol.canonical_name
      LEFT JOIN public.dim_fiscal_period fp
             ON fol.business_date >  fp.start_date::DATE
            AND fol.business_date <= fp.end_date::DATE
      WHERE NOT fol.is_voided
        AND NOT fol.is_deferred
        AND NOT fm.is_voided
        AND fol.menu_name IN (
          'APP','FOOD - TOAST ONLINE ORDERING',
          'DELIVERY','3PD OPEN MARKUP'
        )
        AND (
          UPPER(fol.menu_group) IN (
            'BOWLS','BUILD YOUR OWN BOWL','BYO','CHEF CURATED BOWLS',
            'PLATES','CLASSIC INDIAN PLATES',
            'BURRITOS','INDIAN BURRITOS',
            'KIDS','KIDS MEAL'
          )
          OR fol.canonical_name IN (
            'Side of Main','Side of Grain','Side of Sauce','Side of Veggie',
            'Homemade Juice','Handcrafted Juice for a Group - 1/2 Gallon'
          )
        )
        AND fol.business_date BETWEEN $1::DATE AND $2::DATE
        AND fm.canonical_name NOT ILIKE '1/2 %'
        -- Include modifier if it has a valid (non-excluded) type, OR if it has no entry at all
        AND (
          EXISTS (
            SELECT 1 FROM analytics.modifier_type
            WHERE modifier_name = fm.canonical_name
              AND modifier_type NOT LIKE 'Catering%'
              AND modifier_type NOT IN ('NA','ZeroCater','Plate - Main','Online')
          )
          OR NOT EXISTS (
            SELECT 1 FROM analytics.modifier_type WHERE modifier_name = fm.canonical_name
          )
          OR fm.canonical_name = 'That Fire Hot Sauce'
        )
      GROUP BY COALESCE(bf.clean, fol.canonical_name), cost_period
    ),

    -- IH modifier cost per item × period
    cmc_ih AS (
      SELECT
        COALESCE(bf.clean, fol.canonical_name)                                AS parent_item,
        'P'||LPAD(fp.period::TEXT,2,'0')||'-'||fp.fiscal_year::TEXT            AS cost_period,
        SUM(fm.quantity * COALESCE(
          (SELECT r.cost_per_portion FROM rmc r
           WHERE r.clean_name = fm.canonical_name
             AND r.period = 'P'||LPAD(fp.period::TEXT,2,'0')||'-'||fp.fiscal_year::TEXT
           LIMIT 1),
          (SELECT r.cost_per_portion FROM rmc_latest r WHERE r.clean_name = fm.canonical_name),
          (SELECT r.cost_per_portion FROM extra_costs r WHERE r.extra_name = fm.canonical_name),
          (SELECT r.cost_per_portion FROM organic_costs r WHERE r.organic_name = fm.canonical_name),
          (SELECT r.cost_per_portion FROM side_costs r WHERE r.side_name = fm.canonical_name),
          0
        ))                                                                     AS total_ih_mod_cost
      FROM public.fact_modifiers fm
      JOIN public.fact_order_lines fol ON fm.parent_selection = fol.selection_guid
      LEFT JOIN byo_fix bf ON bf.raw = fol.canonical_name
      LEFT JOIN public.dim_fiscal_period fp
             ON fol.business_date >  fp.start_date::DATE
            AND fol.business_date <= fp.end_date::DATE
      WHERE NOT fol.is_voided
        AND NOT fol.is_deferred
        AND NOT fm.is_voided
        AND fol.menu_name IN ('FOOD - IN HOUSE','DRINKS - IN HOUSE')
        AND (
          UPPER(fol.menu_group) IN (
            'BOWLS','BUILD YOUR OWN BOWL','BYO','CHEF CURATED BOWLS',
            'PLATES','CLASSIC INDIAN PLATES',
            'BURRITOS','INDIAN BURRITOS',
            'KIDS','KIDS MEAL'
          )
          OR fol.canonical_name IN (
            'Side of Main','Side of Grain','Side of Sauce','Side of Veggie',
            'Homemade Juice','Handcrafted Juice for a Group - 1/2 Gallon'
          )
        )
        AND fol.business_date BETWEEN $1::DATE AND $2::DATE
        AND fm.canonical_name NOT ILIKE '1/2 %'
        AND (
          EXISTS (
            SELECT 1 FROM analytics.modifier_type
            WHERE modifier_name = fm.canonical_name
              AND modifier_type NOT LIKE 'Catering%'
              AND modifier_type NOT IN ('NA','ZeroCater','Plate - Main','Online')
          )
          OR NOT EXISTS (
            SELECT 1 FROM analytics.modifier_type WHERE modifier_name = fm.canonical_name
          )
          OR fm.canonical_name = 'That Fire Hot Sauce'
        )
      GROUP BY COALESCE(bf.clean, fol.canonical_name), cost_period
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
            THEN COALESCE(ib.avg_cost, ibl.avg_cost, ab.avg_cost, abl.avg_cost, 0)
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
      LEFT JOIN ih_base           ib  ON ib.item_name_updated  = cs.canonical_name AND ib.period  = cs.cost_period
      LEFT JOIN ih_base_latest    ibl ON ibl.item_name_updated = cs.canonical_name
      LEFT JOIN online_base       ob  ON ob.item_name_updated  = cs.canonical_name AND ob.period  = cs.cost_period
      LEFT JOIN online_base_latest obl ON obl.item_name_updated = cs.canonical_name
      LEFT JOIN any_base          ab  ON ab.item_name_updated  = cs.canonical_name AND ab.period  = cs.cost_period
      LEFT JOIN any_base_latest   abl ON abl.item_name_updated = cs.canonical_name
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
    -- avg_price = pre_discount / qty (gross_sales / qty) — no price markup needed,
    --   3PD OPEN MARKUP menu prices already include the 3PD premium
    -- avg_cost 3PD = online_pink_cost × 1.18 (packaging/delivery cost uplift)
    pivoted AS (
      SELECT
        canonical_name,
        MIN(menu_group)   AS menu_group,
        SUM(qty)          AS qty,
        -- blended net sales (gross_sales = pre-discount, matches AppScript ns = ap×qty)
        SUM(gross_sales)                                                       AS net_sales,
        -- blended total cost: 3PD cost × 1.18
        SUM(CASE WHEN channel='3PD' THEN total_cost * 1.18 ELSE total_cost END) AS total_cost,
        -- per-channel quantities
        SUM(CASE WHEN channel='IH'  THEN qty  ELSE 0 END) AS qty_ih,
        SUM(CASE WHEN channel='LO'  THEN qty  ELSE 0 END) AS qty_lo,
        SUM(CASE WHEN channel='3PD' THEN qty  ELSE 0 END) AS qty_3pd,
        -- per-channel revenues (pre-discount, no price markup)
        SUM(CASE WHEN channel='IH'  THEN gross_sales ELSE 0 END) AS net_sales_ih,
        SUM(CASE WHEN channel='LO'  THEN gross_sales ELSE 0 END) AS net_sales_lo,
        SUM(CASE WHEN channel='3PD' THEN gross_sales ELSE 0 END) AS net_sales_3pd,
        -- per-channel total costs (3PD ×1.18)
        SUM(CASE WHEN channel='IH'  THEN total_cost        ELSE 0 END) AS total_cost_ih,
        SUM(CASE WHEN channel='LO'  THEN total_cost        ELSE 0 END) AS total_cost_lo,
        SUM(CASE WHEN channel='3PD' THEN total_cost * 1.18 ELSE 0 END) AS total_cost_3pd,
        -- BL (LO+3PD) combined
        SUM(CASE WHEN channel IN ('LO','3PD') THEN qty ELSE 0 END) AS qty_bl,
        SUM(CASE WHEN channel IN ('LO','3PD') THEN gross_sales ELSE 0 END) AS net_sales_bl,
        SUM(CASE WHEN channel='LO'  THEN total_cost
                 WHEN channel='3PD' THEN total_cost * 1.18 ELSE 0 END) AS total_cost_bl,
        -- blended avg price: gross_sales / qty (qty-weighted)
        SUM(gross_sales) / NULLIF(SUM(qty),0)                              AS avg_price,
        -- blended avg cost (qty-weighted; 3PD ×1.18)
        SUM(CASE WHEN channel='3PD' THEN total_cost * 1.18 ELSE total_cost END)
          / NULLIF(SUM(qty),0)                                             AS avg_cost,
        -- per-channel avg price (gross_sales / qty)
        SUM(CASE WHEN channel='IH'  THEN gross_sales ELSE 0 END)
          / NULLIF(SUM(CASE WHEN channel='IH'  THEN qty ELSE 0 END),0)    AS avg_price_ih,
        SUM(CASE WHEN channel='LO'  THEN gross_sales ELSE 0 END)
          / NULLIF(SUM(CASE WHEN channel='LO'  THEN qty ELSE 0 END),0)    AS avg_price_lo,
        SUM(CASE WHEN channel='3PD' THEN gross_sales ELSE 0 END)
          / NULLIF(SUM(CASE WHEN channel='3PD' THEN qty ELSE 0 END),0)    AS avg_price_3pd,
        SUM(CASE WHEN channel IN ('LO','3PD') THEN gross_sales ELSE 0 END)
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
      ROUND(p.net_sales::NUMERIC,    2)                                        AS net_sales,
      ROUND(p.avg_price::NUMERIC,    2)                                        AS avg_price,
      ROUND(p.avg_cost::NUMERIC,     4)                                        AS avg_cost,
      ROUND(p.total_cost::NUMERIC,   2)                                        AS total_cost,
      ROUND((p.net_sales - p.total_cost)::NUMERIC, 2)                          AS total_margin,
      COALESCE(p.qty_ih,  0)::BIGINT                                           AS qty_ih,
      COALESCE(p.qty_lo,  0)::BIGINT                                           AS qty_lo,
      COALESCE(p.qty_3pd, 0)::BIGINT                                           AS qty_3pd,
      ROUND(COALESCE(p.net_sales_ih,  0)::NUMERIC, 2)                          AS net_sales_ih,
      ROUND(COALESCE(p.net_sales_lo,  0)::NUMERIC, 2)                          AS net_sales_lo,
      ROUND(COALESCE(p.net_sales_3pd, 0)::NUMERIC, 2)                          AS net_sales_3pd,
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
      ROUND(COALESCE(p.net_sales_bl,  0)::NUMERIC, 2)                          AS net_sales_bl,
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
    byo_fix(raw, clean) AS (VALUES
      ('Grain Bowl',                'BYO Grain Bowl'),
      ('Salad Bowl',                'BYO Salad Bowl'),
      ('Greens + Grains Bowl',      'BYO Greens + Grains Bowl'),
      ('Cauliflower + Quinoa',      'Spiced Cauli + Quinoa Bowl'),
      ('Cauliflower + Quinoa Bowl', 'Spiced Cauli + Quinoa Bowl'),
      ('Kids BYO',                  'Kids Meal'),
      ('Burrito',                   'BYO Indian Burrito')
    ),
    rmc AS (
      SELECT DISTINCT ON (clean_name, period) clean_name, period, cost_per_portion
      FROM analytics.r365_modifier_cost
      WHERE recipe_name LIKE 'MI %' AND cost_per_portion > 0
      ORDER BY clean_name, period
    ),
    rmc_latest AS (
      SELECT DISTINCT ON (clean_name) clean_name, cost_per_portion
      FROM analytics.r365_modifier_cost
      WHERE recipe_name LIKE 'MI %' AND cost_per_portion > 0
      ORDER BY clean_name, period DESC
    ),
    -- "Extra X" → cost of "X": avoids REGEXP_REPLACE which is unreliable for this pattern
    extra_costs AS (
      SELECT 'Extra ' || clean_name AS extra_name, cost_per_portion
      FROM rmc_latest
    ),
    -- "Organic X" → cost of "X" (mirrors AppScript bOrganic fallback)
    organic_costs AS (
      SELECT 'Organic ' || clean_name AS organic_name, cost_per_portion
      FROM rmc_latest
    ),
    -- "X - Side" → cost of "X" (mirrors AppScript bSide fallback)
    side_costs AS (
      SELECT clean_name || ' - Side' AS side_name, cost_per_portion
      FROM rmc_latest
    ),
    -- True online order qty per parent item — NOT from the modifier join (that overcounts)
    online_orders AS (
      SELECT
        COALESCE(bf.clean, fol.canonical_name) AS parent_item,
        MIN(fol.menu_group)                    AS menu_group,
        SUM(fol.quantity)                      AS online_qty
      FROM public.fact_order_lines fol
      LEFT JOIN byo_fix bf ON bf.raw = fol.canonical_name
      WHERE NOT fol.is_voided AND NOT fol.is_deferred
        AND fol.menu_name IN ('APP','FOOD - TOAST ONLINE ORDERING','DELIVERY','3PD OPEN MARKUP')
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
      WHERE NOT fol.is_voided AND NOT fol.is_deferred
        AND fol.menu_name IN ('FOOD - IN HOUSE','DRINKS - IN HOUSE')
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
    -- Shared modifier cost subquery (used by both cmc and cmc_ih)
    -- Online modifier cost
    cmc AS (
      SELECT
        COALESCE(bf.clean, fol.canonical_name) AS parent_item,
        SUM(fm.quantity * COALESCE(
          (SELECT r.cost_per_portion FROM rmc r
           WHERE r.clean_name = fm.canonical_name
             AND r.period = 'P'||LPAD(fp.period::TEXT,2,'0')||'-'||fp.fiscal_year::TEXT
           LIMIT 1),
          (SELECT r.cost_per_portion FROM rmc_latest r WHERE r.clean_name = fm.canonical_name),
          (SELECT r.cost_per_portion FROM extra_costs r WHERE r.extra_name = fm.canonical_name),
          (SELECT r.cost_per_portion FROM organic_costs r WHERE r.organic_name = fm.canonical_name),
          (SELECT r.cost_per_portion FROM side_costs r WHERE r.side_name = fm.canonical_name),
          0
        ))                                     AS total_mod_cost
      FROM public.fact_modifiers fm
      JOIN public.fact_order_lines fol ON fm.parent_selection = fol.selection_guid
      LEFT JOIN byo_fix bf ON bf.raw = fol.canonical_name
      LEFT JOIN public.dim_fiscal_period fp
             ON fol.business_date > fp.start_date::DATE
            AND fol.business_date <= fp.end_date::DATE
      WHERE NOT fol.is_voided AND NOT fol.is_deferred AND NOT fm.is_voided
        AND fol.menu_name IN ('APP','FOOD - TOAST ONLINE ORDERING','DELIVERY','3PD OPEN MARKUP')
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
        AND fm.canonical_name NOT ILIKE '1/2 %'
        AND (
          EXISTS (
            SELECT 1 FROM analytics.modifier_type
            WHERE modifier_name = fm.canonical_name
              AND modifier_type NOT LIKE 'Catering%'
              AND modifier_type NOT IN ('NA','ZeroCater','Plate - Main','Online')
          )
          OR NOT EXISTS (
            SELECT 1 FROM analytics.modifier_type WHERE modifier_name = fm.canonical_name
          )
          OR fm.canonical_name = 'That Fire Hot Sauce'
        )
      GROUP BY COALESCE(bf.clean, fol.canonical_name)
    ),
    -- IH modifier cost (same formula, IH menus only)
    cmc_ih AS (
      SELECT
        COALESCE(bf.clean, fol.canonical_name) AS parent_item,
        SUM(fm.quantity * COALESCE(
          (SELECT r.cost_per_portion FROM rmc r
           WHERE r.clean_name = fm.canonical_name
             AND r.period = 'P'||LPAD(fp.period::TEXT,2,'0')||'-'||fp.fiscal_year::TEXT
           LIMIT 1),
          (SELECT r.cost_per_portion FROM rmc_latest r WHERE r.clean_name = fm.canonical_name),
          (SELECT r.cost_per_portion FROM extra_costs r WHERE r.extra_name = fm.canonical_name),
          (SELECT r.cost_per_portion FROM organic_costs r WHERE r.organic_name = fm.canonical_name),
          (SELECT r.cost_per_portion FROM side_costs r WHERE r.side_name = fm.canonical_name),
          0
        ))                                     AS total_ih_mod_cost
      FROM public.fact_modifiers fm
      JOIN public.fact_order_lines fol ON fm.parent_selection = fol.selection_guid
      LEFT JOIN byo_fix bf ON bf.raw = fol.canonical_name
      LEFT JOIN public.dim_fiscal_period fp
             ON fol.business_date > fp.start_date::DATE
            AND fol.business_date <= fp.end_date::DATE
      WHERE NOT fol.is_voided AND NOT fol.is_deferred AND NOT fm.is_voided
        AND fol.menu_name IN ('FOOD - IN HOUSE','DRINKS - IN HOUSE')
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
        AND fm.canonical_name NOT ILIKE '1/2 %'
        AND (
          EXISTS (
            SELECT 1 FROM analytics.modifier_type
            WHERE modifier_name = fm.canonical_name
              AND modifier_type NOT LIKE 'Catering%'
              AND modifier_type NOT IN ('NA','ZeroCater','Plate - Main','Online')
          )
          OR NOT EXISTS (
            SELECT 1 FROM analytics.modifier_type WHERE modifier_name = fm.canonical_name
          )
          OR fm.canonical_name = 'That Fire Hot Sauce'
        )
      GROUP BY COALESCE(bf.clean, fol.canonical_name)
    ),
    ih_base AS (
      SELECT DISTINCT ON (item_name_updated) item_name_updated, avg_cost
      FROM analytics.r365_item_cost
      WHERE menu IN ('FOOD - IN HOUSE','DRINKS - IN HOUSE') AND avg_cost > 0
      ORDER BY item_name_updated, period DESC
    ),
    online_base AS (
      SELECT DISTINCT ON (item_name_updated) item_name_updated, avg_cost
      FROM analytics.r365_item_cost
      WHERE menu IN ('DELIVERY','3PD OPEN MARKUP') AND avg_cost > 0
      ORDER BY item_name_updated, period DESC
    ),
    any_base AS (
      SELECT DISTINCT ON (item_name_updated) item_name_updated, avg_cost
      FROM analytics.r365_item_cost WHERE avg_cost > 0
      ORDER BY item_name_updated, period DESC
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

    SELECT
      ai.parent_item                                   AS canonical_name,
      ai.menu_group,
      COALESCE(ib.avg_cost, 0)                         AS base_cost_ih,
      COALESCE(ob.avg_cost, ab.avg_cost, 0)            AS base_cost_online,
      ROUND(COALESCE(c.total_mod_cost, 0)::NUMERIC, 4)    AS total_mod_cost,
      ROUND(COALESCE(cih.total_ih_mod_cost, 0)::NUMERIC, 4) AS total_ih_mod_cost,
      ai.online_qty::BIGINT                                AS online_qty,
      ai.ih_qty::BIGINT                                    AS ih_qty,
      -- avg_cost_ih now includes modifier adder (same formula as online)
      ROUND((COALESCE(ib.avg_cost, ab.avg_cost, 0)
        + COALESCE(cih.total_ih_mod_cost, 0) / NULLIF(ai.ih_qty, 0))::NUMERIC, 4) AS avg_cost_ih,
      ROUND((COALESCE(ob.avg_cost, ab.avg_cost, 0)
        + COALESCE(c.total_mod_cost, 0) / NULLIF(ai.online_qty, 0))::NUMERIC, 4) AS avg_cost_online,
      ROUND((COALESCE(ob.avg_cost, ab.avg_cost, 0)
        + COALESCE(c.total_mod_cost, 0) / NULLIF(ai.online_qty, 0)) * 1.18::NUMERIC, 4) AS avg_cost_3pd
    FROM all_items ai
    LEFT JOIN cmc     c   ON c.parent_item   = ai.parent_item
    LEFT JOIN cmc_ih  cih ON cih.parent_item = ai.parent_item
    LEFT JOIN ih_base     ib ON ib.item_name_updated = ai.parent_item
    LEFT JOIN online_base ob ON ob.item_name_updated = ai.parent_item
    LEFT JOIN any_base    ab ON ab.item_name_updated = ai.parent_item
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
    byo_fix(raw, clean) AS (VALUES
      ('Grain Bowl',                'BYO Grain Bowl'),
      ('Salad Bowl',                'BYO Salad Bowl'),
      ('Greens + Grains Bowl',      'BYO Greens + Grains Bowl'),
      ('Cauliflower + Quinoa',      'Spiced Cauli + Quinoa Bowl'),
      ('Cauliflower + Quinoa Bowl', 'Spiced Cauli + Quinoa Bowl'),
      ('Kids BYO',                  'Kids Meal'),
      ('Burrito',                   'BYO Indian Burrito')
    ),
    rmc AS (
      SELECT DISTINCT ON (clean_name, period) clean_name, period, cost_per_portion
      FROM analytics.r365_modifier_cost
      WHERE recipe_name LIKE 'MI %' AND cost_per_portion > 0
      ORDER BY clean_name, period
    ),
    rmc_latest AS (
      SELECT DISTINCT ON (clean_name) clean_name, cost_per_portion
      FROM analytics.r365_modifier_cost
      WHERE recipe_name LIKE 'MI %' AND cost_per_portion > 0
      ORDER BY clean_name, period DESC
    ),
    extra_costs AS (
      SELECT 'Extra ' || clean_name AS extra_name, cost_per_portion
      FROM rmc_latest
    ),
    organic_costs AS (
      SELECT 'Organic ' || clean_name AS organic_name, cost_per_portion
      FROM rmc_latest
    ),
    side_costs AS (
      SELECT clean_name || ' - Side' AS side_name, cost_per_portion
      FROM rmc_latest
    )
    SELECT
      COALESCE(bf.clean, fol.canonical_name)   AS parent_item,
      mt.modifier_type                          AS section,
      fm.canonical_name                         AS modifier_name,
      CASE WHEN fol.menu_name IN ('APP','FOOD - TOAST ONLINE ORDERING','DELIVERY','3PD OPEN MARKUP')
           THEN 'online' ELSE 'ih' END         AS channel,
      SUM(fm.quantity)::BIGINT                  AS qty,
      -- total_cost: Σ(qty × period_cost); Extra Main/etc fall back to base-item cost
      ROUND(SUM(fm.quantity * COALESCE(
        (SELECT r.cost_per_portion FROM rmc r
         WHERE r.clean_name = fm.canonical_name
           AND r.period = 'P'||LPAD(fp.period::TEXT,2,'0')||'-'||fp.fiscal_year::TEXT
         LIMIT 1),
        (SELECT r.cost_per_portion FROM rmc_latest r WHERE r.clean_name = fm.canonical_name),
        (SELECT r.cost_per_portion FROM extra_costs r WHERE r.extra_name = fm.canonical_name),
        (SELECT r.cost_per_portion FROM organic_costs r WHERE r.organic_name = fm.canonical_name),
        (SELECT r.cost_per_portion FROM side_costs r WHERE r.side_name = fm.canonical_name),
        0
      ))::NUMERIC, 4)                           AS total_cost
    FROM public.fact_modifiers fm
    JOIN public.fact_order_lines fol ON fm.parent_selection = fol.selection_guid
    LEFT JOIN byo_fix bf ON bf.raw = fol.canonical_name
    LEFT JOIN (
      SELECT DISTINCT ON (parent_item) parent_item, item_type
      FROM analytics.parent_item_type ORDER BY parent_item, item_type
    ) pit ON pit.parent_item = fol.canonical_name
    -- Prefer exact item_type match; fall back to any item_type; fallback 'Make It Meal' for juice/drink
    -- items whose modifiers are not in analytics.modifier_type; NULL = explicitly excluded type (NA/Catering)
    CROSS JOIN LATERAL (
      SELECT COALESCE(
        (SELECT amt.modifier_type FROM analytics.modifier_type amt
         WHERE amt.modifier_name = fm.canonical_name
           AND amt.modifier_type NOT LIKE 'Catering%'
           AND amt.modifier_type NOT IN ('NA','ZeroCater','Plate - Main','Online')
         ORDER BY (amt.item_type = pit.item_type) DESC NULLS LAST
         LIMIT 1),
        -- That Fire Hot Sauce is classified as 'Online' in modifier_type table but is a real sauce modifier
        CASE WHEN LOWER(fm.canonical_name) = 'that fire hot sauce' THEN 'Sauce' END,
        CASE WHEN NOT EXISTS (
          SELECT 1 FROM analytics.modifier_type WHERE modifier_name = fm.canonical_name
        ) THEN pit.item_type END
      ) AS modifier_type
    ) mt
    LEFT JOIN public.dim_fiscal_period fp
           ON fol.business_date > fp.start_date::DATE
          AND fol.business_date <= fp.end_date::DATE
    WHERE NOT fol.is_voided AND NOT fol.is_deferred AND NOT fm.is_voided
      AND fol.menu_name IN (
        'APP','FOOD - TOAST ONLINE ORDERING','DELIVERY','3PD OPEN MARKUP',
        'FOOD - IN HOUSE','DRINKS - IN HOUSE'
      )
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
      AND mt.modifier_type IS NOT NULL
    GROUP BY
      COALESCE(bf.clean, fol.canonical_name), mt.modifier_type, fm.canonical_name,
      CASE WHEN fol.menu_name IN ('APP','FOOD - TOAST ONLINE ORDERING','DELIVERY','3PD OPEN MARKUP')
           THEN 'online' ELSE 'ih' END
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

// ─── BYO Modifiers ────────────────────────────────────────────────────────────
export async function getModifiers(dr: DateRange): Promise<ModifierRow[]> {
  const db = pool();
  try {
    const { rows } = await db.query(`
      WITH raw_mods AS (
        SELECT
          mt.modifier_type        AS raw_type,
          fm.canonical_name       AS modifier_name,
          fm.quantity             AS quantity,
          fol.canonical_name      AS parent_item
        FROM public.fact_modifiers fm
        JOIN public.fact_order_lines fol ON fm.parent_selection = fol.selection_guid
        JOIN (
          SELECT DISTINCT ON (parent_item) parent_item, item_type
          FROM analytics.parent_item_type
          ORDER BY parent_item, item_type
        ) pit ON pit.parent_item = fol.canonical_name
        JOIN analytics.modifier_type mt
          ON mt.modifier_name = fm.canonical_name
         AND mt.item_type     = pit.item_type
        WHERE ${BASE_WHERE}
          AND NOT fm.is_voided
          AND fol.business_date BETWEEN $1::DATE AND $2::DATE
          AND LOWER(mt.modifier_type) IN ('main','1/2 main','base','1/2 base','veggie','topping','sauce','chutney + dressing')
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
          SUM(quantity) AS qty
        FROM raw_mods
        GROUP BY 1, modifier_name, parent_item
      ),
      type_totals AS (
        SELECT mod_type, parent_item, SUM(qty) AS type_qty FROM byo_mods GROUP BY mod_type, parent_item
      ),
      mod_costs AS (
        SELECT DISTINCT ON (item_name_updated)
          item_name_updated, avg_cost
        FROM analytics.r365_item_cost
        ORDER BY item_name_updated, period DESC
      ),
      -- Full AppScript _getModCost_ pipeline: Skip→0, direct, sauce aliases, 1/2 X→half, Extra X→X
      mod_costs_resolved AS (
        SELECT DISTINCT ON (bm.modifier_name)
          bm.modifier_name,
          CASE
            WHEN bm.modifier_name ILIKE 'Skip %' OR bm.modifier_name ILIKE 'No %'
              THEN 0.0
            ELSE COALESCE(
              -- 1. Direct lookup (case-insensitive)
              mc_direct.avg_cost,
              -- 2. Sauce aliases: Toast display name → R365 recipe name (AppScript SAUCE_ALIASES)
              CASE LOWER(bm.modifier_name)
                WHEN 'tomato garlic (butter masala)' THEN (SELECT avg_cost FROM mod_costs WHERE LOWER(item_name_updated) = 'tomato garlic sauce'         LIMIT 1)
                WHEN 'tikka masala'                  THEN (SELECT avg_cost FROM mod_costs WHERE LOWER(item_name_updated) = 'tikka masala sauce'           LIMIT 1)
                WHEN 'tamarind chili (spicy)'        THEN (SELECT avg_cost FROM mod_costs WHERE LOWER(item_name_updated) = 'tamarind chili sauce'         LIMIT 1)
                WHEN 'peanut sesame'                 THEN (SELECT avg_cost FROM mod_costs WHERE LOWER(item_name_updated) = 'peanut sesame sauce'          LIMIT 1)
                WHEN 'coconut ginger'                THEN (SELECT avg_cost FROM mod_costs WHERE LOWER(item_name_updated) = 'coconut ginger sauce'         LIMIT 1)
                WHEN 'tandoori paneer'               THEN (SELECT avg_cost FROM mod_costs WHERE LOWER(item_name_updated) LIKE '%organic tandoori paneer%' LIMIT 1)
                WHEN 'romaine'                       THEN (SELECT avg_cost FROM mod_costs WHERE LOWER(item_name_updated) LIKE '%shredded romaine%'        LIMIT 1)
                WHEN 'spicy mango chutney'           THEN 0.1777
                ELSE NULL
              END,
              -- 3. "1/2 X" → half cost of "X" (pink sheet rule)
              CASE WHEN bm.modifier_name ILIKE '1/2 %'
                THEN (SELECT avg_cost * 0.5 FROM mod_costs
                      WHERE LOWER(item_name_updated) = LOWER(REGEXP_REPLACE(bm.modifier_name, '^1/2 (and )?', '', 'i'))
                      LIMIT 1)
              END,
              -- 4. "Extra X" → same cost as "X"
              CASE WHEN bm.modifier_name ILIKE 'Extra %'
                THEN (SELECT avg_cost FROM mod_costs
                      WHERE LOWER(item_name_updated) = LOWER(SUBSTR(bm.modifier_name, 7))
                      LIMIT 1)
              END
            )
          END AS avg_cost
        FROM byo_mods bm
        LEFT JOIN mod_costs mc_direct ON LOWER(mc_direct.item_name_updated) = LOWER(bm.modifier_name)
        ORDER BY bm.modifier_name
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
      qty:           Number(r.qty),
      pct:           Number(r.pct),
      avg_cost:      r.avg_cost != null ? Number(r.avg_cost) : null,
    }));
  } catch (err) {
    console.error('getModifiers error:', err);
    await db.end();
    return [];
  }
}

// ─── Payments ─────────────────────────────────────────────────────────────────
export async function getPayments(dr: DateRange): Promise<PaymentRow[]> {
  const db = pool();
  const { rows } = await db.query(`
    WITH grand AS (
      SELECT SUM(amount) AS total
      FROM public.br_order_payment
      WHERE business_date BETWEEN $1::DATE AND $2::DATE
    )
    SELECT
      COALESCE(NULLIF(TRIM(alt_payment_name),''), payment_type, 'Unknown') AS payment_source,
      payment_type,
      COUNT(*)::INT                                                          AS payment_count,
      ROUND(SUM(amount)::NUMERIC, 2)                                        AS total_amount,
      ROUND(SUM(amount)*100.0/NULLIF(g.total,0)::NUMERIC, 1)               AS pct
    FROM public.br_order_payment, grand g
    WHERE business_date BETWEEN $1::DATE AND $2::DATE
    GROUP BY 1, 2, g.total
    ORDER BY total_amount DESC
    LIMIT 30
  `, [dr.start, dr.end]);
  await db.end();
  return rows.map(r => ({
    payment_source: r.payment_source as string,
    payment_count:  Number(r.payment_count),
    total_amount:   Number(r.total_amount),
    pct:            Number(r.pct),
    category:       (r.payment_type as string) === 'CREDIT' ? 'Card' : 'Alt Payment',
  }));
}

// ─── Bikky retention ─────────────────────────────────────────────────────────
export async function getBikky(): Promise<BikkyRow[]> {
  const db = pool();
  try {
    const { rows } = await db.query(`
      SELECT item_name, return_rate, reorder_rate, return_rate_prev, reorder_rate_prev,
             guests, fiscal_year, period, 'instore' AS source
      FROM public.fact_bikky_instore
      UNION ALL
      SELECT item_name, return_rate, reorder_rate, return_rate_prev, reorder_rate_prev,
             guests, fiscal_year, period, '3pd_loyalty' AS source
      FROM public.fact_bikky_3pd_loyalty
      ORDER BY fiscal_year DESC, period DESC, return_rate DESC NULLS LAST
    `);
    await db.end();

    return rows.map(r => ({
      item_name:         r.item_name as string,
      return_rate:       Number(r.return_rate       ?? 0),
      reorder_rate:      Number(r.reorder_rate      ?? 0),
      return_rate_prev:  Number(r.return_rate_prev  ?? 0),
      reorder_rate_prev: Number(r.reorder_rate_prev ?? 0),
      guests:            Number(r.guests            ?? 0),
      period:            `P${String(r.period).padStart(2,'0')} ${r.fiscal_year}`,
      source:            r.source as 'instore' | '3pd_loyalty',
      category:          '',
      revenue:           0,
      qty:               0,
    }));
  } catch (err) {
    console.error('getBikky error:', err);
    await db.end();
    return [];
  }
}

// ─── Renames ──────────────────────────────────────────────────────────────────
export async function getRenames(): Promise<RenameRow[]> {
  const db = pool();
  try {
    const { rows } = await db.query(`
      SELECT
        fol.canonical_name,
        MIN(fol.menu_group)                                              AS menu_group,
        STRING_AGG(DISTINCT fol.menu_name, '|||' ORDER BY fol.menu_name) AS all_names_str,
        COUNT(DISTINCT fol.menu_name)::INT                               AS name_count,
        SUM(fol.quantity)::BIGINT                                        AS lifetime_qty,
        ROUND(SUM(fol.line_total)::NUMERIC, 2)                          AS lifetime_revenue,
        COUNT(DISTINCT fol.location_code)::INT                          AS location_count,
        MIN(fol.business_date)::TEXT                                     AS first_seen
      FROM public.fact_order_lines fol
      WHERE NOT fol.is_voided
        AND fol.canonical_name IS NOT NULL
        AND fol.menu_name IS NOT NULL
      GROUP BY fol.canonical_name
      HAVING COUNT(DISTINCT fol.menu_name) > 1
      ORDER BY lifetime_qty DESC
      LIMIT 50
    `);
    await db.end();

    const db2 = pool();
    const { rows: mltRows3 } = await db2.query(`SELECT DISTINCT modifier_name FROM analytics.modifier_type`);
    await db2.end();
    const mltSet3 = new Set(mltRows3.map(r => r.modifier_name as string));

    return rows.map(r => {
      const name      = r.canonical_name as string;
      const menuGroup = (r.menu_group ?? '') as string;
      const category  = name === 'That Fire Hot Sauce (Bottle)' || name === 'That Fire Hot Sauce - Side'
        ? 'Retail'
        : mltSet3.has(name) ? 'Modifier' : (GRP_TO_CAT_MAP[menuGroup] ?? 'Other');
      return {
        canonical_name:   name,
        all_names:        (r.all_names_str as string).split('|||'),
        category,
        lifetime_qty:     Number(r.lifetime_qty),
        lifetime_revenue: Number(r.lifetime_revenue),
        location_count:   Number(r.location_count),
        first_seen:       r.first_seen as string,
      };
    });
  } catch (err) {
    console.error('getRenames error:', err);
    await db.end();
    return [];
  }
}

// ─── Needs Review ────────────────────────────────────────────────────────────
// Items where the derived channel (menu_name) and channel_code disagree,
// or where alt_payment_name contradicts the menu_name channel.
export async function getNeedsReview(dr: DateRange): Promise<NeedsReviewRow[]> {
  const db = pool();
  try {
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
      SELECT DISTINCT ON (fol.order_guid)
        fol.order_guid,
        fol.location_code                                    AS location,
        fol.business_date::TEXT                              AS business_date,
        (${CH})                                              AS current_channel,
        fol.dining_option,
        os.amount,
        os.item_count,
        COALESCE(p.alt_payment_name,'')                      AS alt_payment_name,
        CASE
          WHEN p.alt_payment_name IN ('EzCater','Ez Cater','HUNGRY','Sharebite',
            'Territory Foods','Cater Cow','WCK','Food Fleet','ZeroCater','Cater2Me')
           AND (${CH}) = 'IN_HOUSE'
          THEN 'CATERING'
          WHEN p.alt_payment_name IN ('Fooda','Aramark','Eurest','Metz Corp',
            'Taher','Foodworks','Cureate','Guest Services')
           AND (${CH}) = 'IN_HOUSE'
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
      WHERE ${BASE_WHERE}
        AND fol.business_date BETWEEN $1::DATE AND $2::DATE
        AND (
          (p.alt_payment_name IN ('EzCater','Ez Cater','HUNGRY','Sharebite',
            'Territory Foods','Cater Cow','WCK','Food Fleet','ZeroCater','Cater2Me')
           AND (${CH}) = 'IN_HOUSE')
          OR
          (p.alt_payment_name IN ('Fooda','Aramark','Eurest','Metz Corp',
            'Taher','Foodworks','Cureate','Guest Services')
           AND (${CH}) = 'IN_HOUSE')
        )
      ORDER BY fol.order_guid, fol.business_date DESC
      LIMIT 100
    `, [dr.start, dr.end]);
    await db.end();
    return rows.map(r => ({
      order_guid:       r.order_guid       as string,
      location:         r.location         as string,
      business_date:    r.business_date    as string,
      amount:           Number(r.amount),
      item_count:       Number(r.item_count),
      issue_type:       'CATERING-PAYMENT-WITH-WRONG-CHANNEL',
      current_channel:  r.current_channel  as string,
      dining_option:    (r.dining_option   ?? '') as string,
      alt_payment_name: r.alt_payment_name as string,
      suggested_channel: (r.suggested_channel ?? '') as string,
    }));
  } catch (err) {
    console.error('getNeedsReview error:', err);
    await db.end();
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
    await db.end();
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
    SELECT period, fiscal_year, start_date::TEXT, end_date::TEXT
    FROM public.dim_fiscal_period
    ORDER BY fiscal_year DESC, period DESC
    LIMIT 26
  `);
  await db.end();
  return rows.map(r => ({
    period:      Number(r.period),
    fiscal_year: Number(r.fiscal_year),
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
        (${CH}) AS channel,
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
      WHERE ${BASE_WHERE}
        AND fol.business_date BETWEEN $1::DATE AND $2::DATE
        AND (${CH}) NOT IN ('OFFSITE', 'OPEN_ITEMS')
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
    await db.end();
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

// ─── Master loader ────────────────────────────────────────────────────────────
export async function loadDashboardData(
  override?: { start: string; end: string; label?: string }
) {
  // Get date range + periods first so we can compute prev range for comparison
  const [dr, periods] = await Promise.all([
    getDateRange(override),
    getPeriods(),
  ]);

  const prevRange = computePrevDateRange(dr, periods);

  const [
    summary, prevSummaryResult,
    channels, weekly, daily,
    weeklyByChannel, dailyByChannel,
    items, channelItems, locationItems, locations,
    meItems, pinkSheets, pinkSheetDetails, modifiers, payments, bikky,
    categories, channelCategories,
    renames, needsReview,
    openItemsResult,
    uncategorizedItems,
    cateringVendors, offsiteVendors,
  ] = await Promise.all([
    getSummary(dr),
    prevRange ? getSummary({ ...dr, start: prevRange.start, end: prevRange.end, label: prevRange.label }) : Promise.resolve(null),
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
    getBikky(),
    getCategories(dr),
    getChannelCategories(dr),
    getRenames(),
    getNeedsReview(dr),
    getOpenItems(dr),
    getUncategorizedItems(dr),
    getCateringVendors(dr),
    getOffsiteVendors(dr),
  ]);

  const totalMargin   = meItems.reduce((s, i) => s + i.total_margin, 0);
  const totalNetSales = meItems.reduce((s, i) => s + i.net_sales,    0);
  const avgMargin     = totalNetSales > 0 ? totalMargin / totalNetSales : 0;

  return {
    dateRange: dr,
    summary,
    prevSummary: prevSummaryResult,
    channels,
    weekly, daily, weeklyByChannel, dailyByChannel,
    items, channelItems, locationItems, locations,
    meItems, pinkSheets, pinkSheetDetails, avgMargin,
    modifiers, payments, bikky,
    categories, channelCategories,
    renames, needsReview,
    uncategorizedItems,
    openItems:        openItemsResult.items,
    openItemsSummary: openItemsResult.summary,
    periods,
    cateringVendors, offsiteVendors,
  };
}
