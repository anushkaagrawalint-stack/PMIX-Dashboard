import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { Pool } from '@neondatabase/serverless';
import { verifyToken, COOKIE } from '@/lib/auth';

function pool() { return new Pool({ connectionString: process.env.DATABASE_URL! }); }

const DDL = `
  CREATE TABLE IF NOT EXISTS analytics.name_merge_decisions (
    raw_name   TEXT PRIMARY KEY,
    clean_name TEXT        NOT NULL,
    decision   TEXT        NOT NULL CHECK (decision IN ('confirmed','rejected')),
    source     TEXT        NOT NULL DEFAULT 'user',
    decided_by TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

// Merge decisions are open to every SIGNED-IN user (owner request 2026-10-01),
// not just admin/tester — the UI's Yes/No/Undo buttons are ungated to match.
// Still requires a valid session: these writes are global, so a confirm here
// renames that item for every user across every tab that reads byo_fix.
async function requireUser(req: NextRequest) {
  const token = req.cookies.get(COOKIE)?.value;
  return token ? await verifyToken(token) : null;
}

interface DecisionInput { raw_name: string; clean_name?: string; decision: 'confirmed' | 'rejected' }

// Record merge decisions. Accepts either one decision or a batch — the review UI
// collects yes/no across many rows and applies them in a single call, so the
// dashboard rebuilds once at the end instead of after every individual click.
// 'confirmed' makes every row named raw_name report as clean_name across all 10
// queries that read byo_fix; 'rejected' only records that the pair was reviewed
// and deliberately NOT merged, so it stops being suggested.
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const incoming: DecisionInput[] = Array.isArray(body?.decisions)
    ? body.decisions
    : [{ raw_name: body?.raw_name, clean_name: body?.clean_name, decision: body?.decision }];

  if (!incoming.length) {
    return NextResponse.json({ error: 'No decisions supplied' }, { status: 400 });
  }
  for (const d of incoming) {
    if (!d?.raw_name || (d.decision !== 'confirmed' && d.decision !== 'rejected')) {
      return NextResponse.json({ error: 'Each decision needs raw_name and a valid decision' }, { status: 400 });
    }
    if (d.decision === 'confirmed' && !d.clean_name) {
      return NextResponse.json({ error: `"${d.raw_name}" is a merge but has no target name` }, { status: 400 });
    }
  }

  const db = pool();
  const applied: { raw_name: string; clean_name: string; decision: string }[] = [];
  const failed:  { raw_name: string; error: string }[] = [];
  try {
    await db.query(DDL);

    for (const d of incoming) {
      // Case-insensitive target resolution: typing "garlic naan" must land on the
      // existing "Garlic Naan" rather than creating a second differently-cased group
      // that every downstream GROUP BY would then treat as a separate item.
      let resolved = String(d.clean_name ?? '').trim();
      if (resolved) {
        const { rows } = await db.query(
          `SELECT canonical_name FROM (
             SELECT DISTINCT canonical_name FROM public.fact_order_lines
             UNION
             SELECT DISTINCT clean_name FROM analytics.name_merge_decisions WHERE decision = 'confirmed'
           ) n
           WHERE LOWER(canonical_name) = LOWER($1)
           ORDER BY canonical_name = $1 DESC
           LIMIT 1`,
          [resolved],
        );
        if (rows[0]?.canonical_name) resolved = rows[0].canonical_name as string;
      }

      // Guard against a cycle: A→B while B→A already exists would make neither name
      // resolvable. Also blocks the degenerate self-merge. A bad row is skipped and
      // reported rather than aborting the whole batch.
      if (d.decision === 'confirmed') {
        if (resolved === d.raw_name) {
          failed.push({ raw_name: d.raw_name, error: 'cannot merge into itself' });
          continue;
        }
        const { rows } = await db.query(
          `SELECT 1 FROM analytics.name_merge_decisions
           WHERE raw_name = $1 AND clean_name = $2 AND decision = 'confirmed'`,
          [resolved, d.raw_name],
        );
        if (rows.length) {
          failed.push({ raw_name: d.raw_name, error: `"${resolved}" already merges into it — would loop` });
          continue;
        }
      }

      await db.query(
        `INSERT INTO analytics.name_merge_decisions (raw_name, clean_name, decision, source, decided_by, updated_at)
         VALUES ($1, $2, $3, 'user', $4, NOW())
         ON CONFLICT (raw_name) DO UPDATE
           SET clean_name = EXCLUDED.clean_name,
               decision   = EXCLUDED.decision,
               source     = 'user',
               decided_by = EXCLUDED.decided_by,
               updated_at = NOW()`,
        [d.raw_name, resolved || d.raw_name, d.decision, auth.email ?? null],
      );
      applied.push({ raw_name: d.raw_name, clean_name: resolved, decision: d.decision });
    }

    await db.end();
    // loadDashboardData is a cached function tagged 'dashboard-data' with
    // cacheLife('hours') — only revalidateTag clears it. revalidatePath alone
    // would leave a merge invisible until the cache aged out. Fired once for the
    // whole batch, not per row.
    if (applied.length) revalidateTag('dashboard-data', { expire: 0 });
    return NextResponse.json({ ok: failed.length === 0, applied, failed });
  } catch (err) {
    console.error('merge-decision error:', err);
    await db.end();
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// Undo — drops the decision entirely, so the name reverts to standing on its own
// and the pair becomes eligible to be suggested again.
export async function DELETE(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { raw_name } = await req.json();
  if (!raw_name) return NextResponse.json({ error: 'Missing raw_name' }, { status: 400 });

  const db = pool();
  try {
    await db.query(`DELETE FROM analytics.name_merge_decisions WHERE raw_name = $1`, [raw_name]);
    await db.end();
    // loadDashboardData is a cached function tagged 'dashboard-data' with
    // cacheLife('hours') — only revalidateTag clears it. revalidatePath alone
    // would leave a merge invisible until the cache aged out.
    revalidateTag('dashboard-data', { expire: 0 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('merge-decision undo error:', err);
    await db.end();
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
