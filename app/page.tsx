import { unstable_cache } from 'next/cache';
import { loadDashboardData } from '@/lib/queries';
import Dashboard from '@/components/Dashboard';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ start?: string; end?: string; label?: string }>;
}

export default async function Home({ searchParams }: Props) {
  const { start, end, label } = await searchParams;
  const override = start && end ? { start, end, label } : undefined;

  const cacheKey = override ? `${override.start}_${override.end}` : 'default';
  const getCached = unstable_cache(
    () => loadDashboardData(override),
    ['dashboard', cacheKey],
    { revalidate: 300 }, // 5 min cache, server-side only — proxy still runs every request
  );

  const data = await getCached();
  return <Dashboard data={data} />;
}
