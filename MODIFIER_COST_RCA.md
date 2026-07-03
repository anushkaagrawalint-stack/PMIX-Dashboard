# Modifier Cost RCA — Pink Sheets & Menu Engineering

## Overview

There are three separate modifier cost computation paths in the dashboard. Each has a distinct problem. The issues compound — a cost that looks wrong on the pink sheet summary row may be wrong for a *different* reason than the cost shown in the per-modifier detail breakdown.

---

## Root Cause 1 — `getMEPinkSheets` cmc/cmc_ih: No period grouping

**Most impactful. Causes blended/wrong costs whenever date range spans multiple periods.**

### What's happening

The `cmc` CTE in `getMEPinkSheets` groups by:

```sql
GROUP BY COALESCE(bf.clean, fol.canonical_name)   -- no cost_period
```

Compare to `getMEItems` `cmc` which is period-aware:

```sql
GROUP BY COALESCE(bf.clean, fol.canonical_name), cost_period
```

`getMEPinkSheets` aggregates ALL modifier costs across the entire selected date range into a single `total_mod_cost`. Each order's modifiers are priced at that order's period's unit cost via `dim_fiscal_period`, and those dollar amounts are all summed together. Then:

```
avg_cost_online = base_cost_online + total_mod_cost / online_qty
```

This divides a **multi-period blended sum** by the **total order count**, producing an average that corresponds to no single period.

### Example

Coconut Ginger Sauce: $0.65 in P4, $0.79 in P5. 100 BYO orders each period.

| What we compute | What pink sheet should show |
|---|---|
| `(0.65×100 + 0.79×100) / 200 = $0.72` | P5: `$0.79` or P4: `$0.65` |

The $0.72 is a time-weighted blend that corresponds to neither period.

### Why `getMEItems` doesn't have this problem

`getMEItems` matches modifier costs at `(parent_item, cost_period)` level and the final SELECT joins at the same period level. Pink sheet skips this join entirely.

---

## Root Cause 2 — COALESCE step ordering + R365 recipe rename (Coconut Ginger specific)

**Why Coconut Ginger shows P1's cost even when P5 is selected.**

### What's happening

At some point R365 renamed the recipe from **"Coconut Ginger"** → **"Coconut Ginger Sauce"**. This means:

- Old periods (P1, P2, …) have rows in `r365_modifier_cost` under `clean_name = 'Coconut Ginger'`
- New periods (P5 onward) have rows under `clean_name = 'Coconut Ginger Sauce'`
- In `fact_modifiers`, Toast still sends the modifier as `canonical_name = 'Coconut Ginger'`

The COALESCE lookup waterfall for `fm.canonical_name = 'Coconut Ginger'`:

| Step | Lookup | Result |
|---|---|---|
| 1 | `clean_name = 'coconut ginger'` AND `period = P05-2026` | NULL — no P5 entry under the old name |
| 2 | `clean_name = 'coconut ginger'` AND `period ≤ P05-2026`, most recent DESC | **P1's cost** — old "Coconut Ginger" entry from P1 is the most recent one under this name |
| 3 | SAUCE_ALIASES → `clean_name = 'coconut ginger sauce'` | **Never runs** — COALESCE stopped at step 2 |

Step 2 succeeds with the stale P1 entry. COALESCE never reaches the SAUCE_ALIASES step that would have found the correct P5 cost in "Coconut Ginger Sauce".

### Why the AppScript doesn't have this problem

The AppScript builds `costMap` by iterating **all** MI rows in r365 and keeping the **max cost per normalized name** (line 2988):

```javascript
if (!(key in costMap) || cost > costMap[key]) costMap[key] = cost;
```

So `costMap['coconut ginger']` might have the old P1 value. But `_getModCost_('Coconut Ginger')` fails the direct lookup, falls into SAUCE_ALIASES, and looks up `costMap['coconut ginger sauce']` — which has P5's cost. The stale P1 entry under the old name is completely bypassed.

### The fix direction

The SAUCE_ALIASES lookup (step 3) needs to run **before** the period-aware direct fallback (step 2), OR step 2 needs to be restricted to only match entries that exist in the **current** selected period (not any period ≤ current). As long as any old-name stale entry exists from any earlier period, it will shadow the alias lookup.

---

## Root Cause 3 — `getMEPinkSheetDetails`: Old lookup pipeline (no LOWER, no SAUCE_ALIASES, no 1/2 X)

**Causes the per-modifier detail breakdown to show $0 for several modifier families.**

The `getMEPinkSheetDetails` query was not updated when `cmc`/`cmc_ih` were fixed. It still uses:

```sql
WHERE r.clean_name = nm.base_name   -- exact case, no LOWER()
```

And has **no SAUCE_ALIASES step**. Effect per modifier family:

| Modifier | Why cost = 0 |
|---|---|
| Coconut Ginger | r365 has "Coconut Ginger Sauce" — alias lookup missing |
| Tikka Masala | r365 has "Tikka Masala Sauce" — alias lookup missing |
| Tamarind Chili (Spicy) | r365 has "Tamarind Chili Sauce" — alias lookup missing |
| Peanut Sesame | r365 has "Peanut Sesame Sauce" — alias lookup missing |
| 1/2 Spinach, 1/2 Brown Rice | No "1/2 X → half cost" handler |
| Chilli Lime Vinaigrette | Case mismatch — "Chilli" (fact_modifiers) vs "Chili" (r365), no LOWER() |

Additionally, `getMEPinkSheetDetails` uses a hardcoded `$1.249` for Tandoori Paneer, while `getMEPinkSheets` `cmc` uses the period-aware Tandoori Paneer → Organic Tandoori Paneer alias lookup. **These two paths produce different numbers for the same modifier.**

### Inconsistency created

`getMEPinkSheets` (summary row) now uses: LOWER + SAUCE_ALIASES + 1/2 X  
`getMEPinkSheetDetails` (per-modifier table) still uses: old exact-case, no aliases, no 1/2 X  

The unit costs in the detail breakdown **will not reconcile** with the total cost shown in the header row.

---

## Root Cause 4 — `getModifiers` (BYO Breakdown tab): Wrong cost source

The BYO Breakdown `mod_costs` CTE uses `r365_item_cost` as the **primary** source:

```sql
mod_costs AS (
  SELECT DISTINCT ON (item_name_updated) item_name_updated, avg_cost
  FROM analytics.r365_item_cost   -- ← wrong table as primary
  ORDER BY item_name_updated, RIGHT(period,4)::INT DESC ...
)
```

The AppScript uses `r365_modifier_cost` (MI rows) as primary and `r365_item_cost` only as a fallback for modifiers not found there. This query inverts that priority — any modifier present in both tables gets the item recipe cost instead of the modifier cost. These are often different values.

---

## Summary

| Query | Problem | Effect |
|---|---|---|
| `getMEPinkSheets` cmc/cmc_ih | No `cost_period` grouping | Multi-period date ranges blend modifier costs across periods → wrong modifier adder |
| `cmc`/`cmc_ih` COALESCE step 2 before step 3 | Stale old-name r365 entries shadow alias lookups | Coconut Ginger (and any renamed recipe) pulls old period's cost |
| `getMEPinkSheetDetails` | No LOWER(), no SAUCE_ALIASES, no 1/2 X, hardcoded Tandoori Paneer | ~6 modifier families show $0 in detail breakdown; summary and detail don't reconcile |
| `getModifiers` (BYO tab) | Uses `r365_item_cost` as primary instead of `r365_modifier_cost` | Wrong cost source for modifiers present in both tables |

---

## Fix Priority

1. **Move SAUCE_ALIASES before the period-aware direct fallback** in all cmc/cmc_ih COALESCE waterfalls — fixes Coconut Ginger and any other renamed recipe.
2. **Add `cost_period` to `getMEPinkSheets` cmc/cmc_ih** and match costs at the period level in the final SELECT — fixes multi-period blending.
3. **Update `getMEPinkSheetDetails`** to use the same LOWER + SAUCE_ALIASES + 1/2 X waterfall as the updated cmc CTEs — fixes the $0 detail rows and reconciles summary vs detail.
4. **Fix `getModifiers`** to use `r365_modifier_cost` (MI rows) as primary and `r365_item_cost` as fallback — matches AppScript lookup order.
