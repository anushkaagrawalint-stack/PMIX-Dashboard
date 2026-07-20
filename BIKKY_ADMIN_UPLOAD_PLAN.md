# Bikky Admin Upload Plan — retire Neon for Bikky, move to git-committed CSVs

**Goal:** admins/testers upload the two Bikky exports (In-Store, 3PD+Loyalty)
from the Admin Panel. Each upload parses, validates, and commits the CSV
straight to the **PMIX-Dashboard** repo itself (not the pipeline repo). The
dashboard reads Bikky data by fetching and parsing those committed CSVs live
on every request — **no Postgres table is involved for Bikky data anymore.**

Confirmed decisions (from you):
- Files live in a new `Data/Bikkydata/InStore/` and `Data/Bikkydata/3PD+Loyalty/`
  inside **this** repo (`github.com/anushkaagrawalint-stack/PMIX-Dashboard`),
  not `PMIX-Pipeline`.
- Reads parse CSV live per request — no intermediate JSON cache committed.
- No GitHub token exists yet — creating one is part of this plan.
- Replace = delete the existing file for that period+type, then upload the
  new one (two commits). Delete = remove the file, no extra guardrails on
  period age.
- Treat this as greenfield: no migration of the P1–P5 files currently sitting
  in `PMIX-Pipeline/Data/Bikkydata/` — re-upload them through the new UI later
  if you want historical periods visible (optional, your call, not automated
  here).

---

## 0. Ground truth this plan is built on

1. **Current write path:** `toast_pipeline.cli bikky-instore` / `bikky-3pd`
   parse `Data/Bikkydata/{InStore,3PD+Loyalty}/P{PP}{YYYY}{IS,Del}.csv` via
   Python `csv.DictReader`, map columns through `_BIKKY_COL_MAP`
   ([toast_pipeline/cli.py:203-329](../PMIX-Pipeline/PMIX-Pipeline/toast_pipeline/cli.py#L203-L329)),
   and upsert into `public.fact_bikky_instore` / `fact_bikky_3pd_loyalty`
   (`PRIMARY KEY (fiscal_year, period, item_name)`). Triggered by
   [.github/workflows/bikky_load.yml](../PMIX-Pipeline/PMIX-Pipeline/.github/workflows/bikky_load.yml)
   on push to those paths.
2. **Current read path:** `getBikky()`
   ([lib/queries.ts:1988](lib/queries.ts#L1988)) is a plain `UNION ALL` over
   both tables with **no date/period filter at all** — it returns every row
   ever loaded, tagged `source: 'instore' | '3pd_loyalty'`, and the UI
   (`components/tabs/CustomerRetention.tsx`) filters/aggregates client-side.
   This matters: replacing it means "read every CSV file in both folders and
   concatenate" — not "read the CSVs for one period" — so no per-request
   period-filtering logic needs to be invented, just parity with today's
   "return everything" behavior.
3. **CSV shape** (from the two sample files you gave me): 41 columns, header
   row exactly as in `_BIKKY_COL_MAP`. Only 6 of those columns are actually
   read downstream (`item_name, return_rate, reorder_rate, return_rate_prev,
   reorder_rate_prev, guests`) plus `fiscal_year`/`period` (from the
   filename, not a column). The other 35 columns are ignored today and can
   stay ignored.
4. Filenames encode period/year: `P(\d{2})(\d{4})IS` for In-Store,
   `P(\d{2})(\d{4})Del` for 3PD+Loyalty — same regex the Python loader uses.

---

## 1. New repo layout (this repo)

```
PMIX-Dashboard/
  Data/
    Bikkydata/
      InStore/
        P012026IS.csv
        P062026IS.csv   ← new uploads land here
      3PD+Loyalty/
        P012026Del.csv
        P062026Del.csv
```

Filenames are **derived from the admin's period picker at upload time**, not
trusted from whatever the uploader's local file was named — this avoids a
mismatched filename silently misfiling a period. E.g. picking "In-Store,
Period 6, 2026" always writes to `Data/Bikkydata/InStore/P062026IS.csv`
regardless of what the browser's file picker reports as the filename.

---

## 2. GitHub write access (setup step, do this first)

1. Create a **fine-grained personal access token** scoped to only this repo
   (`anushkaagrawalint-stack/PMIX-Dashboard`), permission **Contents:
   Read and write** — nothing else. Fine-grained + single-repo scope, not a
   classic PAT with blanket `repo` access, since this token lives in a server
   env var and only ever needs to touch one repo's files.
2. Add it as `GITHUB_TOKEN` in the dashboard's env (`.env` locally, and
   whatever secret store the deployment uses — Vercel project env vars, given
   `BLOB_READ_WRITE_TOKEN` already present in `.env` suggests Vercel hosting).
3. Add `GITHUB_REPO` = `anushkaagrawalint-stack/PMIX-Dashboard`,
   `GITHUB_BRANCH` = `main` as plain env vars (not secret, just config) so the
   repo/branch aren't hardcoded in route code.

**Verify:** a throwaway script that does one `PUT
/repos/{GITHUB_REPO}/contents/Data/Bikkydata/.gitkeep` with the token
succeeds and shows up as a commit on `main`.

---

## 3. Shared CSV schema module (single source of truth)

New file `lib/bikkyCsv.ts` — ports the Python column map so upload
validation and read parsing can't drift apart:

```ts
export const BIKKY_COL_MAP: Record<string, string> = {
  'Item': 'item_name',
  'Item id': 'item_id',
  'Item revenue': 'revenue',
  // ...full mapping, ported 1:1 from toast_pipeline/cli.py's _BIKKY_COL_MAP
};
export const BIKKY_NUMERIC_COLS = new Set([...]);   // ported from _BIKKY_NUMERIC_COLS
export const BIKKY_REQUIRED_HEADER = 'Item';         // minimum viable header check

export function parseBikkyCsv(raw: string): Array<Record<string, string | number | null>> {
  // csv-parse (Node) with columns: true, then map + coerce numeric cols.
}
```

New dependency: `csv-parse` (small, pure-Node, handles quoted fields
correctly — don't hand-roll a `.split(',')` parser, some exports may contain
commas inside quoted item names).

---

## 4. Upload / Replace / Delete API

New route: `app/api/admin/bikky/route.ts`. Admin-only
(`hasAdminAccess`, same guard as [app/api/costs/route.ts](app/api/costs/route.ts)).

### `GET /api/admin/bikky`
Lists existing files in both folders (one GitHub Contents API directory
listing per folder) so the Admin Panel can show "what's already uploaded"
and let the admin pick one to replace/delete.

### `POST /api/admin/bikky` — upload (create or replace)
```jsonc
// multipart/form-data
{ "type": "instore" | "3pd_loyalty", "period": 6, "fiscal_year": 2026, "file": <CSV> }
```
Server steps:
1. Validate `type`/`period`/`fiscal_year` shape.
2. Read the uploaded file as text, run `parseBikkyCsv()` — reject with a
   clear error if the header row doesn't contain `Item`, or zero rows parse
   to a non-empty `item_name`. **This is the only integrity check left**
   (Postgres's `NOT NULL`/type constraints are gone) — don't skip it.
3. Compute the canonical path:
   `Data/Bikkydata/{InStore|3PD+Loyalty}/P{period:02}{fiscal_year}{IS|Del}.csv`.
4. If a file already exists at that path (per your answer: replace = delete
   then create):
   - `DELETE /repos/{GITHUB_REPO}/contents/{path}` (needs current `sha`,
     fetched via a `GET` first) — one commit, message
     `"bikky: remove {path} (replaced)"`.
   - `PUT /repos/{GITHUB_REPO}/contents/{path}` with the new base64 content —
     second commit, message `"bikky: upload {path}"`.
5. If no file exists yet, just the `PUT` (one commit).
6. On success, call `revalidateTag('dashboard-data', { expire: 0 })` (see §5) so the upload
   is visible on next load instead of waiting out `cacheLife('hours')`.

*Note on the two-commit replace:* this does what you asked for literally,
but it's worth knowing GitHub's Contents API supports a single-commit
overwrite (`PUT` with the existing file's `sha` included) instead of
delete-then-create. Delete-then-create also leaves a brief window where the
file doesn't exist if two requests race. If you'd rather have one commit per
replace, say so and I'll change this to the single-`PUT` form — otherwise
this ships as literal delete+create.

### `DELETE /api/admin/bikky?type=instore&period=6&fiscal_year=2026`
Looks up the file's current `sha`, calls the Contents API `DELETE`. One
commit, message `"bikky: delete {path}"`. Also calls
`revalidateTag('dashboard-data', { expire: 0 })` on success.

---

## 5. Read path — replace `getBikky()`

```ts
export async function getBikky(): Promise<BikkyRow[]> {
  const [instoreFiles, del3pdFiles] = await Promise.all([
    listBikkyFiles('InStore'),
    listBikkyFiles('3PD+Loyalty'),
  ]);
  const [instoreRows, del3pdRows] = await Promise.all([
    Promise.all(instoreFiles.map(f => fetchAndParseBikkyFile(f, 'instore'))),
    Promise.all(del3pdFiles.map(f => fetchAndParseBikkyFile(f, '3pd_loyalty'))),
  ]);
  return [...instoreRows.flat(), ...del3pdRows.flat()]
    .sort((a, b) => /* fiscal_year desc, period desc, return_rate desc nulls-last — mirrors today's ORDER BY */);
}
```

- `listBikkyFiles(folder)` = one GitHub Contents API directory listing.
- `fetchAndParseBikkyFile(file, source)` = fetch raw content (GitHub Contents
  API with `Accept: application/vnd.github.raw+json`, authenticated with
  `GITHUB_TOKEN` since the repo is private), parse via `parseBikkyCsv()`,
  pull `fiscal_year`/`period` from the filename regex (same regex as the
  Python loader), map to `BikkyRow` shape — **identical output shape to
  today**, so `CustomerRetention.tsx` and every other consumer needs zero
  changes.

**Caching — this repo does NOT use classic Next.js fetch-cache.** This is
Next.js 16 with `cacheComponents: true`
([next.config.ts](next.config.ts)) — the newer `'use cache'` /
`cacheLife` / `cacheTag` model, confirmed by `loadDashboardData()`'s own
`'use cache'; cacheLife('hours')`
([lib/queries.ts:2991-2992](lib/queries.ts#L2991-L2992)). Do **not** add
`fetch(..., { next: { revalidate, tags } })` to `getBikky()` — that's the
pre-Cache-Components API and has no effect here.

`getBikky()` needs **no cache directive of its own** — it already runs
inside `loadDashboardData()`'s cached scope and inherits that caching for
free, exactly like every other `get*()` function in `queries.ts` today.

**Invalidation, done correctly this time:**
- Add `cacheTag('dashboard-data')` as the first line inside
  `loadDashboardData()`, right after `cacheLife('hours')`.
- The Bikky upload/delete route calls `revalidateTag('dashboard-data', { expire: 0 })`
  (from `next/cache`) after a successful commit — not `revalidatePath('/')`.
  Per Next's own `'use cache'` docs, `cacheTag` + `revalidateTag`/`updateTag`
  is the documented on-demand invalidation path for `'use cache'`-tagged
  functions; `revalidatePath` is not documented to reach into that cache at
  all. Note `revalidateTag` now requires a second argument (the single-arg
  form is deprecated) — `updateTag` gives read-your-own-writes semantics but
  is Server-Action-only, so it can't be used from a Route Handler; `{ expire:
  0 }` is what the docs call out specifically for Route-Handler-triggered
  mutations that need immediate (not stale-while-revalidate) effect.
- **This one `cacheTag` line is the only change to existing code this plan
  requires** — everything else about `loadDashboardData()` stays untouched.
  Whether to also switch the *existing* `update-channel`/`categorize-item`
  routes from `revalidatePath('/')` to `revalidateTag('dashboard-data', { expire: 0 })` is
  a separate follow-up (see §9) — not bundled into this feature.

---

## 6. Admin Panel UI

New section in [components/tabs/AdminPanel.tsx](components/tabs/AdminPanel.tsx)
(or a new tab if AdminPanel is already crowded — your call at build time):

- Two tables (In-Store / 3PD+Loyalty), each row = one currently-uploaded
  period file, sourced from `GET /api/admin/bikky`. Per row: period label,
  a "Replace" button (opens file picker, same period/type), a "Delete"
  button (confirm dialog, then `DELETE`).
- An "Upload new period" form: type toggle, period number + fiscal year
  inputs, file picker, submit → `POST`.
- Inline validation error surface (the header/row-count check from §4 step 2)
  so a malformed CSV fails loudly in the UI instead of silently landing a
  broken file in git.

---

## 7. Decommission the old path

Once the new upload flow is live and verified (§8):
- Stop relying on
  [.github/workflows/bikky_load.yml](../PMIX-Pipeline/PMIX-Pipeline/.github/workflows/bikky_load.yml)
  — either disable its `push` trigger (keep `workflow_dispatch` as a dead
  fallback) or leave it; it's inert once nothing pushes CSVs into
  `PMIX-Pipeline/Data/Bikkydata/` anymore.
- Leave `public.fact_bikky_instore` / `fact_bikky_3pd_loyalty` in place but
  unused — don't drop them immediately. Revisit dropping them once you're
  confident the CSV-based path has been running cleanly for a while.

---

## 8. Rollout sequence

1. **GitHub token + env vars** (§2) → verify: manual test commit lands.
2. **`lib/bikkyCsv.ts`** (§3) → verify: unit-parse the two sample files you
   gave me, confirm the 6 downstream fields extract correctly for a handful
   of known rows (e.g. "Chicken Tikka Bowl" row from the In-Store sample).
3. **Upload/replace/delete route** (§4) → verify: upload a test period via
   `curl`/Postman before wiring the UI, confirm the commit appears on GitHub
   with the exact expected path and content.
4. **Read path** (§5) → verify: `getBikky()` output for the just-uploaded
   test period matches what `parseBikkyCsv()` produces directly from the
   same file — byte-for-byte on the 6 fields that matter.
5. **Admin UI** (§6) → verify: full loop in the browser — upload, see it
   appear in Customer Retention tab, replace it, delete it, confirm each
   step's git commit.
6. **Decommission** (§7).

---

## 9. Risks / open notes

- **GitHub API rate limit**: 5,000 req/hr per authenticated token — fine for
  internal admin traffic. Since `getBikky()` rides `loadDashboardData()`'s
  hours-long cache (§5), normal page loads don't re-hit GitHub at all
  between cache windows/`revalidateTag` calls.
- **Cross-validation finding — existing `revalidatePath('/')` calls may be
  no-ops against the `'use cache'` data cache.** `update-channel/route.ts`
  and `categorize-item/route.ts` invalidate via `revalidatePath('/')`, but
  there is no `cacheTag` anywhere in the codebase today — and Next's docs
  describe `cacheTag`/`revalidateTag`/`updateTag` as the on-demand
  invalidation path for `'use cache'`-tagged functions, not
  `revalidatePath`. This plan adds the one `cacheTag('dashboard-data')`
  needed for the new Bikky routes to invalidate correctly, but doesn't
  touch those two existing routes. **Follow-up worth doing separately:**
  switch them to `revalidateTag('dashboard-data', { expire: 0 })` too, and actually verify
  in the browser (edit a channel override, confirm it shows up next load
  without waiting out `cacheLife('hours')`) — don't assume either the old or
  new behavior works until it's been watched happen once.
- **No audit trail beyond git history** — acceptable since every change is
  already a commit with a message; if you want who-clicked-what beyond the
  git author (which will just be the token's identity, not the admin's), that
  needs the route to also log `email` from the session into the commit
  message.
- **Concurrent uploads to the same period** could race between the DELETE
  and PUT in a replace — low risk given this is an internal single-admin-ish
  tool, not flagged as something to solve now.
- **The two-commit replace** — see the note in §4; flag if you'd rather have
  a single-commit overwrite instead.
