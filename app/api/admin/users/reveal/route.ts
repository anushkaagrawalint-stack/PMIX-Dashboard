import { NextRequest, NextResponse } from 'next/server';
import { Pool } from '@neondatabase/serverless';
import { verifyToken, hasAdminAccess, COOKIE } from '@/lib/auth';
import { decryptPassword } from '@/lib/crypto';

function pool() { return new Pool({ connectionString: process.env.DATABASE_URL! }); }

// POST /api/admin/users/reveal — decrypt and return one user's current plaintext
// password. Admin/tester only. On-demand, per-user (never bulk) so a single list
// fetch can't dump every password at once.
export async function POST(req: NextRequest) {
  const token   = req.cookies.get(COOKIE)?.value;
  const payload = token ? await verifyToken(token) : null;
  if (!payload || !hasAdminAccess(payload.role)) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  const { email } = await req.json().catch(() => ({}));
  if (!email || typeof email !== 'string') {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 });
  }
  const normalized = email.toLowerCase().trim();

  const db = pool();
  try {
    const { rows } = await db.query(`SELECT password_enc FROM analytics.users WHERE email = $1`, [normalized]);
    await db.end();
    if (rows.length === 0) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    if (!rows[0].password_enc) {
      return NextResponse.json({ error: 'No viewable password on file for this user — reset their password to set one' }, { status: 404 });
    }
    const password = decryptPassword(rows[0].password_enc);
    return NextResponse.json({ password });
  } catch (err) {
    console.error('admin/users/reveal error:', err);
    await db.end().catch(() => {});
    return NextResponse.json({ error: 'Failed to reveal password' }, { status: 500 });
  }
}
