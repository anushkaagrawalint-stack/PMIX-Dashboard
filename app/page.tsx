import { cookies } from 'next/headers';
import { loadDashboardData } from '@/lib/queries';
import { verifyToken, COOKIE } from '@/lib/auth';
import Dashboard from '@/components/Dashboard';


interface Props {
  searchParams: Promise<{ start?: string; end?: string; label?: string }>;
}

export default async function Home({ searchParams }: Props) {
  const { start, end, label } = await searchParams;
  const override = start && end ? { start, end, label } : undefined;
  const [data, cookieStore] = await Promise.all([
    loadDashboardData(override),
    cookies(),
  ]);
  const token   = cookieStore.get(COOKIE)?.value;
  const payload = token ? await verifyToken(token) : null;
  const isAdmin = payload?.role === 'admin';
  return <Dashboard data={data} isAdmin={isAdmin} />;
}
