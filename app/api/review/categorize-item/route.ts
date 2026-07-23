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

  const { canonical_name, category, sub_category, menu_group } = await req.json();
  if (!canonical_name || !category) {
    return NextResponse.json({ error: 'Missing canonical_name or category' }, { status: 400 });
  }

  const db = pool();
  try {
    // Create override table if it doesn't exist (stores category assignments made in the dashboard)
    await db.query(`
      CREATE TABLE IF NOT EXISTS analytics.item_category_override (
        canonical_name TEXT PRIMARY KEY,
        category       TEXT NOT NULL,
        sub_category   TEXT,
        menu_group     TEXT,
        updated_at     TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Upsert category override — read live by CAT1/CAT2 in lib/queries.ts (LEFT JOIN
    // on canonical_name), so this takes effect on the very next dashboard load.
    await db.query(`
      INSERT INTO analytics.item_category_override (canonical_name, category, sub_category, menu_group, updated_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (canonical_name) DO UPDATE
        SET category     = EXCLUDED.category,
            sub_category  = EXCLUDED.sub_category,
            menu_group    = EXCLUDED.menu_group,
            updated_at    = NOW()
    `, [canonical_name, category, sub_category || null, menu_group || null]);

    // Also insert into item_lookup so it no longer shows as uncategorized
    await db.query(`
      INSERT INTO analytics.item_lookup (raw_item_name)
      VALUES ($1)
      ON CONFLICT DO NOTHING
    `, [canonical_name]);

    await db.end();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('categorize-item error:', err);
    await db.end();
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
