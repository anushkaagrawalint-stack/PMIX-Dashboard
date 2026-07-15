// ─── Channel attribution ──────────────────────────────────────────────────────
// channel_code in fact_order_lines is UNRELIABLE — do NOT use it.
// True channel is derived from menu_name in every SQL query.

export const CHANNEL_FROM_MENU_SQL = `
  CASE
    WHEN menu_name IN ('FOOD - IN HOUSE', 'DRINKS - IN HOUSE') THEN 'IN_HOUSE'
    WHEN menu_name IN ('APP', 'FOOD - TOAST ONLINE ORDERING')  THEN 'APP'
    WHEN menu_name = 'DELIVERY'                                THEN 'TPD'
    WHEN menu_name = '3PD OPEN MARKUP'                         THEN 'TPD_MARKUP'
    WHEN menu_name = 'CATERING'                                THEN 'CATERING'
    WHEN menu_name = 'CATERING - 3PD'                          THEN 'CATERING_3PD'
    WHEN menu_name = 'OFFSITE POP-UPS'                         THEN 'OFFSITE'
    WHEN menu_name IS NULL                                      THEN 'OPEN_ITEMS'
    ELSE 'OFFSITE'
  END
`;

// Same expression for a named alias — use in SELECT as: ${CHANNEL_SQL} AS channel
export const CHANNEL_SQL = CHANNEL_FROM_MENU_SQL.trim();

// ─── Channel overrides (Needs Review "wrong channel" fixes) ──────────────────
// analytics.channel_overrides (selection_guid PK, order_guid, correct_channel)
// lets an admin permanently reassign a SPECIFIC LINE's channel from the Needs
// Review tab — keyed on selection_guid (the per-line id), NOT order_guid, so
// fixing one mistracked line in an otherwise-correct order never touches that
// order's other, already-correct lines. EVERY query that derives channel from
// menu_name and cares about accurate per-channel revenue/qty MUST join this
// table (alias `co`, on selection_guid) and use CHANNEL_SQL_WITH_OVERRIDE
// instead of CHANNEL_SQL — single shared expression so a correction is honored
// identically everywhere, rather than hand-copied into each query (the exact
// drift problem byo_fix already had). Queries that intentionally want the RAW,
// un-overridden derivation (e.g. getNeedsReview's own "what does Toast
// currently think this is" column) should keep using CHANNEL_SQL as-is.
export const CHANNEL_OVERRIDE_JOIN_SQL = (selectionGuidExpr: string) =>
  `LEFT JOIN analytics.channel_overrides co ON co.selection_guid = ${selectionGuidExpr}`;

export const CHANNEL_SQL_WITH_OVERRIDE = `COALESCE(co.correct_channel, (${CHANNEL_FROM_MENU_SQL}))`.trim();

// Channel metadata for UI
export const CHANNELS = [
  { code: 'IN_HOUSE',    label: 'In-House',      color: '#9f7cef' },
  { code: 'APP',         label: 'RASA Digital',  color: '#7cb9ef' },
  { code: 'TPD',         label: '3PD',           color: '#ef7ccf' },
  { code: 'TPD_MARKUP',  label: '3PD Markup',    color: '#f97316' },
  { code: 'CATERING',    label: 'Catering',      color: '#f5a623' },
  { code: 'CATERING_3PD',label: 'Catering 3PD', color: '#e08f00' },
  { code: 'OFFSITE',     label: 'Offsite',       color: '#2ec4b6' },
  { code: 'OPEN_ITEMS',  label: 'Open Items',    color: '#94a3b8' },
] as const;

export type ChannelCode = typeof CHANNELS[number]['code'];

export const CHANNEL_LABEL: Record<string, string> = Object.fromEntries(
  CHANNELS.map(c => [c.code, c.label])
);

export const CHANNEL_COLOR: Record<string, string> = Object.fromEntries(
  CHANNELS.map(c => [c.code, c.color])
);

// Kids Meal is folded into Entrees everywhere in the UI — it is not a
// separately-selectable category anywhere (the global category filter
// dropdown, NeedsReview's categorize-item tool, etc. never offer "Kids
// Meal" as an option). Single shared implementation — every tab that
// groups/filters by category must use this instead of its own copy, so a
// Kids Meal item's revenue always lands under Entrees, everywhere.
export const normalizeCategory = (c: string | null | undefined): string =>
  c === 'Kids Meal' ? 'Entrees' : (c || 'Other');

// Location colors (ordered alphabetically by location code: BALLPARK, MOSAIC, MVT, NL, ROCKVILLE)
export const LOCATION_COLORS: Record<string, string> = {
  BALLPARK:  '#ef4444',
  MOSAIC:    '#10b981',
  MVT:       '#f59e0b',
  NL:        '#3b82f6',
  ROCKVILLE: '#8b5cf6',
};

// ─── Category mapping from item_lookup ───────────────────────────────────────
// item_lookup.category_1 stores raw values like 'Bowls', 'Plates', 'Burritos'.
// These SQL expressions normalise them to display categories used across the UI.

// Normalise item_lookup.category_1 → display category_1
export const NORM_CAT1_SQL = `
  CASE il.category_1
    WHEN 'Bowls'                  THEN 'Entrees'
    WHEN 'BUILD YOUR OWN BOWL'    THEN 'Entrees'
    WHEN 'BYO'                    THEN 'Entrees'
    WHEN 'CHEF CURATED BOWLS'     THEN 'Entrees'
    WHEN 'Plates'                 THEN 'Entrees'
    WHEN 'PLATES'                 THEN 'Entrees'
    WHEN 'CLASSIC INDIAN PLATES'  THEN 'Entrees'
    WHEN 'Burritos'               THEN 'Entrees'
    WHEN 'BURRITOS'               THEN 'Entrees'
    WHEN 'INDIAN BURRITOS'        THEN 'Entrees'
    WHEN 'Kids Meal'              THEN 'Kids Meal'
    WHEN 'KIDS'                   THEN 'Kids Meal'
    WHEN 'Sides'                  THEN 'Sides'
    WHEN 'SIDES'                  THEN 'Sides'
    WHEN 'Drinks'                 THEN 'NA Drinks'
    WHEN 'DRINKS'                 THEN 'NA Drinks'
    WHEN 'Cold Drinks'            THEN 'NA Drinks'
    WHEN 'Hot Drinks'             THEN 'NA Drinks'
    WHEN 'Lassi'                  THEN 'NA Drinks'
    WHEN 'Juice'                  THEN 'NA Drinks'
    WHEN 'Canned Soda'            THEN 'NA Drinks'
    WHEN 'Kombucha'               THEN 'NA Drinks'
    WHEN 'Chai'                   THEN 'NA Drinks'
    WHEN 'Water'                  THEN 'NA Drinks'
    WHEN 'Coconut'                THEN 'NA Drinks'
    WHEN 'Sweets'                 THEN 'Sweets'
    WHEN 'SWEETS'                 THEN 'Sweets'
    WHEN 'Soft Serve'             THEN 'Sweets'
    WHEN 'Cookies'                THEN 'Sweets'
    WHEN 'Yogurt'                 THEN 'Sweets'
    WHEN 'Beer'                   THEN 'Alc Drinks'
    WHEN 'Wine'                   THEN 'Alc Drinks'
    WHEN 'WINE'                   THEN 'Alc Drinks'
    WHEN 'Liquor'                 THEN 'Alc Drinks'
    WHEN 'Gameday'                THEN 'Alc Drinks'
    WHEN 'Retail'                 THEN 'Retail'
    ELSE 'Other'
  END
`;

// Normalise item_lookup.category_2 → display sub-category.
// ELSE returns il.category_2 as-is (NULL when item not in lookup, enabling COALESCE chain in CAT2).
export const NORM_CAT2_SQL = `
  CASE il.category_2
    WHEN 'Bowls'                  THEN 'Bowl'
    WHEN 'BUILD YOUR OWN BOWL'    THEN 'Bowl'
    WHEN 'BYO'                    THEN 'Bowl'
    WHEN 'CHEF CURATED BOWLS'     THEN 'Bowl'
    WHEN 'Plates'                 THEN 'Plates'
    WHEN 'PLATES'                 THEN 'Plates'
    WHEN 'CLASSIC INDIAN PLATES'  THEN 'Plates'
    WHEN 'Burritos'               THEN 'Burrito'
    WHEN 'BURRITOS'               THEN 'Burrito'
    WHEN 'INDIAN BURRITOS'        THEN 'Burrito'
    WHEN 'Kids Meal'              THEN 'Kids Meal'
    WHEN 'KIDS'                   THEN 'Kids Meal'
    WHEN 'Lassi'                  THEN 'Lassi'
    WHEN 'Juice'                  THEN 'Juice'
    WHEN 'Canned Soda'            THEN 'Canned Soda'
    WHEN 'Kombucha'               THEN 'Kombucha'
    WHEN 'Chai'                   THEN 'Chai'
    WHEN 'Water'                  THEN 'Water'
    WHEN 'Coconut'                THEN 'Coconut'
    WHEN 'Soft Serve'             THEN 'Soft Serve'
    WHEN 'Cookies'                THEN 'Cookies'
    WHEN 'Yogurt'                 THEN 'Yogurt'
    WHEN 'Beer'                   THEN 'Beer'
    WHEN 'Wine'                   THEN 'Wine'
    WHEN 'WINE'                   THEN 'Wine'
    WHEN 'Liquor'                 THEN 'Liquor'
    WHEN 'Gameday'                THEN 'Gameday'
    WHEN 'Retail'                 THEN 'Retail'
    ELSE il.category_2
  END
`;

// ─── GRP_TO_CATEGORY (AppScript) — menu_group → category ────────────────────
// Fallback for items NOT in item_lookup (new items, OFFSITE events, etc.).
// Mirrors AppScript GRP_TO_CATEGORY exactly.
export const GRP_TO_CAT_SQL = `
  CASE fol.menu_group
    WHEN 'BOWLS'                 THEN 'Entrees'
    WHEN 'BUILD YOUR OWN BOWL'   THEN 'Entrees'
    WHEN 'BYO'                   THEN 'Entrees'
    WHEN 'PLATES'                THEN 'Entrees'
    WHEN 'CLASSIC INDIAN PLATES' THEN 'Entrees'
    WHEN 'BURRITOS'              THEN 'Entrees'
    WHEN 'INDIAN BURRITOS'       THEN 'Entrees'
    WHEN 'CHEF CURATED BOWLS'    THEN 'Entrees'
    WHEN 'SIDES'                 THEN 'Sides'
    WHEN 'DRINKS'                THEN 'NA Drinks'
    WHEN 'Cold Drinks'           THEN 'NA Drinks'
    WHEN 'Hot Drinks'            THEN 'NA Drinks'
    WHEN 'SWEETS'                THEN 'Sweets'
    WHEN 'KIDS'                  THEN 'Kids Meal'
    WHEN 'Beer'                  THEN 'Alc Drinks'
    WHEN 'Wine'                  THEN 'Alc Drinks'
    WHEN 'Liquor'                THEN 'Alc Drinks'
    WHEN 'Gameday'               THEN 'Alc Drinks'
    ELSE NULL
  END
`;

// ─── ITEM_SUBCATEGORY + ITEM_SUBCATEGORY_OVERRIDE (AppScript) — name → subcat ─
// Priority 1 in subcategory chain. Includes the BYO Indian Burrito override.
export const ITEM_SUBCAT_SQL = `
  CASE fol.canonical_name
    WHEN 'BYO Indian Burrito'                         THEN 'Burrito'
    WHEN 'Garlic Naan'                                THEN 'Bread'
    WHEN 'Naan'                                       THEN 'Bread'
    WHEN 'Roti'                                       THEN 'Bread'
    WHEN 'Mini Samosas'                               THEN 'Samosa'
    WHEN 'Samosa Chaat'                               THEN 'Samosa'
    WHEN 'Cucumber Raita'                             THEN 'Raita'
    WHEN 'Side of Main'                               THEN 'Main'
    WHEN 'Side of Grain'                              THEN 'Grain'
    WHEN 'Side of Veggie'                             THEN 'Veggie'
    WHEN 'Side of Sauce'                              THEN 'Sauce'
    WHEN 'Chips + Chutney'                            THEN 'Chips'
    WHEN 'That Fire Hot Sauce - Side'                 THEN 'Sauce Bottle'
    WHEN 'That Fire Hot Sauce (Bottle)'               THEN 'Sauce Bottle'
    WHEN 'Mango Lassi'                                THEN 'Lassi'
    WHEN 'Strawberry Lassi'                           THEN 'Lassi'
    WHEN 'Vanilla Mango Lassi Soft Serve'             THEN 'Soft Serve'
    WHEN 'Blossom Lassi'                              THEN 'Lassi'
    WHEN 'Homemade Juice'                             THEN 'Juice'
    WHEN 'Handcrafted Juice for a Group - 1/2 Gallon' THEN 'Juice'
    WHEN 'Maine Root Fountain Soda'                   THEN 'Canned Soda'
    WHEN 'Olipop - Cola'                              THEN 'Canned Soda'
    WHEN 'Olipop - Lemon Lime'                        THEN 'Canned Soda'
    WHEN 'Olipop - Root Beer'                         THEN 'Canned Soda'
    WHEN 'Spindrift - Lemon'                          THEN 'Canned Soda'
    WHEN 'Spindrift - Grapefruit'                     THEN 'Canned Soda'
    WHEN 'LaCroix - Lime'                             THEN 'Canned Soda'
    WHEN 'LaCroix - Grapefruit'                       THEN 'Canned Soda'
    WHEN 'Open Water Still Water'                     THEN 'Water'
    WHEN 'Open Water Sparkling Water'                 THEN 'Water'
    WHEN 'Wild Kombucha - Mango Peach'                THEN 'Kombucha'
    WHEN 'Wild Kombucha - Ginger'                     THEN 'Kombucha'
    WHEN 'Masala Chai'                                THEN 'Chai'
    WHEN 'Masala Chai - Oat Milk'                     THEN 'Chai'
    WHEN 'Iced Oat Masala Chai'                       THEN 'Chai'
    WHEN 'Icaro - Spearmint Yerba Mate'               THEN 'Chai'
    WHEN 'Chocolate Chai Soft Serve'                  THEN 'Chai'
    WHEN 'Fresh Young Coconut'                        THEN 'Coconut'
    WHEN 'Masala Chai Cookies'                        THEN 'Cookies'
    WHEN 'Sweet Cardamom Yogurt'                      THEN 'Yogurt'
    WHEN 'Swirl Soft Serve'                           THEN 'Soft Serve'
    WHEN 'Mango Lassi Soft Serve'                     THEN 'Soft Serve'
    WHEN 'Masala Chai Soft Serve'                     THEN 'Soft Serve'
    WHEN 'Spiked Lassi'                               THEN 'Liquor'
    WHEN 'Tamarind Margarita'                         THEN 'Liquor'
    WHEN 'Pabst Blue Ribbon - Gameday'                THEN 'Gameday'
    ELSE NULL
  END
`;

// ─── GRP_TO_SUBCATEGORY (AppScript) — menu_group → subcat ────────────────────
// Last-resort subcategory fallback when name lookup also returns NULL.
export const GRP_TO_SUBCAT_SQL = `
  CASE fol.menu_group
    WHEN 'BOWLS'                 THEN 'Bowl'
    WHEN 'BUILD YOUR OWN BOWL'   THEN 'Bowl'
    WHEN 'BYO'                   THEN 'Bowl'
    WHEN 'CHEF CURATED BOWLS'    THEN 'Bowl'
    WHEN 'PLATES'                THEN 'Plates'
    WHEN 'CLASSIC INDIAN PLATES' THEN 'Plates'
    WHEN 'BURRITOS'              THEN 'Burrito'
    WHEN 'INDIAN BURRITOS'       THEN 'Burrito'
    WHEN 'KIDS'                  THEN 'Kids Meal'
    WHEN 'Beer'                  THEN 'Beer'
    WHEN 'Wine'                  THEN 'Wine'
    WHEN 'Liquor'                THEN 'Liquor'
    WHEN 'Gameday'               THEN 'Gameday'
    ELSE NULL
  END
`;

// ─── Fiscal periods (hardcoded per RASA accounting calendar) ─────────────────
export const FISCAL_PERIODS = [
  { label: 'P1 2026', start: '2025-12-31', end: '2026-01-27' },
  { label: 'P2 2026', start: '2026-01-28', end: '2026-02-24' },
  { label: 'P3 2026', start: '2026-02-25', end: '2026-03-24' },
  { label: 'P4 2026', start: '2026-03-25', end: '2026-04-22' },
  { label: 'P5 2026', start: '2026-04-23', end: '2026-05-20' },
  { label: 'P6 2026', start: '2026-05-21', end: '2026-06-17' },
  { label: 'P7 2026', start: '2026-06-18', end: '2026-07-15' },
  { label: 'P8 2026', start: '2026-07-16', end: '2026-08-12' },
] as const;
