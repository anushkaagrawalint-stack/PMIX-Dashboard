# PMIX Dashboard — Complete Handoff Document

> Prepared for reporting manager onboarding. All decisions, formulas, schema details,
> and conventions from prior development sessions are consolidated here.

---

## 1. Project Overview

**PMIX Dashboard** is an internal analytics dashboard for **RASA** (restaurant group).
It shows product mix, menu engineering, channel breakdown, cost/margin analysis,
and data quality flags — all driven by Toast POS data loaded into a PostgreSQL database.

**Live URL:** Deployed on Vercel (check `.env` for `VERCEL_URL` or ask Anushka).

**Who uses it:** Restaurant management team (Anushka, reporting managers).

---

## 2. Tech Stack

| Layer | Choice |
|---|---|
| Framework | Next.js (App Router, server components) |
| Language | TypeScript |
| Database | Neon (serverless PostgreSQL) via `@neondatabase/serverless` |
| Charts | Recharts |
| Auth | JWT in HTTP-only cookie (`pmix_token`, 8h expiry), bcrypt password hashing |
| Hosting | Vercel |
| CSS | Global CSS in `app/globals.css` (no Tailwind, custom CSS variables) |

---

## 3. Repository & Git

- **Org / User:** `anushkaagrawalint-stack`
- **Remote:** `git@github-kutlerrri:anushkaagrawalint-stack/PMIX-Dashboard.git`
- **SSH alias:** `github-kutlerrri` (maps to github.com for the work account — separate from personal account)
- **ALWAYS use** `git@github-kutlerrri:...` not `git@github.com:...`

---

## 4. Environment Variables (`.env`)

```
DATABASE_URL=           # Neon PostgreSQL connection string
JWT_SECRET=             # Secret for signing JWT tokens
USERS_JSON=             # JSON: { "email@domain.com": "<bcrypt_hash>" }
                        #   OR  { "email": { "hash": "<bcrypt_hash>", "role": "admin" } }
```

**To add a new user:** Generate a bcrypt hash of their password and add it to `USERS_JSON`.
No user management UI exists — it's env-var based.

---

## 5. Project File Structure

```
PMIX-Dashboard/
├── app/
│   ├── page.tsx                        ← Root: calls loadDashboardData(), renders <Dashboard>
│   ├── layout.tsx                      ← HTML shell
│   ├── loading.tsx                     ← Loading state
│   ├── globals.css                     ← All CSS (CSS variables, component classes)
│   ├── login/page.tsx                  ← Login form
│   └── api/
│       ├── auth/login/route.ts         ← POST /api/auth/login
│       ├── auth/logout/route.ts        ← POST /api/auth/logout
│       └── review/
│           ├── update-channel/route.ts ← POST: saves wrong-channel correction to DB
│           └── categorize-item/route.ts← POST: saves category assignment to DB
│
├── components/
│   ├── Dashboard.tsx                   ← Main shell: sticky header, filter bar, tab routing
│   ├── DatePicker.tsx                  ← Date range picker (fiscal periods + rolling presets)
│   ├── CalendarPicker.tsx              ← Custom date calendar
│   └── tabs/
│       ├── Overview.tsx                ← KPI cards, revenue trend, channel breakdown
│       ├── ItemMix.tsx                 ← Full item list with revenue/qty/category
│       ├── LocationCompare.tsx         ← Item revenue by location side-by-side
│       ├── ChannelMenu.tsx             ← Revenue breakdown by channel + category
│       ├── BYOBreakdown.tsx            ← Modifier (add-on) selection rates + costs
│       ├── PaymentSource.tsx           ← Payment method breakdown
│       ├── MEOverall.tsx               ← Menu Engineering quadrant table/scatter/bar
│       ├── PinkSheets.tsx              ← Per-item cost breakdown with modifier detail
│       ├── CustomerRetention.tsx       ← Bikky retention data (return/reorder rates)
│       ├── RenamesAudit.tsx            ← Items that have had name changes over time
│       ├── NeedsReview.tsx             ← Wrong-channel orders + uncategorized items
│       └── OpenItems.tsx               ← Items with no menu_name (Toast "open items")
│
└── lib/
    ├── queries.ts                      ← ALL database queries + loadDashboardData()
    ├── types.ts                        ← All TypeScript interfaces (DashboardData, MERow, etc.)
    ├── constants.ts                    ← Channel SQL, category maps, fiscal periods
    ├── auth.ts                         ← JWT sign/verify, getUsers()
    └── db.ts                           ← Pool helper
```

---

## 6. Data Flow

```
Toast POS
   │
   ▼
public.fact_order_lines     ← raw transaction lines (one row per item sold)
public.fact_modifiers       ← modifier rows (add-ons) per order line
public.br_order_payment     ← payment rows per order (for Needs Review)
public.dim_fiscal_period    ← fiscal calendar
   │
   ▼
analytics schema (enrichment tables)
   ├── r365_item_cost        ← R365 base cost per item, per menu, per period
   ├── r365_modifier_cost    ← R365 ingredient cost for modifiers
   ├── modifier_type         ← modifier_name → section/type classification
   ├── parent_item_type      ← parent item → item_type (for modifier join)
   ├── item_lookup           ← canonical_name → raw category (NOT used for display category)
   ├── item_category_override← dashboard-assigned categories (from Needs Review tab)
   └── channel_overrides     ← dashboard-corrected channels (from Needs Review tab)
   │
   ▼
lib/queries.ts               ← 25+ async query functions, all called in parallel by loadDashboardData()
   │
   ▼
app/page.tsx (Server Component)
   │ passes DashboardData
   ▼
components/Dashboard.tsx (Client Component)
   │ manages all filter state (channel, category, location, date)
   │ computes filtered/location-adjusted slices via useMemo
   ▼
Tab components (receive pre-filtered data as props)
```

**Caching:** `loadDashboardData()` uses `'use cache'` with `cacheLife('minutes')` —
data refreshes every few minutes automatically. Manual refresh button in header forces
a full page reload.

---

## 7. Database Schema — Key Tables

### `public.fact_order_lines` (raw Toast data — source of truth)

| Column | Type | Notes |
|---|---|---|
| `selection_guid` | TEXT | PK per line |
| `order_guid` | TEXT | Groups lines into one order |
| `canonical_name` | TEXT | Clean item name (used as item ID everywhere) |
| `menu_name` | TEXT | Toast menu — **use this for channel**, not `channel_code` |
| `menu_group` | TEXT | Item group within menu (BOWLS, PLATES, DRINKS, etc.) |
| `sales_category` | TEXT | 'Food' or 'Drink' — used for open items filter |
| `business_date` | DATE | Transaction date |
| `quantity` | INT | Units sold |
| `pre_discount` | NUMERIC | **Gross price** (before discounts) — use for avg_price |
| `line_total` | NUMERIC | **Net price** (after discounts) — use for revenue |
| `is_voided` | BOOL | Always filter `NOT is_voided` |
| `is_deferred` | BOOL | Always filter `NOT is_deferred` |
| `location_code` | TEXT | Location identifier (BALLPARK, MOSAIC, MVT, NL, ROCKVILLE) |
| `dining_option` | TEXT | 'Dine In', 'Take Out', etc. |

**CRITICAL:** `channel_code` column exists but is **unreliable** — always derive channel
from `menu_name` via `CHANNEL_FROM_MENU_SQL`.

### `public.fact_modifiers`

| Column | Notes |
|---|---|
| `parent_selection` | FK → `fact_order_lines.selection_guid` |
| `canonical_name` | Modifier item name |
| `quantity` | Modifier quantity |
| `is_voided` | Filter out voided modifiers |

### `analytics.r365_item_cost`

| Column | Notes |
|---|---|
| `item_name_updated` | Matches `canonical_name` in fact_order_lines |
| `menu` | 'FOOD - IN HOUSE', 'DRINKS - IN HOUSE', 'DELIVERY', '3PD OPEN MARKUP' |
| `avg_cost` | Base ingredient cost (no modifiers) |
| `period` | Format: 'P05-2026' |

**Menu → Channel cost mapping:**
- IH cost: `menu IN ('FOOD - IN HOUSE', 'DRINKS - IN HOUSE')`
- Online/3PD cost: `menu IN ('DELIVERY', '3PD OPEN MARKUP')`

### `analytics.r365_modifier_cost`

| Column | Notes |
|---|---|
| `clean_name` | Modifier name |
| `recipe_name` | **Only `LIKE 'MI %'` rows are valid modifier costs** |
| `cost_per_portion` | Cost per unit |
| `period` | Same format as r365_item_cost |

### `analytics.modifier_type`

Maps modifier names to their display section/type.
- Used to classify items as 'Modifier' category
- Missing entries: Spicy Mango Chutney, Sweet Tamarind Chutney (need to be added)

### `analytics.item_category_override` (created by dashboard)

Created on first use of Needs Review → Uncategorized Items "Confirm" action.
```sql
raw_item_name TEXT PRIMARY KEY,
category      TEXT NOT NULL,
menu_group    TEXT,
updated_at    TIMESTAMPTZ
```

### `analytics.channel_overrides` (created by dashboard)

Created on first use of Needs Review → Wrong Channel "Confirm" action.
```sql
order_guid      TEXT PRIMARY KEY,
correct_channel TEXT NOT NULL,
updated_at      TIMESTAMPTZ
```

---

## 8. Channel Attribution Logic

**NEVER use `channel_code` from the database — it's unreliable.**

Always derive channel from `menu_name` using this SQL expression (defined in `lib/constants.ts`):

```sql
CASE
  WHEN menu_name IN ('FOOD - IN HOUSE', 'DRINKS - IN HOUSE') THEN 'IN_HOUSE'
  WHEN menu_name IN ('APP', 'FOOD - TOAST ONLINE ORDERING')  THEN 'APP'
  WHEN menu_name = 'DELIVERY'                                 THEN 'TPD'
  WHEN menu_name = '3PD OPEN MARKUP'                          THEN 'TPD_MARKUP'
  WHEN menu_name = 'CATERING'                                 THEN 'CATERING'
  WHEN menu_name = 'CATERING - 3PD'                           THEN 'CATERING_3PD'
  WHEN menu_name = 'OFFSITE POP-UPS'                          THEN 'OFFSITE'
  WHEN menu_name IS NULL                                       THEN 'OPEN_ITEMS'
  ELSE 'OFFSITE'
END
```

**Channel codes used in UI:**

| Code | Label | Color |
|---|---|---|
| IN_HOUSE | In-House | #9f7cef (purple) |
| APP | Loyalty | #7cb9ef (blue) |
| TPD | 3PD | #ef7ccf (pink) |
| TPD_MARKUP | 3PD Markup | #f97316 (orange) |
| CATERING | Catering | #f5a623 (yellow) |
| CATERING_3PD | Catering 3PD | #e08f00 (dark yellow) |
| OFFSITE | Offsite | #2ec4b6 (teal) |
| OPEN_ITEMS | Open Items | #94a3b8 (gray) |

**Note on CATERING_3PD vs CATERING vs OFFSITE:**
- `CATERING - 3PD` menu + `menu_group ILIKE 'EzCater%'` → CATERING
- `CATERING - 3PD` menu + any other group → OFFSITE
- This secondary logic is handled in the Needs Review query, not in the main channel SQL

---

## 9. Category Logic

**Category does NOT come from `item_lookup.category_1` in the main dashboard display.**
It mirrors the AppScript `getMasterCategory_()` function exactly:

### Priority chain (in order):

1. **ITEM_CATEGORY_OVERRIDE** (hardcoded by canonical_name):
   - "That Fire Hot Sauce (Bottle)" → Retail
   - "That Fire Hot Sauce - Side" → Retail
   - "Harvest Chicken Bowl" → Entrees
   - "Spicy Chili Chicken Bowl" → Entrees
   - "Chicken Tikka Burrito" → Entrees

2. **GRP_TO_CATEGORY** (by `menu_group`):
   - BOWLS / BYO / PLATES / BURRITOS / CHEF CURATED BOWLS → Entrees
   - SIDES → Sides
   - DRINKS / Cold Drinks / Hot Drinks → NA Drinks
   - SWEETS → Sweets
   - KIDS → Kids Meal
   - Beer / Wine / Liquor / Gameday → Alc Drinks

3. Fallback → **'Other'**

### Sub-category priority chain:

1. **ITEM_SUBCATEGORY** (by canonical_name) — large map in `lib/constants.ts`
2. **GRP_TO_SUBCATEGORY** (by menu_group)
3. Fallback → empty string

### Special case — Catering/Offsite channels:
For CATERING, CATERING_3PD, OFFSITE channels, the **category displayed in Item Mix**
is the `menu_group` value (vendor name like "Aramark", "EzCater Catering Packages")
rather than the normal AppScript category.

### To modify category logic:
Must update **both** places in sync:
1. SQL expressions in `lib/constants.ts` (`GRP_TO_CAT_SQL`, `ITEM_SUBCAT_SQL`, `GRP_TO_SUBCAT_SQL`)
2. TypeScript maps in `lib/queries.ts` (`GRP_TO_CAT_MAP`, `ITEM_SUBCAT_MAP`, `GRP_TO_SUBCAT_MAP`)

---

## 10. Price vs Cost Rules

| Metric | Source | Notes |
|---|---|---|
| `avg_price` | `SUM(pre_discount) / SUM(quantity)` | Gross price BEFORE discounts |
| `net_sales` | `SUM(pre_discount)` | Same as gross_sales |
| `revenue` (displayed) | `SUM(line_total)` | Net after discounts |
| `avg_cost` (IH) | `r365_item_cost` where `menu IN ('FOOD - IN HOUSE','DRINKS - IN HOUSE')` | + modifier adder |
| `avg_cost` (Online) | `r365_item_cost` where `menu IN ('DELIVERY','3PD OPEN MARKUP')` | + modifier adder |
| `avg_cost` (3PD) | online avg_cost × 1.18 | Packaging/delivery uplift |

**3PD OPEN MARKUP:** The ×1.22 markup is already **embedded in `pre_discount`** for this
menu. Do NOT multiply by 1.22 again in any query.

---

## 11. Pink Sheet (Cost) Formula

```
FINAL AVG COST = base_cost + (total_mod_cost / qty)
```

Where:
- `base_cost` = `r365_item_cost.avg_cost` (period-specific, fallback to latest)
- `total_mod_cost` = `SUM(modifier_quantity × modifier_unit_cost)` from modifier join
- `qty` = **actual parent item order count from `fact_order_lines` directly**
  — NOT from modifier join (that overcounts by n_modifiers per order)

**IH also has modifier costs** (Extra Main, Veggies, etc.) — same formula, separate
IH cost base and IH modifier count.

### Modifier cost lookup rules:
- Source: `analytics.r365_modifier_cost`
- **Only `recipe_name LIKE 'MI %'` rows are valid**
- Period-specific match: `'P'||LPAD(period::TEXT,2,'0')||'-'||fiscal_year`
- Fallback chain: period-specific → latest → strip "Extra " prefix → 0

### Special half-half items:
- "1/2 and 1/2 Base" — no r365 cost; uses weighted-avg cost of the "1/2 Base" section
- "1/2 and 1/2 Mains" — uses weighted-avg of "1/2 Main" section
- Handled via `applyHalfHalfCosts()` in the PinkSheets component

### Modifier type exclusions:
- `'NA'`, `'ZeroCater'`, `'Plate - Main'` excluded from modifier cost calculation
  (protein already priced into r365 base for set plates)

### Section display grouping in Pink Sheet:
- modifier_types "Drink", "Side", "Sweet" all map to "Make It Meal" display section
- Strip item-type prefix from others: "Bowls - Bases" → "Bases"

---

## 12. Menu Engineering Formulas

### Menu Mix %
```
Mix % = Item Qty ÷ Grand Total Qty (all non-open items)
```

### Mix Threshold (dynamic, computed per period/filter)
```
Mix Threshold = (1 / Total number of items) × 0.7
```
An item is **High** mix if `Mix % > Mix Threshold`, else **Low**.

### Margin %
```
Margin % = (Avg Price − Avg Cost) / Avg Price
```

### Margin Threshold (dynamic)
```
Margin Threshold = Grand Total Margin / Grand Total Net Sales
                 = (Total Sales − Total Cost) / Total Sales
```
An item is **High** margin if `Margin % > Margin Threshold`, else **Low**.

### Quadrant assignment:
| Mix \ Margin | High Margin | Low Margin |
|---|---|---|
| **High Mix** | Star | Plow Horse |
| **Low Mix** | Puzzle | Dog |

### "Cost view" dropdown:
Changing channel view (ALL / IH / LO / 3PD / BL) recalculates thresholds and
quadrants using only that channel's qty/cost. BL = Loyalty + 3PD combined.

Pink Sheet costs take priority over r365 base costs when available.

3PD cost uplift: ×1.18 (packaging). Applied per-channel in ME recompute.

---

## 13. Tab-by-Tab Reference

### Overview
KPI cards (Total Revenue, Qty, Unique Items, Top Item) with period-over-period
delta vs previous fiscal period or equivalent rolling range. Revenue trend chart
(weekly/daily toggle), channel breakdown pie + table.

### Item Mix
Full item table sorted by revenue. Columns: Name, Category, Sub-Category, Qty,
Revenue, Avg Price, Channel, Mix%. Filterable by channel + category + location
from global filter bar.

### Location Compare
Side-by-side item revenue per location. Location filter affects all other tabs via
proportional scaling (location qty/revenue ÷ total qty/revenue applied to every
per-channel row).

### Channels
Revenue breakdown by channel, with per-category drill-down within each channel.
Shows catering/offsite vendor breakdown for those channels.

### BYO Breakdown
Modifier (add-on) selection rates — which bases, mains, veggies, sauces get chosen
and at what rate, plus their avg cost. Useful for understanding modifier cost drivers.

### Payment Source
Payment method breakdown (credit card, gift card, EzCater, etc.) by count and value.

### Menu Engineering (Overall)
Table + scatter chart + bar chart. See Section 12 for formulas. Has "Cost view"
dropdown for per-channel ME analysis. Export CSV button.

### Pink Sheets
Per-item cost card with modifier-level detail. Shows IH and Online cost separately.
Click an item to expand its modifier breakdown by section.

### Customer Retention
Bikky loyalty data — return rate and reorder rate per item, by fiscal period.
Compared to previous period. Split by In-Store vs 3PD Loyalty.

### Renames Audit
Items that have sold under multiple `canonical_name` values over time (renamed items).
Shows lifetime qty/revenue across all names.

### Needs Review (audit/correction tab)
**Section 1 — Wrong Channel Orders:**
Orders flagged where payment provider (alt_payment_name from `br_order_payment`)
contradicts the channel:
- EzCater, Hungry, Sharebite, Territory Foods, Cater Cow, WCK, Food Fleet,
  ZeroCater, Cater2Me + IN_HOUSE → suggests CATERING
- Fooda, Aramark, Eurest, Metz Corp, Taher, Foodworks, Cureate, Guest Services
  + IN_HOUSE → suggests OFFSITE

User selects correct channel and clicks Confirm → saves to `analytics.channel_overrides`.

**Section 2 — Uncategorized Items:**
Items not in `item_lookup`, not in `modifier_type`, not resolvable by
GRP_TO_CATEGORY, excluding OFFSITE and OPEN_ITEMS channels.
These fall through to "Other" in all reports.

User assigns Category + Menu Group → saves to `analytics.item_category_override`
AND inserts into `analytics.item_lookup`.

The red badge count on the tab = wrong channel orders + uncategorized items.

### Open Items
Items where `menu_name IS NULL` (Toast "open items" — unassigned menu entries).
Shows issue flags: NO COST, UNCATEGORIZED, MISSING MENU GROUP.
Separate from Needs Review — informational only, no correction UI.

---

## 14. Global Filter Bar Behavior

The filter bar (Channel, Category, Location) is **shown/hidden per-tab**:

```typescript
needs:      { channel: false, category: false, location: false }
openitems:  { channel: false, category: false, location: false }
renames:    { channel: false, category: false, location: false }
payment:    { channel: false, category: false, location: false }
bikky:      { channel: false, category: false, location: false }
pinksheets: { channel: false, category: false, location: false }
byo:        { channel: false, category: false, location: true  }
overview:   { channel: true,  category: true,  location: true  }
itemmix:    { channel: true,  category: true,  location: true  }
... etc
```

**Location filter** works by proportionally scaling all item revenue/qty to the
selected location(s) using `locationItems` data (not by re-querying the DB).

**Channel filter** aggregates per-channel item rows and recalculates ME thresholds
client-side.

**Category filter** for vendor channels (CATERING/OFFSITE) shows `menu_group`
values as options instead of normal categories.

---

## 15. Item Name Canonicalization (byo_fix)

Old Bowl names were renamed. All ME and pink sheet queries use this CTE to normalize:

```sql
byo_fix(raw, clean) AS (VALUES
  ('Grain Bowl',            'BYO Grain Bowl'),
  ('Salad Bowl',            'BYO Salad Bowl'),
  ('Greens + Grains Bowl',  'BYO Greens + Grains Bowl'),
  ('Cauliflower + Quinoa',  'Spiced Cauli + Quinoa Bowl'),
  ('Cauliflower + Quinoa Bowl', 'Spiced Cauli + Quinoa Bowl'),
  ('Kids BYO',              'Kids Meal'),
  ('Burrito',               'BYO Indian Burrito')
)
```

---

## 16. Fiscal Calendar

13-period fiscal year (RASA accounting calendar). Hardcoded in `lib/constants.ts`:

```
P1 2026: 2025-12-31 → 2026-01-27
P2 2026: 2026-01-28 → 2026-02-24
P3 2026: 2026-02-25 → 2026-03-24
P4 2026: 2026-03-25 → 2026-04-22
P5 2026: 2026-04-23 → 2026-05-20
P6 2026: 2026-05-21 → 2026-06-17
P7 2026: 2026-06-18 → 2026-07-15
P8 2026: 2026-07-16 → 2026-08-12
```

Also stored in `public.dim_fiscal_period` table for SQL use.

**Period-over-period comparison:**
- Fiscal period → previous fiscal period
- Quarter → previous quarter
- Rolling (7d/14d/28d) → same duration shifted back

---

## 17. Locations

```
BALLPARK   #ef4444 (red)
MOSAIC     #10b981 (green)
MVT        #f59e0b (amber)
NL         #3b82f6 (blue)
ROCKVILLE  #8b5cf6 (purple)
```

---

## 18. Coding Conventions & Preferences

### Dollar formatting — CRITICAL
**Never use `$12K`, `$1.2M` or any abbreviated format.**
Always use exact values:
```typescript
const fmt$ = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;
```
This applies everywhere: KPI cards, chart labels, tooltip formatters, table cells.

### No comments in code
Don't add comments explaining WHAT code does. Only add a comment when WHY is
non-obvious (a hidden constraint, workaround, or surprising behavior).

### No unnecessary abstractions
Three similar lines is better than a premature abstraction. Bug fixes don't need
surrounding refactors.

### API routes pattern
All mutation routes: `POST` only, JSON body, return `{ ok: true }` or `{ error: string }`.
Status 400 for bad input, 500 for DB errors.

---

## 19. Known Issues / Open Items

### Missing modifier_type entries
These modifiers are not in `analytics.modifier_type` — they won't appear correctly
in BYO Breakdown or Pink Sheet modifier costs:
- Spicy Mango Chutney
- Sweet Tamarind Chutney
- Organic Tandoori Paneer (check assignment)
- That Fire Hot Sauce - Side (check modifier_type value)

**Fix:** Insert rows into `analytics.modifier_type` for these modifiers.

### Uncategorized items
Items not matching any category rule fall to "Other". Use the **Needs Review tab →
Uncategorized Items** section to fix these through the UI.

### Wrong-channel orders
Corporate/offsite catering orders sometimes land in IN_HOUSE. Use the **Needs Review
tab → Wrong Channel Orders** to correct these through the UI.

---

## 20. How to Run Locally

```bash
cd PMIX-Dashboard

# Install dependencies
npm install

# Create .env file with:
# DATABASE_URL=<neon connection string>
# JWT_SECRET=<any random string>
# USERS_JSON={"your@email.com":"<bcrypt hash>"}

# Run dev server
npm run dev
# → http://localhost:3000
```

**To generate a bcrypt hash for a new user:**
```bash
node -e "const b=require('bcryptjs'); b.hash('yourpassword',10).then(h=>console.log(h))"
```

---

## 21. API Routes Summary

| Route | Method | Purpose |
|---|---|---|
| `/api/auth/login` | POST | Validates email+password, sets `pmix_token` cookie |
| `/api/auth/logout` | POST | Clears `pmix_token` cookie |
| `/api/review/update-channel` | POST | Saves `{ order_guid, channel }` to `analytics.channel_overrides` |
| `/api/review/categorize-item` | POST | Saves `{ canonical_name, category, menu_group }` to `analytics.item_category_override` + `analytics.item_lookup` |

---

## 22. loadDashboardData() — All Parallel Queries

Everything loads in one parallel `Promise.all()` call from `lib/queries.ts`:

```
getSummary()              → KPI totals (revenue, qty, unique items, top item)
getSummary(prevRange)     → previous period KPIs for delta comparison
getChannels()             → revenue/qty/pct per channel
getWeekly()               → weekly revenue + qty totals
getDaily()                → daily revenue + qty totals
getWeeklyByChannel()      → weekly revenue per channel
getDailyByChannel()       → daily revenue per channel
getItems()                → all items with category/channel/qty/revenue
getChannelItems()         → per-channel breakdown of every item
getLocationItems()        → per-location breakdown of every item
getLocations()            → location codes + display names
getMEItems()              → full ME data with per-channel costs + quadrants
getMEPinkSheets()         → pink sheet avg costs per item (IH/online/3PD)
getMEPinkSheetDetails()   → modifier-level cost detail for pink sheet drill-down
getModifiers()            → BYO modifier selection data
getPayments()             → payment source breakdown
getBikky()                → Bikky retention data (static, no date filter)
getCategories()           → category revenue/qty totals
getChannelCategories()    → channel × category revenue matrix
getRenames()              → items with multiple historical names
getNeedsReview()          → wrong-channel flagged orders
getOpenItems()            → open items summary + detail
getUncategorizedItems()   → items falling to "Other" with no category match
getCateringVendors()      → catering alt_payment breakdown
getOffsiteVendors()       → offsite alt_payment breakdown
```

---

## 23. AppScript Reference

The file `PMIX_AppScript.txt` in the project root contains the original Google Sheets
AppScript that preceded this dashboard. It is the **source of truth** for:
- Category mapping rules (`getMasterCategory_()`, `GRP_TO_CATEGORY`)
- Subcategory rules (`getMasterSubCategory_()`)
- Item name overrides
- Pink sheet cost formula and section grouping

When the SQL/TS category maps in `lib/constants.ts` and `lib/queries.ts` need updating
(new menu items, new groups), cross-reference against the AppScript to stay in sync.

---

*Last updated: 2026-06-30 by Anushka / Claude Code session*
