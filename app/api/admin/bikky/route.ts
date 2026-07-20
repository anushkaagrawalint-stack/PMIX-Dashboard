import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { verifyToken, hasAdminAccess, COOKIE } from '@/lib/auth';
import { listDir, createFile, deleteFile } from '@/lib/github';
import {
  parseBikkyCsv, bikkyFileNameFor, bikkyFolderFor, parseBikkyFileName,
  type BikkySource,
} from '@/lib/bikkyCsv';

const BIKKY_ROOT = 'Data/Bikkydata';
const VALID_SOURCES: BikkySource[] = ['instore', '3pd_loyalty'];

function isValidSource(v: unknown): v is BikkySource {
  return typeof v === 'string' && (VALID_SOURCES as string[]).includes(v);
}

async function requireAdmin(req: NextRequest) {
  const token   = req.cookies.get(COOKIE)?.value;
  const payload = token ? await verifyToken(token) : null;
  return hasAdminAccess(payload?.role) ? payload : null;
}

// ─── GET — list currently-uploaded periods per source ────────────────────────
export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  try {
    const files = await Promise.all(
      VALID_SOURCES.map(async source => {
        const entries = await listDir(`${BIKKY_ROOT}/${bikkyFolderFor(source)}`);
        return entries
          .filter(e => e.type === 'file' && e.name.endsWith('.csv'))
          .map(e => {
            const stem = e.name.replace(/\.csv$/i, '');
            const parsed = parseBikkyFileName(stem, source);
            return parsed ? { source, name: e.name, path: e.path, ...parsed } : null;
          })
          .filter((x): x is NonNullable<typeof x> => x !== null);
      }),
    );
    return NextResponse.json({ files: files.flat() });
  } catch (err) {
    console.error('bikky GET error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ─── POST — upload (create, or replace = delete existing + create) ───────────
export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  const form   = await req.formData().catch(() => null);
  const source = form?.get('type');
  const period = Number(form?.get('period'));
  const fiscalYear = Number(form?.get('fiscal_year'));
  const file   = form?.get('file');

  if (!isValidSource(source)) {
    return NextResponse.json({ error: 'type must be "instore" or "3pd_loyalty"' }, { status: 400 });
  }
  if (!Number.isInteger(period) || period < 1 || period > 13) {
    return NextResponse.json({ error: 'period must be an integer 1-13' }, { status: 400 });
  }
  if (!Number.isInteger(fiscalYear) || fiscalYear < 2000) {
    return NextResponse.json({ error: 'fiscal_year must be a valid year' }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing file' }, { status: 400 });
  }

  const raw = await file.text();
  try {
    parseBikkyCsv(raw); // validate shape before touching git — see plan §4 step 2
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }

  const fileName = bikkyFileNameFor(source, period, fiscalYear);
  const path = `${BIKKY_ROOT}/${bikkyFolderFor(source)}/${fileName}`;

  try {
    // Replace semantics per BIKKY_ADMIN_UPLOAD_PLAN.md §4: delete-then-create,
    // two commits, not a single-sha overwrite.
    const replaced = await deleteFile(path, `bikky: remove ${path} (replaced)`);
    await createFile(path, raw, `bikky: upload ${path}`);
    // Route Handlers can't use updateTag (Server-Action-only) — {expire: 0} is
    // the documented way to get immediate (not stale-while-revalidate) effect here.
    revalidateTag('dashboard-data', { expire: 0 });
    return NextResponse.json({ ok: true, path, replaced });
  } catch (err) {
    console.error('bikky POST error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ─── DELETE — remove a period's file entirely ────────────────────────────────
export async function DELETE(req: NextRequest) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const source = searchParams.get('type');
  const period = Number(searchParams.get('period'));
  const fiscalYear = Number(searchParams.get('fiscal_year'));

  if (!isValidSource(source)) {
    return NextResponse.json({ error: 'type must be "instore" or "3pd_loyalty"' }, { status: 400 });
  }
  if (!Number.isInteger(period) || !Number.isInteger(fiscalYear)) {
    return NextResponse.json({ error: 'period and fiscal_year are required' }, { status: 400 });
  }

  const path = `${BIKKY_ROOT}/${bikkyFolderFor(source)}/${bikkyFileNameFor(source, period, fiscalYear)}`;

  try {
    const deleted = await deleteFile(path, `bikky: delete ${path}`);
    if (!deleted) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }
    // Route Handlers can't use updateTag (Server-Action-only) — {expire: 0} is
    // the documented way to get immediate (not stale-while-revalidate) effect here.
    revalidateTag('dashboard-data', { expire: 0 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('bikky DELETE error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
