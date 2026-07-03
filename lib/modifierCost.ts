/**
 * Batch pre-computation of modifier unit costs.
 *
 * Returns a SQL fragment containing four helper CTEs followed by `mod_costs`:
 *
 *   _mi          — r365_modifier_cost scanned ONCE, numeric pnum computed
 *   _mod_pairs   — DISTINCT (norm_name, target_pnum) from fact_modifiers in [$1,$2]
 *   _cands       — _mod_pairs × _mi hash-joined (alias expansion here)
 *   _primary     — freshest-≤-P row per (norm_name, target_pnum), direct name wins ties
 *   mod_costs    — §1.2 skip/no, §1.4 primary, §1.5a-f fallbacks (all vs small _primary)
 *
 * Drop-in for the old `mod_costs AS (SELECT … modifierUnitCostSQL …)` CTE.
 * Expects $1 = start_date, $2 = end_date in the parameterized query.
 * Outputs: norm_name TEXT, pnum INT, unit_cost FLOAT
 */
export function modifierCostBatchSQL(): string {
  return `
  _mi AS (
    SELECT LOWER(clean_name) AS clean_name, cost_per_portion,
           RIGHT(period,4)::INT * 100 + SUBSTRING(period,2,2)::INT AS pnum
    FROM analytics.r365_modifier_cost
    WHERE recipe_name LIKE 'MI %' AND cost_per_portion > 0
  ),
  _mod_pairs AS (
    SELECT DISTINCT
      LOWER(REGEXP_REPLACE(fm.canonical_name, ' -\\*$', '')) AS norm_name,
      fp.fiscal_year * 100 + fp.period                        AS target_pnum
    FROM public.fact_modifiers fm
    JOIN public.fact_order_lines fol ON fm.parent_selection = fol.selection_guid
    LEFT JOIN public.dim_fiscal_period fp
           ON fol.business_date >  fp.start_date::DATE
          AND fol.business_date <= fp.end_date::DATE
    WHERE NOT fol.is_voided AND NOT fol.is_deferred AND NOT fm.is_voided
      AND fol.business_date BETWEEN $1::DATE AND $2::DATE
      AND fp.fiscal_year IS NOT NULL
  ),
  _cands AS (
    SELECT mp.norm_name, mp.target_pnum, m.cost_per_portion,
           m.pnum AS src_pnum,
           (m.clean_name = mp.norm_name) AS is_direct
    FROM _mod_pairs mp
    JOIN _mi m ON m.clean_name IN (
      mp.norm_name,
      CASE mp.norm_name
        WHEN 'tomato garlic (butter masala)' THEN 'tomato garlic sauce'
        WHEN 'tikka masala'                  THEN 'tikka masala sauce'
        WHEN 'tamarind chili (spicy)'        THEN 'tamarind chili sauce'
        WHEN 'peanut sesame'                 THEN 'peanut sesame sauce'
        WHEN 'coconut ginger'                THEN 'coconut ginger sauce'
        WHEN 'tandoori paneer'               THEN 'organic tandoori paneer'
        WHEN 'romaine'                       THEN 'shredded romaine'
        ELSE mp.norm_name
      END
    )
    WHERE m.pnum <= mp.target_pnum
  ),
  _primary AS (
    SELECT DISTINCT ON (norm_name, target_pnum) norm_name, target_pnum, cost_per_portion
    FROM _cands
    ORDER BY norm_name, target_pnum, src_pnum DESC, is_direct DESC
  ),
  mod_costs AS (
    SELECT
      mp.norm_name,
      mp.target_pnum AS pnum,
      CASE
        WHEN mp.norm_name LIKE 'skip %' OR mp.norm_name LIKE 'no %' THEN 0
        WHEN p.cost_per_portion IS NOT NULL THEN p.cost_per_portion
        WHEN mp.norm_name LIKE 'extra organic %' THEN
          (SELECT p2.cost_per_portion FROM _primary p2
           WHERE p2.norm_name = SUBSTRING(mp.norm_name FROM 15) AND p2.target_pnum = mp.target_pnum)
        WHEN mp.norm_name LIKE 'extra %' AND mp.norm_name NOT LIKE 'extra organic %' THEN
          (SELECT p2.cost_per_portion FROM _primary p2
           WHERE p2.norm_name = SUBSTRING(mp.norm_name FROM 7) AND p2.target_pnum = mp.target_pnum)
        WHEN mp.norm_name LIKE 'organic %' THEN
          (SELECT p2.cost_per_portion FROM _primary p2
           WHERE p2.norm_name = SUBSTRING(mp.norm_name FROM 9) AND p2.target_pnum = mp.target_pnum)
        WHEN mp.norm_name LIKE '1/2 %' THEN
          (SELECT p2.cost_per_portion / 2.0 FROM _primary p2
           WHERE p2.norm_name = REGEXP_REPLACE(SUBSTRING(mp.norm_name FROM 5), '^and ', '', 'i')
             AND p2.target_pnum = mp.target_pnum)
        WHEN mp.norm_name LIKE '% - side' THEN
          (SELECT p2.cost_per_portion FROM _primary p2
           WHERE p2.norm_name = LEFT(mp.norm_name, LENGTH(mp.norm_name) - 7)
             AND p2.target_pnum = mp.target_pnum)
        WHEN mp.norm_name IN ('spicy mango chutney', 'spicy mango chutney - side') THEN 0.1777
        ELSE 0
      END::NUMERIC AS unit_cost
    FROM _mod_pairs mp
    LEFT JOIN _primary p ON p.norm_name = mp.norm_name AND p.target_pnum = mp.target_pnum
  )`.trim();
}

/**
 * Canonical modifier-cost lookup — §1 of MODIFIER_COST_FIX_SPEC.md.
 *
 * One function, four call sites. Any future rule change (new alias, new hardcode
 * removal) lands everywhere at once instead of drifting across four copies.
 *
 * @param nameExpr   SQL expression for the raw modifier name  (e.g. "fm.canonical_name")
 * @param periodExpr SQL expression for the period as YYYYPP integer
 *                   (e.g. "fp.fiscal_year * 100 + fp.period")
 * @returns          A SQL scalar expression that resolves the per-unit cost.
 */
export function modifierUnitCostSQL(nameExpr: string, periodExpr: string): string {
  // §1.1 Normalize: strip Toast auto-select suffix ' -*' and lowercase.
  const b = `LOWER(REGEXP_REPLACE(${nameExpr}, ' -\\*$', ''))`;

  // §1.3 Alias: Toast display name → R365 recipe clean_name.
  // ELSE = b itself, so IN(b, b) deduplicates to IN(b) effectively.
  const alias = `CASE ${b}
      WHEN 'tomato garlic (butter masala)' THEN 'tomato garlic sauce'
      WHEN 'tikka masala'                  THEN 'tikka masala sauce'
      WHEN 'tamarind chili (spicy)'        THEN 'tamarind chili sauce'
      WHEN 'peanut sesame'                 THEN 'peanut sesame sauce'
      WHEN 'coconut ginger'                THEN 'coconut ginger sauce'
      WHEN 'tandoori paneer'               THEN 'organic tandoori paneer'
      WHEN 'romaine'                       THEN 'shredded romaine'
      ELSE ${b}
    END`;

  // Helper: freshest-≤-P MI lookup for a single (already-lowercase) name expression.
  const mi = (cleanExpr: string) =>
    `(SELECT r.cost_per_portion
       FROM analytics.r365_modifier_cost r
       WHERE r.recipe_name LIKE 'MI %' AND r.cost_per_portion > 0
         AND LOWER(r.clean_name) = ${cleanExpr}
         AND RIGHT(r.period,4)::INT * 100 + SUBSTRING(r.period,2,2)::INT <= ${periodExpr}
       ORDER BY RIGHT(r.period,4)::INT * 100 + SUBSTRING(r.period,2,2)::INT DESC LIMIT 1)`;

  return `
  CASE
    -- §1.2 Skip / No modifiers cost 0
    WHEN ${b} LIKE 'skip %' OR ${b} LIKE 'no %' THEN 0
    ELSE COALESCE(
      -- §1.4 Primary: freshest row ≤ P across {direct name, alias}; tie → direct name wins.
      --   Handles Tikka Masala P5 flip-flop and stale-alias Coconut Ginger correctly.
      (SELECT r.cost_per_portion
       FROM analytics.r365_modifier_cost r
       WHERE r.recipe_name LIKE 'MI %' AND r.cost_per_portion > 0
         AND LOWER(r.clean_name) IN (${b}, ${alias})
         AND RIGHT(r.period,4)::INT * 100 + SUBSTRING(r.period,2,2)::INT <= ${periodExpr}
       ORDER BY RIGHT(r.period,4)::INT * 100 + SUBSTRING(r.period,2,2)::INT DESC,
                (LOWER(r.clean_name) = ${b}) DESC
       LIMIT 1),
      -- §1.5a Extra Organic X → cost of X  (checked before Extra X — longer prefix first)
      CASE WHEN ${b} LIKE 'extra organic %' THEN
        ${mi(`SUBSTRING(${b} FROM 15)`)}
      END,
      -- §1.5b Extra X → cost of X
      CASE WHEN ${b} LIKE 'extra %' AND ${b} NOT LIKE 'extra organic %' THEN
        ${mi(`SUBSTRING(${b} FROM 7)`)}
      END,
      -- §1.5c Organic X → cost of X
      CASE WHEN ${b} LIKE 'organic %' THEN
        ${mi(`SUBSTRING(${b} FROM 9)`)}
      END,
      -- §1.5d 1/2 X → half cost of X  (fallback only; R365 native 1/2 rows resolve at §1.4)
      CASE WHEN ${b} LIKE '1/2 %' THEN
        (SELECT r.cost_per_portion / 2.0
         FROM analytics.r365_modifier_cost r
         WHERE r.recipe_name LIKE 'MI %' AND r.cost_per_portion > 0
           AND LOWER(r.clean_name) = REGEXP_REPLACE(SUBSTRING(${b} FROM 5), '^and ', '', 'i')
           AND RIGHT(r.period,4)::INT * 100 + SUBSTRING(r.period,2,2)::INT <= ${periodExpr}
         ORDER BY RIGHT(r.period,4)::INT * 100 + SUBSTRING(r.period,2,2)::INT DESC LIMIT 1)
      END,
      -- §1.5e X - Side → cost of X
      CASE WHEN ${b} LIKE '% - side' THEN
        ${mi(`LEFT(${b}, LENGTH(${b}) - 7)`)}
      END,
      -- §1.5f Hardcode: keep until R365 adds the recipe row (§5.2)
      CASE WHEN ${b} IN ('spicy mango chutney', 'spicy mango chutney - side') THEN 0.1777 END,
      -- §1.6 Else 0
      0
    )
  END`.trim();
}
