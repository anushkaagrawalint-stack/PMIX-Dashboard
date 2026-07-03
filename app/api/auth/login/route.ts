import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { signToken, getUsers, getUserRole, COOKIE } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const { email, password } = await req.json().catch(() => ({}));
  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password required' }, { status: 400 });
  }

  const users = getUsers();
  const normalized = String(email).toLowerCase().trim();
  const hash = users[normalized];
  if (!hash) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const valid = await bcrypt.compare(password, hash);
  if (!valid) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const role = getUserRole(normalized);
  const token = await signToken(normalized, role);
  const res = NextResponse.json({ ok: true, user: { email: normalized, role } });
  res.cookies.set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 8, // 8 hours
    secure: process.env.NODE_ENV === 'production',
  });
  return res;
}
