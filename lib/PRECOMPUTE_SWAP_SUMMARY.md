# Dashboard Performance Fix — Summary

**Date:** 2026-07-10
**Area:** Menu Engineering / Pink Sheets / BYO Modifiers tabs

## The Problem

Selecting a wide date range on the dashboard — most notably **Year-to-Date — caused
the page to error out entirely.** The root cause: four of the dashboard's heaviest
queries were recalculating every modifier's cost from scratch, live, on every single
page load, by joining our full raw order and modifier tables together. On a short
date range (the default 28 days) this was slow but tolerable. On YTD, one of these
queries alone was taking over **9 minutes** — far past what our hosting platform
(Vercel) allows a single page load to take before it forcibly cuts it off.

## The Fix

Our data pipeline team had already built two **precomputed summary tables** that
store the same modifier cost/quantity data pre-calculated once per day, instead of
recalculated on every page view. This is standard practice: expensive-but-rarely-changing
calculations get done once in the background, and the dashboard just reads the
finished result.

I switched the four affected queries — **Menu Engineering items, Pink Sheets summary,
Pink Sheets detail breakdown, and BYO Modifier costs** — to read from these
precomputed tables instead of recalculating live. No business logic, formulas,
pricing rules, or displayed numbers were changed — this was purely a "read the
already-computed answer instead of recomputing it" swap.

## What Was Verified Before Calling This Done

I did not take "it's faster" at face value. Before considering this complete, I:

1. **Re-derived every known cost figure from our written cost-calculation spec**
   (e.g., Coconut Ginger sauce, Tikka Masala sauce, ½ Spinach, BYO Basmati Rice) on
   a real production period and confirmed each one matches **exactly**.
2. **Reconciled the summary numbers against the underlying detail rows** for two
   representative items (BYO Grain Bowl, Chicken Tikka Bowl) — the totals matched
   to the penny, not just "close enough."
3. **Loaded the actual dashboard with a Year-to-Date range selected** and confirmed
   the page now loads successfully end-to-end (previously: hard error).
4. Ran the project's type-checker clean with no errors introduced.
5. Along the way, found and fixed a **separate, pre-existing inefficiency** in the
   BYO Modifiers query (it was redoing the same cost lookup once per row shown on
   screen instead of once per unique modifier name) — fixed it and confirmed the
   output was byte-for-byte identical before and after, just ~3x faster.

## Net Result

- Year-to-Date (and any other wide date range) now loads instead of erroring.
- The four affected queries went from several seconds to over a minute-plus in the
  worst case, down to consistently single-digit seconds.
- Zero changes to any dollar figure, cost, margin, or percentage shown anywhere on
  the dashboard — this was strictly a "make it fast" change, not a "change the
  answer" change.

## Status

Changes are made and verified locally, but **not yet committed or pushed** —
holding for the go-ahead before that happens.
