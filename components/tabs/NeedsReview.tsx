'use client';
import type { NeedsReviewRow } from '@/lib/types';

interface Props { needsReview: NeedsReviewRow[] }

const fmt$ = (v: number) =>
  v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M`
  : v >= 1_000   ? `$${(v / 1_000).toFixed(0)}K`
  : `$${v.toFixed(2)}`;

export default function NeedsReview({ needsReview }: Props) {
  const cateringCount = needsReview.filter(r => r.channel_code === 'CATERING').length;
  const offsiteCount  = needsReview.filter(r => r.channel_code === 'OFFSITE').length;

  return (
    <div>
      <div className="info-banner yellow">
        <i className="ti ti-alert-triangle" />
        <div>
          <strong>{needsReview.length}</strong> orders are excluded from the main dashboard.
          {cateringCount > 0 && <> {cateringCount} catering,</>}
          {offsiteCount  > 0 && <> {offsiteCount} offsite.</>}
          {' '}Review below to confirm correct channel assignment.
        </div>
      </div>

      {needsReview.length === 0 ? (
        <div className="cc" style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
          <i className="ti ti-check" style={{ fontSize: 32, opacity: 0.3 }} />
          <div style={{ marginTop: 10 }}>No excluded orders in this date range.</div>
        </div>
      ) : (
        <>
          {/* Summary by channel */}
          <div className="krow k3" style={{ marginBottom: 12 }}>
            {(['CATERING', 'OFFSITE'] as const).map(ch => {
              const rows   = needsReview.filter(r => r.channel_code === ch);
              const total  = rows.reduce((s, r) => s + r.amount, 0);
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

          {/* Card list */}
          {needsReview.map((r, i) => (
            <div key={i} className="nr-card">
              <div style={{ flex: 1 }}>
                <div
                  className={`nr-tag${r.channel_code === 'OFFSITE' ? ' offsite' : ''}`}
                >
                  {r.channel_code}
                </div>
                <div className="nr-main">
                  {r.location} · {r.business_date}
                </div>
                <div className="nr-sub">
                  {r.item_count} item{r.item_count !== 1 ? 's' : ''} · {fmt$(r.amount)}
                </div>
                <div className="nr-hint">
                  <i className="ti ti-info-circle" style={{ fontSize: 9, marginRight: 3 }} />
                  {r.suggestion}
                </div>
              </div>
              <div style={{ textAlign: 'right', fontSize: 18, fontWeight: 700, color: 'var(--accent)', minWidth: 70 }}>
                {fmt$(r.amount)}
              </div>
            </div>
          ))}

          <div style={{ fontSize: 10, color: 'var(--muted)', textAlign: 'center', padding: '8px 0' }}>
            Showing {needsReview.length} excluded order groups
          </div>
        </>
      )}
    </div>
  );
}
