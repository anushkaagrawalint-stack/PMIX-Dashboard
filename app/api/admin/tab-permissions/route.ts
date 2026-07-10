import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, hasAdminAccess, COOKIE } from '@/lib/auth';
import { getTabPermissions, setTabPermission, type GovernedRole } from '@/lib/tabPermissions';

async function requireAdminAccess(req: NextRequest) {
  const token = req.cookies.get(COOKIE)?.value;
  const payload = token ? await verifyToken(token) : null;
  return payload && hasAdminAccess(payload.role) ? payload : null;
}

// GET /api/admin/tab-permissions — current tab visibility for the admin + user roles.
export async function GET(req: NextRequest) {
  const caller = await requireAdminAccess(req);
  if (!caller) return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

  try {
    const permissions = await getTabPermissions();
    return NextResponse.json({ permissions });
  } catch (err) {
    console.error('tab-permissions GET error:', err);
    return NextResponse.json({ error: 'Failed to load tab permissions' }, { status: 500 });
  }
}

// POST /api/admin/tab-permissions — set one tab's visibility for one governed role.
// Body: { role: 'admin' | 'user', tab_id: string, visible: boolean }
// Testers may edit either role's tabs; admins may only edit the 'user' role's —
// enforced here server-side, not just hidden in the UI.
export async function POST(req: NextRequest) {
  const caller = await requireAdminAccess(req);
  if (!caller) return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

  const { role, tab_id, visible } = await req.json().catch(() => ({}));
  if ((role !== 'admin' && role !== 'user') || typeof tab_id !== 'string' || typeof visible !== 'boolean') {
    return NextResponse.json({ error: 'role (admin|user), tab_id, and visible are required' }, { status: 400 });
  }
  if (role === 'admin' && caller.role !== 'tester') {
    return NextResponse.json({ error: 'Only testers can change what Admin sees' }, { status: 403 });
  }

  try {
    await setTabPermission(role as GovernedRole, tab_id, visible);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('tab-permissions POST error:', err);
    return NextResponse.json({ error: 'Failed to update tab permission' }, { status: 500 });
  }
}
