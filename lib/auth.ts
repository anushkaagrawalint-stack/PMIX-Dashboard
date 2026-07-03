import { SignJWT, jwtVerify } from 'jose';

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET ?? 'dev-secret-change-me');
const COOKIE = 'pmix_token';
const EXPIRY = '8h';

export { COOKIE };

export type Role = 'admin' | 'user';

export async function signToken(email: string, role: Role): Promise<string> {
  return new SignJWT({ email, role })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(EXPIRY)
    .sign(SECRET);
}

export async function verifyToken(token: string): Promise<{ email: string; role: Role } | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET);
    const p = payload as { email: string; role?: Role };
    return { email: p.email, role: p.role === 'admin' ? 'admin' : 'user' };
  } catch {
    return null;
  }
}

// Returns { email → bcrypt_hash }
// Handles both plain-string values and { hash, role } objects
export function getUsers(): Record<string, string> {
  try {
    const raw = JSON.parse(process.env.USERS_JSON ?? '{}');
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === 'string') out[k] = v;
      else if (v && typeof (v as Record<string,unknown>).hash === 'string')
        out[k] = (v as { hash: string }).hash;
    }
    return out;
  } catch {
    return {};
  }
}

// Returns { email → role }. Plain-string entries (no explicit role) default to 'user'.
export function getUserRole(email: string): Role {
  try {
    const raw = JSON.parse(process.env.USERS_JSON ?? '{}');
    const v = raw[email];
    if (v && typeof v === 'object' && (v as Record<string, unknown>).role === 'admin') return 'admin';
    return 'user';
  } catch {
    return 'user';
  }
}
