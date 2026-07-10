# Task: switch the four heavy dashboard queries to the precomputed cost layer

*Paste this whole document into your coding assistant as the task prompt.*
*Repo: `anushkaagrawalint-stack/PMIX-Dashboard` · work on a branch off `main`, open a PR.*

## Context (read fully before editing)

The dashboard recomputes modifier costs on every page load. On wide date ranges this
exceeds Vercel's function time limit — **selecting YTD currently errors** (measured:
`getMEPinkSheetDetails` alone takes 557s on YTD; fiscal Q1 ≈ 2 min total).

Two precomputed tables now exist **on production** (already built, already validated —
do NOT create them):

- **`analytics.pc_modifier_unit_cost`** `(norm_name, pnum, unit_cost)` — the resolved
  unit cost of every modifier per fiscal period (`pnum` = `fiscal_year*100+period`).
  It bakes in the full lookup from `docs/MODIFIER_COST_FIX_SPEC.md` §1: sauce aliases,
  extra/organic/1-2/side-/side-of rules, skip/no→0, the Spicy Mango Chutney hardcode.
  `norm_name` = `LOWER()` of the name with any Toast `' -*'` suffix stripped.
- **`analytics.pc_modifier_daily`** — daily-grain modifier facts:
  `business_date, pnum, location_code, raw_parent` (unmapped `fol.canonical_name`),
  `channel` (already override-aware — Needs-Review corrections folded in),
  `mod_display, mod_norm, section_base, from_item_type, pit_item_type,
  include_cmc, byo_type, in_byo_scope, qty`.

They are refreshed (~70s, atomic swap) at the end of every pipeline
`merge_to_public()` — see PMIX-Pipeline PR #1, **merge that PR first**.

Parity has been proven against the CURRENT live queries on P5-2026: all 1,582 detail
rows exact on qty and cost; BYO per-location exact; pink-sheet mod-cost sums to the
cent. Your job is a mechanical swap: same outputs, new source. **If any acceptance
number below changes, you have a bug — stop and compare against the old query.**

## Rules

1. Do NOT change function signatures, return types, UI components, or any formula
   (base costs, 1.18 uplift, denominators, thresholds, composite 1/2-and-1/2 logic).
2. Do NOT modify `lib/modifierCost.ts` (it stays as the documented rule source) and do
   NOT edit the pc_* tables or `sql/pc_refresh.sql` in the pipeline repo.
3. Keep the `byo_fix` map applied at read time exactly as today (`raw_parent` in the
   daily table is UNMAPPED).
4. Keep every query parameterized `[$1=start, $2=end]` as today.

## Change 1 — `getMEPinkSheetDetails` (lib/queries.ts)

Replace the entire body's FROM/JOIN pipeline (fact_modifiers × fact_order_lines ×
laterals × `modifierCostBatchSQL()`) with this reader (keep the function's map/return
code):

```sql
WITH byo_fix(raw, clean) AS (VALUES /* keep the existing map verbatim */),
sp AS (
  SELECT fiscal_year*100+period AS pnum FROM public.dim_fiscal_period
  WHERE start_date::DATE <= $2::DATE AND end_date::DATE >= $1::DATE
  ORDER BY fiscal_year DESC, period DESC LIMIT 1
),
rows_ AS (
  SELECT COALESCE(bf.clean, d.raw_parent) AS parent_item,
    CASE WHEN d.from_item_type AND COALESCE(uc.unit_cost,0) > 0
              AND d.pit_item_type ILIKE '%online%'
         THEN CASE WHEN d.pit_item_type ILIKE 'kids meal%' THEN 'Drink' ELSE 'Topping' END
         ELSE d.section_base END AS section,
    d.mod_display AS modifier_name,
    CASE WHEN d.channel IN ('APP','TPD','TPD_MARKUP') THEN 'online' ELSE 'ih' END AS channel,
    d.qty, d.qty * COALESCE(uc.unit_cost, 0) AS cost
  FROM analytics.pc_modifier_daily d
  CROSS JOIN sp
  LEFT JOIN byo_fix bf ON bf.raw = d.raw_parent
  LEFT JOIN analytics.pc_modifier_unit_cost uc
         ON uc.norm_name = d.mod_norm AND uc.pnum = sp.pnum
  WHERE d.business_date BETWEEN $1::DATE AND $2::DATE
    AND d.channel IN ('IN_HOUSE','APP','TPD','TPD_MARKUP')
    AND d.in_byo_scope
)
SELECT parent_item, section, modifier_name, channel,
       SUM(qty)::BIGINT AS qty, ROUND(SUM(cost)::NUMERIC,4) AS total_cost
FROM rows_
WHERE section IS NOT NULL AND section NOT IN ('Online','NA','ZeroCater')
GROUP BY 1,2,3,4
ORDER BY parent_item, channel, section, modifier_name
```

## Change 2 — `cmc` / `cmc_ih` CTEs in `getMEItems` AND `getMEPinkSheets`

Replace each `cmc`/`cmc_ih` CTE body (the fact_modifiers join + `modifierCostBatchSQL()`
/ mod_costs join) with reads of the daily table. Everything downstream of the CTEs
(base costs, qty denominators, avg-cost formulas, selected-period display) stays
untouched.

- **`getMEItems`** costs each order at ITS OWN period → join unit cost at `d.pnum`:

```sql
cmc AS (
  SELECT COALESCE(bf.clean, d.raw_parent) AS parent_item,
         'P'||LPAD((d.pnum % 100)::TEXT,2,'0')||'-'||(d.pnum / 100)::TEXT AS cost_period,
         SUM(d.qty * COALESCE(uc.unit_cost,0)) AS total_mod_cost
  FROM analytics.pc_modifier_daily d
  LEFT JOIN byo_fix bf ON bf.raw = d.raw_parent
  LEFT JOIN analytics.pc_modifier_unit_cost uc
         ON uc.norm_name = d.mod_norm AND uc.pnum = d.pnum
  WHERE d.business_date BETWEEN $1::DATE AND $2::DATE
    AND d.channel IN ('APP','TPD','TPD_MARKUP')      -- cmc_ih: = 'IN_HOUSE'
    AND d.include_cmc AND d.in_byo_scope
  GROUP BY 1, 2
)
```

- **`getMEPinkSheets`** prices at the SELECTED period → same CTE but join
  `uc.pnum = sp.pnum` (its `selected_period` CTE already exists) and group without
  `cost_period` where the current code does.

## Change 3 — `getModifiers` (BYO tab)

Replace `raw_mods` (the fact_modifiers × parent_item_type × modifier_type join) with:

```sql
raw_mods AS (
  SELECT byo_type AS raw_type, mod_display AS modifier_name,
         qty AS quantity, raw_parent AS parent_item, location_code
  FROM analytics.pc_modifier_daily
  WHERE byo_type IS NOT NULL
    AND business_date BETWEEN $1::DATE AND $2::DATE
)
```

`byo_type` is already lowercased and restricted to the main/base/veggie/topping/sauce/
chutney list. Keep `byo_mods`, `type_totals`, `mod_costs_resolved`, and the composite
`1/2 and 1/2` logic exactly as they are (they operate on these aggregates). For
`mod_costs_resolved`, you may keep the current lookup OR read
`pc_modifier_unit_cost` at the max pnum — only if the acceptance numbers still pass.

## Change 4 — cache lifetime

In `loadDashboardData`: `cacheLife('minutes')` → `cacheLife('hours')`. The data changes
once a day (pipeline merge), so minutes-level caching just re-pays query cost for
identical data.

## Acceptance (run ALL before opening the PR; paste outputs in the PR description)

1. `npx tsx --env-file=.env scripts/profile.mts` — before AND after. After the swap,
   `getMEPinkSheetDetails`, `getMEItems`, `getMEPinkSheets`, `getModifiers` must each be
   **< 3s** on the default range.
2. `npx tsx --env-file=.env scripts/profile.mts 2026-01-01 2026-07-10` (YTD) — the same
   four queries must be **< 5s**. This is the "YTD errors" fix.
3. Spec numbers (docs/MODIFIER_COST_FIX_SPEC.md §6) on P5 (2026-04-27 → 2026-05-24):
   Coconut Ginger unit cost **0.7998** · Tikka Masala **0.7360** · 1/2 Spinach
   **0.3573** · BYO Basmati Rice **0.2023** · summary vs Σdetail reconcile ≤ 0.1% for
   BYO Grain Bowl / Chicken Tikka Bowl.
4. In the running app: pick YTD from the date picker — the page must load without error;
   Pink Sheets, Menu Engineering, and BYO tabs all populated.
5. `tsc --noEmit` clean.

## Housekeeping in the same PR
- Once all four functions read pc_*, the runtime imports of `modifierCostBatchSQL` may
  be removed (leave the module file in place — it documents the rules the pipeline's
  `pc_refresh.sql` mirrors; a header comment in each file cross-references the other).

## Known trade-off (intentional — do not "fix")
Needs-Review channel overrides now reach these four tabs after the NEXT pipeline
refresh (daily), not instantly. The sales/channel tabs remain instant as today.
