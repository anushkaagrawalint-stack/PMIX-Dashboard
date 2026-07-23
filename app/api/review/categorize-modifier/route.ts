import { NextRequest, NextResponse } from 'next/server';
import { Pool } from '@neondatabase/serverless';
import { verifyToken, hasAdminAccess, COOKIE } from '@/lib/auth';

function pool() { return new Pool({ connectionString: process.env.DATABASE_URL! }); }

export async function POST(req: NextRequest) {
  const token   = req.cookies.get(COOKIE)?.value;
  const payload = token ? await verifyToken(token) : null;
  if (!hasAdminAccess(payload?.role)) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  const { modifier_name, item_type, modifier_type } = await req.json();
  if (!modifier_name || !item_type) {
    return NextResponse.json({ error: 'Missing modifier_name or item_type' }, { status: 400 });
  }

  const db = pool();
  try {
    await db.query(`
      INSERT INTO analytics.modifier_type (modifier_name, item_type, modifier_type, loaded_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (modifier_name, item_type) DO UPDATE
        SET modifier_type = EXCLUDED.modifier_type,
            loaded_at     = NOW()
    `, [modifier_name, item_type, modifier_type || null]);

    await db.end();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('categorize-modifier error:', err);
    await db.end();
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
