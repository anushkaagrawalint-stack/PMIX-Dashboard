'use client';
import { CHANNEL_LABEL } from '@/lib/constants';
import type { NeedsReviewRow, UncategorizedItemRow } from '@/lib/types';

interface Props {
  needsReview:        NeedsReviewRow[];
  uncategorizedItems: UncategorizedItemRow[];
}

const fmt$ = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;

export default function NeedsReview({ needsReview, uncategorizedItems }: Props) {
  const cateringCount = needsReview.filter(r => r.current_channel === 'CATERING').length;
  const offsiteCount  = needsReview.filter(r => r.current_channel === 'OFFSITE').length;

  return (
    <div>

      {/* ── Section 1: Wrong-channel orders ── */}
      <div className="info-banner yellow" style={{ marginBottom: 12 }}>
        <i className="ti ti-alert-triangle" />
        <div>
          <strong>{needsReview.length}</strong> orders are excluded from the main dashboard.
          {cateringCount > 0 && <> {cateringCount} catering,</>}
          {offsiteCount  > 0 && <> {offsiteCount} offsite.</>}
          {' '}Review below to confirm correct channel assignment.
        </div>
      </div>

      {needsReview.length === 0 ? (
        <div className="cc" style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>
          <i className="ti ti-check" style={{ fontSize: 28, opacity: 0.3 }} />
          <div style={{ marginTop: 8 }}>No excluded orders in this date range.</div>
        </div>
      ) : (
        <>
          <div className="krow k3" style={{ marginBottom: 12 }}>
            {(['CATERING', 'OFFSITE'] as const).map(ch => {
              const rows  = needsReview.filter(r => r.current_channel === ch);
              const total = rows.reduce((s, r) => s + r.amount, 0);
              return rows.length === 0 ? null : (
                <div key={ch} className={`kc ${ch === 'CATERING' ? 'o' : 't'}`}>
                  <div className="kl">{ch === 'CATERING' ? 'Catering' : 'Offsite'}</div>
                  <div className="kv">{fmt$(total)}</div>
                  <div className="ks">{rows.length} order groups excluded</div>
                </div>
              );
            })}
            <div className="kc p">
              <div className="kl">Total Excluded</div>
              <div className="kv">{fmt$(needsReview.reduce((s, r) => s + r.amount, 0))}</div>
              <div className="ks">not in main metrics</div>
            </div>
          </div>

          {needsReview.map((r, i) => (
            <div key={i} className="nr-card">
              <div style={{ flex: 1 }}>
                <div className={`nr-tag${r.current_channel === 'OFFSITE' ? ' offsite' : ''}`}>
                  {r.current_channel}
                </div>
                <div className="nr-main">{r.location} · {r.business_date}</div>
                <div className="nr-sub">
                  {r.item_count} item{r.item_count !== 1 ? 's' : ''} · {fmt$(r.amount)}
                </div>
                <div className="nr-hint">
                  <i className="ti ti-info-circle" style={{ fontSize: 9, marginRight: 3 }} />
                  {r.suggested_channel}
                </div>
              </div>
              <div style={{ textAlign: 'right', fontSize: 18, fontWeight: 700, color: 'var(--accent)', minWidth: 70 }}>
                {fmt$(r.amount)}
              </div>
            </div>
          ))}

          <div style={{ fontSize: 10, color: 'var(--muted)', textAlign: 'center', padding: '8px 0 16px' }}>
            Showing {needsReview.length} excluded order groups
          </div>
        </>
      )}

      {/* ── Section 2: Uncategorized items ── */}
      <div className="info-banner" style={{
        background: 'rgba(249,115,22,0.08)', borderColor: '#f97316',
        marginTop: 8, marginBottom: 12,
      }}>
        <i className="ti ti-tag-off" style={{ color: '#f97316' }} />
        <div>
          <strong style={{ color: '#f97316' }}>{uncategorizedItems.length}</strong> items are not found in{' '}
          <code>item_lookup</code> or <code>modifier_type</code> — they appear as <em>Other</em> in category
          breakdowns. Add them to the appropriate lookup table to categorize correctly.
        </div>
      </div>

      {uncategorizedItems.length === 0 ? (
        <div className="cc" style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>
          <i className="ti ti-check" style={{ fontSize: 28, opacity: 0.3 }} />
          <div style={{ marginTop: 8 }}>All items are categorized.</div>
        </div>
      ) : (
        <div className="tw">
          <div className="th2">
            <h3>Uncategorized items ({uncategorizedItems.length})</h3>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Item Name</th>
                  <th>Channel</th>
                  <th>Qty Sold</th>
                  <th>Revenue</th>
                  <th>Last Seen</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {uncategorizedItems.map((row, i) => (
                  <tr key={i}>
                    <td style={{ color: 'var(--muted)', fontSize: 11 }}>{i + 1}</td>
                    <td style={{ fontWeight: 600, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.canonical_name}
                    </td>
                    <td>
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                        background: 'var(--border)', color: 'var(--text)',
                      }}>
                        {CHANNEL_LABEL[row.channel] ?? row.channel}
                      </span>
                    </td>
                    <td style={{ fontWeight: 600 }}>{row.qty.toLocaleString()}</td>
                    <td style={{ fontWeight: 600, color: 'var(--accent)' }}>{fmt$(row.revenue)}</td>
                    <td style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{row.last_seen}</td>
                    <td style={{ fontSize: 11, color: '#f97316' }}>
                      Add to item_lookup or modifier_type
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
