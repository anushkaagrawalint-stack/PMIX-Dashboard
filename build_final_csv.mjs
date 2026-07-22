import { Pool } from '@neondatabase/serverless';
import { readFileSync, writeFileSync } from 'fs';
const env = Object.fromEntries(
  readFileSync('.env', 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; })
);
const pool = new Pool({ connectionString: env.DATABASE_URL });

const { rows } = await pool.query(`
  SELECT DISTINCT h.display_name AS raw_name, d.canonical_name
  FROM analytics.item_name_history h
  JOIN public.dim_item d ON d.item_guid = h.item_guid
  WHERE h.display_name IS DISTINCT FROM d.canonical_name
  ORDER BY d.canonical_name, h.display_name
`);
await pool.end();

// Explicit pipeline mapping list (mappings/name_mappings.csv)
const pipelineMap = new Map(Object.entries({
  'Grain Bowl - Club Feast': 'Grain Bowl',
  'Salad Bowl - Club Feast': 'Salad Bowl',
  'Spicy Chili Chicken Bowl - Club Feast': 'Spicy Chili Chicken Bowl',
  'Chicken Tikka + Avocado Salad - Club Feast': 'Chicken Tikka + Avocado Salad',
  'Tandoori Tasting Platter': 'Tandoori Tasting Bundle',
  'Kingfisher - Gameday': 'Kingfisher',
  'Rupee Lager - Gameday': 'Rupee Lager',
  'Burrito': 'BYO Indian Burrito',
  'Kids Meal': 'Kids BYO',
  'Indian Yogurt': 'Sweet Cardamom Yogurt',
  'Fooda Aramark Eurest Masala Chai Cookies': 'Masala Chai Cookies',
  'That Fire Hot Sauce - Side': 'That Fire Hot Sauce',
  'Additonal': 'Additional',
  'Fooda Qualtrics - Set Price Bowl': 'Fooda Set Price Bowl',
  'Fooda Okta - Set Price Bowl': 'Fooda Set Price Bowl',
  'Fooda CloudHQ - Set Price Bowl': 'Fooda Set Price Bowl',
  'Fooda T-Mobile - Set Price Bowl': 'Fooda Set Price Bowl',
}));

// Dashboard BYO_FIX_CTE list (lib/queries.ts)
const dashboardMap = new Map(Object.entries({
  'Grain Bowl': 'BYO Grain Bowl',
  'Salad Bowl': 'BYO Salad Bowl',
  'Greens + Grains Bowl': 'BYO Greens + Grains Bowl',
  'Cauliflower + Quinoa': 'Spiced Cauli + Quinoa Bowl',
  'Cauliflower + Quinoa Bowl': 'Spiced Cauli + Quinoa Bowl',
  'Kids BYO': 'Kids Meal',
  'Burrito': 'BYO Indian Burrito',
  'Grain Bowl - In House': 'BYO Grain Bowl',
  'Salad Bowl - In House': 'BYO Salad Bowl',
  'Greens + Grains Bowl - In House': 'BYO Greens + Grains Bowl',
  'Cauliflower + Quinoa - In House': 'Spiced Cauli + Quinoa Bowl',
  'Burrito - In House': 'BYO Indian Burrito',
  'Kids BYO - In House': 'Kids Meal',
  'Homemade Juice - In House': 'Homemade Juice',
  'Chicken Tikka Bowl - In House': 'Chicken Tikka Bowl',
  'Spicy Chili Chicken Bowl - In House': 'Spicy Chili Chicken Bowl',
  'Paneer Tikka Bowl - In House': 'Paneer Tikka Bowl',
  'Lamb Kebab Bowl - In House': 'Lamb Kebab Bowl',
  'Chicken Tikka + Avocado Salad - In House': 'Chicken Tikka + Avocado Salad',
  'Butter Chicken - In House': 'Butter Chicken',
  'Chicken Tikka Masala - In House': 'Chicken Tikka Masala',
  'Aloo Gobhi - In House': 'Aloo Gobhi',
  'Saag Paneer - In House': 'Saag Paneer',
  'Paneer Butter Masala - In House': 'Paneer Butter Masala',
  'Saag Chole - In House': 'Saag Chole',
  'Pick 2 Combo Plate - In House': 'Pick 2 Combo Plate',
  'Tandoori Paneer Burrito - In House': 'Tandoori Paneer Burrito',
  'Butter Chicken Burrito - In House': 'Butter Chicken Burrito',
}));

// Pipeline suffix-stripping rule (toast_pipeline/clean/normalize.py _SUFFIX_PATTERNS)
const SUFFIX_RE = /\s*-\s*(club feast|gameday|side|catering|in house|in-house|ezcater)\s*$/i;

function classify(raw, canonical) {
  const inPipelineMap = pipelineMap.get(raw) === canonical;
  const inDashboardMap = dashboardMap.get(raw) === canonical;
  const stripped = raw.replace(SUFFIX_RE, '').trim();
  const suffixMatch = stripped.toLowerCase() === canonical.toLowerCase() && stripped !== raw;
  // suffix-stripped result might ITSELF then get dashboard-mapped again (two-stage)
  const chainedMatch = suffixMatch === false && dashboardMap.get(stripped) === canonical && stripped !== raw;

  if (inPipelineMap && inDashboardMap) return 'pipeline_explicit + dashboard_BYO_FIX_CTE';
  if (inPipelineMap) return 'pipeline_explicit (name_mappings.csv)';
  if (inDashboardMap) return 'dashboard_BYO_FIX_CTE';
  if (suffixMatch) return 'pipeline_suffix_strip_rule';
  if (chainedMatch) return 'pipeline_suffix_strip_rule -> dashboard_BYO_FIX_CTE (two-stage)';
  return 'OPEN-ITEM REUSE (same item_guid, unrelated typed name — not a cleaning rule)';
}

const classified = rows.map(r => ({ ...r, type: classify(r.raw_name, r.canonical_name) }));

const openItemCount = classified.filter(r => r.type.startsWith('OPEN-ITEM')).length;
const cleaningCount = classified.length - openItemCount;
console.log(`Total pairs: ${classified.length}  |  genuine cleaning/normalization: ${cleaningCount}  |  open-item reuse (not cleaning): ${openItemCount}`);

const esc = v => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
const header = 'raw_name,normalized_canonical_name,normalization_type';
const lines = classified
  .sort((a, b) => a.type.localeCompare(b.type) || a.canonical_name.localeCompare(b.canonical_name))
  .map(r => [esc(r.raw_name), esc(r.canonical_name), esc(r.type)].join(','));
const csv = [header, ...lines].join('\n');
writeFileSync('/Users/anushka.agrawal/Desktop/all_normalized_names.csv', csv);
console.log('Written to ~/Desktop/all_normalized_names.csv');
