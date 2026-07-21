import { Pool } from '@neondatabase/serverless';
import { readFileSync } from 'fs';
const env = Object.fromEntries(
  readFileSync('.env', 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; })
);
const pool = new Pool({ connectionString: env.DATABASE_URL });
const guid = '01189079-839b-41ec-9897-ef0089e1c8e9';

const { rows: mods } = await pool.query(`
  SELECT fm.modifier_guid, fm.canonical_name, fm.option_group_name, fm.parent_selection, fm.quantity, fm.price
  FROM public.fact_modifiers fm
  JOIN public.fact_order_lines fol ON fol.selection_guid = fm.parent_selection
  WHERE fol.check_guid = $1 AND fm.canonical_name = 'Mango Lassi'
`, [guid]);
console.log('--- Mango Lassi modifier row ---');
console.table(mods);

const parentSelection = mods[0].parent_selection;
const { rows: parentLine } = await pool.query(`
  SELECT selection_guid, order_guid, check_guid, canonical_name, menu_group, menu_name, business_date
  FROM public.fact_order_lines WHERE selection_guid = $1
`, [parentSelection]);
console.log('--- Parent order line (what the modifier is attached to) ---');
console.table(parentLine);

const { rows: strawberryLassi } = await pool.query(`
  SELECT selection_guid, canonical_name, menu_group, menu_name, quantity, line_total
  FROM public.fact_order_lines WHERE check_guid = $1 AND canonical_name = 'Strawberry Lassi'
`, [guid]);
console.log('--- Standalone Strawberry Lassi item line (the "item" side of the overlap) ---');
console.table(strawberryLassi);

await pool.end();
