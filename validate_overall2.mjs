import { Pool } from '@neondatabase/serverless';
import { readFileSync } from 'fs';
const env = Object.fromEntries(
  readFileSync('.env', 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; })
);
const pool = new Pool({ connectionString: env.DATABASE_URL });
const MAIN = ['BOWLS','BUILD YOUR OWN BOWL','BURRITOS','BYO','CHEF CURATED BOWLS','CLASSIC INDIAN PLATES','PLATES','INDIAN BURRITOS','KIDS'];
const START = '2026-06-24', END = '2026-07-21';

async function validateOverall(locFilter, label) {
  const locClause = locFilter ? `AND location_code = '${locFilter}'` : '';
  const { rows } = await pool.query(`
    WITH main_checks AS (
      SELECT DISTINCT check_guid FROM public.fact_order_lines
      WHERE NOT is_voided AND NOT is_deferred AND business_date BETWEEN $1::DATE AND $2::DATE
        AND menu_group = ANY($3::TEXT[]) ${locClause}
    ),
    item_lines AS (
      SELECT DISTINCT mc.check_guid, fol.canonical_name AS name
      FROM public.fact_order_lines fol
      JOIN main_checks mc ON mc.check_guid = fol.check_guid
      WHERE NOT fol.is_voided AND NOT fol.is_deferred AND fol.business_date BETWEEN $1::DATE AND $2::DATE
        AND (
          (fol.menu_group = ANY(ARRAY['Cold Drinks','Hot Drinks','DRINKS','Beer','Wine','Liquor']) AND fol.menu_name <> 'CATERING')
          OR fol.menu_group = 'SWEETS' OR fol.menu_group = 'SIDES'
        )
    ),
    item_counts AS (SELECT name, COUNT(*) AS n FROM item_lines GROUP BY name),
    mod_lines AS (
      SELECT DISTINCT mc.check_guid, fm.canonical_name AS name
      FROM public.fact_modifiers fm
      JOIN public.fact_order_lines fol ON fol.selection_guid = fm.parent_selection
      JOIN main_checks mc ON mc.check_guid = fol.check_guid
      WHERE NOT fm.is_voided AND NOT fol.is_voided AND NOT fol.is_deferred
        AND fm.business_date BETWEEN $1::DATE AND $2::DATE
        AND fm.canonical_name IN (SELECT DISTINCT name FROM item_lines)
    ),
    mod_counts AS (SELECT name, COUNT(*) AS n FROM mod_lines GROUP BY name),
    -- naive sum per name (matches merged[].totals = checksItem + checksMod, NOT deduped by check within a name)
    naive AS (
      SELECT COALESCE(i.name, m.name) AS name, COALESCE(i.n,0) + COALESCE(m.n,0) AS naive_total
      FROM item_counts i FULL OUTER JOIN mod_counts m ON m.name = i.name
    ),
    -- properly deduped per name (check present in item OR mod for that name, counted once)
    deduped AS (
      SELECT name, COUNT(DISTINCT check_guid) AS n FROM (
        SELECT check_guid, name FROM item_lines
        UNION
        SELECT check_guid, name FROM mod_lines
      ) x GROUP BY name
    )
    SELECT
      (SELECT COUNT(*) FROM main_checks) AS main_checks,
      (SELECT SUM(naive_total) FROM naive) AS naive_sum,
      (SELECT SUM(n) FROM deduped) AS deduped_sum
  `, [START, END, MAIN]);
  const r = rows[0];
  console.log(`${label}: main=${r.main_checks}  naive_sum=${r.naive_sum} (${(r.naive_sum/r.main_checks*100).toFixed(2)}%)  deduped_sum=${r.deduped_sum} (${(r.deduped_sum/r.main_checks*100).toFixed(2)}%)`);
}

await validateOverall('BALLPARK', 'Ballpark ');
await validateOverall('ROCKVILLE', 'Rockville');
await validateOverall('MVT', 'MVT      ');
await validateOverall('MOSAIC', 'Mosaic   ');
await validateOverall('NL', 'NL       ');
await validateOverall(null, 'OVERALL  ');
await pool.end();
