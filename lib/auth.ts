import { SignJWT, jwtVerify } from 'jose';
import { Pool } from '@neondatabase/serverless';

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET ?? 'dev-secret-change-me');
const COOKIE = 'pmix_token';
const EXPIRY = '8h';

export { COOKIE };

export type Role = 'admin' | 'tester' | 'user';

const VALID_ROLES = new Set<Role>(['admin', 'tester', 'user']);
function normalizeRole(role: unknown): Role {
  return VALID_ROLES.has(role as Role) ? (role as Role) : 'user';
}

// tester currently has full admin-level access (owner request 2026-07-08) — kept as
// a separate role (not just an alias) so it can be scoped down later without
// touching every call site again, just this one function.
export function hasAdminAccess(role: Role | undefined | null): boolean {
  return role === 'admin' || role === 'tester';
}

export async function signToken(email: string, role: Role, name: string | null): Promise<string> {
  return new SignJWT({ email, role, name })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(EXPIRY)
    .sign(SECRET);
}

export async function verifyToken(token: string): Promise<{ email: string; role: Role; name: string | null } | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET);
    const p = payload as { email: string; role?: Role; name?: string | null };
    return { email: p.email, role: normalizeRole(p.role), name: p.name ?? null };
  } catch {
    return null;
  }
}

// Users live in analytics.users (managed via the Admin Panel), not an env var —
// account changes (add/edit/delete) take effect immediately, no redeploy.
export async function getUserByEmail(email: string): Promise<{ email: string; hash: string; role: Role; name: string | null } | null> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  try {
    const { rows } = await pool.query(
      `SELECT email, password_hash, role, name FROM analytics.users WHERE email = $1`,
      [email],
    );
    if (rows.length === 0) return null;
    return {
      email: rows[0].email,
      hash:  rows[0].password_hash,
      role:  normalizeRole(rows[0].role),
      name:  rows[0].name ?? null,
    };
  } finally {
    await pool.end();
  }
}
