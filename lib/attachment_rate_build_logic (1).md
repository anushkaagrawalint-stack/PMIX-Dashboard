# Attachment Rate Dashboard — Build Logic (from raw `item lines` + `Modifier`)

Based on `P5_Attachment.xlsx`. This is the exact logic to go from your two raw tables to the three output sheets (Overall / Location / Channel), with every decision point called out so nothing is silently assumed.

---

## 1. Your Raw Data Model

**`item lines`** — one row per menu item sold on a check. Grain: `selection_guid`.
Key columns: `selection_guid` (PK), `order_guid`, `check_guid` (FK — the join key for "same check"), `location_code`, `business_date`, `canonical_name` (item name, already normalized — "Aloo Gobhi" is the same string whether sold in-house or on 3PD, unlike your old Toast export), `menu_group`, `sales_category`, `dining_option`, `channel_code`, `quantity`, `line_total`, `is_voided`, `is_deferred`.

**`Modifier`** — one row per modifier/customization applied to an item line. Grain: `modifier_guid`.
Key columns: `modifier_guid` (PK), `parent_selection` (FK → `item lines.selection_guid`), `order_guid`, `canonical_name` (modifier name), `depth` (1 = direct modifier on the item; 2 = sub-modifier of a modifier — e.g. "1/2 Basmati Rice" nested under a base-builder), `price`, `is_voided`, `option_group_name`.

**This is a real relational join** (`parent_selection` → `selection_guid`), not name-matching. That's a meaningful upgrade from the old Toast export — no more floating-point Check ID precision risk, and no more manually merging "Item" vs "Item - In House" rows, because `canonical_name` is already channel-agnostic and `channel_code` carries the channel separately.

**Data-quality flag found:** `Modifier` starts 2026-04-27; `item lines` starts 2026-04-29. ~10,900 modifier rows (12.2%) fall in that 2-day gap and can never join to an item line. Confirm with whoever pulls this data whether that's an extraction window mismatch — if so, either backfill those 2 days of item lines or trim the Modifier table to match, otherwise every period that includes early data will structurally undercount modifier attachment.

---

## 2. Core Definitions (unchanged from your existing model)

- **Total Main Checks** = distinct `check_guid` where the check contains this Main Item, not voided, in an included channel.
- **Checks With Item** = of those, distinct `check_guid` where the same check *also* has a separate item line that's a Companion Item.
- **Checks With Modifier** = of those, distinct `check_guid` where the Main Item's own selection has a Companion Modifier attached.
- **Totals** = distinct `check_guid` that hit *either* condition (**union, not sum** — a check with both an item add and a modifier add only counts once).
- **Attachment Rate** = Totals ÷ Total Main Checks.

---

## 3. Step 0 — Clean & Filter

```
items  = item_lines[ is_voided == 'f' ]
mods   = Modifier[ (is_voided == 'f') & (depth == 1) ]     # depth 2 = sub-modifier of a build step, never a companion attach
```

Do **not** filter `is_deferred` out by default — confirm with the business whether deferred (tab/pre-auth) orders should count. Flag, don't assume.

---

## 4. Step 1 — Classify Channel (using `menu_name`, not `channel_code`)

Per your direction, channel is derived from `menu_name`, not `channel_code`. This matches the exact mapping your old `Category` sheet used (same string values):

| menu_name | Bucket |
|---|---|
| FOOD - IN HOUSE | Instore |
| DRINKS - IN HOUSE | Instore |
| APP | Loyalty |
| DELIVERY | 3PD |
| 3PD OPEN MARKUP | **Ignore** |
| CATERING | **Ignore** |
| CATERING - 3PD | **Ignore** |
| OFFSITE POP-UPS | **Ignore** |

```python
CHANNEL_MAP = {
    'FOOD - IN HOUSE': 'Instore', 'DRINKS - IN HOUSE': 'Instore',
    'APP': 'Loyalty',
    'DELIVERY': '3PD',
}
# anything not in CHANNEL_MAP (3PD OPEN MARKUP, CATERING, CATERING - 3PD, OFFSITE POP-UPS) = Ignore

items['channel_bucket'] = items['menu_name'].map(CHANNEL_MAP)   # NaN = Ignore
items = items[items['channel_bucket'].notna()]
```

**Flag:** `menu_name` and `channel_code` disagree substantially on this data — e.g. rows where `menu_name == 'APP'` split across `channel_code` values of APP (11,819 rows), TPD (7,518 rows), CATERING (126), and OFFSITE (44). So this is a real methodology choice, not a cosmetic one: using `menu_name` will pull a large chunk of what `channel_code` calls "TPD" into your "Loyalty" bucket instead. Worth confirming that's intentional (e.g. if `menu_name = APP` reflects the ordering surface/app the guest used, while `channel_code = TPD` reflects the actual fulfillment/delivery partner — you may be choosing "how it was ordered" over "how it was fulfilled").

---

## 5. Step 2 — Classify Main vs. Companion (needs your sign-off — this is a business call, not a data call)

`menu_group` gives a strong starting signal, but it's not 100% clean (case duplicates like `Drinks`/`DRINKS`, `Wine`/`WINE`; and a long tail of catering/partner channels that repackage core menu items under different names — `Sharebite`, `HUNGRY`, `Cureate`, `Fooda`, `Eurest`, `Aramark*`, `Territory`, `Metz`, `Cater Cow`, `Foodworks`, `Guest Services`, tour/ticket groups).

**Recommended default:**

| Bucket | menu_group values |
|---|---|
| **Main Item** | BOWLS, BUILD YOUR OWN BOWL, BURRITOS, BYO, CHEF CURATED BOWLS, CLASSIC INDIAN PLATES, PLATES, KIDS |
| **Companion Item** | SIDES, DRINKS, Drinks, Cold Drinks, SWEETS, Beer, Wine, WINE, Liquor |
| **Exclude entirely** | 3PD MARKUPS, BAG TAX, Additional Items, Classic Indian Entrees (catering trays), Educational Discovery Tours, EF Tours, Guest Services, TERRITORY, and every third-party-repackaged menu_group (Aramark*, Cater Cow, Cureate, Eurest / Eurest*, Ez Cater *, Fooda, Foodworks, Gameday, HUNGRY, Metz, Sharebite) |

**Needs your confirmation:** the "Exclude entirely" list drops real food/beverage sales (e.g. Sharebite and HUNGRY sell actual bowls, not just catering trays) purely because they run through partner platforms that don't map cleanly to Instore/3PD/Loyalty. If you want these included, they need their own channel bucket — don't let them fall into "Instore" by default just because they contain a real bowl.

---

## 6. Step 3 — Companion Modifier Classification (needs your sign-off — same reasoning as Step 2, one level down)

I checked the price field across the option groups to separate real add-ons from free build-steps — for reference, here's what that looked like before narrowing to just `Make it a Meal`:

| option_group_name pattern | % priced > $0 | Verdict |
|---|---|---|
| `Make it a Meal` | 100% (avg $3.25) | **Companion attach** — the only group used |
| `Main Add On's` | 100% (avg $1.62) | Excluded per your direction |
| `Side of Main`, `Side of Grain`, `Side of Veggie`, `Side of Sauce*` | mostly 0%, `Side of Main` 35.7% | Excluded per your direction |
| `Get Saucy*`, `Any Chutney or Dressings*`, `Top It Off*`, `Pick a Main*`, `Build Your Base*`, `Kids Toppings` | ~0% | Free build steps — not an attach |

**Confirmed rule (per your direction — only `Make it a Meal` counts):**
```
companion_modifier_groups = {'Make it a Meal'}
```
Everything else — `Main Add On's`, `Side of Main/Grain/Veggie/Sauce`, `Get Saucy*`, `Top It Off*`, `Any Chutney or Dressings*`, `Pick a Main*`, `Build Your Base*`, `Kids Toppings` — is excluded from "Checks With Modifier." `Make it a Meal` is the cleanest signal anyway (100% priced, avg $3.25 — an unambiguous paid meal-completion upsell), so this simplifies Step 6 to a single-value filter with no ambiguity left to resolve.

---

## 7. Step 4 — Build "Total Main Checks"

```python
main_lines = items[items.canonical_name.isin(MAIN_ITEMS) & items.channel_code.isin(['IN_HOUSE','APP','TPD'])]

total_main_checks = (
    main_lines.groupby('canonical_name')['check_guid']
    .nunique()
)
```

---

## 8. Step 5 — Build "Checks With Item" (companion sold as its own line)

```python
companion_lines = items[items.canonical_name.isin(COMPANION_ITEMS) & items.channel_code.isin(['IN_HOUSE','APP','TPD'])]

# checks that have a companion item line at all
checks_with_companion_item = set(companion_lines.check_guid)

checks_with_item = (
    main_lines[main_lines.check_guid.isin(checks_with_companion_item)]
    .groupby('canonical_name')['check_guid']
    .nunique()
)
```

---

## 9. Step 6 — Build "Checks With Modifier" (companion added via modifier)

```python
mods_companion = mods[mods.option_group_name.isin(companion_modifier_groups)]

# join modifier -> its parent item line, to know which Main Item & check it belongs to
joined = mods_companion.merge(
    main_lines[['selection_guid','canonical_name','check_guid']],
    left_on='parent_selection', right_on='selection_guid'
)

checks_with_modifier = (
    joined.groupby('canonical_name')['check_guid']
    .nunique()
)
```

Note: this only counts a modifier as an attach when it sits on a **Main Item's own selection line** — a modifier on a companion item's own line (e.g. flavor of an already-ordered Naan Basket) is not a new attachment, it's just describing the companion item, so it's correctly excluded by the join.

---

## 10. Step 7 — Totals & Attachment Rate

```python
# union of check_guids per main item, not sum of the two counts
union_checks = (
    checks_with_companion_item_by_main | checks_with_modifier_by_main   # set union per canonical_name
)
totals = union_checks.groupby('canonical_name').nunique()
attachment_rate = totals / total_main_checks
```

Do this with actual set unions per item (build a dict of `{canonical_name: set(check_guids)}` for the item path and the modifier path, then union the two sets before counting) — do not add the two counts, or you'll double-count checks that had both.

---

## 11. Step 8 — Location & Channel Cuts

Same five formulas, just add `location_code` or the channel bucket to the `groupby`. Then a hard validation rule:

> Sum of the five `location_code` splits' Total Main Checks, Checks With Item, Checks With Modifier must exactly equal the Overall sheet's numbers for every row. Same for the three channel splits. If they don't reconcile, something in the filter logic is location/channel-dependent and needs to be found before trusting either sheet.

---

## 12. Validation Checklist Before Publishing

1. Pick 2-3 main items, manually filter the raw sheets in Excel (AutoFilter, not formulas) and hand-count Total Main Checks / Checks With Item / Checks With Modifier. Confirm they match your pipeline output exactly.
2. Confirm Location splits sum to Overall (Step 11).
3. Confirm Channel splits sum to Overall.
4. Spot-check that `Totals` is never greater than `Checks With Item + Checks With Modifier` (it should be ≤, since it's a union).
5. Re-run the 2-day date-range gap check (Section 1) once you get the next period's raw pull — if the two sheets' date ranges match exactly next time, the gap was a one-off pull issue and not a recurring pipeline problem.

---

## 13. What I need from you before I build this

- Confirm the Main Item / Companion Item classification in Step 5 (especially the "Exclude entirely" list — Sharebite/HUNGRY carry real bowl sales).
- Confirm `is_deferred` handling.
- Confirm the 2-day Modifier/item-lines date mismatch is a known pull artifact, not a recurring issue.
- Confirm the `menu_name` vs `channel_code` disagreement on channel bucketing (Section 4) is intentional.

Resolved: channel = `menu_name`-based (Section 4); companion modifier = `Make it a Meal` only (Section 6).

Once you confirm the remaining points, I'll build the actual formulas/pipeline against `P5_Attachment.xlsx` and produce the three output sheets with everything as live formulas (not hardcoded), so it's auditable and matches the xlsx house style.
