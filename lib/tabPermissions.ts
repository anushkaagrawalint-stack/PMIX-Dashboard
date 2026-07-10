import { Pool } from '@neondatabase/serverless';
import { DEFAULT_USER_HIDDEN } from './tabsMeta';

function pool() { return new Pool({ connectionString: process.env.DATABASE_URL! }); }

// Only 'admin' and 'user' are governed — 'tester' always sees every tab
// (hardcoded in app/page.tsx), never stored here, never editable.
export type GovernedRole = 'admin' | 'user';
export type TabPermissionMap = Record<GovernedRole, Record<string, boolean>>;

async function ensureTable(db: Pool) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS analytics.tab_permissions (
      role    TEXT NOT NULL,
      tab_id  TEXT NOT NULL,
      visible BOOLEAN NOT NULL DEFAULT TRUE,
      PRIMARY KEY (role, tab_id)
    )
  `);
  // One-time seed matching pre-permission-system behavior exactly (owner:
  // "whatever hidden right now for user will be the same for now") — ON
  // CONFLICT DO NOTHING so this never overwrites a later tester/admin edit.
  if (DEFAULT_USER_HIDDEN.length > 0) {
    await db.query(`
      INSERT INTO analytics.tab_permissions (role, tab_id, visible)
      SELECT 'user', unnest($1::TEXT[]), FALSE
      ON CONFLICT (role, tab_id) DO NOTHING
    `, [DEFAULT_USER_HIDDEN]);
  }
}

// Missing row = visible (fail-open) — a tab added to TAB_META later isn't
// silently hidden from anyone until a tester/admin actively configures it.
export async function getTabPermissions(): Promise<TabPermissionMap> {
  const db = pool();
  try {
    await ensureTable(db);
    const { rows } = await db.query(`SELECT role, tab_id, visible FROM analytics.tab_permissions`);
    const result: TabPermissionMap = { admin: {}, user: {} };
    for (const r of rows) {
      const role = r.role as string;
      if (role === 'admin' || role === 'user') result[role][r.tab_id as string] = r.visible as boolean;
    }
    return result;
  } finally {
    await db.end();
  }
}

export async function setTabPermission(role: GovernedRole, tabId: string, visible: boolean): Promise<void> {
  const db = pool();
  try {
    await ensureTable(db);
    await db.query(`
      INSERT INTO analytics.tab_permissions (role, tab_id, visible)
      VALUES ($1, $2, $3)
      ON CONFLICT (role, tab_id) DO UPDATE SET visible = EXCLUDED.visible
    `, [role, tabId, visible]);
  } finally {
    await db.end();
  }
}
