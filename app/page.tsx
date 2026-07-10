import { cookies } from 'next/headers';
import { loadDashboardData } from '@/lib/queries';
import { verifyToken, hasAdminAccess, COOKIE } from '@/lib/auth';
import { getTabPermissions } from '@/lib/tabPermissions';
import { TAB_META } from '@/lib/tabsMeta';
import Dashboard from '@/components/Dashboard';


interface Props {
  searchParams: Promise<{ start?: string; end?: string; label?: string }>;
}

export default async function Home({ searchParams }: Props) {
  const { start, end, label } = await searchParams;
  const override = start && end ? { start, end, label } : undefined;
  // getTabPermissions() is a tiny ~15-row lookup — runs concurrently with the
  // heavy loadDashboardData query, so it adds no measurable page-load time.
  const [data, cookieStore, permissions] = await Promise.all([
    loadDashboardData(override),
    cookies(),
    getTabPermissions(),
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

  return (
    <Dashboard
      data={data}
      isAdmin={isAdmin}
      role={role}
      visibleTabs={visibleTabs}
      currentEmail={payload?.email ?? null}
    />
  );
}
