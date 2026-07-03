import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { Pool } from '@neondatabase/serverless';

function pool() { return new Pool({ connectionString: process.env.DATABASE_URL! }); }

export async function POST(req: NextRequest) {
  const { order_guid, channel } = await req.json();
  if (!order_guid || !channel) {
    return NextResponse.json({ error: 'Missing order_guid or channel' }, { status: 400 });
  }

  const db = pool();
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS analytics.channel_overrides (
        order_guid      TEXT PRIMARY KEY,
        correct_channel TEXT NOT NULL,
        updated_at      TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await db.query(`
      INSERT INTO analytics.channel_overrides (order_guid, correct_channel, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (order_guid) DO UPDATE
        SET correct_channel = EXCLUDED.correct_channel,
            updated_at      = NOW()
    `, [order_guid, channel]);
    await db.end();
    revalidatePath('/');
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('update-channel error:', err);
    await db.end();
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
