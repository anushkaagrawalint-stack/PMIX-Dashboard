import type { FiscalPeriodRow } from '@/lib/types';

export function fiscalWeekLabel(weekStart: string, periods: FiscalPeriodRow[]): string {
  const wMs = new Date(weekStart + 'T00:00:00').getTime();
  for (const p of periods) {
    const pStart = new Date(p.start_date + 'T00:00:00').getTime();
    const pEnd   = new Date(p.end_date   + 'T00:00:00').getTime();
    if (wMs >= pStart && wMs <= pEnd) {
      const weekNum = Math.floor((wMs - pStart) / (7 * 24 * 3600 * 1000)) + 1;
      return `P${p.period}W${weekNum}`;
    }
  }
  return weekStart.slice(5);
}
