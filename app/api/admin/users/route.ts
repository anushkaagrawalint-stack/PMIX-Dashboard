import { NextRequest, NextResponse } from 'next/server';
import { Pool } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';
import { verifyToken, hasAdminAccess, COOKIE, type Role } from '@/lib/auth';
import { encryptPassword } from '@/lib/crypto';

function pool() { return new Pool({ connectionString: process.env.DATABASE_URL! }); }

async function requireAdmin(req: NextRequest) {
  const token = req.cookies.get(COOKIE)?.value;
  const payload = token ? await verifyToken(token) : null;
  return payload && hasAdminAccess(payload.role) ? payload : null;
}

const VALID_ROLES = new Set<Role>(['admin', 'tester', 'user']);

// GET /api/admin/users — list all users (emails + roles + names, no hashes).
export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

  const db = pool();
  try {
    const { rows } = await db.query(`SELECT email, name, role, created_at FROM analytics.users ORDER BY email`);
    await db.end();
    return NextResponse.json({ users: rows });
  } catch (err) {
    console.error('admin/users GET error:', err);
    await db.end().catch(() => {});
    return NextResponse.json({ error: 'Failed to load users' }, { status: 500 });
  }
}

// POST /api/admin/users — add a new user or update an existing one.
// Body: { email, password?, role, name? } — password required for new users,
// optional when updating an existing one (omit to keep the current password).
// name is always optional and always set directly (not a sensitive field like
// password, so no "omit to keep unchanged" — the edit form always sends the
// current value, whether changed or not).
export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

  const { email, password, role, name } = await req.json().catch(() => ({}));
  if (!email || typeof email !== 'string') {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 });
  }
  if (!role || !VALID_ROLES.has(role)) {
    return NextResponse.json({ error: 'Role must be admin or user' }, { status: 400 });
  }
  const normalized = email.toLowerCase().trim();
  const cleanName = typeof name === 'string' && name.trim() ? name.trim() : null;

  const db = pool();
  try {
    const { rows } = await db.query(`SELECT password_hash FROM analytics.users WHERE email = $1`, [normalized]);
    const existing = rows[0];

    if (!existing && !password) {
      await db.end();
      return NextResponse.json({ error: 'Password is required for new users' }, { status: 400 });
    }
    if (password && String(password).length < 6) {
      await db.end();
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
    }

    const hash = password ? await bcrypt.hash(String(password), 10) : existing.password_hash;
    // password_enc is only set/overwritten when a new password is actually provided —
    // omitted on a role-only edit, existing encrypted value (if any) stays untouched.
    const enc  = password ? encryptPassword(String(password)) : undefined;
    await db.query(`
      INSERT INTO analytics.users (email, password_hash, password_enc, role, name, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (email) DO UPDATE
        SET password_hash = EXCLUDED.password_hash,
            password_enc  = COALESCE(EXCLUDED.password_enc, analytics.users.password_enc),
            role          = EXCLUDED.role,
            name          = EXCLUDED.name,
            updated_at    = NOW()
    `, [normalized, hash, enc ?? null, role, cleanName]);

    await db.end();
    return NextResponse.json({ ok: true, email: normalized, role, name: cleanName });
  } catch (err) {
    console.error('admin/users POST error:', err);
    await db.end().catch(() => {});
    return NextResponse.json({ error: 'Failed to save user' }, { status: 500 });
  }
}

// DELETE /api/admin/users — remove a user. Body: { email }
export async function DELETE(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

  const { email } = await req.json().catch(() => ({}));
  if (!email || typeof email !== 'string') {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 });
  }
  const normalized = email.toLowerCase().trim();

  if (normalized === admin.email) {
    return NextResponse.json({ error: 'You cannot delete your own account' }, { status: 400 });
  }

  const db = pool();
  try {
    const result = await db.query(`DELETE FROM analytics.users WHERE email = $1`, [normalized]);
    await db.end();
    if (result.rowCount === 0) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('admin/users DELETE error:', err);
    await db.end().catch(() => {});
    return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 });
  }
}
