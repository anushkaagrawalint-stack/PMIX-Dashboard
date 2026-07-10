import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, hasAdminAccess, COOKIE } from '@/lib/auth';
import { getDateRange, getAttachmentData } from '@/lib/queries';

// Admin/tester-only, fetched on demand when the Attachment Rate tab is opened —
// deliberately NOT part of loadDashboardData (owner request 2026-07-08: keep
// this out of the main page load for all users while it's still in testing).
export async function GET(req: NextRequest) {
  const token   = req.cookies.get(COOKIE)?.value;
  const payload = token ? await verifyToken(token) : null;
  if (!payload || !hasAdminAccess(payload.role)) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const start = searchParams.get('start');
  const end   = searchParams.get('end');
  const label = searchParams.get('label') ?? undefined;
  const channelsParam = searchParams.get('channels');
  const locationsParam = searchParams.get('locations');
  const channels  = channelsParam  ? channelsParam.split(',').filter(Boolean)  : undefined;
  const locations = locationsParam ? locationsParam.split(',').filter(Boolean) : undefined;

  try {
    const dr = await getDateRange(start && end ? { start, end, label } : undefined);
    const data = await getAttachmentData(dr, channels, locations);
    return NextResponse.json({ dateRange: dr, ...data });
  } catch (err) {
    console.error('attachment-rate GET error:', err);
    return NextResponse.json({ error: 'Failed to load attachment data' }, { status: 500 });
  }
}
