import { Pool } from '@neondatabase/serverless';

function pool() { return new Pool({ connectionString: process.env.DATABASE_URL! }); }

async function ensureTable(db: Pool) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS analytics.location_status (
      location_code TEXT PRIMARY KEY,
      is_open       BOOLEAN NOT NULL DEFAULT TRUE
    )
  `);
}

// Missing row = open (fail-open) — a location with no row yet (brand new
// location, or table just created) defaults to open, so nothing silently
// drops out of "Open Locations" until a tester actively marks it closed.
export async function getLocationStatusMap(): Promise<Record<string, boolean>> {
  const db = pool();
  try {
    await ensureTable(db);
    const { rows } = await db.query(`SELECT location_code, is_open FROM analytics.location_status`);
    const map: Record<string, boolean> = {};
    for (const r of rows) map[r.location_code as string] = r.is_open as boolean;
    return map;
  } finally {
    await db.end();
  }
}

export interface LocationWithStatus { location_code: string; display_name: string; is_open: boolean }

// The single always-fresh source of truth for location open/closed status —
// called from app/page.tsx (uncached — plain Server Component, re-runs every
// request) and from the tester-only API route. Never call this from inside
// loadDashboardData, which is cached for hours; a tester's change would sit
// stale for up to an hour if it were baked into that cache.
export async function getLocationsWithStatus(): Promise<LocationWithStatus[]> {
  const db = pool();
  try {
    await ensureTable(db);
    const { rows } = await db.query(`
      SELECT dl.location_code, dl.display_name, COALESCE(ls.is_open, TRUE) AS is_open
      FROM public.dim_location dl
      LEFT JOIN analytics.location_status ls ON ls.location_code = dl.location_code
      ORDER BY dl.display_name
    `);
    return rows.map(r => ({
      location_code: r.location_code as string,
      display_name:  r.display_name  as string,
      is_open:       r.is_open       as boolean,
    }));
  } finally {
    await db.end();
  }
}

export async function setLocationStatus(locationCode: string, isOpen: boolean): Promise<void> {
  const db = pool();
  try {
    await ensureTable(db);
    await db.query(`
      INSERT INTO analytics.location_status (location_code, is_open)
      VALUES ($1, $2)
      ON CONFLICT (location_code) DO UPDATE SET is_open = EXCLUDED.is_open
    `, [locationCode, isOpen]);
  } finally {
    await db.end();
  }
}
