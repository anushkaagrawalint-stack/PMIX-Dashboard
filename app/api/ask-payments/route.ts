import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, hasAdminAccess, COOKIE } from '@/lib/auth';
import { generateSql, validateSql, runReadOnlySql, summarizeAnswer } from '@/lib/askPayments';

async function requireAdminAccess(req: NextRequest) {
  const token = req.cookies.get(COOKIE)?.value;
  const payload = token ? await verifyToken(token) : null;
  return payload && hasAdminAccess(payload.role) ? payload : null;
}

// POST /api/ask-payments — { question: string } -> { sql, rows }
// Natural-language question over the payments/refunds read-only views (see
// lib/askPayments.ts). Admin/tester only, same as the rest of the Payments tab.
export async function POST(req: NextRequest) {
  const caller = await requireAdminAccess(req);
  if (!caller) return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

  const { question } = await req.json();
  if (!question || typeof question !== 'string') {
    return NextResponse.json({ error: 'Missing question' }, { status: 400 });
  }

  try {
    const generated = await generateSql(question);
    const sql = validateSql(generated);
    const rows = await runReadOnlySql(sql);
    const answer = await summarizeAnswer(question, rows);
    return NextResponse.json({ sql, rows, answer });
  } catch (err) {
    console.error('ask-payments error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
