-- MODIFIER_COST_ACCEPTANCE.sql — companion to MODIFIER_COST_FIX_SPEC.md
-- Run in the Neon SQL editor (or psql) against production. Read-only.
--
-- REFERENCE IMPLEMENTATION of the §1 canonical lookup, evaluated for the T1
-- test names at period P5-2026 (202605). After implementing the shared lookup,
-- your dashboard's resolved unit costs must match the `expected` column here.
-- Change the `sel_period` value to test other periods.

WITH params AS (SELECT 202605 AS sel_period),
aliases(base, alias) AS (VALUES
  ('tomato garlic (butter masala)', 'tomato garlic sauce'),
  ('tikka masala',                  'tikka masala sauce'),
  ('tamarind chili (spicy)',        'tamarind chili sauce'),
  ('peanut sesame',                 'peanut sesame sauce'),
  ('coconut ginger',                'coconut ginger sauce'),
  ('tandoori paneer',               'organic tandoori paneer'),
  ('romaine',                       'shredded romaine')
),
-- T1 test names (add any modifier name here to test it)
tests(toast_name, expected) AS (VALUES
  ('Coconut Ginger',                0.7998),
  ('Tikka Masala',                  0.7360),   -- guard: direct P5 row must beat alias P4
  ('Tamarind Chili (Spicy)',        0.6996),
  ('Peanut Sesame',                 0.5310),
  ('Tomato Garlic (Butter Masala)', 0.7524),
  ('Tandoori Paneer',               1.2490),
  ('1/2 Spinach',                   0.3573)    -- direct R365 half-row, NOT computed half
),
mi AS (
  SELECT clean_name, cost_per_portion,
         RIGHT(period,4)::INT * 100 + SUBSTRING(period,2,2)::INT AS pnum
  FROM analytics.r365_modifier_cost
  WHERE recipe_name LIKE 'MI %' AND cost_per_portion > 0
)
SELECT
  t.toast_name,
  t.expected,
  -- §1 lookup: freshest row ≤ selected period across {direct name, alias}, tie → direct
  (SELECT m.cost_per_portion FROM mi m, params p
   WHERE LOWER(m.clean_name) IN (
           LOWER(t.toast_name),
           COALESCE((SELECT a.alias FROM aliases a WHERE a.base = LOWER(t.toast_name)), LOWER(t.toast_name))
         )
     AND m.pnum <= p.sel_period
   ORDER BY m.pnum DESC, (LOWER(m.clean_name) = LOWER(t.toast_name)) DESC
   LIMIT 1)                                            AS reference_lookup,
  CASE WHEN ROUND((SELECT m.cost_per_portion FROM mi m, params p
   WHERE LOWER(m.clean_name) IN (
           LOWER(t.toast_name),
           COALESCE((SELECT a.alias FROM aliases a WHERE a.base = LOWER(t.toast_name)), LOWER(t.toast_name))
         )
     AND m.pnum <= p.sel_period
   ORDER BY m.pnum DESC, (LOWER(m.clean_name) = LOWER(t.toast_name)) DESC
   LIMIT 1)::NUMERIC, 4) = t.expected
   THEN 'PASS' ELSE 'CHECK' END                        AS status
FROM tests t
ORDER BY t.toast_name;

-- T4 (BYO tab, RC4): after the fix, these must show costs in the BYO Breakdown
-- (today they are blank because they exist only in r365_modifier_cost):
--   Basmati Rice ≈ 0.2023 · Masala Quinoa ≈ 0.3121 · Arugula ≈ 0.7969
--   Baby Spinach ≈ 0.7145 · Romaine Lettuce ≈ 1.1415 · 1/2 Tandoori Paneer ≈ 0.74
--
-- T3 (summary/detail reconciliation): for BYO Grain Bowl / BYO Salad Bowl /
-- Chicken Tikka Bowl, P5 online: Σ(detail qty × unit_cost) = summary total_mod_cost
-- (±$0.01) and no $0 rows in Sauce / Chutney + Dressing sections. Verify in the UI
-- or by running the two fixed queries side by side.
