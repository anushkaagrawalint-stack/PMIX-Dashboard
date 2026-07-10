import { NextRequest, NextResponse } from 'next/server';
import { Pool } from '@neondatabase/serverless';
import { verifyToken, hasAdminAccess, COOKIE } from '@/lib/auth';

function pool() { return new Pool({ connectionString: process.env.DATABASE_URL! }); }

// Which real r365 "menu" values each sales bucket is allowed to write to — must match
// the exact menu sets getItemCosts()/getMissingItemCosts() read from, so a cost entered
// here is actually picked up by the rest of the dashboard.
const BUCKET_MENUS: Record<string, string[]> = {
  ih:           ['FOOD - IN HOUSE', 'DRINKS - IN HOUSE'],
  online:       ['DELIVERY', '3PD OPEN MARKUP'],
  catering:     ['CATERING'],
  catering_3pd: ['CATERING - 3PD'],
  offsite:      ['OFFSITE POP-UPS'],
};

// r365 period strings look like 'P05-2026' (zero-padded 2-digit period, dash, year)
const PERIOD_RE = /^P\d{2}-\d{4}$/;

export async function POST(req: NextRequest) {
  const token   = req.cookies.get(COOKIE)?.value;
  const payload = token ? await verifyToken(token) : null;
  if (!hasAdminAccess(payload?.role)) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  const { canonical_name, bucket, menu, period, avg_cost, category, menu_group } = await req.json().catch(() => ({}));

  if (!canonical_name || typeof canonical_name !== 'string') {
    return NextResponse.json({ error: 'Missing canonical_name' }, { status: 400 });
  }
  if (!bucket || !BUCKET_MENUS[bucket]) {
    return NextResponse.json({ error: 'Invalid bucket' }, { status: 400 });
  }
  if (!menu || !BUCKET_MENUS[bucket].includes(menu)) {
    return NextResponse.json({ error: `Invalid menu for bucket "${bucket}"` }, { status: 400 });
  }
  if (!period || typeof period !== 'string' || !PERIOD_RE.test(period)) {
    return NextResponse.json({ error: 'Invalid period (expected e.g. P05-2026)' }, { status: 400 });
  }
  const cost = Number(avg_cost);
  if (!Number.isFinite(cost) || cost <= 0) {
    return NextResponse.json({ error: 'avg_cost must be a positive number' }, { status: 400 });
  }

  const db = pool();
  try {
    await db.query(`
      INSERT INTO analytics.r365_item_cost
        (period, menu, item_name, item_name_updated, menu_group, category_1, category_2, avg_cost, loaded_at)
      VALUES ($1, $2, $3, $3, $4, $5, $5, $6, NOW())
      ON CONFLICT (item_name, menu, period) DO UPDATE
        SET item_name_updated = EXCLUDED.item_name_updated,
            menu_group        = EXCLUDED.menu_group,
            category_1        = EXCLUDED.category_1,
            category_2        = EXCLUDED.category_2,
            avg_cost          = EXCLUDED.avg_cost,
            loaded_at         = NOW()
    `, [period, menu, canonical_name, menu_group || null, category || null, cost]);

    await db.end();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('costs POST error:', err);
    await db.end().catch(() => {});
    return NextResponse.json({ error: 'Failed to save cost' }, { status: 500 });
  }
}
