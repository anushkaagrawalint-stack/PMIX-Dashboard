/**
 * Query profiler — times every query loadDashboardData fires, individually,
 * against the database in DATABASE_URL. Use it after changing any query to see
 * what it costs, instead of guessing from page-load feel.
 *
 * Run:   npx tsx --env-file=.env scripts/profile.mts            (default: P5)
 *        npx tsx --env-file=.env scripts/profile.mts 2026-06-01 2026-06-28
 *
 * Notes:
 * - Read-only; safe against production.
 * - Runs queries SEQUENTIALLY for clean per-query numbers (total is therefore
 *   worst-case; the app runs them in parallel, so real load ≈ slowest query).
 * - Times include network RTT to Neon from wherever you run this — compare
 *   queries against each other, not against Vercel wall-clock.
 * - Calls the individual query functions, NOT loadDashboardData, so Next's
 *   'use cache' never engages and numbers reflect true query cost.
 * - History: 2026-07-03 this flagged getNeedsReview at 211s (missing
 *   br_order_payment(order_guid) index → idx_bop_order). Post-fix: 1.7s.
 */
import * as q from '../lib/queries';

const [startArg, endArg] = process.argv.slice(2);
const dr: any = {
  start: startArg ?? '2026-04-27',
  end:   endArg   ?? '2026-05-24',
  dbMax: endArg   ?? '2026-05-24',
  label: 'profile',
};
console.log(`Profiling ${dr.start} → ${dr.end}\n`);

const fns: [string, () => Promise<unknown>][] = [
  ['getDateRange', () => q.getDateRange()],
  ['getPeriods', () => q.getPeriods()],
  ['getSummary', () => q.getSummary(dr)],
  ['getChannels', () => q.getChannels(dr)],
  ['getWeekly', () => q.getWeekly(dr)],
  ['getDaily', () => q.getDaily(dr)],
  ['getWeeklyByChannel', () => q.getWeeklyByChannel(dr)],
  ['getDailyByChannel', () => q.getDailyByChannel(dr)],
  ['getItems', () => q.getItems(dr)],
  ['getChannelItems', () => q.getChannelItems(dr)],
  ['getLocationItems', () => q.getLocationItems(dr)],
  ['getLocations', () => q.getLocations()],
  ['getMEItems', () => q.getMEItems(dr)],
  ['getMEPinkSheets', () => q.getMEPinkSheets(dr)],
  ['getMEPinkSheetDetails', () => q.getMEPinkSheetDetails(dr)],
  ['getModifiers', () => q.getModifiers(dr)],
  ['getPayments', () => q.getPayments(dr)],
  ['getPaymentsByLocation', () => q.getPaymentsByLocation(dr)],
  ['getPaymentSourcesByLocation', () => q.getPaymentSourcesByLocation(dr)],
  ['getBikky', () => q.getBikky()],
  ['getCategories', () => q.getCategories(dr)],
  ['getChannelCategories', () => q.getChannelCategories(dr)],
  ['getRenames', () => q.getRenames()],
  ['getNeedsReview', () => q.getNeedsReview(dr)],
  ['getOpenItems', () => q.getOpenItems(dr)],
  ['getUncategorizedItems', () => q.getUncategorizedItems(dr)],
  ['getCateringVendors', () => q.getCateringVendors(dr)],
  ['getOffsiteVendors', () => q.getOffsiteVendors(dr)],
  ['getItemCosts', () => q.getItemCosts(dr)],
];

const results: { name: string; ms: number; err?: string }[] = [];
for (const [name, fn] of fns) {
  const t0 = Date.now();
  try { await fn(); results.push({ name, ms: Date.now() - t0 }); }
  catch (e: any) { results.push({ name, ms: Date.now() - t0, err: String(e?.message).slice(0, 60) }); }
  process.stdout.write('.');
}
console.log('\n');
results.sort((a, b) => b.ms - a.ms);
for (const r of results) {
  const flag = r.err ? `  ERR: ${r.err}` : r.ms > 10_000 ? '  ◀ INVESTIGATE' : '';
  console.log(`${String(r.ms).padStart(7)} ms  ${r.name}${flag}`);
}
console.log(`${String(results.reduce((s, r) => s + r.ms, 0)).padStart(7)} ms  TOTAL (sequential; app runs in parallel ≈ slowest row)`);
