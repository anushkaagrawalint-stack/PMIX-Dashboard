import { loadDashboardData } from '@/lib/queries';
import Dashboard from '@/components/Dashboard';


interface Props {
  searchParams: Promise<{ start?: string; end?: string; label?: string }>;
}

export default async function Home({ searchParams }: Props) {
  const { start, end, label } = await searchParams;
  const override = start && end ? { start, end, label } : undefined;
  const data = await loadDashboardData(override);
  return <Dashboard data={data} />;
}
