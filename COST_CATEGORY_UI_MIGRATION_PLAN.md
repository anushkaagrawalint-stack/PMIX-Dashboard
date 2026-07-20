# Cost / Category / Modifier-Type UI Migration Plan

**Goal:** admins and testers can set an item's cost, a modifier's cost, an
item's category + sub-category, and a modifier's type — for *any* canonical
name, for *any* period — directly from the dashboard UI, with immediate (or
near-immediate, see §5) effect on every tab. This eliminates the manual R365
`.xlsx` drop → git push → GitHub Actions → CLI load workflow as the *primary*
path for period-over-period cost/category maintenance.

**Non-goals:** this does not touch the Toast order ingestion pipeline
(`toast_pipeline.cli run`), Bikky retention loads, or the initial historical
backfill. Those still run on their existing schedule. Only the four R365/
categorization maintenance actions above move into the dashboard.

---

## 0. Ground truth this plan is built on

Read directly from the code, not assumed:

1. **Item cost** is read live from `analytics.r365_item_cost`, picking the
   freshest row with `period <= current period` per canonical name
   ([lib/queries.ts:2543](lib/queries.ts#L2543) `getItemCosts`). Writing a row
   with a new/updated `avg_cost` for any `(period, menu, item_name)` takes
   effect on the **next page load, no rebuild needed**. `/api/costs` already
   does this correctly for any item — it just isn't exposed for non-"missing"
   items yet.

2. **Modifier cost** has two separate read paths:
   - *Live*: `modifierUnitCostSQL` / `modifierCostBatchSQL`
     ([lib/modifierCost.ts](lib/modifierCost.ts)) query
     `analytics.r365_modifier_cost` directly, freshest-≤-period, **but only
     rows where `recipe_name LIKE 'MI %'`**. This is a hard filter — a
     modifier-cost row whose `recipe_name` doesn't start with `MI ` is
     invisible to every consumer.
   - *Precomputed*: Pink Sheets / ME detail / BYO Breakdown read
     `analytics.pc_modifier_unit_cost` / `analytics.pc_modifier_daily`
     ([sql/pc_refresh.sql](sql/pc_refresh.sql)), which only rebuild inside
     `toast_pipeline.cli precompute` — currently invoked only from
     `merge_to_public()` at the end of the daily Toast pipeline run, **never**
     from the R365 cost-load workflow.

3. **Item category / sub-category is 100% hardcoded TypeScript**, not
   database-driven, despite comments implying otherwise. `CAT1`/`CAT2` in
   [lib/queries.ts:52-71](lib/queries.ts#L52-L71) reference `GRP_TO_CAT_SQL`,
   `ITEM_SUBCAT_SQL`, `GRP_TO_SUBCAT_SQL` — all static `CASE/WHEN` string
   constants in [lib/constants.ts:163-263](lib/constants.ts#L163-L263). The
   existing `analytics.item_category_override` table
   ([app/api/review/categorize-item/route.ts](app/api/review/categorize-item/route.ts))
   is **written but never read anywhere**. Today's "categorize an item"
   feature is a dead end — it removes an item from the uncategorized list but
   changes nothing else. **This must be fixed as part of this plan**, or the
   new category/sub-category UI will have the same silent-no-op bug.

4. **Modifier type** (`analytics.modifier_type(modifier_name, item_type,
   modifier_type)`) is joined live in most places
   ([lib/queries.ts:41-47](lib/queries.ts#L41-L47) — existence only, for
   `category = 'Modifier'`), but the actual `modifier_type` *value* (the
   "section", e.g. "Bowls - Bases") is baked into
   `analytics.pc_modifier_daily` at precompute time
   ([lib/queries.ts:1621-1631](lib/queries.ts#L1621-L1631)). Same precompute
   dependency as modifier cost.

5. Roles: `admin` and `tester` already both pass `hasAdminAccess()`
   ([lib/auth.ts:20](lib/auth.ts#L20)) — no new permission plumbing needed.

---

## 1. Database changes

All additive. Nothing existing is dropped.

```sql
-- Extend the existing (currently dead) override table with sub-category,
-- and actually give it a stable key: canonical_name, not raw_item_name
-- (raw_item_name drifts per menu wording; canonical_name is the join key
-- every query already normalizes to).
ALTER TABLE analytics.item_category_override
  RENAME COLUMN raw_item_name TO canonical_name;
ALTER TABLE analytics.item_category_override
  ADD COLUMN IF NOT EXISTS sub_category TEXT;

-- modifier_type already has the right shape (modifier_name, item_type) → type.
-- No schema change needed — just a write path.

-- r365_item_cost / r365_modifier_cost already have the right shape.
-- No schema change needed — just write paths (item cost) and a new one
-- (modifier cost).
```

**Migration file:** add
`PMIX-Pipeline/PMIX-Pipeline/sql/015_item_category_override_rename.sql` with
the two statements above, run once by hand against Neon (or via the pipeline's
existing `init-db` bootstrap if that's how prior `sql/0NN_*.sql` files got
applied — confirm which before running).

---

## 2. Fix category/sub-category resolution (the load-bearing change)

Wire the override table into the SQL the dashboard already runs, as
first-priority, exactly as the stale comments in `queries.ts` claim already
happens:

```sql
-- CAT1 (lib/queries.ts) becomes:
CASE
  WHEN ico.category IS NOT NULL THEN ico.category
  WHEN fol.canonical_name IN ('That Fire Hot Sauce (Bottle)', ...) THEN 'Retail'
  WHEN fol.canonical_name IN ('Harvest Chicken Bowl', ...) THEN 'Entrees'
  ELSE COALESCE(${GRP_TO_CAT_SQL}, 'Other')
END

-- CAT2 becomes:
COALESCE(
  ico.sub_category,
  ${ITEM_SUBCAT_SQL},
  ${GRP_TO_SUBCAT_SQL},
  ''
)
```

with a join added everywhere `CAT1`/`CAT2` is used:
```sql
LEFT JOIN analytics.item_category_override ico
       ON ico.canonical_name = fol.canonical_name
```

**Every query site that currently inlines `CAT1`/`CAT2` needs this join
added.** Grep `CAT1\|CAT2\|ITEM_SUBCAT_SQL\|GRP_TO_CAT_SQL` in
`lib/queries.ts` to enumerate them before touching anything — do not assume
there's only one call site.

**Verify:** pick 3 items already covered by the hardcoded lists (e.g.
"Harvest Chicken Bowl"), confirm category is unchanged after the join is
added (override table empty → falls through exactly as before). Then insert
one override row and confirm it flips category on the next dashboard load
with zero code redeploy.

---

## 3. New / changed API routes

All routes below require `hasAdminAccess(payload?.role)` — copy the guard
pattern from [app/api/costs/route.ts:22-26](app/api/costs/route.ts#L22-L26).

### 3.1 `POST /api/costs` (item cost) — already exists, no server change
Currently correct for any item/period. Only the **UI** restriction needs
removing (see §4.1).

### 3.2 `POST /api/costs/modifier` (new)
```jsonc
// request
{ "canonical_name": "Tikka Masala Sauce", "period": "P06-2026", "cost_per_portion": 0.42 }
// canonical_name here is the modifier's clean_name (lowercase display name),
// NOT a raw_item_name — matches what modifierUnitCostSQL normalizes to.
```
Server logic:
- Validate `period` against `^P\d{2}-\d{4}$` (reuse `PERIOD_RE`).
- Validate `cost_per_portion > 0`.
- **Synthesize `recipe_name = 'MI ' + canonical_name`** — this is not
  optional, it's the hard filter every read path applies. Document this loudly
  in the route's own comment so a future editor doesn't drop the prefix.
- Upsert into `analytics.r365_modifier_cost` on `(period, recipe_name)`,
  setting `clean_name = canonical_name`.

```sql
INSERT INTO analytics.r365_modifier_cost
  (period, recipe_name, clean_name, cost_per_portion, loaded_at)
VALUES ($1, 'MI ' || $2, $2, $3, NOW())
ON CONFLICT (period, recipe_name) DO UPDATE
  SET clean_name = EXCLUDED.clean_name,
      cost_per_portion = EXCLUDED.cost_per_portion,
      loaded_at = NOW()
```

### 3.3 `POST /api/review/categorize-item` (extend existing)
Add `sub_category` to the request body and the upsert
(`analytics.item_category_override`), alongside the rename in §1. Keep
`menu_group` as-is (still useful metadata even though category resolution
no longer depends on it directly).

### 3.4 `POST /api/review/categorize-modifier` (new)
```jsonc
{ "modifier_name": "Tikka Masala Sauce", "item_type": "Bowls", "modifier_type": "Bowls - Bases" }
```
Upsert into `analytics.modifier_type` on `(modifier_name, item_type)`.

### 3.5 `POST /api/admin/refresh-precompute` (new — see §5)

---

## 4. UI changes

### 4.1 Cost editor — generalize, don't rebuild
Extend [components/tabs/NeedsReview.tsx](components/tabs/NeedsReview.tsx)'s
existing cost section rather than building a parallel screen — it already has
the menu/period/value inputs, `costStatus` tracking, and the save flow. Two
changes:
- Add a searchable item/modifier picker above the flagged-rows list (source
  the option list from `items` / `modifiers` already loaded into the
  dashboard — no new query needed) so admins can pull up *any* canonical
  name, not just ones flagged missing.
- Add a toggle: "Item cost" (existing `/api/costs` path) vs. "Modifier cost"
  (new `/api/costs/modifier` path, §3.2) — modifier cost has no
  bucket/menu concept, just canonical_name + period + cost.
- Because this now overwrites values the R365 export may have already
  loaded for that period, add a confirm step when a non-empty existing value
  is being replaced (fetch current value on picker-select, show it inline).

### 4.2 Item detail — category / sub-category editor
No single-item detail view exists today
([components/tabs/AllItems.tsx](components/tabs/AllItems.tsx) is a flat
table). Cheapest correct option: make category and sub-category inline-
editable cells in that table (click cell → dropdown/text input → save),
gated on `isAdmin`, calling §3.3. Avoids building a new modal/route just to
host two fields.

### 4.3 Modifier detail — modifier type editor
Same pattern as 4.2, on whichever tab already lists modifiers with their
`item_type` context (BYO Breakdown / Channel Menu — confirm which one
carries `item_type` per row before picking the surface, since `modifier_type`
is keyed on `(modifier_name, item_type)`, not modifier_name alone).

---

## 5. The precompute problem — pick one, don't skip this

Modifier cost and modifier type changes are invisible on Pink Sheets/ME
detail/BYO Breakdown until `analytics.pc_modifier_unit_cost` /
`pc_modifier_daily` rebuild. Three options, in order of recommendation:

1. **Admin-triggered rebuild button** calling
   `POST /api/admin/refresh-precompute`, which runs the same SQL as
   [sql/pc_refresh.sql](sql/pc_refresh.sql) directly from the Next.js route
   against `DATABASE_URL`. Full rebuild is ~70s
   ([sql/pc_refresh.sql:12](sql/pc_refresh.sql#L12)) — **confirm your
   hosting tier's serverless function timeout before building this**
   (Vercel Hobby caps at 10s; Pro/Enterprise can raise `maxDuration` up to
   300s via route config). If the timeout can't cover 70s, this has to run
   as a background job (e.g. a queued task, or fall back to option 2)
   instead of a synchronous request/response.
2. **Leave precompute on the existing daily cron** (it already reruns at the
   end of every `merge_to_public()`, i.e. daily) and clearly label in the UI
   that modifier cost/type edits take up to 24h to reach those three tabs.
   Zero new infra, worse UX.
3. **Stop precomputing, make those three tabs query live** — removes the lag
   entirely but reintroduces the ~557s live-query cost the precompute layer
   was built to avoid ([sql/pc_refresh.sql:13](sql/pc_refresh.sql#L13)).
   Not viable as-is.

**Recommendation:** option 1, gated on confirming the hosting tier supports
a >70s route (or moving the rebuild to a background job if not). This is the
one open infra question that determines whether "immediate effect" is
actually deliverable for modifier cost/type — resolve it before writing the
route, not after.

---

## 6. Rollout sequence

Each step has its own verify — don't proceed to the next until the current
one is confirmed.

1. **Schema migration** (§1) → verify: `item_category_override` has
   `canonical_name` + `sub_category` columns, existing rows (if any)
   survived the rename.
2. **Category/sub-category join fix** (§2) → verify: dashboard category
   numbers are byte-identical to before the change (override table still
   empty), across at least Overview + Menu Engineering totals for one period.
3. **`/api/costs/modifier` + generalized cost UI** (§3.2, §4.1) → verify: set
   a modifier cost for the *current* period via UI, confirm it shows up in
   whichever tab reads modifier cost *live* (`modifierCostBatchSQL` callers)
   within one page reload — this validates the write path without touching
   precompute yet.
4. **Precompute decision** (§5) → verify: after resolution, set a modifier
   cost via UI, trigger the chosen refresh path, confirm Pink Sheets / BYO
   Breakdown reflect it.
5. **Category/modifier-type UI** (§4.2, §4.3, §3.3, §3.4) → verify: one
   category override + one modifier-type override, each confirmed against
   the tab that displays it.
6. **Parity check against last real R365 load** — for the most recent period
   already loaded via the old xlsx pipeline (P5), spot-check ~10 items and
   ~10 modifiers: cost via UI-read path should match cost as currently
   displayed, proving the new write path and the old file-load path are
   truly equivalent before anyone relies on UI-only for P6 onward.
7. **Decommission the sheet-upload path.** Once P6 (or whichever is the
   first UI-only period) has been fully entered and verified end-to-end:
   - Stop dropping files into `Data/R365Data/ItemCost/` /
     `Data/R365Data/ModifierCost/`.
   - Either disable
     [.github/workflows/r365_load.yml](../PMIX-Pipeline/PMIX-Pipeline/.github/workflows/r365_load.yml)
     (remove the `push` trigger, keep `workflow_dispatch` as a manual
     emergency-import fallback) or leave it as-is — it's harmless dead code
     if nothing ever pushes to those paths again. Recommend keeping
     `workflow_dispatch` alive as a bulk-import escape hatch (e.g. a full
     historical re-load) rather than deleting the loader entirely.

---

## 7. Risks / open questions to resolve before coding

- **Hosting tier timeout for §5** — blocks the precompute-refresh design.
  Needs an answer before `/api/admin/refresh-precompute` is built.
- **`item_category_override` rename is a breaking change** for the one
  existing writer (`categorize-item` route) — must ship in the same deploy
  as the route update in §3.3, not before/after.
- **All call sites of `CAT1`/`CAT2`** must get the new join, or category
  overrides will work on some tabs and silently not on others — enumerate
  them explicitly (grep first) rather than trusting there's a single shared
  constant usage.
- **No audit trail** on any of these overrides (who changed what cost/
  category/type, when, from what value). Not in scope per the original ask,
  but flagging since these are now direct, unreviewed writes to numbers that
  drive margin reporting — consider at minimum keeping `loaded_at`/
  `updated_at` timestamps visible somewhere in the admin UI for traceability.
