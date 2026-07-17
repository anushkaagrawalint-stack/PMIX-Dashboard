# Task: add Toast-exact refunds to the dashboard (Item Mix + headline Net Revenue)

*Paste this whole document into your coding assistant as the task prompt.*
*Repo: `anushkaagrawalint-stack/PMIX-Dashboard` · branch off `main`, open a PR.*

## Context

Toast's item report computes **Net item amt = Gross − Discounts − Refunds**. Our
dashboard currently stops at Gross − Discounts, so it reads high by the refund amount
(Jul 6–12: $1,068.91). The refund data is already extracted and live in production —
**do NOT create it**:

**`analytics.refund_sales`** (a VIEW over the raw Toast payloads, always current,
one row per refunded item line):
`location_code · business_date · order_guid · check_guid · selection_guid ·
item_name · sales_refund · tax_refund · refund_txn_guid`

It joins to `public.fact_order_lines` by `selection_guid` (verified 71/71 rows join),
so every refund inherits the line's canonical item, channel, location and service
date. Attribution: refunds ride the refunded LINE's `business_date` — exactly how
Toast's item report dates them. Verified against Toast UI for 2026-07-06→07-12:
sales_refund total = **$1,068.91 to the cent** (The Party Pack $698.91 + Tandoori
Tasting Bundle $370.00, both CATERING).

## Changes

### 1. `getSummary` (lib/queries.ts)
Add a `refunds` figure for the selected range/scope and a net-of-refunds headline:

```sql
-- inside the same date range; scope via the join to fact_order_lines (BASE_WHERE)
SELECT COALESCE(SUM(rs.sales_refund), 0) AS refunds
FROM analytics.refund_sales rs
JOIN public.fact_order_lines fol USING (selection_guid)
WHERE ${BASE_WHERE}
  AND fol.business_date BETWEEN $1::DATE AND $2::DATE
```
Expose on `Summary`: `refunds` and `net_revenue = total_revenue - refunds`.
Overview KPI shows **Net Revenue = net_revenue** (this is the number that equals
Toast) with a small sub-line `after $X refunds` when refunds > 0. Do not remove or
rename `total_revenue` — other tabs consume it.

### 2. Item queries — `getItems`, `getChannelItems`, `getLocationItems`
Add per-item refunds via a pre-aggregated LEFT JOIN (do NOT join row-level into the
main aggregate — it would fan out):

```sql
LEFT JOIN (
  SELECT fol2.canonical_name /* + channel/location to match each query's grain */,
         SUM(rs.sales_refund) AS refunds
  FROM analytics.refund_sales rs
  JOIN public.fact_order_lines fol2 USING (selection_guid)
  WHERE fol2.business_date BETWEEN $1::DATE AND $2::DATE
  GROUP BY 1
) rf ON rf.canonical_name = <the query's item key>
```
Match each query's existing grain (add `channel`/`location_code` to the subquery's
SELECT/GROUP BY/join for getChannelItems/getLocationItems). Apply the same `byo_fix`
mapping to `fol2.canonical_name` as the outer query uses, so refunds land on the same
merged item row. New fields: `refunds` (0 when null), `net_after_refunds = revenue −
refunds`.

### 3. Item Mix UI (`components/tabs/ItemMix.tsx`)
Two new columns after Net Sales: **Refunds** and **Net after Refunds**. Exact dollar
formatting (`$1,068.91`-style, never abbreviated). Group headers/totals must sum the
new columns. Rows with zero refunds show `—` or `$0.00` (match existing style).

### 4. Do NOT touch
`pc_*` tables, `lib/modifierCost.ts`, Menu Engineering / Pink Sheets math (refunds are
a revenue-reporting concept; cost/margin tabs stay as-is for now), `fact_adjustments`
(payment-level audit record — not the reporting source; it bundles tax differently).

## Acceptance (run before PR; paste results in the description)

For 2026-07-06 → 2026-07-12, All Channels, All Locations, tolerance ±$1:
1. Gross = **$167,341.41** · Discounts = **$3,876.45** · Refunds = **$1,068.91** ·
   **Net Revenue = $162,396.05** — the four numbers on Toast's own report.
2. Item Mix: `The Party Pack` shows refunds **$698.91**, `Tandoori Tasting Bundle`
   **$370.00**; every other item $0. Catering group subtotal reflects them.
3. Sanity SQL (should return 1068.91):
   `SELECT ROUND(SUM(sales_refund),2) FROM analytics.refund_sales
    WHERE business_date BETWEEN '2026-07-06' AND '2026-07-12';`
4. `npx tsx --env-file=.env scripts/profile.mts` — no query slower than before
   (the refunds view is tiny; the pre-aggregated join must not change plans
   materially).
5. `tsc --noEmit` clean.

## Note for the future (not this PR)
The view reads `raw.toast_orders` directly. If refund volume ever grows large, the
same extraction belongs in the pipeline as a parsed table — flagged in the pipeline
repo when that day comes. For now the view is exact, live, and zero-maintenance.
