import { NextRequest, NextResponse } from 'next/server';
import { Pool } from '@neondatabase/serverless';
import { verifyToken, hasAdminAccess, COOKIE } from '@/lib/auth';

function pool() { return new Pool({ connectionString: process.env.DATABASE_URL! }); }

// r365 period strings look like 'P05-2026' (zero-padded 2-digit period, dash, year)
const PERIOD_RE = /^P\d{2}-\d{4}$/;

export async function POST(req: NextRequest) {
  const token   = req.cookies.get(COOKIE)?.value;
  const payload = token ? await verifyToken(token) : null;
  if (!hasAdminAccess(payload?.role)) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  const { canonical_name, period, cost_per_portion } = await req.json().catch(() => ({}));

  if (!canonical_name || typeof canonical_name !== 'string') {
    return NextResponse.json({ error: 'Missing canonical_name' }, { status: 400 });
  }
  if (!period || typeof period !== 'string' || !PERIOD_RE.test(period)) {
    return NextResponse.json({ error: 'Invalid period (expected e.g. P05-2026)' }, { status: 400 });
  }
  const cost = Number(cost_per_portion);
  if (!Number.isFinite(cost) || cost <= 0) {
    return NextResponse.json({ error: 'cost_per_portion must be a positive number' }, { status: 400 });
  }

  const db = pool();
  try {
    // recipe_name MUST be 'MI ' + canonical_name — modifierUnitCostSQL/modifierCostBatchSQL
    // (lib/modifierCost.ts) hard-filter on recipe_name LIKE 'MI %', so a row saved without
    // this prefix is invisible to every reader.
    await db.query(`
      INSERT INTO analytics.r365_modifier_cost
        (period, recipe_name, clean_name, cost_per_portion, loaded_at)
      VALUES ($1, 'MI ' || $2, $2, $3, NOW())
      ON CONFLICT (period, recipe_name) DO UPDATE
        SET clean_name       = EXCLUDED.clean_name,
            cost_per_portion = EXCLUDED.cost_per_portion,
            loaded_at        = NOW()
    `, [period, canonical_name, cost]);

    await db.end();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('costs/modifier POST error:', err);
    await db.end().catch(() => {});
    return NextResponse.json({ error: 'Failed to save modifier cost' }, { status: 500 });
  }
}
