import { SignJWT, jwtVerify } from 'jose';

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET ?? 'dev-secret-change-me');
const COOKIE = 'pmix_token';
const EXPIRY = '8h';

export { COOKIE };

export async function signToken(email: string): Promise<string> {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(EXPIRY)
    .sign(SECRET);
}

export async function verifyToken(token: string): Promise<{ email: string } | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET);
    return payload as { email: string };
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
