import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, hasAdminAccess, COOKIE } from '@/lib/auth';
import { getLocationsWithStatus, setLocationStatus } from '@/lib/locationStatus';

// Configuring open/closed locations, and the resulting "Open Locations"
// dropdown option, are available to both admin and tester (owner request
// 2026-07-13 tester-only, opened up to admin as well same day) — unlike tab
// permissions, there's no per-role hierarchy here: a location is physically
// open or closed regardless of who's looking, so admin and tester share full
// read/write access equally.
async function requireAdminAccess(req: NextRequest) {
  const token = req.cookies.get(COOKIE)?.value;
  const payload = token ? await verifyToken(token) : null;
  return payload && hasAdminAccess(payload.role) ? payload : null;
}

// GET /api/admin/location-status — every location + its current open/closed status.
export async function GET(req: NextRequest) {
  const caller = await requireAdminAccess(req);
  if (!caller) return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

  try {
    const locations = await getLocationsWithStatus();
    return NextResponse.json({ locations });
  } catch (err) {
    console.error('location-status GET error:', err);
    return NextResponse.json({ error: 'Failed to load location status' }, { status: 500 });
  }
}

// POST /api/admin/location-status — set one location's open/closed status.
// Body: { location_code: string, is_open: boolean }
export async function POST(req: NextRequest) {
  const caller = await requireAdminAccess(req);
  if (!caller) return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

  const { location_code, is_open } = await req.json().catch(() => ({}));
  if (typeof location_code !== 'string' || typeof is_open !== 'boolean') {
    return NextResponse.json({ error: 'location_code and is_open are required' }, { status: 400 });
  }

  try {
    await setLocationStatus(location_code, is_open);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('location-status POST error:', err);
    return NextResponse.json({ error: 'Failed to update location status' }, { status: 500 });
  }
}
