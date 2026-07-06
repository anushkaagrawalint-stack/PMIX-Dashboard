import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { Pool } from '@neondatabase/serverless';

function pool() { return new Pool({ connectionString: process.env.DATABASE_URL! }); }

// Overrides are keyed on selection_guid (a specific line), NOT order_guid — so
// fixing one mistracked line in an otherwise-correct order never touches that
// order's other, already-correct lines. order_stats is populated for reference,
// but every query in lib/queries.ts joins on selection_guid.
export async function POST(req: NextRequest) {
  const { order_guid, selection_guids, channel } = await req.json();
  if (!order_guid || !Array.isArray(selection_guids) || selection_guids.length === 0 || !channel) {
    return NextResponse.json({ error: 'Missing order_guid, selection_guids, or channel' }, { status: 400 });
  }

  const db = pool();
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS analytics.channel_overrides (
        selection_guid  TEXT PRIMARY KEY,
        order_guid      TEXT NOT NULL,
        correct_channel TEXT NOT NULL,
        updated_at      TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await db.query(`
      INSERT INTO analytics.channel_overrides (selection_guid, order_guid, correct_channel, updated_at)
      SELECT unnest($1::TEXT[]), $2, $3, NOW()
      ON CONFLICT (selection_guid) DO UPDATE
        SET correct_channel = EXCLUDED.correct_channel,
            updated_at      = NOW()
    `, [selection_guids, order_guid, channel]);
    await db.end();
    revalidatePath('/');
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('update-channel error:', err);
    await db.end();
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// Undo — removes the override(s) for the given line(s) entirely, so those
// specific lines revert to whatever channel they naturally derive to from
// menu_name (their pre-fix state). Other lines in the same order are untouched.
export async function DELETE(req: NextRequest) {
  const { selection_guids } = await req.json();
  if (!Array.isArray(selection_guids) || selection_guids.length === 0) {
    return NextResponse.json({ error: 'Missing selection_guids' }, { status: 400 });
  }

  const db = pool();
  try {
    await db.query(`DELETE FROM analytics.channel_overrides WHERE selection_guid = ANY($1::TEXT[])`, [selection_guids]);
    await db.end();
    revalidatePath('/');
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('update-channel undo error:', err);
    await db.end();
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
