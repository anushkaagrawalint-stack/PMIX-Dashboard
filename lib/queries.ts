import { getDb } from './db';
import { EXCLUDED_GROUPS, EXCLUDED_CHANNELS } from './constants';
import type {
  DateRange, Summary, ChannelRow, WeekRow, ItemRow,
  LocationItemRow, MERow, ModifierRow, PaymentRow, BikkyRow,
  CategoryRow, ChannelItemRow, LocationRow, FiscalPeriodRow,
  RenameRow, NeedsReviewRow, ChannelCategoryRow,
} from './types';

function sqlInList(arr: readonly string[]): string {
  return arr.map(s => `'${s.replace(/'/g, "''")}'`).join(',');
}

// Static SQL fragments — safe to embed directly (compile-time constants, not user input)
const EXCL_CH_SQL  = `'CATERING','OFFSITE'`;
const EXCL_GRP_SQL = sqlInList(EXCLUDED_GROUPS);

// item_lookup join: deduplicates to one row per canonical_name.
// il_cat = category_2 only when it genuinely differs from category_1 (i.e. a real category was assigned)
const ilJoin = (alias: string) => `
  LEFT JOIN (
    SELECT DISTINCT ON (raw_item_name)
      raw_item_name,
      CASE WHEN category_2 IS DISTINCT FROM category_1 THEN category_2 END AS il_cat
    FROM analytics.item_lookup
    ORDER BY raw_item_name, loaded_at DESC
  ) il ON il.raw_item_name = ${alias}.canonical_name`;

// Category from item_lookup.category_2 (primary) or menu_group (fallback)
const catCase = (alias: string) =>
  `CASE COALESCE(il.il_cat, COALESCE(${alias}.menu_group,''))
    WHEN 'Bowls'                  THEN 'Entrees'
    WHEN 'BOWLS'                  THEN 'Entrees'
    WHEN 'BUILD YOUR OWN BOWL'    THEN 'Entrees'
    WHEN 'BYO'                    THEN 'Entrees'
    WHEN 'CHEF CURATED BOWLS'     THEN 'Entrees'
    WHEN 'Plates'                 THEN 'Entrees'
    WHEN 'PLATES'                 THEN 'Entrees'
    WHEN 'CLASSIC INDIAN PLATES'  THEN 'Entrees'
    WHEN 'Burritos'               THEN 'Entrees'
    WHEN 'BURRITOS'               THEN 'Entrees'
    WHEN 'INDIAN BURRITOS'        THEN 'Entrees'
    WHEN 'Sides'                  THEN 'Sides'
    WHEN 'SIDES'                  THEN 'Sides'
    WHEN 'Drinks'                 THEN 'NA Drinks'
    WHEN 'DRINKS'                 THEN 'NA Drinks'
    WHEN 'Cold Drinks'            THEN 'NA Drinks'
    WHEN 'Hot Drinks'             THEN 'NA Drinks'
    WHEN 'Lassi'                  THEN 'NA Drinks'
    WHEN 'Juice'                  THEN 'NA Drinks'
    WHEN 'Canned Soda'            THEN 'NA Drinks'
    WHEN 'Kombucha'               THEN 'NA Drinks'
    WHEN 'Chai'                   THEN 'NA Drinks'
    WHEN 'Water'                  THEN 'NA Drinks'
    WHEN 'Coconut'                THEN 'NA Drinks'
    WHEN 'Sweets'                 THEN 'Sweets'
    WHEN 'SWEETS'                 THEN 'Sweets'
    WHEN 'Soft Serve'             THEN 'Sweets'
    WHEN 'Cookies'                THEN 'Sweets'
    WHEN 'Yogurt'                 THEN 'Sweets'
    WHEN 'Beer'                   THEN 'Alc Drinks'
    WHEN 'Wine'                   THEN 'Alc Drinks'
    WHEN 'WINE'                   THEN 'Alc Drinks'
    WHEN 'Liquor'                 THEN 'Alc Drinks'
    WHEN 'Gameday'                THEN 'Alc Drinks'
    WHEN 'Kids Meal'              THEN 'Kids Meal'
    WHEN 'KIDS'                   THEN 'Kids Meal'
    WHEN 'Retail'                 THEN 'Retail'
    ELSE 'Other'
  END`;

const subcatCase = (alias: string) =>
  `CASE COALESCE(il.il_cat, COALESCE(${alias}.menu_group,''))
    WHEN 'Bowls'                  THEN 'Bowl'
    WHEN 'BOWLS'                  THEN 'Bowl'
    WHEN 'BUILD YOUR OWN BOWL'    THEN 'Bowl'
    WHEN 'BYO'                    THEN 'Bowl'
    WHEN 'CHEF CURATED BOWLS'     THEN 'Bowl'
    WHEN 'Plates'                 THEN 'Plates'
    WHEN 'PLATES'                 THEN 'Plates'
    WHEN 'CLASSIC INDIAN PLATES'  THEN 'Plates'
    WHEN 'Burritos'               THEN 'Burrito'
    WHEN 'BURRITOS'               THEN 'Burrito'
    WHEN 'INDIAN BURRITOS'        THEN 'Burrito'
    WHEN 'Kids Meal'              THEN 'Kids Meal'
    WHEN 'KIDS'                   THEN 'Kids Meal'
    WHEN 'Beer'                   THEN 'Beer'
    WHEN 'Wine'                   THEN 'Wine'
    WHEN 'WINE'                   THEN 'Wine'
    WHEN 'Liquor'                 THEN 'Liquor'
    WHEN 'Gameday'                THEN 'Gameday'
    WHEN 'Lassi'                  THEN 'Lassi'
    WHEN 'Juice'                  THEN 'Juice'
    WHEN 'Canned Soda'            THEN 'Canned Soda'
    WHEN 'Kombucha'               THEN 'Kombucha'
    WHEN 'Chai'                   THEN 'Chai'
    WHEN 'Water'                  THEN 'Water'
    WHEN 'Coconut'                THEN 'Coconut'
    WHEN 'Soft Serve'             THEN 'Soft Serve'
    WHEN 'Cookies'                THEN 'Cookies'
    WHEN 'Yogurt'                 THEN 'Yogurt'
    WHEN 'Retail'                 THEN 'Retail'
    ELSE ''
  END`;

export async function getDateRange(override?: { start: string; end: string; label?: string }): Promise<DateRange> {
  const rows = await getDb()`
    SELECT
      MIN(business_date)::TEXT AS min_date,
      MAX(business_date)::TEXT AS max_date
    FROM public.fact_order_lines
    WHERE NOT is_voided
  `;
  const dbMin = rows[0].min_date as string;
  const dbMax = rows[0].max_date as string;

  if (override) {
    const label = override.label ?? `${override.start} → ${override.end}`;
    return { start: override.start, end: override.end, label, dbMin, dbMax };
  }

  const end = new Date(dbMax);
  const start = new Date(dbMax);
  start.setDate(start.getDate() - 27);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end), label: `${fmt(start)} → ${fmt(end)}`, dbMin, dbMax };
}

export async function getSummary(dr: DateRange): Promise<Summary> {
  const { Pool } = await import('@neondatabase/serverless');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });

  const [sumRes, topRes] = await Promise.all([
    pool.query(`
      SELECT
        SUM(quantity)::BIGINT                        AS total_qty,
        ROUND(SUM(line_total)::NUMERIC, 2)           AS total_revenue,
        COUNT(DISTINCT canonical_name)::INT          AS unique_items,
        MAX(business_date)::TEXT                     AS last_date
      FROM public.fact_order_lines
      WHERE NOT is_voided
        AND channel_code NOT IN (${EXCL_CH_SQL})
        AND COALESCE(menu_group,'') NOT IN (${EXCL_GRP_SQL})
        AND canonical_name NOT ILIKE 'Order notes%'
        AND business_date BETWEEN $1::DATE AND $2::DATE
    `, [dr.start, dr.end]),
    pool.query(`
      WITH grand AS (
        SELECT SUM(line_total) AS total
        FROM public.fact_order_lines
        WHERE NOT is_voided
          AND channel_code NOT IN (${EXCL_CH_SQL})
          AND COALESCE(menu_group,'') NOT IN (${EXCL_GRP_SQL})
          AND canonical_name NOT ILIKE 'Order notes%'
          AND business_date BETWEEN $1::DATE AND $2::DATE
      )
      SELECT
        canonical_name,
        ROUND(SUM(line_total)::NUMERIC, 2) AS revenue,
        ROUND(SUM(line_total)*100.0/NULLIF(g.total,0)::NUMERIC, 1) AS mix_pct
      FROM public.fact_order_lines, grand g
      WHERE NOT is_voided
        AND channel_code NOT IN (${EXCL_CH_SQL})
        AND COALESCE(menu_group,'') NOT IN (${EXCL_GRP_SQL})
        AND canonical_name NOT ILIKE 'Order notes%'
        AND business_date BETWEEN $1::DATE AND $2::DATE
      GROUP BY canonical_name, g.total
      ORDER BY revenue DESC
      LIMIT 1
    `, [dr.start, dr.end]),
  ]);
  await pool.end();

  const row = sumRes.rows[0];
  const top = topRes.rows[0];
  return {
    total_qty:        Number(row.total_qty),
    total_revenue:    Number(row.total_revenue),
    unique_items:     Number(row.unique_items),
    last_date:        row.last_date as string,
    top_item:         top?.canonical_name ?? '',
    top_item_revenue: Number(top?.revenue ?? 0),
    top_item_mix:     Number(top?.mix_pct ?? 0),
  };
}

export async function getChannels(dr: DateRange): Promise<ChannelRow[]> {
  const { Pool } = await import('@neondatabase/serverless');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  const { rows } = await pool.query(`
    WITH totals AS (
      SELECT SUM(line_total) AS grand
      FROM public.fact_order_lines
      WHERE NOT is_voided
        AND channel_code NOT IN (${EXCL_CH_SQL})
        AND COALESCE(menu_group,'') NOT IN (${EXCL_GRP_SQL})
        AND canonical_name NOT ILIKE 'Order notes%'
        AND business_date BETWEEN $1::DATE AND $2::DATE
    )
    SELECT
      channel_code,
      SUM(quantity)::BIGINT                                             AS qty,
      ROUND(SUM(line_total)::NUMERIC, 2)                                AS revenue,
      ROUND(SUM(line_total)*100.0/NULLIF(t.grand,0)::NUMERIC, 1)       AS pct
    FROM public.fact_order_lines, totals t
    WHERE NOT is_voided
      AND channel_code NOT IN (${EXCL_CH_SQL})
      AND COALESCE(menu_group,'') NOT IN (${EXCL_GRP_SQL})
      AND canonical_name NOT ILIKE 'Order notes%'
      AND business_date BETWEEN $1::DATE AND $2::DATE
    GROUP BY channel_code, t.grand
    ORDER BY revenue DESC
  `, [dr.start, dr.end]);
  await pool.end();
  return rows.map(r => ({
    channel_code: r.channel_code as string,
    qty:          Number(r.qty),
    revenue:      Number(r.revenue),
    pct:          Number(r.pct),
  }));
}

export async function getWeekly(dr: DateRange): Promise<WeekRow[]> {
  const { Pool } = await import('@neondatabase/serverless');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  const { rows } = await pool.query(`
    SELECT
      DATE_TRUNC('week', business_date)::DATE::TEXT AS week_start,
      ROUND(SUM(line_total)::NUMERIC, 0)            AS revenue,
      SUM(quantity)::BIGINT                          AS qty
    FROM public.fact_order_lines
    WHERE NOT is_voided
      AND channel_code NOT IN (${EXCL_CH_SQL})
      AND COALESCE(menu_group,'') NOT IN (${EXCL_GRP_SQL})
      AND canonical_name NOT ILIKE 'Order notes%'
      AND business_date BETWEEN $1::DATE AND $2::DATE
    GROUP BY 1
    ORDER BY 1
  `, [dr.start, dr.end]);
  await pool.end();
  return rows.map(r => ({
    week_start: r.week_start as string,
    revenue:    Number(r.revenue),
    qty:        Number(r.qty),
  }));
}

export async function getItems(dr: DateRange): Promise<ItemRow[]> {
  const { Pool } = await import('@neondatabase/serverless');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  // Outer SELECT joins item_lookup after aggregation (one lookup row per canonical_name).
  // Category and sub_category are computed in SQL: item_lookup.category_2 first, menu_group fallback.
  const { rows } = await pool.query(`
    SELECT
      s.canonical_name,
      s.menu_group,
      s.menu_name,
      s.qty,
      s.revenue,
      s.avg_price,
      s.revenue_pct,
      s.qty_pct,
      ${catCase('s')}    AS category,
      ${subcatCase('s')} AS sub_category
    FROM (
      WITH grand AS (
        SELECT SUM(line_total) AS total_rev, SUM(quantity) AS total_qty
        FROM public.fact_order_lines
        WHERE NOT is_voided
          AND channel_code NOT IN (${EXCL_CH_SQL})
          AND COALESCE(menu_group,'') NOT IN (${EXCL_GRP_SQL})
          AND canonical_name NOT ILIKE 'Order notes%'
          AND business_date BETWEEN $1::DATE AND $2::DATE
      )
      SELECT
        fol.canonical_name,
        COALESCE(fol.menu_group,'Other')                                        AS menu_group,
        COALESCE(fol.menu_name,'Other')                                         AS menu_name,
        SUM(fol.quantity)::BIGINT                                               AS qty,
        ROUND(SUM(fol.line_total)::NUMERIC, 2)                                 AS revenue,
        ROUND((SUM(fol.line_total)/NULLIF(SUM(fol.quantity),0))::NUMERIC, 2)   AS avg_price,
        ROUND((SUM(fol.line_total)*100.0/NULLIF(g.total_rev,0))::NUMERIC, 2)   AS revenue_pct,
        ROUND((SUM(fol.quantity)*100.0/NULLIF(g.total_qty,0))::NUMERIC, 2)     AS qty_pct
      FROM public.fact_order_lines fol, grand g
      WHERE NOT fol.is_voided
        AND fol.channel_code NOT IN (${EXCL_CH_SQL})
        AND COALESCE(fol.menu_group,'') NOT IN (${EXCL_GRP_SQL})
        AND fol.canonical_name NOT ILIKE 'Order notes%'
        AND fol.business_date BETWEEN $1::DATE AND $2::DATE
      GROUP BY fol.canonical_name, fol.menu_group, fol.menu_name, g.total_rev, g.total_qty
    ) s
    ${ilJoin('s')}
    ORDER BY s.revenue DESC
  `, [dr.start, dr.end]);
  await pool.end();
  return rows.map(r => ({
    canonical_name: r.canonical_name as string,
    menu_group:     r.menu_group as string,
    menu_name:      r.menu_name as string,
    category:       r.category as string,
    sub_category:   r.sub_category as string,
    qty:            Number(r.qty),
    revenue:        Number(r.revenue),
    avg_price:      Number(r.avg_price),
    revenue_pct:    Number(r.revenue_pct),
    qty_pct:        Number(r.qty_pct),
  }));
}

export async function getLocationItems(dr: DateRange): Promise<LocationItemRow[]> {
  const { Pool } = await import('@neondatabase/serverless');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  const { rows } = await pool.query(`
    WITH loc_totals AS (
      SELECT location_code, SUM(quantity) AS loc_qty
      FROM public.fact_order_lines
      WHERE NOT is_voided
        AND channel_code NOT IN (${EXCL_CH_SQL})
        AND COALESCE(menu_group,'') NOT IN (${EXCL_GRP_SQL})
        AND canonical_name NOT ILIKE 'Order notes%'
        AND business_date BETWEEN $1::DATE AND $2::DATE
      GROUP BY location_code
    )
    SELECT
      fol.canonical_name,
      fol.location_code,
      SUM(fol.quantity)::BIGINT                                          AS qty,
      ROUND(SUM(fol.line_total)::NUMERIC, 2)                            AS revenue,
      ROUND((SUM(fol.quantity)*100.0/NULLIF(lt.loc_qty,0))::NUMERIC, 2) AS mix_pct
    FROM public.fact_order_lines fol
    JOIN loc_totals lt ON lt.location_code = fol.location_code
    WHERE NOT fol.is_voided
      AND fol.channel_code NOT IN (${EXCL_CH_SQL})
      AND COALESCE(fol.menu_group,'') NOT IN (${EXCL_GRP_SQL})
      AND fol.canonical_name NOT ILIKE 'Order notes%'
      AND fol.business_date BETWEEN $1::DATE AND $2::DATE
    GROUP BY fol.canonical_name, fol.location_code, lt.loc_qty
    ORDER BY fol.canonical_name, fol.location_code
  `, [dr.start, dr.end]);
  await pool.end();
  return rows.map(r => ({
    canonical_name: r.canonical_name as string,
    location_code:  r.location_code as string,
    qty:            Number(r.qty),
    revenue:        Number(r.revenue),
    mix_pct:        Number(r.mix_pct),
  }));
}

export async function getMEItems(dr: DateRange): Promise<MERow[]> {
  const { Pool } = await import('@neondatabase/serverless');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });

  // Outer SELECT joins item_lookup on the aggregated result to get category/sub_category in SQL.
  const { rows } = await pool.query(`
    SELECT
      s.canonical_name,
      s.menu_group,
      s.net_sales,
      s.avg_price,
      s.avg_cost,
      s.total_cost,
      s.total_margin,
      s.qty,
      s.margin_pct,
      s.cogs_pct,
      s.mix_pct,
      s.margin_threshold,
      s.mix_threshold,
      s.quadrant,
      s.margin_flag,
      s.mix_flag,
      ${catCase('s')}    AS category,
      ${subcatCase('s')} AS sub_category
    FROM (
      WITH period_sales AS (
        SELECT
          fol.canonical_name,
          COALESCE(fol.menu_group, 'Other')                                        AS menu_group,
          'P' || LPAD(fp.period::TEXT, 2, '0') || '-' || fp.fiscal_year::TEXT     AS cost_period,
          SUM(fol.quantity)                                                         AS qty,
          SUM(fol.line_total)                                                       AS net_sales
        FROM public.fact_order_lines fol
        LEFT JOIN public.dim_fiscal_period fp
          ON fol.business_date >  fp.start_date::DATE
         AND fol.business_date <= fp.end_date::DATE
        WHERE NOT fol.is_voided
          AND fol.business_date BETWEEN $1::DATE AND $2::DATE
          AND fol.channel_code NOT IN (${EXCL_CH_SQL})
          AND COALESCE(fol.menu_group,'') NOT IN (${EXCL_GRP_SQL})
        GROUP BY fol.canonical_name, fol.menu_group, 3
      ),
      all_costs AS (
        SELECT item_name_updated, period, AVG(avg_cost) AS avg_cost
        FROM analytics.r365_item_cost
        GROUP BY item_name_updated, period
      ),
      latest_costs AS (
        SELECT DISTINCT ON (item_name_updated)
          item_name_updated, avg_cost
        FROM all_costs
        ORDER BY item_name_updated, period DESC
      ),
      period_with_cost AS (
        SELECT
          ps.canonical_name,
          ps.menu_group,
          ps.qty,
          ps.net_sales,
          COALESCE(ac.avg_cost, lc.avg_cost, 0)          AS avg_cost,
          ps.qty * COALESCE(ac.avg_cost, lc.avg_cost, 0) AS line_cost
        FROM period_sales ps
        LEFT JOIN all_costs    ac ON ac.item_name_updated = ps.canonical_name AND ac.period = ps.cost_period
        LEFT JOIN latest_costs lc ON lc.item_name_updated = ps.canonical_name
      ),
      aggregated AS (
        SELECT
          canonical_name,
          menu_group,
          SUM(qty)                              AS qty,
          SUM(net_sales)                        AS net_sales,
          SUM(line_cost)                        AS total_cost,
          SUM(net_sales) - SUM(line_cost)       AS total_margin,
          SUM(net_sales) / NULLIF(SUM(qty), 0)  AS avg_price,
          SUM(line_cost) / NULLIF(SUM(qty), 0)  AS avg_cost
        FROM period_with_cost
        GROUP BY canonical_name, menu_group
      ),
      item_count AS (SELECT COUNT(*) AS n FROM aggregated),
      thresholds AS (
        SELECT
          SUM(a.total_margin) / NULLIF(SUM(a.net_sales), 0) AS margin_threshold,
          (1.0 / NULLIF(MAX(ic.n), 0)) * 0.7                AS mix_threshold,
          SUM(a.qty)                                          AS grand_qty
        FROM aggregated a, item_count ic
      )
      SELECT
        a.canonical_name,
        a.menu_group,
        ROUND(a.net_sales::NUMERIC,    2) AS net_sales,
        ROUND(a.avg_price::NUMERIC,    2) AS avg_price,
        ROUND(a.avg_cost::NUMERIC,     4) AS avg_cost,
        ROUND(a.total_cost::NUMERIC,   2) AS total_cost,
        ROUND(a.total_margin::NUMERIC, 2) AS total_margin,
        a.qty::BIGINT                      AS qty,
        ROUND((a.total_margin / NULLIF(a.net_sales,0))::NUMERIC, 4)   AS margin_pct,
        ROUND((a.total_cost   / NULLIF(a.net_sales,0))::NUMERIC, 4)   AS cogs_pct,
        ROUND((a.qty          / NULLIF(t.grand_qty,0))::NUMERIC, 4)   AS mix_pct,
        ROUND(t.margin_threshold::NUMERIC, 4)                          AS margin_threshold,
        ROUND(t.mix_threshold::NUMERIC,    4)                          AS mix_threshold,
        CASE
          WHEN (a.qty/NULLIF(t.grand_qty,0)) >  t.mix_threshold
           AND (a.total_margin/NULLIF(a.net_sales,0)) >  t.margin_threshold THEN 'Star'
          WHEN (a.qty/NULLIF(t.grand_qty,0)) >  t.mix_threshold
           AND (a.total_margin/NULLIF(a.net_sales,0)) <= t.margin_threshold THEN 'Plow Horse'
          WHEN (a.qty/NULLIF(t.grand_qty,0)) <= t.mix_threshold
           AND (a.total_margin/NULLIF(a.net_sales,0)) >  t.margin_threshold THEN 'Puzzle'
          ELSE 'Dog'
        END AS quadrant,
        CASE WHEN (a.total_margin/NULLIF(a.net_sales,0)) >  t.margin_threshold THEN 'High' ELSE 'Low' END AS margin_flag,
        CASE WHEN (a.qty/NULLIF(t.grand_qty,0))          >  t.mix_threshold    THEN 'High' ELSE 'Low' END AS mix_flag
      FROM aggregated a, thresholds t
      ORDER BY net_sales DESC
    ) s
    ${ilJoin('s')}
    ORDER BY s.net_sales DESC
  `, [dr.start, dr.end]);
  await pool.end();

  // Two-pass: compute category/subcategory revenue totals for sls_pct_ fields
  const catRev: Record<string, number> = {};
  const subRev: Record<string, number> = {};
  rows.forEach((r: Record<string, unknown>) => {
    const cat = r.category as string;
    const sub = r.sub_category as string;
    catRev[cat] = (catRev[cat] ?? 0) + Number(r.net_sales);
    subRev[sub || '_none'] = (subRev[sub || '_none'] ?? 0) + Number(r.net_sales);
  });

  return rows.map((r: Record<string, unknown>) => {
    const cat = r.category as string;
    const sub = r.sub_category as string;
    const ns  = Number(r.net_sales);
    return {
      canonical_name:      r.canonical_name as string,
      menu_group:          r.menu_group as string,
      category:            cat,
      sub_category:        sub,
      qty:                 Number(r.qty),
      net_sales:           ns,
      avg_price:           Number(r.avg_price),
      avg_cost:            Number(r.avg_cost),
      total_cost:          Number(r.total_cost),
      total_margin:        Number(r.total_margin),
      margin_pct:          Number(r.margin_pct),
      cogs_pct:            Number(r.cogs_pct),
      mix_pct:             Number(r.mix_pct),
      sls_pct_category:    catRev[cat] > 0 ? ns / catRev[cat] : 0,
      sls_pct_subcategory: (subRev[sub || '_none'] ?? 0) > 0 ? ns / (subRev[sub || '_none'] ?? 0) : 0,
      quadrant:            r.quadrant as MERow['quadrant'],
      margin_flag:         r.margin_flag as 'High' | 'Low',
      mix_flag:            r.mix_flag as 'High' | 'Low',
      margin_threshold:    Number(r.margin_threshold),
      mix_threshold:       Number(r.mix_threshold),
    };
  });
}

export async function getModifiers(dr: DateRange): Promise<ModifierRow[]> {
  const { Pool } = await import('@neondatabase/serverless');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  const { rows } = await pool.query(`
    WITH raw_mods AS (
      -- fact_modifiers.mod_type is always NULL; derive type via parent_item_type + modifier_type tables
      SELECT
        mt.modifier_type AS raw_type,
        fm.canonical_name AS modifier_name,
        fm.quantity        AS quantity
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
      WHERE NOT fol.is_voided
        AND NOT fm.is_voided
        AND fol.channel_code NOT IN (${EXCL_CH_SQL})
        AND fol.business_date BETWEEN $1::DATE AND $2::DATE
        AND fol.canonical_name ILIKE '%bowl%'
        AND LOWER(mt.modifier_type) IN ('main','base','veggie','topping','sauce','chutney + dressing')
    ),
    byo_mods AS (
      SELECT
        CASE WHEN LOWER(raw_type) = 'chutney + dressing' THEN 'chutney' ELSE LOWER(raw_type) END AS mod_type,
        modifier_name,
        SUM(quantity) AS qty
      FROM raw_mods
      GROUP BY 1, modifier_name
    ),
    type_totals AS (
      SELECT mod_type, SUM(qty) AS type_qty FROM byo_mods GROUP BY mod_type
    )
    SELECT
      bm.mod_type,
      bm.modifier_name,
      bm.qty::BIGINT                                             AS qty,
      ROUND((bm.qty*100.0/NULLIF(tt.type_qty,0))::NUMERIC,1)   AS pct
    FROM byo_mods bm
    JOIN type_totals tt ON tt.mod_type = bm.mod_type
    ORDER BY bm.mod_type, bm.qty DESC
  `, [dr.start, dr.end]);
  await pool.end();
  return rows.map(r => ({
    mod_type:      r.mod_type as string,
    modifier_name: r.modifier_name as string,
    qty:           Number(r.qty),
    pct:           Number(r.pct),
  }));
}

export async function getPayments(dr: DateRange): Promise<PaymentRow[]> {
  const rows = await getDb()`
    WITH grand AS (
      SELECT SUM(amount) AS total FROM public.br_order_payment
      WHERE business_date BETWEEN ${dr.start}::DATE AND ${dr.end}::DATE
    )
    SELECT
      COALESCE(NULLIF(TRIM(alt_payment_name),''), payment_type, 'Unknown') AS payment_source,
      payment_type,
      COUNT(*)::INT                                                          AS payment_count,
      ROUND(SUM(amount)::NUMERIC, 2)                                        AS total_amount,
      ROUND((SUM(amount)*100.0/NULLIF(g.total,0))::NUMERIC, 1)             AS pct
    FROM public.br_order_payment, grand g
    WHERE business_date BETWEEN ${dr.start}::DATE AND ${dr.end}::DATE
    GROUP BY 1, 2, g.total
    ORDER BY total_amount DESC
    LIMIT 30
  `;
  return rows.map(r => ({
    payment_source: r.payment_source as string,
    payment_count:  Number(r.payment_count),
    total_amount:   Number(r.total_amount),
    pct:            Number(r.pct),
    category:       (r.payment_type as string) === 'CREDIT' ? 'Card' : 'Alt Payment',
  }));
}

export async function getBikky(dr: DateRange): Promise<BikkyRow[]> {
  try {
    const { Pool } = await import('@neondatabase/serverless');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
    const { rows } = await pool.query(`
      WITH active_periods AS (
        SELECT DISTINCT fp.period
        FROM public.dim_fiscal_period fp
        WHERE fp.end_date::DATE  >= $1::DATE
          AND fp.start_date::DATE <= $2::DATE
      ),
      period_count AS (
        SELECT COUNT(*) AS cnt FROM active_periods
      ),
      all_bikky AS (
        SELECT b.item_name,
               b.return_rate::FLOAT  AS return_rate,
               b.reorder_rate::FLOAT AS reorder_rate,
               b.period
        FROM public.fact_bikky_instore b
        WHERE (
          (SELECT cnt FROM period_count) > 0
          AND b.period IN (SELECT period FROM active_periods)
        ) OR (
          (SELECT cnt FROM period_count) = 0
          AND b.period = (SELECT MAX(b2.period) FROM public.fact_bikky_instore b2)
        )
      ),
      item_stats AS (
        SELECT
          canonical_name,
          CASE COALESCE(MIN(menu_group),'')
            WHEN 'BOWLS' THEN 'Entrees' WHEN 'BUILD YOUR OWN BOWL' THEN 'Entrees'
            WHEN 'CHEF CURATED BOWLS' THEN 'Entrees' WHEN 'BYO' THEN 'Entrees'
            WHEN 'PLATES' THEN 'Entrees' WHEN 'CLASSIC INDIAN PLATES' THEN 'Entrees'
            WHEN 'BURRITOS' THEN 'Entrees' WHEN 'INDIAN BURRITOS' THEN 'Entrees'
            WHEN 'SIDES' THEN 'Sides' WHEN 'Sides' THEN 'Sides'
            WHEN 'DRINKS' THEN 'NA Drinks' WHEN 'Drinks' THEN 'NA Drinks'
            WHEN 'Cold Drinks' THEN 'NA Drinks' WHEN 'Hot Drinks' THEN 'NA Drinks'
            WHEN 'SWEETS' THEN 'Sweets' WHEN 'Sweets' THEN 'Sweets'
            WHEN 'KIDS' THEN 'Kids Meal'
            WHEN 'Beer' THEN 'Alc Drinks' WHEN 'Wine' THEN 'Alc Drinks' WHEN 'WINE' THEN 'Alc Drinks'
            ELSE 'Other'
          END AS category,
          SUM(quantity)::BIGINT AS qty,
          ROUND(SUM(line_total)::NUMERIC, 2) AS revenue
        FROM public.fact_order_lines
        WHERE NOT is_voided
          AND channel_code NOT IN (${EXCL_CH_SQL})
          AND business_date BETWEEN $1::DATE AND $2::DATE
        GROUP BY canonical_name
      )
      SELECT
        ab.item_name,
        ab.return_rate,
        ab.reorder_rate,
        ab.period,
        COALESCE(ist.category, 'Other') AS category,
        COALESCE(ist.revenue, 0)        AS revenue,
        COALESCE(ist.qty, 0)            AS qty
      FROM all_bikky ab
      LEFT JOIN item_stats ist ON ist.canonical_name = ab.item_name
      ORDER BY ab.period DESC, ab.return_rate DESC NULLS LAST
    `, [dr.start, dr.end]);
    await pool.end();
    return rows.map(r => ({
      item_name:    r.item_name as string,
      return_rate:  Number(r.return_rate ?? 0),
      reorder_rate: Number(r.reorder_rate ?? 0),
      period:       `P${String(r.period).padStart(2,'0')}`,
      category:     r.category as string,
      revenue:      Number(r.revenue ?? 0),
      qty:          Number(r.qty ?? 0),
    }));
  } catch (err) {
    console.error('getBikky error:', err);
    return [];
  }
}

export async function getRenames(): Promise<RenameRow[]> {
  try {
    const { Pool } = await import('@neondatabase/serverless');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
    const { rows } = await pool.query(`
      SELECT
        canonical_name,
        STRING_AGG(DISTINCT menu_name, '|||' ORDER BY menu_name) AS all_names_str,
        COUNT(DISTINCT menu_name)::INT                           AS name_count,
        SUM(quantity)::BIGINT                                    AS lifetime_qty,
        ROUND(SUM(line_total)::NUMERIC, 2)                      AS lifetime_revenue,
        COUNT(DISTINCT location_code)::INT                       AS location_count,
        MIN(business_date)::TEXT                                 AS first_seen
      FROM public.fact_order_lines
      WHERE NOT is_voided
        AND canonical_name IS NOT NULL
        AND menu_name IS NOT NULL
      GROUP BY canonical_name
      HAVING COUNT(DISTINCT menu_name) > 1
      ORDER BY lifetime_qty DESC
      LIMIT 50
    `);
    await pool.end();
    return rows.map(r => ({
      canonical_name:   r.canonical_name as string,
      all_names:        (r.all_names_str as string).split('|||'),
      lifetime_qty:     Number(r.lifetime_qty),
      lifetime_revenue: Number(r.lifetime_revenue),
      location_count:   Number(r.location_count),
      first_seen:       r.first_seen as string,
    }));
  } catch (err) {
    console.error('getRenames error:', err);
    return [];
  }
}

export async function getNeedsReview(dr: DateRange): Promise<NeedsReviewRow[]> {
  try {
    const { Pool } = await import('@neondatabase/serverless');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
    const { rows } = await pool.query(`
      SELECT
        location_code,
        business_date::TEXT                AS business_date,
        channel_code,
        ROUND(SUM(line_total)::NUMERIC, 2) AS amount,
        COUNT(DISTINCT canonical_name)::INT AS item_count,
        CASE channel_code
          WHEN 'CATERING' THEN 'Catering order — excluded from main dashboard metrics'
          WHEN 'OFFSITE'  THEN 'Offsite order — excluded from main dashboard metrics'
          ELSE 'Verify channel assignment for this order'
        END AS suggestion
      FROM public.fact_order_lines
      WHERE NOT is_voided
        AND channel_code IN ('CATERING','OFFSITE')
        AND business_date BETWEEN $1::DATE AND $2::DATE
      GROUP BY location_code, business_date, channel_code
      ORDER BY business_date DESC, amount DESC
      LIMIT 40
    `, [dr.start, dr.end]);
    await pool.end();
    return rows.map(r => ({
      location:      r.location_code as string,
      business_date: r.business_date as string,
      channel_code:  r.channel_code as string,
      amount:        Number(r.amount),
      item_count:    Number(r.item_count),
      suggestion:    r.suggestion as string,
    }));
  } catch (err) {
    console.error('getNeedsReview error:', err);
    return [];
  }
}

export async function getChannelCategories(dr: DateRange): Promise<ChannelCategoryRow[]> {
  try {
    const { Pool } = await import('@neondatabase/serverless');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
    const { rows } = await pool.query(`
      SELECT
        channel_code,
        CASE COALESCE(menu_group,'')
          WHEN 'BOWLS' THEN 'Entrees' WHEN 'BUILD YOUR OWN BOWL' THEN 'Entrees'
          WHEN 'CHEF CURATED BOWLS' THEN 'Entrees' WHEN 'BYO' THEN 'Entrees'
          WHEN 'PLATES' THEN 'Entrees' WHEN 'CLASSIC INDIAN PLATES' THEN 'Entrees'
          WHEN 'BURRITOS' THEN 'Entrees' WHEN 'INDIAN BURRITOS' THEN 'Entrees'
          WHEN 'SIDES' THEN 'Sides' WHEN 'Sides' THEN 'Sides'
          WHEN 'DRINKS' THEN 'NA Drinks' WHEN 'Drinks' THEN 'NA Drinks'
          WHEN 'Cold Drinks' THEN 'NA Drinks' WHEN 'Hot Drinks' THEN 'NA Drinks'
          WHEN 'SWEETS' THEN 'Sweets' WHEN 'Sweets' THEN 'Sweets'
          WHEN 'KIDS' THEN 'Kids Meal'
          WHEN 'Beer' THEN 'Alc Drinks' WHEN 'Wine' THEN 'Alc Drinks' WHEN 'WINE' THEN 'Alc Drinks'
          ELSE 'Other'
        END AS category,
        ROUND(SUM(line_total)::NUMERIC, 2) AS revenue
      FROM public.fact_order_lines
      WHERE NOT is_voided
        AND channel_code NOT IN (${EXCL_CH_SQL})
        AND COALESCE(menu_group,'') NOT IN (${EXCL_GRP_SQL})
        AND canonical_name NOT ILIKE 'Order notes%'
        AND business_date BETWEEN $1::DATE AND $2::DATE
      GROUP BY channel_code, 2
      ORDER BY channel_code, revenue DESC
    `, [dr.start, dr.end]);
    await pool.end();
    return rows.map(r => ({
      channel_code: r.channel_code as string,
      category:     r.category as string,
      revenue:      Number(r.revenue),
    }));
  } catch (err) {
    console.error('getChannelCategories error:', err);
    return [];
  }
}

export async function getCategories(dr: DateRange): Promise<CategoryRow[]> {
  const { Pool } = await import('@neondatabase/serverless');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  // Category computed in SQL from menu_group — no JS mapping needed
  const { rows } = await pool.query(`
    SELECT
      CASE COALESCE(menu_group,'')
        WHEN 'BOWLS'                THEN 'Entrees'
        WHEN 'BUILD YOUR OWN BOWL'  THEN 'Entrees'
        WHEN 'BYO'                  THEN 'Entrees'
        WHEN 'PLATES'               THEN 'Entrees'
        WHEN 'CLASSIC INDIAN PLATES' THEN 'Entrees'
        WHEN 'BURRITOS'             THEN 'Entrees'
        WHEN 'INDIAN BURRITOS'      THEN 'Entrees'
        WHEN 'CHEF CURATED BOWLS'   THEN 'Entrees'
        WHEN 'SIDES'                THEN 'Sides'
        WHEN 'DRINKS'               THEN 'NA Drinks'
        WHEN 'Cold Drinks'          THEN 'NA Drinks'
        WHEN 'Hot Drinks'           THEN 'NA Drinks'
        WHEN 'Drinks'               THEN 'NA Drinks'
        WHEN 'SWEETS'               THEN 'Sweets'
        WHEN 'KIDS'                 THEN 'Kids Meal'
        WHEN 'Beer'                 THEN 'Alc Drinks'
        WHEN 'WINE'                 THEN 'Alc Drinks'
        WHEN 'Wine'                 THEN 'Alc Drinks'
        WHEN 'Liquor'               THEN 'Alc Drinks'
        WHEN 'Gameday'              THEN 'Alc Drinks'
        ELSE 'Other'
      END                                AS category,
      ROUND(SUM(line_total)::NUMERIC, 2) AS revenue,
      SUM(quantity)::BIGINT              AS qty
    FROM public.fact_order_lines
    WHERE NOT is_voided
      AND channel_code NOT IN (${EXCL_CH_SQL})
      AND COALESCE(menu_group,'') NOT IN (${EXCL_GRP_SQL})
      AND canonical_name NOT ILIKE 'Order notes%'
      AND business_date BETWEEN $1::DATE AND $2::DATE
    GROUP BY 1
    ORDER BY revenue DESC
  `, [dr.start, dr.end]);
  await pool.end();
  return rows.map(r => ({
    category: r.category as string,
    revenue:  Number(r.revenue),
    qty:      Number(r.qty),
  }));
}

export async function getChannelItems(dr: DateRange): Promise<ChannelItemRow[]> {
  const { Pool } = await import('@neondatabase/serverless');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  const { rows } = await pool.query(`
    SELECT
      canonical_name,
      channel_code,
      SUM(quantity)::BIGINT             AS qty,
      ROUND(SUM(line_total)::NUMERIC,2) AS revenue
    FROM public.fact_order_lines
    WHERE NOT is_voided
      AND channel_code NOT IN (${EXCL_CH_SQL})
      AND COALESCE(menu_group,'') NOT IN (${EXCL_GRP_SQL})
      AND canonical_name NOT ILIKE 'Order notes%'
      AND business_date BETWEEN $1::DATE AND $2::DATE
    GROUP BY canonical_name, channel_code
    ORDER BY revenue DESC
  `, [dr.start, dr.end]);
  await pool.end();
  return rows.map(r => ({
    canonical_name: r.canonical_name as string,
    channel_code:   r.channel_code as string,
    qty:            Number(r.qty),
    revenue:        Number(r.revenue),
  }));
}

export async function getLocations(): Promise<LocationRow[]> {
  const { Pool } = await import('@neondatabase/serverless');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  const { rows } = await pool.query(`
    SELECT location_code, display_name
    FROM public.dim_location
    ORDER BY display_name
  `);
  await pool.end();
  return rows.map(r => ({
    location_code: r.location_code as string,
    display_name:  r.display_name  as string,
  }));
}

export async function getPeriods(): Promise<FiscalPeriodRow[]> {
  const { Pool } = await import('@neondatabase/serverless');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  const { rows } = await pool.query(`
    SELECT
      period,
      fiscal_year,
      start_date::TEXT AS start_date,
      end_date::TEXT   AS end_date
    FROM public.dim_fiscal_period
    ORDER BY fiscal_year DESC, period DESC
    LIMIT 26
  `);
  await pool.end();
  return rows.map(r => ({
    period:      Number(r.period),
    fiscal_year: Number(r.fiscal_year),
    label:       `P${r.period} ${r.fiscal_year}`,
    start_date:  r.start_date as string,
    end_date:    r.end_date   as string,
  }));
}

export async function loadDashboardData(override?: { start: string; end: string; label?: string }) {
  const dr = await getDateRange(override);
  const [
    summary, channels, weekly, items,
    locationItems, meItems, modifiers,
    payments, bikky, categories, channelItems, locations, periods,
    renames, needsReview, channelCategories,
  ] = await Promise.all([
    getSummary(dr),
    getChannels(dr),
    getWeekly(dr),
    getItems(dr),
    getLocationItems(dr),
    getMEItems(dr),
    getModifiers(dr),
    getPayments(dr),
    getBikky(dr),
    getCategories(dr),
    getChannelItems(dr),
    getLocations(),
    getPeriods(),
    getRenames(),
    getNeedsReview(dr),
    getChannelCategories(dr),
  ]);

  const totalMargin  = meItems.reduce((s, i) => s + i.total_margin, 0);
  const totalNetSales = meItems.reduce((s, i) => s + i.net_sales, 0);
  const avgMargin = totalNetSales > 0 ? totalMargin / totalNetSales : 0;

  return {
    dateRange: dr, summary, channels, weekly, items, locationItems,
    meItems, modifiers, payments, bikky, categories, channelItems,
    locations, periods, renames, needsReview, channelCategories, avgMargin,
  };
}
