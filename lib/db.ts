import { neon } from '@neondatabase/serverless';

type Row = Record<string, unknown>;

let _raw: ReturnType<typeof neon> | null = null;

function getRaw() {
  if (!_raw) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set in .env.local');
    _raw = neon(process.env.DATABASE_URL);
  }
  return _raw;
}

// Tagged template that always returns Row[]
export function getDb() {
  const raw = getRaw();
  return async (strings: TemplateStringsArray, ...values: unknown[]): Promise<Row[]> => {
    const result = await raw(strings, ...values);
    return result as Row[];
  };
}
