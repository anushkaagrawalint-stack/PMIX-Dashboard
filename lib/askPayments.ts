import { Pool } from '@neondatabase/serverless';

// Natural-language -> SQL layer for the Payments tab's "Ask" box (admin/
// tester only). Scoped to two read-only views (see pipeline sql/018_llm_
// readonly_payments.sql) rather than the raw tables so the model never has
// to reason about business logic it can get wrong (refund bucketing, tip
// inclusion, etc.) -- that logic is already baked into the views.

const SCHEMA_DESCRIPTION = `You can query exactly two read-only Postgres views:

analytics.v_payments_llm -- one row per payment
  payment_guid, order_guid, location_code, location_name,
  business_date        (date the order/payment happened),
  paid_business_date   (date Toast actually paid it out -- may lag business_date),
  payment_type          ('CREDIT', 'OTHER', 'GIFTCARD'),
  category              ('Card' or 'Alt Payment'),
  payment_source        (human-readable tender name, e.g. 'Ez Cater', 'STREAM x UBER'),
  amount, tip_amount, fees, withholdings   (numeric, dollars),
  paid_status           ('CAPTURED', 'AUTHORIZED', 'DENIED', 'VOIDED', 'OPEN')

analytics.v_refunds_llm -- one row per refund (a SEPARATE event from payments)
  refund_transaction_guid, payment_guid, order_guid, location_code, location_name,
  refund_date           (the date the REFUND happened -- NOT the original payment's date),
  refund_amount, tip_refund_amount, payment_type, payment_source

Rules:
- Write exactly ONE SELECT statement. No other statement type, ever.
- Never reference any table or view other than these two.
- A revenue/"card payments" question should filter v_payments_llm.paid_status IN ('CAPTURED','AUTHORIZED').
- A refunds question must use v_refunds_llm.refund_date, never a payment's business_date.
- Add "LIMIT 200" unless the question asks for an aggregate (SUM/COUNT/AVG/etc.), which needs no LIMIT.
- Reply with ONLY the raw SQL -- no markdown fences, no explanation, no trailing commentary.`;

const ALLOWED_VIEWS = /\b(analytics\.)?v_(payments|refunds)_llm\b/i;
const FORBIDDEN = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|GRANT|REVOKE|CREATE|COPY|CALL|EXECUTE|MERGE|VACUUM|LISTEN|NOTIFY|SET|RESET)\b|--|\/\*/i;

export async function generateSql(question: string): Promise<string> {
  if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY is not set');
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      temperature: 0,
      messages: [
        { role: 'system', content: SCHEMA_DESCRIPTION },
        { role: 'user', content: question },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Groq API error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const raw = (data.choices?.[0]?.message?.content ?? '').trim();
  return raw.replace(/^```(?:sql)?\s*/i, '').replace(/```\s*$/i, '').trim();
}

export function validateSql(sql: string): string {
  const trimmed = sql.trim().replace(/;+\s*$/, '');
  if (!/^select\b/i.test(trimmed)) throw new Error('Only SELECT statements are allowed.');
  if (trimmed.includes(';')) throw new Error('Only a single statement is allowed.');
  if (FORBIDDEN.test(trimmed)) throw new Error('Query contains a disallowed keyword.');
  if (!ALLOWED_VIEWS.test(trimmed)) throw new Error('Query must reference v_payments_llm or v_refunds_llm.');
  return trimmed;
}

// Turns the raw query result into a short, conversational answer instead of
// a bare table -- the point of "Ask" is that it doesn't feel like reading a
// SQL result. Dollar amounts are always called out formatted ($1,234.56),
// never as a bare number.
export async function summarizeAnswer(question: string, rows: Record<string, unknown>[]): Promise<string> {
  if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY is not set');
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: `You answer questions about payments/refunds data conversationally, in 1-4 sentences.
You'll be given the user's question and the exact query result as JSON -- use only that data, never
invent numbers. Format every dollar amount as $X,XXX.XX (comma thousands, 2 decimals). Never mention
SQL, queries, or databases -- just answer like a knowledgeable colleague would. If the result is an
empty list, say so plainly (e.g. "No refunds found for that period.").`,
        },
        { role: 'user', content: `Question: ${question}\n\nResult (JSON): ${JSON.stringify(rows).slice(0, 8000)}` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Groq API error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return (data.choices?.[0]?.message?.content ?? '').trim();
}

export async function runReadOnlySql(sql: string): Promise<Record<string, unknown>[]> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  const client = await pool.connect();
  try {
    await client.query('BEGIN TRANSACTION READ ONLY');
    await client.query("SET LOCAL statement_timeout = '5s'");
    const result = await client.query(sql);
    await client.query('ROLLBACK');
    return result.rows;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}
