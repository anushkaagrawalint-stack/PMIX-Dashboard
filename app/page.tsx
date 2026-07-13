import { cookies } from 'next/headers';
import { loadDashboardData } from '@/lib/queries';
import { verifyToken, hasAdminAccess, COOKIE } from '@/lib/auth';
import { getTabPermissions } from '@/lib/tabPermissions';
import { getLocationsWithStatus } from '@/lib/locationStatus';
import { TAB_META } from '@/lib/tabsMeta';
import Dashboard from '@/components/Dashboard';


interface Props {
  searchParams: Promise<{ start?: string; end?: string; label?: string }>;
}

export default async function Home({ searchParams }: Props) {
  const { start, end, label } = await searchParams;
  const override = start && end ? { start, end, label } : undefined;
  // getTabPermissions() and getLocationsWithStatus() are both tiny lookups
  // (~15 and ~5 rows) that run concurrently with the heavy loadDashboardData
  // query, so neither adds measurable page-load time. Both must stay OUTSIDE
  // loadDashboardData's cache (cacheLife('hours')) — otherwise a tester's
  // tab/location change could sit stale for up to an hour.
  const [data, cookieStore, permissions, freshLocations] = await Promise.all([
    loadDashboardData(override),
    cookies(),
    getTabPermissions(),
    getLocationsWithStatus(),
  ]);
  const token   = cookieStore.get(COOKIE)?.value;
  const payload = token ? await verifyToken(token) : null;
  const isAdmin = hasAdminAccess(payload?.role);
  const role    = payload?.role ?? 'user';

  // Tester always sees every tab (hardcoded, never gated). Admin/user are
  // governed by analytics.tab_permissions — a tab with no row yet defaults to
  // visible, so newly added tabs aren't silently hidden pre-configuration.
  const visibleTabs = role === 'tester'
    ? TAB_META.map(t => t.id as string)
    : TAB_META.filter(t => permissions[role as 'admin' | 'user']?.[t.id] !== false).map(t => t.id as string);

  // data.locations came from the cached loadDashboardData with is_open
  // hardcoded true (see getLocations() in lib/queries.ts) — replace with the
  // freshly-fetched, always-current status before it reaches the client.
  const dataWithFreshLocations = { ...data, locations: freshLocations };

  return (
    <Dashboard
      data={dataWithFreshLocations}
      isAdmin={isAdmin}
      role={role}
      visibleTabs={visibleTabs}
      currentEmail={payload?.email ?? null}
    />
  );
}
