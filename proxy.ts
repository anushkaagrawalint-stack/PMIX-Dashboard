import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, COOKIE } from '@/lib/auth';

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Always allow the login page and its API
  if (pathname.startsWith('/login') || pathname.startsWith('/api/auth')) {
    return NextResponse.next();
  }

  const token = req.cookies.get(COOKIE)?.value;
  const payload = token ? await verifyToken(token) : null;

  if (!payload) {
    const loginUrl = new URL('/login', req.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  // Static public assets (logos, icons, etc.) must stay reachable pre-login too —
  // the login page itself renders /rasa-logo.png and /BlackTextLogo.webp.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.png|.*\\.(?:png|svg|jpg|jpeg|gif|webp|ico)$).*)'],
};
