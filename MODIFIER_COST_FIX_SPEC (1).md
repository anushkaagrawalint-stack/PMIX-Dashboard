# Modifier Cost Fix Spec — Pink Sheets, Menu Engineering, BYO

**For:** Anushka (implementation) · **From:** Rishabh + Claude (planning/verification)
**Date:** 2026-07-02
**Code version this spec was written against:** `anushkaagrawalint-stack/PMIX-Dashboard` commit `ae710ec` (current `main`)
**Data verified against:** production Neon, live queries run 2026-07-02

This turns the Modifier Cost RCA into implementation-ready fixes. Every claim below was
re-verified against the current code and the live database; where the data told a
different story than the RCA, the correction is noted in §7. Please implement each fix
as its own branch + PR, run the acceptance queries in §6, and paste the results in the
PR description. We will re-run them independently before merge.

---

## 0. Design principle — ONE lookup, not four

Today the modifier-cost lookup is implemented four times (`getMEItems` cmc/cmc_ih,
`getMEPinkSheets` cmc/cmc_ih, `getMEPinkSheetDetails`, `getModifiers`) and they have
drifted. That drift *is* the bug family. The fix is one canonical lookup defined once
and reused everywhere.

**Recommended shape:** a TypeScript function in a new `lib/modifierCost.ts` that emits
the SQL expression, e.g.

```ts
// Returns a SQL scalar expression that resolves the unit cost of a modifier.
// nameExpr:   SQL expression for the modifier name (e.g. "fm.canonical_name" or "nm.base_name")
// periodExpr: SQL expression for the order's period key as YYYYPP integer
//             (e.g. "fp.fiscal_year * 100 + fp.period")
export function modifierUnitCostSQL(nameExpr: string, periodExpr: string): string { ... }
```

All four call sites interpolate this one expression. Any future rule change (new alias,
new hardcode removal) then lands everywhere at once. Keep the per-query WHERE filters
(menu scope, modifier_type exclusions) where they are — only the *cost resolution* is
shared.

---

## 1. The canonical lookup algorithm

For a modifier name `N` on an order in fiscal period `P` (as integer `YYYYPP`):

1. **Normalize:** strip the Toast auto-select suffix `' -*'`; all comparisons via
   `LOWER()`. Call the result `base`.
2. **Skip/No:** if `base` starts with `skip ` or `no ` → cost `0`. (Exists today only
   in `getModifiers`; make it universal.)
3. **Candidate names** = `base` plus its alias, if one exists:

   | Toast sends (`base`) | R365 alias |
   |---|---|
   | tomato garlic (butter masala) | tomato garlic sauce |
   | tikka masala | tikka masala sauce |
   | tamarind chili (spicy) | tamarind chili sauce |
   | peanut sesame | peanut sesame sauce |
   | coconut ginger | coconut ginger sauce |
   | tandoori paneer | organic tandoori paneer |
   | romaine | shredded romaine |

4. **Primary lookup** — one subquery over BOTH candidate names at once:

   ```sql
   SELECT r.cost_per_portion
   FROM analytics.r365_modifier_cost r
   WHERE r.recipe_name LIKE 'MI %' AND r.cost_per_portion > 0
     AND LOWER(r.clean_name) IN (<base>, <alias>)          -- candidate set
     AND RIGHT(r.period,4)::INT * 100 + SUBSTRING(r.period,2,2)::INT <= <P>
   ORDER BY RIGHT(r.period,4)::INT * 100 + SUBSTRING(r.period,2,2)::INT DESC,  -- freshest ≤ P wins
            (LOWER(r.clean_name) = <base>) DESC                                 -- tie → direct name
   LIMIT 1
   ```

   **This single ORDER BY replaces the RCA's "move step 3 before step 2" — and is
   provably safer.** Why: the RCA's reorder (alias before direct fallback) breaks
   Tikka Masala, which R365 renamed *and then renamed back* — it has a P5 row under the
   OLD name (`Tikka Masala`, $0.7360) that must beat the alias's stale P4 row
   (`Tikka Masala Sauce`, $0.7497). "Freshest period ≤ P across both names, tie goes to
   the direct name" gets every case right:
   - Coconut Ginger @ P5: alias's P5 row ($0.7998) beats direct's P2 row ($0.8331) ✓
   - Tikka Masala @ P5: direct's P5 row ($0.7360) beats alias's P4 row ($0.7497) ✓
   - Any sauce @ P6/P7 (no R365 data loaded yet): freshest available (P5) row wins,
     regardless of which name it's under ✓

5. **Pattern fallbacks**, only if step 4 found nothing, each using the same
   freshest-≤-P ordering:
   - `Extra Organic X` → cost of `X` (check before `Extra X` — longer prefix first)
   - `Extra X` → cost of `X`
   - `Organic X` → cost of `X`
   - `1/2 X` → **half** cost of `X` — *fallback only*: R365 has dedicated `1/2 X`
     recipe rows for every common half-modifier (`1/2 Spinach` $0.3573,
     `1/2 Basmati Rice`, `1/2 Chicken`, `1/2 Tandoori Paneer` ≈$0.74 …) and those direct
     rows resolve at step 4. Do NOT let computed halving shadow them — R365's own
     half-portion cost differs from naive halving (1/2 Tandoori Paneer $0.74 vs
     $1.249/2 = $0.62).
   - `X - Side` → cost of `X`
   - Hardcode: `spicy mango chutney` (and `- side`) → `0.1777` (keep for now; ask R365
     to add the recipe, then delete)
6. Else `0`.

**Delete the Tandoori Paneer `$1.2490` hardcode** in `getMEPinkSheetDetails` — the
alias (step 3) resolves it period-aware. The hardcode equals exactly the P5 value of
Organic Tandoori Paneer, so it silently mis-costs every other period (P1 = $1.2166)
and will drift further each new period.

---

## 2. Fix RC1 — Pink Sheet cmc/cmc_ih must be period-aware

**File:** `lib/queries.ts`, `getMEPinkSheets`.

`cmc` and `cmc_ih` end with `GROUP BY COALESCE(bf.clean, fol.canonical_name)` (no
`cost_period`) and the final SELECT divides the range-wide modifier-cost sum by the
range-wide qty. Any date range spanning periods produces a blended unit cost that
matches no period.

**Change:** mirror `getMEItems`:
1. Add `cost_period` to both CTEs' SELECT + GROUP BY (the expression already exists in
   `getMEItems` lines ~691/787).
2. Make `online_orders` / `ih_orders` also group by `cost_period`.
3. Compute `avg_cost_online` / `avg_cost_ih` per (item, period):
   `base_cost(period) + mod_cost(period) / qty(period)`.
4. **Display rule — DECIDED by owner 2026-07-02:** the pink sheet shows the unit cost
   of **the fiscal period selected on the dashboard**. Concretely: the most recent
   fiscal period that overlaps the selected date range — the same convention the Bikky
   retention tab already uses (`activeBikkyPeriod`, `Dashboard.tsx` ~line 399). When
   the user picks a single period from the period dropdown, that IS the selected
   period; for free ranges (YTD, Last 4 Weeks, custom) it resolves to the latest
   overlapping period. Never blend across periods. (The ME tab's *total margin
   dollars* are different: costing each period's orders at that period's cost and
   summing is correct there — `getMEItems` already does this; don't change it.)

---

## 3. Fix RC2 — replace all four COALESCE waterfalls with the §1 lookup

**Files:** `lib/queries.ts` — `getMEItems` (cmc ~line 692, cmc_ih ~line 803),
`getMEPinkSheets` (cmc ~1312, cmc_ih ~1370), `getMEPinkSheetDetails` (~1550).

All five waterfalls currently run "direct, freshest ≤ P under the SAME name" (step 2)
before the alias steps, so a stale old-name row shadows the alias forever. Replace each
9-step COALESCE with the shared `modifierUnitCostSQL(...)` expression.

Also sweep for any remaining **text-sorted period ordering** (`ORDER BY period DESC`
on the raw text column). It happens to work while all data is fiscal-2026 (`LPAD`ed
period within one year) but breaks at the year boundary (`'P10-2025' > 'P02-2026'` as
text). The numeric form `RIGHT(period,4)::INT * 100 + SUBSTRING(period,2,2)::INT` is
already used in the newer code — make it universal (also in `ih_base`/`online_base`/
`any_base`/`rmc_latest`-style CTEs and `getModifiers`' `mod_costs`).

---

## 4. Fix RC3 & RC4 — detail breakdown and BYO tab

### RC3 — `getMEPinkSheetDetails`
Currently: exact-case matching (no `LOWER`), no aliases, no `1/2 X`, hardcoded Tandoori
Paneer. Rewire its cost expression to `modifierUnitCostSQL('nm.base_name', ...)`, drop
`hardcoded_costs`. Keep its `' -*'` suffix-stripping (`nm.base_name`) — that becomes
the normalize step (§1.1) of the shared lookup.

**Acceptance:** for one item (e.g. BYO Grain Bowl, P5, online), the detail rows'
`Σ(qty × unit_cost)` must equal the summary row's `total_mod_cost` to the cent, and no
Sauce-family row shows $0.

### RC4 — `getModifiers` (BYO Breakdown tab)
The `mod_costs` CTE reads **only** `analytics.r365_item_cost`. Two consequences:
- Core BYO modifiers that exist only in `r365_modifier_cost` — Basmati Rice ($0.2023),
  Lemon Turmeric Rice, Masala Quinoa, Arugula, Baby Spinach, Romaine Lettuce, all
  `1/2 X` rows — resolve to **NULL** (blank cost in the UI).
- Names present in both tables get the item-recipe cost instead of the modifier-portion
  cost (drinks/sides differ by $0.01–0.09).

**Change:** primary = `r365_modifier_cost` MI rows (freshest ≤ P, numeric period sort),
fallback = `r365_item_cost` — i.e., the AppScript's order. Simplest path: use the shared
§1 lookup as primary and keep a slimmed `r365_item_cost` DISTINCT ON as the final
fallback before `0`. Keep the composite `1/2 and 1/2` weighted-average logic — it's
correct and out of scope.

---

## 5. Owner decisions — RESOLVED 2026-07-02

1. **Pink Sheet unit cost = the period selected on the dashboard** (via the
   latest-overlapping-period rule, §2.4). Blending across periods is not acceptable.
2. **Spicy Mango Chutney stays hardcoded ($0.1777) for now.** Revisit if/when R365
   adds the recipe row.

---

## 6. Acceptance tests (run on production Neon; paste results in the PR)

All numbers below were pulled live on 2026-07-02.

**T1 — sauce lookup, P5-only range (2026-04-27 → 2026-05-23):** unit cost resolved for
these `fact_modifiers` names must be:

| Toast name | Current (buggy) | Expected after fix | Why |
|---|---|---|---|
| Coconut Ginger | 0.8331 | **0.7998** | alias's P5 row wins over direct's stale P2 |
| Tikka Masala | 0.7360 | **0.7360** | direct P5 row must STILL win (guard case) |
| Tamarind Chili (Spicy) | 0.7234 | **0.6996** | alias P5 |
| Peanut Sesame | 0.5304 | **0.5310** | alias P5 |
| Tomato Garlic (Butter Masala) | 0.7524 | **0.7524** | values coincide; must come from alias P5 row |
| Tandoori Paneer | (varies/hardcode) | **1.2490** | alias = Organic Tandoori Paneer P5 |
| 1/2 Spinach | 0 or computed | **0.3573** | direct R365 `1/2 Spinach` row |

**T2 — no multi-period blending:** run Pink Sheets for P4+P5 combined
(2026-03-30 → 2026-05-23). The displayed unit modifier cost for Coconut Ginger-heavy
items must equal the P5-only number (selected period = latest overlapping = P5, per
§2.4), not a P4/P5 blend. Sanity: Coconut Ginger Sauce is 0.7998 in both P4 and P5 but
0.8331 in P3 — so a P3–P5 range is the sharper test: selected-period display = 0.7998;
the buggy blend would sit between 0.7998 and 0.8331 (P3 qty 1563 / P4 1256 / P5 1213).
Also verify the single-period case: selecting exactly "P4" from the period dropdown
shows P4's cost (0.7998 for Coconut Ginger Sauce; base costs may differ from P5's).

**T3 — summary/detail reconciliation (RC3):** for BYO Grain Bowl, BYO Salad Bowl and
Chicken Tikka Bowl, P5 online: `Σ(detail qty × unit_cost)` = summary `total_mod_cost`
(±$0.01), and zero $0 rows in the Sauce / Chutney + Dressing sections.

**T4 — BYO tab costs (RC4):** on any P5 range the BYO Breakdown must show
Basmati Rice ≈ **$0.20**, Masala Quinoa ≈ **$0.31**, Arugula ≈ **$0.80**,
Baby Spinach ≈ **$0.71**, Romaine Lettuce ≈ **$1.14** (currently blank), and
1/2 Tandoori Paneer ≈ **$0.74** (NOT $0.62 = half of full).

**T5 — regression:** `getMEItems` total margin for P5 must not change by more than the
sauce-cost corrections imply (spot-check one location × one channel before/after; a
swing >2% needs explanation).

---

## 7. Corrections to the RCA (verified against live data — trust these)

1. **The renames happened at P3, not P5:** all five sauces have old-name rows in P1–P2
   only and `... Sauce` rows from P3 on. (Coconut Ginger example values in the RCA —
   $0.65/$0.79 — were illustrative; real values are $0.8331 → $0.7998.)
2. **Tikka Masala flip-flopped:** it ALSO has a P5 row under the old name (`Tikka
   Masala`, $0.7360). This is why "alias always first" is wrong and the §1.4 ordering
   is required. The RCA's fix direction would have mis-priced it.
3. **"Chilli vs Chili" case mismatch: not reproduced.** `fact_modifiers` contains only
   the single-L `Chili Lime Vinaigrette` spellings (all-time), which exact-match R365.
   Keep `LOWER()` everywhere anyway, but no special fix is needed.
4. **Detail rows are currently stale, not $0, for the aliased sauces** — the RCA's "$0"
   table predates the partial detail-query update that added the freshest-≤-P direct
   fallback. Genuinely-$0 today: the `1/2 X` family (no handler + only `rmc`
   exact-period step matches nothing). Acceptance test T3 covers both.
5. **Catering-tier suffixed names** (`Coconut Ginger - Classic`, `Tikka Masala - Party
   Pack`, …) are typed `Catering - Sauce` in `analytics.modifier_type` and are
   correctly excluded from pink-sheet/ME cost CTEs. No action needed — don't "fix" them in.
6. **`1/2 X` rows exist natively in R365** (§1.5) — the computed-half rule is a
   fallback, not the primary path.
7. **R365 data currently ends at P5-2026**; the fiscal calendar runs through P12. Any
   P6+ range exercises the freshest-≤-P fallback for *every* modifier — worth one
   manual look at the Pink Sheet on a P6 range after the fix.

---

## 8. Suggested implementation order

1. **PR 1:** `lib/modifierCost.ts` (shared lookup) + wire into `getMEItems` +
   `getMEPinkSheets` cmc/cmc_ih (= RC2) **and** add period grouping to Pink Sheets
   (= RC1). These interact; doing them together avoids re-testing the same queries twice.
   Acceptance: T1, T2, T5.
2. **PR 2:** rewrite `getMEPinkSheetDetails` on the shared lookup (= RC3).
   Acceptance: T3.
3. **PR 3:** `getModifiers` cost-source inversion (= RC4). Acceptance: T4.
4. Sweep for text-sorted `period DESC` orderings (§3) — can ride along in PR 1.

---

## 9. Verification results — her implementation @ `fe230e5` (added 2026-07-03)

Ran the acceptance suite against Anushka's ACTUAL pushed query functions on production.

**Verdict: implementation is correct; ONE pre-existing bug blocks sign-off.**
19/20 checks pass once a one-line fiscal-boundary fix is applied (verified by patching
locally and re-running). As pushed, all T1 unit costs read ~3–4% low.

### The blocker — fiscal-period join orphans day 1 of every period
`dim_fiscal_period` stores INCLUSIVE dates (P5 = 2026-04-27 → 2026-05-24, 28 days), but
every fiscal join uses `fol.business_date > fp.start_date::DATE` (strictly greater), so
the first day of each period matches NO period (not > its own start; not ≤ prior end).
Those orders get `pnum` NULL → `mod_costs` join misses → modifiers priced $0
(2026-04-27 alone: 3,279 modifier rows). This PREDATES the modifier-cost work — the old
code masked it via the period-less "latest cost" fallback; the new period-strict
pipeline correctly exposes it.

**Fix (verified — with it, all T1 hit exactly):**
1. `business_date > fp.start_date::DATE` → `>=` — 9 instances (8 in `lib/queries.ts`,
   1 in `lib/modifierCost.ts` `_mod_pairs`).
2. `selected_period` overlap test (`lib/queries.ts` ~1242): `start_date::DATE < $2::DATE`
   → `<=` (same convention; a range equal to a period's first day selects no period).
No double-counting risk: periods are contiguous and disjoint (P4 ends 04-26, P5 starts
04-27), so `>= start AND <= end` is exact.

### Results (with the boundary fix applied)
- **T1** all 7 exact — incl. Coconut Ginger 0.7998 and the Tikka Masala 0.7360 guard.
- **T2** pink-sheet summary: PASS (P3–P5 range = P5-only; selected-period rule works).
- **T3** summary vs Σdetail reconcile ≤0.1%; no $0 sauce/chutney rows.
- **T4** BYO tab: all 6 (Basmati Rice 0.2023 … 1/2 Tandoori Paneer 0.7494 from R365's
  native half-row — correct, not naive halving).

### Remaining notes (non-blocking)
1. **Detail tab on multi-period ranges** prices each order at its own period while the
   summary shows the selected period → the two won't reconcile on spanning ranges
   (P3–P5 Coconut Ginger: detail 0.8129 vs summary 0.7998). Single-period ranges (the
   normal case) reconcile perfectly. Recommend: join the detail's `mod_costs` at the
   selected period, same as the summary.
2. `getModifiers` re-inlines the alias list instead of importing it from
   `lib/modifierCost.ts` (a 5th copy — drift risk). Suggest exporting the alias CASE
   from the module and reusing.
3. Process: pushed straight to `main`, and the commit bundles unrelated tab work
   (EntreeMix, ChannelMenu, Overview). Branch + PR next time, one concern per PR.
4. Spec's P5 range (04-27→05-23) was one day short; true P5 ends 05-24. Doesn't affect
   unit costs; acceptance runs used the corrected calendar.
