import { Pool } from '@neondatabase/serverless';
import { readFileSync } from 'fs';
const env = Object.fromEntries(
  readFileSync('.env', 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; })
);
const pool = new Pool({ connectionString: env.DATABASE_URL });

const MAIN = ['BOWLS','BUILD YOUR OWN BOWL','BURRITOS','BYO','CHEF CURATED BOWLS','CLASSIC INDIAN PLATES','PLATES','INDIAN BURRITOS','KIDS'];
const DRINK = ['Cold Drinks','Hot Drinks','DRINKS','Beer','Wine','Liquor'];
const START = '2026-06-24', END = '2026-07-21';

async function validateLocation(locFilter, label) {
  const locClause = locFilter ? `AND location_code = '${locFilter}'` : '';
  async function catCount(itemFilterSql) {
    const { rows } = await pool.query(`
      WITH main_checks AS (
        SELECT DISTINCT check_guid FROM public.fact_order_lines
        WHERE NOT is_voided AND NOT is_deferred AND business_date BETWEEN $1::DATE AND $2::DATE
          AND menu_group = ANY($3::TEXT[]) ${locClause}
      ),
      item_lines AS (
        SELECT DISTINCT mc.check_guid, fol.canonical_name
        FROM public.fact_order_lines fol
        JOIN main_checks mc ON mc.check_guid = fol.check_guid
        WHERE NOT fol.is_voided AND NOT fol.is_deferred AND fol.business_date BETWEEN $1::DATE AND $2::DATE
          AND (${itemFilterSql})
      ),
      name_category AS (SELECT DISTINCT canonical_name AS name FROM item_lines),
      mod_lines AS (
        SELECT DISTINCT mc.check_guid
        FROM public.fact_modifiers fm
        JOIN public.fact_order_lines fol ON fol.selection_guid = fm.parent_selection
        JOIN main_checks mc ON mc.check_guid = fol.check_guid
        WHERE NOT fm.is_voided AND NOT fol.is_voided AND NOT fol.is_deferred
          AND fm.business_date BETWEEN $1::DATE AND $2::DATE
          AND fm.canonical_name IN (SELECT name FROM name_category)
      )
      SELECT
        (SELECT COUNT(*) FROM main_checks) AS main_checks,
        (SELECT COUNT(*) FROM (SELECT check_guid FROM item_lines UNION SELECT check_guid FROM mod_lines) x) AS total
    `, [START, END, MAIN]);
    return rows[0];
  }
  const drink = await catCount(`fol.menu_group = ANY(ARRAY['Cold Drinks','Hot Drinks','DRINKS','Beer','Wine','Liquor']) AND fol.menu_name <> 'CATERING'`);
  const side  = await catCount(`fol.menu_group = 'SIDES'`);
  const sweet = await catCount(`fol.menu_group = 'SWEETS'`);
  const main = Number(drink.main_checks);
  const pct = n => (Number(n) / main * 100).toFixed(2);
  const overallTotal = Number(drink.total) + Number(side.total) + Number(sweet.total);
  console.log(`${label}: main=${main}  drink%=${pct(drink.total)}  side%=${pct(side.total)}  sweet%=${pct(sweet.total)}  overall%=${(overallTotal/main*100).toFixed(2)}`);
}

await validateLocation('BALLPARK', 'Ballpark ');
await validateLocation('ROCKVILLE', 'Rockville');
await validateLocation('MVT', 'MVT      ');
await validateLocation('MOSAIC', 'Mosaic   ');
await validateLocation('NL', 'NL       ');
await validateLocation(null, 'OVERALL  ');

await pool.end();
