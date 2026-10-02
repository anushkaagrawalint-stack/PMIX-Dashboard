'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { RenameRow, MergeDecisionRow, MergeSuggestionRow } from '@/lib/types';
import type { Role } from '@/lib/auth';

interface Props {
  renames: RenameRow[];
  mergeDecisions: MergeDecisionRow[];
  mergeSuggestions: MergeSuggestionRow[];
  role: Role;
}

const fmt$ = (v: number) =>
  `$${Math.round(v).toLocaleString('en-US')}`;

function csvDownload(filename: string, headers: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

type Section = 'suggested' | 'decided' | 'history';

const KIND_BADGE: Record<MergeSuggestionRow['kind'], { bg: string; color: string; label: string }> = {
  guid_rename:  { bg: '#dcfce7', color: '#14532d', label: 'Likely rename' },
  vendor_label: { bg: '#fef3c7', color: '#92400e', label: 'Needs a look' },
};

export default function RenamesAudit({
  renames, mergeDecisions, mergeSuggestions, role,
}: Props) {
  const router = useRouter();
  // Every signed-in user can confirm/reject/undo a merge (owner request
  // 2026-10-01); the API route is open to the same audience. Kept as a named
  // flag rather than deleted so re-gating is a one-line change. Note these
  // writes are global — a confirm renames that item for everyone, everywhere.
  const canEdit = true;

  const [search, setSearch]   = useState('');
  const [section, setSection] = useState<Section>('suggested');
  const [busy, setBusy]       = useState<string | null>(null);
  const [error, setError]     = useState<string | null>(null);
  // Per-suggestion editable target. Typing is case-insensitive on save — the API
  // resolves what you type back onto the existing name's real capitalisation.
  const [targets, setTargets] = useState<Record<string, string>>({});
  // Yes/No marks held locally until Confirm applies them as one batch.
  const [pending, setPending] = useState<Record<string, 'confirmed' | 'rejected'>>({});

  const suggestionByName = new Map(mergeSuggestions.map(s => [s.raw_name, s]));
  const pendingCount = Object.keys(pending).length;

  const confirmed = mergeDecisions.filter(d => d.decision === 'confirmed');
  const rejected  = mergeDecisions.filter(d => d.decision === 'rejected');

  const q = search.trim().toLowerCase();
  const hit = (...vals: string[]) => !q || vals.some(v => v.toLowerCase().includes(q));

  // Yes/No only MARK a row — nothing is saved until Confirm. Lets a whole review
  // pass happen in one go and rebuilds the dashboard once at the end rather than
  // after every click (owner request 2026-09-28).
  function mark(raw_name: string, decision: 'confirmed' | 'rejected') {
    setPending(p => (p[raw_name] === decision
      ? Object.fromEntries(Object.entries(p).filter(([k]) => k !== raw_name))  // click again to unmark
      : { ...p, [raw_name]: decision }));
  }

  async function confirmAll() {
    const entries = Object.entries(pending);
    if (!entries.length) return;
    setBusy('__batch__'); setError(null);
    try {
      const decisions = entries.map(([raw_name, decision]) => ({
        raw_name,
        decision,
        clean_name: decision === 'confirmed'
          ? (targets[raw_name] ?? suggestionByName.get(raw_name)?.suggested_name ?? '').trim()
          : (suggestionByName.get(raw_name)?.suggested_name ?? ''),
      }));
      const res = await fetch('/api/review/merge-decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decisions }),
      });
      const body = await res.json();
      if (body.failed?.length) {
        setError(`${body.failed.length} could not be applied: ` +
          body.failed.map((f: { raw_name: string; error: string }) => `${f.raw_name} (${f.error})`).join('; '));
      }
      if (!res.ok && !body.failed?.length) {
        setError(body.error ?? 'Failed to save');
      } else {
        // Drop only the rows that actually landed; anything rejected by the server
        // stays marked so it is still visible and fixable.
        const ok = new Set((body.applied ?? []).map((a: { raw_name: string }) => a.raw_name));
        setPending(p => Object.fromEntries(Object.entries(p).filter(([k]) => !ok.has(k))));
        router.refresh();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function undo(raw_name: string) {
    setBusy(raw_name); setError(null);
    try {
      const res = await fetch('/api/review/merge-decision', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw_name }),
      });
      const body = await res.json();
      if (!res.ok) setError(body.error ?? 'Failed to undo');
      else router.refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  function exportCsv() {
    const headers = ['Canonical Name (Current)', 'Name History', 'Lifetime Qty', 'Lifetime $', 'Locations', 'First Seen'];
    const rows = renames.map(r => [
      r.canonical_name,
      r.name_history.map(h => `${h.name} (${h.first_used} → ${h.name === r.canonical_name ? 'present' : h.last_used})`).join('; '),
      r.lifetime_qty,
      r.lifetime_revenue.toFixed(2),
      r.location_count,
      r.first_seen,
    ]);
    csvDownload('renames_audit.csv', headers, rows);
  }

  const TABS: { id: Section; label: string; count: number }[] = [
    { id: 'suggested', label: 'Suggested',      count: mergeSuggestions.length },
    { id: 'decided',   label: 'Renamed',        count: mergeDecisions.length },
    { id: 'history',   label: 'Name history',   count: renames.length },
  ];

  return (
    <div>
      <div className="info-banner purple">
        <i className="ti ti-refresh" />
        <div>
          Decisions about which item names are the same dish. <strong>Suggested</strong> is what still needs a
          yes or no; <strong>Renamed</strong> is everything already decided, whether it was merged or
          deliberately kept apart. Every decision can be undone.
        </div>
      </div>

      {error && (
        <div className="info-banner" style={{ background: '#fee2e2', color: '#991b1b', marginBottom: 10 }}>
          <i className="ti ti-alert-triangle" />
          <div>{error}</div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setSection(t.id)}
            style={{
              padding: '5px 12px', borderRadius: 8, border: '1px solid var(--border)',
              fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              background: section === t.id ? 'var(--accent)' : 'var(--card)',
              color: section === t.id ? '#fff' : 'var(--muted)',
            }}>
            {t.label} ({t.count})
          </button>
        ))}
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search names…" className="srch" style={{ marginLeft: 'auto' }}
        />
        {canEdit && section === 'history' && (
          <button className="drb" onClick={exportCsv} style={{ minWidth: 0, padding: '6px 12px' }}>
            <i className="ti ti-download" style={{ fontSize: 12, marginRight: 4 }} />
            Export CSV
          </button>
        )}
      </div>

      {/* ── Suggested ─────────────────────────────────────────────────────── */}
      {section === 'suggested' && canEdit && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10,
          padding: '8px 12px', borderRadius: 8,
          background: pendingCount ? '#f5f3ff' : 'var(--card)',
          border: `1px solid ${pendingCount ? 'var(--accent)' : 'var(--border)'}`,
        }}>
          <span style={{ fontSize: 11, color: pendingCount ? '#381d7c' : 'var(--muted)', fontWeight: 600 }}>
            {pendingCount
              ? `${pendingCount} marked — nothing is saved until you confirm`
              : 'Mark rows Yes or No, then confirm them together'}
          </span>
          <button
            onClick={confirmAll}
            disabled={!pendingCount || busy !== null}
            style={{
              marginLeft: 'auto', padding: '5px 16px', borderRadius: 6,
              border: '1px solid var(--accent)', fontSize: 11, fontWeight: 700,
              cursor: pendingCount ? 'pointer' : 'not-allowed', fontFamily: 'inherit',
              background: pendingCount ? 'var(--accent)' : 'var(--card)',
              color: pendingCount ? '#fff' : 'var(--muted)',
              opacity: busy === '__batch__' ? 0.6 : 1,
            }}>
            {busy === '__batch__' ? 'Applying…' : `Confirm${pendingCount ? ` (${pendingCount})` : ''}`}
          </button>
          {pendingCount > 0 && busy === null && (
            <button
              onClick={() => setPending({})}
              style={{
                padding: '5px 12px', borderRadius: 6, border: '1px solid var(--border)',
                background: 'var(--card)', color: 'var(--muted)', fontSize: 11,
                fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              }}>Clear marks</button>
          )}
        </div>
      )}

      {section === 'suggested' && (
        <div className="tw">
          <div className="tscroll">
            <table>
              <thead>
                <tr>
                  <th>Item name</th>
                  <th>Qty</th>
                  <th>Why</th>
                  <th style={{ minWidth: 220 }}>Merge into</th>
                  <th style={{ width: 150 }}>Decision</th>
                </tr>
              </thead>
              <tbody>
                {mergeSuggestions.filter(s => hit(s.raw_name, s.suggested_name)).map(s => {
                  const target = targets[s.raw_name] ?? s.suggested_name;
                  const badge = KIND_BADGE[s.kind];
                  const mine  = pending[s.raw_name];
                  return (
                    <tr key={s.raw_name} style={{
                      background: mine === 'confirmed' ? '#f0fdf4' : mine === 'rejected' ? '#f9fafb' : undefined,
                    }}>
                      <td style={{ fontWeight: 600 }}>{s.raw_name}</td>
                      <td>{s.raw_qty.toLocaleString()}</td>
                      <td style={{ fontSize: 10, color: 'var(--muted)' }}>
                        <span style={{
                          display: 'inline-block', background: badge.bg, color: badge.color,
                          borderRadius: 4, padding: '1px 6px', fontSize: 9, fontWeight: 700, marginRight: 6,
                        }}>{badge.label}</span>
                        {s.detail}
                      </td>
                      <td>
                        <input
                          value={target}
                          onChange={e => setTargets(t => ({ ...t, [s.raw_name]: e.target.value }))}
                          className="srch"
                          style={{ width: '100%', fontSize: 11 }}
                          disabled={!canEdit || busy === s.raw_name}
                        />
                      </td>
                      <td>
                        {canEdit ? (
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button
                              onClick={() => mark(s.raw_name, 'confirmed')}
                              disabled={busy !== null || !target.trim()}
                              title={mine === 'confirmed' ? 'Click again to unmark' : 'Mark as the same dish'}
                              style={{
                                padding: '3px 10px', borderRadius: 6,
                                border: `1px solid ${mine === 'confirmed' ? '#16a34a' : 'var(--border)'}`,
                                background: mine === 'confirmed' ? '#16a34a' : 'var(--card)',
                                color:      mine === 'confirmed' ? '#fff' : 'var(--muted)',
                                fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                              }}>Yes</button>
                            <button
                              onClick={() => mark(s.raw_name, 'rejected')}
                              disabled={busy !== null}
                              title={mine === 'rejected' ? 'Click again to unmark' : 'Mark as different dishes'}
                              style={{
                                padding: '3px 10px', borderRadius: 6,
                                border: `1px solid ${mine === 'rejected' ? '#4b5563' : 'var(--border)'}`,
                                background: mine === 'rejected' ? '#4b5563' : 'var(--card)',
                                color:      mine === 'rejected' ? '#fff' : 'var(--muted)',
                                fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                              }}>No</button>
                          </div>
                        ) : (
                          <span style={{ fontSize: 10, color: 'var(--muted)' }}>view only</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {mergeSuggestions.length === 0 && (
                  <tr><td colSpan={5} style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>
                    Nothing to review — every candidate has been decided.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Renamed: every decision, merged and kept-apart together ───────── */}
      {section === 'decided' && (
        <>
          <div className="info-banner" style={{ background: '#f5f3ff', color: '#381d7c', marginBottom: 10 }}>
            <i className="ti ti-check" />
            <div>
              <strong>Merged</strong> names report as a single item everywhere in the dashboard.
              <strong style={{ marginLeft: 8 }}>Kept apart</strong> means the pair was reviewed and judged to be
              genuinely different dishes — nothing about the numbers changes, it just records the decision so it
              stops being suggested. Undo returns either one to Suggested.
            </div>
          </div>
          <div className="tw">
            <div className="tscroll">
              <table>
                <thead>
                  <tr>
                    <th>Item name</th>
                    <th>Qty</th>
                    <th style={{ width: 110 }}>Status</th>
                    <th>Against</th>
                    <th>Decided by</th>
                    <th style={{ width: 100 }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {[...confirmed, ...rejected]
                    .filter(d => hit(d.raw_name, d.clean_name))
                    .map(d => {
                      const merged = d.decision === 'confirmed';
                      return (
                        <tr key={d.raw_name}>
                          <td style={{ fontWeight: 600 }}>{d.raw_name}</td>
                          <td>{d.qty ? d.qty.toLocaleString() : '—'}</td>
                          <td>
                            <span style={{
                              display: 'inline-block', borderRadius: 4, padding: '1px 7px',
                              fontSize: 9, fontWeight: 700, whiteSpace: 'nowrap',
                              background: merged ? '#dcfce7' : '#e5e7eb',
                              color:      merged ? '#14532d' : '#4b5563',
                            }}>
                              {merged ? 'Merged' : 'Kept apart'}
                            </span>
                          </td>
                          <td style={{ fontWeight: merged ? 700 : 400, color: merged ? 'var(--text)' : 'var(--muted)' }}>
                            {merged ? `→ ${d.clean_name}` : d.clean_name}
                          </td>
                          <td style={{ fontSize: 10, color: 'var(--muted)' }}>
                            {d.source === 'seeded' ? 'existing rule' : (d.decided_by ?? 'user')}
                            <span style={{ marginLeft: 6 }}>{d.updated_at?.slice(0, 10)}</span>
                          </td>
                          <td>
                            {canEdit ? (
                              <button
                                onClick={() => undo(d.raw_name)}
                                disabled={busy === d.raw_name}
                                style={{
                                  padding: '3px 10px', borderRadius: 6, border: '1px solid var(--border)',
                                  background: 'var(--card)', color: 'var(--accent)', fontSize: 10,
                                  fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                                }}>Undo</button>
                            ) : (
                              <span style={{ fontSize: 10, color: 'var(--muted)' }}>—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ── Name history (the original table) ─────────────────────────────── */}
      {section === 'history' && (
        <div className="tw">
          <div className="tscroll">
            <table>
              <thead>
                <tr>
                  <th>Canonical name (current)</th>
                  <th>Name history</th>
                  <th>Lifetime Qty</th>
                  <th>Lifetime $</th>
                  <th>Locations</th>
                  <th>First seen</th>
                </tr>
              </thead>
              <tbody>
                {renames.filter(r => hit(r.canonical_name, ...r.all_names)).map(r => (
                  <tr key={r.canonical_name}>
                    <td style={{ fontWeight: 700 }}>{r.canonical_name}</td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {r.name_history.map(h => {
                          const isCurrent = h.name === r.canonical_name;
                          return (
                            <div key={h.name} style={{ fontSize: 10, display: 'flex', gap: 5, alignItems: 'baseline' }}>
                              <span style={{
                                fontWeight: isCurrent ? 700 : 400,
                                color: isCurrent ? 'var(--text)' : '#9ca3af',
                                textDecoration: isCurrent ? 'none' : 'line-through',
                              }}>{h.name}</span>
                              <span style={{ color: 'var(--muted)' }}>
                                {h.first_used} → {isCurrent ? 'present' : h.last_used}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </td>
                    <td>{r.lifetime_qty.toLocaleString()}</td>
                    <td>{fmt$(r.lifetime_revenue)}</td>
                    <td>
                      <span style={{
                        display: 'inline-block', background: '#f3f0fb', color: '#381d7c',
                        borderRadius: 4, padding: '1px 7px', fontSize: 10, fontWeight: 700,
                      }}>
                        {r.location_count}
                      </span>
                    </td>
                    <td style={{ fontSize: 10, color: 'var(--muted)' }}>{r.first_seen}</td>
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
