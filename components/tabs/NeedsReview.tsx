'use client';
import { useState, useCallback } from 'react';
import { CHANNELS, CHANNEL_LABEL } from '@/lib/constants';
import type { NeedsReviewRow, UncategorizedItemRow } from '@/lib/types';

interface Props {
  needsReview:        NeedsReviewRow[];
  uncategorizedItems: UncategorizedItemRow[];
}

const fmt$ = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;

const ASSIGNABLE_CHANNELS = CHANNELS.filter(
  c => !['OPEN_ITEMS'].includes(c.code)
);

const CATEGORIES = [
  'Entrees', 'Sides', 'NA Drinks', 'Alc Drinks', 'Sweets',
  'Retail', 'Catering', 'Other',
];

const MENU_GROUPS: Record<string, string[]> = {
  'Entrees':   ['BOWLS','PLATES','BURRITOS','CHEF CURATED BOWLS','KIDS','KIDS MEAL'],
  'Sides':     ['SIDES'],
  'NA Drinks': ['DRINKS','Cold Drinks','Hot Drinks'],
  'Alc Drinks':['Beer','Wine','Liquor','Gameday'],
  'Sweets':    ['SWEETS'],
  'Retail':    ['RETAIL'],
  'Catering':  ['CATERING'],
  'Other':     [],
};

type Section = 'channels' | 'items';

export default function NeedsReview({ needsReview, uncategorizedItems }: Props) {
  const [section, setSection]     = useState<Section>('channels');

  // ── Channel correction state ──────────────────────────────────────────────
  // channelDraft[order_guid] = selected channel value (not yet confirmed)
  const [channelDraft,    setChannelDraft]    = useState<Record<string, string>>(() =>
    Object.fromEntries(needsReview.map(r => [r.order_guid, r.suggested_channel]))
  );
  const [channelStatus,  setChannelStatus]   = useState<Record<string, 'idle' | 'saving' | 'done' | 'error'>>({});
  const [channelEditing, setChannelEditing]  = useState<Set<string>>(new Set());

  // ── Item categorization state ─────────────────────────────────────────────
  const [catDraft,   setCatDraft]   = useState<Record<string, string>>({});
  const [grpDraft,   setGrpDraft]   = useState<Record<string, string>>({});
  const [itemStatus, setItemStatus] = useState<Record<string, 'idle' | 'saving' | 'done' | 'error'>>({});
  const [itemEditing,setItemEditing]= useState<Set<string>>(new Set());

  // ── Channel confirm ───────────────────────────────────────────────────────
  const confirmChannel = useCallback(async (order_guid: string) => {
    const channel = channelDraft[order_guid];
    if (!channel) return;
    setChannelStatus(s => ({ ...s, [order_guid]: 'saving' }));
    try {
      const res = await fetch('/api/review/update-channel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_guid, channel }),
      });
      if (!res.ok) throw new Error(await res.text());
      setChannelStatus(s => ({ ...s, [order_guid]: 'done' }));
      setChannelEditing(prev => { const n = new Set(prev); n.delete(order_guid); return n; });
    } catch {
      setChannelStatus(s => ({ ...s, [order_guid]: 'error' }));
    }
  }, [channelDraft]);

  // ── Item confirm ──────────────────────────────────────────────────────────
  const confirmItem = useCallback(async (canonical_name: string) => {
    const category   = catDraft[canonical_name];
    const menu_group = grpDraft[canonical_name] ?? '';
    if (!category) return;
    setItemStatus(s => ({ ...s, [canonical_name]: 'saving' }));
    try {
      const res = await fetch('/api/review/categorize-item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canonical_name, category, menu_group }),
      });
      if (!res.ok) throw new Error(await res.text());
      setItemStatus(s => ({ ...s, [canonical_name]: 'done' }));
      setItemEditing(prev => { const n = new Set(prev); n.delete(canonical_name); return n; });
    } catch {
      setItemStatus(s => ({ ...s, [canonical_name]: 'error' }));
    }
  }, [catDraft, grpDraft]);

  const doneChannels = Object.values(channelStatus).filter(s => s === 'done').length;
  const doneItems    = Object.values(itemStatus).filter(s => s === 'done').length;

  return (
    <div>

      {/* ── Section selector ──────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>Reviewing:</span>
        <select
          className="fb-sel"
          value={section}
          onChange={e => setSection(e.target.value as Section)}
          style={{ minWidth: 240, fontWeight: 700 }}
        >
          <option value="channels">
            Wrong Channel Orders ({needsReview.length}{doneChannels > 0 ? ` · ${doneChannels} fixed` : ''})
          </option>
          <option value="items">
            Uncategorized Items ({uncategorizedItems.length}{doneItems > 0 ? ` · ${doneItems} fixed` : ''})
          </option>
        </select>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 1 — Wrong-channel orders
      ══════════════════════════════════════════════════════════════════════ */}
      {section === 'channels' && (
        <>
          <div className="info-banner yellow" style={{ marginBottom: 12 }}>
            <i className="ti ti-alert-triangle" />
            <div>
              <strong>{needsReview.length}</strong> orders are excluded from the main dashboard.
              Select the correct channel for each and confirm to update the database.
              {doneChannels > 0 && <> <strong style={{ color: '#16a34a' }}>{doneChannels} fixed.</strong></>}
            </div>
          </div>

          {needsReview.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>
              <i className="ti ti-check" style={{ fontSize: 28, opacity: 0.3, display: 'block' }} />
              <div style={{ marginTop: 8 }}>No excluded orders in this date range.</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {needsReview.map((r) => {
                const status  = channelStatus[r.order_guid] ?? 'idle';
                const isDone  = status === 'done';
                const isEdit  = channelEditing.has(r.order_guid);
                const draft   = channelDraft[r.order_guid] ?? r.suggested_channel;

                return (
                  <div key={r.order_guid} className="nr-card" style={{
                    opacity: isDone && !isEdit ? 0.7 : 1,
                    borderLeft: isDone && !isEdit ? '3px solid #16a34a' : undefined,
                  }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <div className={`nr-tag${r.current_channel === 'OFFSITE' ? ' offsite' : ''}`}>
                          {r.current_channel}
                        </div>
                        {isDone && !isEdit && (
                          <span style={{ fontSize: 10, fontWeight: 700, color: '#16a34a' }}>
                            <i className="ti ti-check" /> Updated to {CHANNEL_LABEL[channelDraft[r.order_guid]] ?? channelDraft[r.order_guid]}
                          </span>
                        )}
                      </div>
                      <div className="nr-main">{r.location} · {r.business_date}</div>
                      <div className="nr-sub">
                        {r.item_count} item{r.item_count !== 1 ? 's' : ''} · {fmt$(r.amount)}
                      </div>
                      <div className="nr-hint">
                        <i className="ti ti-info-circle" style={{ fontSize: 9, marginRight: 3 }} />
                        {r.suggested_channel}
                      </div>

                      {/* Action row */}
                      {(!isDone || isEdit) && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
                          <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Correct channel:</span>
                          <select
                            className="fb-sel"
                            value={draft}
                            onChange={e => setChannelDraft(prev => ({ ...prev, [r.order_guid]: e.target.value }))}
                            style={{ fontSize: 11, padding: '3px 6px' }}
                          >
                            {ASSIGNABLE_CHANNELS.map(c => (
                              <option key={c.code} value={c.code}>{c.label}</option>
                            ))}
                          </select>
                          <button
                            disabled={status === 'saving'}
                            onClick={() => confirmChannel(r.order_guid)}
                            style={{
                              padding: '4px 14px', borderRadius: 6, border: 'none',
                              background: 'var(--accent)', color: '#fff',
                              fontSize: 11, fontWeight: 700, cursor: 'pointer',
                              opacity: status === 'saving' ? 0.6 : 1,
                            }}
                          >
                            {status === 'saving' ? 'Saving…' : '✓ Confirm'}
                          </button>
                          {status === 'error' && (
                            <span style={{ fontSize: 10, color: '#dc2626' }}>Save failed — try again</span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Edit button after done */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent)', minWidth: 70, textAlign: 'right' }}>
                        {fmt$(r.amount)}
                      </div>
                      {isDone && !isEdit && (
                        <button
                          onClick={() => setChannelEditing(prev => { const n = new Set(prev); n.add(r.order_guid); return n; })}
                          style={{
                            padding: '3px 10px', borderRadius: 5,
                            border: '1px solid var(--border)', background: 'transparent',
                            fontSize: 10, fontWeight: 600, cursor: 'pointer', color: 'var(--muted)',
                          }}
                        >
                          Edit
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              <div style={{ fontSize: 10, color: 'var(--muted)', textAlign: 'center', padding: '8px 0 16px' }}>
                {doneChannels} of {needsReview.length} orders updated
              </div>
            </div>
          )}
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 2 — Uncategorized items
      ══════════════════════════════════════════════════════════════════════ */}
      {section === 'items' && (
        <>
          <div className="info-banner" style={{
            background: 'rgba(249,115,22,0.08)', borderColor: '#f97316',
            marginBottom: 12,
          }}>
            <i className="ti ti-tag-off" style={{ color: '#f97316' }} />
            <div>
              <strong style={{ color: '#f97316' }}>{uncategorizedItems.length}</strong> items fall through to{' '}
              <em>Other</em>. Assign each a category and confirm to save to the database.
              {doneItems > 0 && <> <strong style={{ color: '#16a34a' }}>{doneItems} fixed.</strong></>}
            </div>
          </div>

          {uncategorizedItems.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>
              <i className="ti ti-check" style={{ fontSize: 28, opacity: 0.3, display: 'block' }} />
              <div style={{ marginTop: 8 }}>All items are categorized.</div>
            </div>
          ) : (
            <div className="tw">
              <div style={{ overflowX: 'auto' }}>
                <table style={{ fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>#</th>
                      <th style={{ textAlign: 'left' }}>Item Name</th>
                      <th style={{ textAlign: 'left' }}>Channel</th>
                      <th>Qty</th>
                      <th>Revenue</th>
                      <th style={{ textAlign: 'left' }}>Category</th>
                      <th style={{ textAlign: 'left' }}>Menu Group</th>
                      <th style={{ textAlign: 'left' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {uncategorizedItems.map((row, i) => {
                      const key    = row.canonical_name;
                      const status = itemStatus[key] ?? 'idle';
                      const isDone = status === 'done';
                      const isEdit = itemEditing.has(key);
                      const cat    = catDraft[key] ?? '';
                      const grp    = grpDraft[key] ?? '';

                      return (
                        <tr key={key} style={{
                          background: isDone && !isEdit ? 'rgba(22,163,74,0.05)' : undefined,
                          borderLeft: isDone && !isEdit ? '3px solid #16a34a' : undefined,
                        }}>
                          <td style={{ color: 'var(--muted)', fontSize: 11 }}>{i + 1}</td>
                          <td style={{
                            fontWeight: 600, maxWidth: 200,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
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

                          {/* Category cell */}
                          <td>
                            {isDone && !isEdit ? (
                              <span style={{ fontSize: 11, fontWeight: 700, color: '#16a34a' }}>
                                <i className="ti ti-check" /> {catDraft[key]}
                              </span>
                            ) : (
                              <select
                                className="fb-sel"
                                value={cat}
                                onChange={e => {
                                  const v = e.target.value;
                                  setCatDraft(prev => ({ ...prev, [key]: v }));
                                  // Auto-fill first menu group for the category
                                  const groups = MENU_GROUPS[v] ?? [];
                                  if (groups[0] && !grpDraft[key]) {
                                    setGrpDraft(prev => ({ ...prev, [key]: groups[0] }));
                                  }
                                }}
                                style={{ fontSize: 11, padding: '3px 6px', minWidth: 110 }}
                              >
                                <option value="">— select —</option>
                                {CATEGORIES.map(c => (
                                  <option key={c} value={c}>{c}</option>
                                ))}
                              </select>
                            )}
                          </td>

                          {/* Menu Group cell */}
                          <td>
                            {isDone && !isEdit ? (
                              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{grpDraft[key] || '—'}</span>
                            ) : (
                              <select
                                className="fb-sel"
                                value={grp}
                                onChange={e => setGrpDraft(prev => ({ ...prev, [key]: e.target.value }))}
                                style={{ fontSize: 11, padding: '3px 6px', minWidth: 130 }}
                                disabled={!cat}
                              >
                                <option value="">— optional —</option>
                                {(MENU_GROUPS[cat] ?? []).map(g => (
                                  <option key={g} value={g}>{g}</option>
                                ))}
                              </select>
                            )}
                          </td>

                          {/* Action cell */}
                          <td style={{ whiteSpace: 'nowrap' }}>
                            {isDone && !isEdit ? (
                              <button
                                onClick={() => setItemEditing(prev => { const n = new Set(prev); n.add(key); return n; })}
                                style={{
                                  padding: '3px 10px', borderRadius: 5,
                                  border: '1px solid var(--border)', background: 'transparent',
                                  fontSize: 10, fontWeight: 600, cursor: 'pointer', color: 'var(--muted)',
                                }}
                              >
                                Edit
                              </button>
                            ) : (
                              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                <button
                                  disabled={!cat || status === 'saving'}
                                  onClick={() => confirmItem(key)}
                                  style={{
                                    padding: '4px 12px', borderRadius: 5, border: 'none',
                                    background: cat ? 'var(--accent)' : 'var(--border)',
                                    color: cat ? '#fff' : 'var(--muted)',
                                    fontSize: 11, fontWeight: 700,
                                    cursor: cat ? 'pointer' : 'not-allowed',
                                    opacity: status === 'saving' ? 0.6 : 1,
                                  }}
                                >
                                  {status === 'saving' ? '…' : '✓ Confirm'}
                                </button>
                                {status === 'error' && (
                                  <span style={{ fontSize: 10, color: '#dc2626' }}>Failed</span>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ fontSize: 10, color: 'var(--muted)', padding: '8px 0 4px' }}>
                {doneItems} of {uncategorizedItems.length} items categorized · Changes saved to{' '}
                <code>analytics.item_category_override</code> and <code>analytics.item_lookup</code>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
