import { NextRequest, NextResponse } from 'next/server';
import { getPayments, getPaymentsByLocation, getPaymentSourcesByLocation, getDeniedVoidedTotal } from '@/lib/queries';
import type { DateRange } from '@/lib/types';

const ALL_STATUSES = ['CAPTURED', 'AUTHORIZED', 'DENIED', 'VOIDED'];

// PAYMENT_BASIS_TOGGLE_SPEC.md Part B.2: statuses × basis is too many variants
// to pre-fetch in loadDashboardData, so the PaymentSource tab calls this route
// on demand instead. Kept outside loadDashboardData's cache entirely — always
// live, since the point is picking a non-default basis/status combo.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const start = searchParams.get('start');
  const end = searchParams.get('end');
  const basisParam = searchParams.get('basis') ?? 'event';
  const statusesParam = searchParams.get('statuses');

  if (!start || !end) {
    return NextResponse.json({ error: 'Missing start or end' }, { status: 400 });
  }
  if (basisParam !== 'event' && basisParam !== 'paid') {
    return NextResponse.json({ error: 'basis must be "event" or "paid"' }, { status: 400 });
  }
  const statuses = statusesParam ? statusesParam.split(',').filter(Boolean) : ['CAPTURED', 'AUTHORIZED'];
  if (statuses.length === 0 || !statuses.every(s => ALL_STATUSES.includes(s))) {
    return NextResponse.json({ error: `statuses must be a non-empty subset of ${ALL_STATUSES.join(', ')}` }, { status: 400 });
  }
  const basis = basisParam as 'event' | 'paid';

  const dr: DateRange = { start, end, label: `${start} → ${end}`, dbMin: start, dbMax: end };

  const deniedVoidedStatuses = statuses.filter(s => s === 'DENIED' || s === 'VOIDED');

  try {
    const [payments, paymentsByLocation, paymentSourcesByLocation, deniedVoided] = await Promise.all([
      getPayments(dr, basis, statuses),
      getPaymentsByLocation(dr, basis, statuses),
      getPaymentSourcesByLocation(dr, basis, statuses),
      getDeniedVoidedTotal(dr, basis, deniedVoidedStatuses),
    ]);
    return NextResponse.json({ payments, paymentsByLocation, paymentSourcesByLocation, deniedVoided });
  } catch (err) {
    console.error('payments route error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
