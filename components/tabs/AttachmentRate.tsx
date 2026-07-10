'use client';
import { Fragment, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import type { DateRange, AttachmentData, AttachmentOverallRow } from '@/lib/types';

const HBarChart = dynamic(() => import('../charts/HBarChart'), { ssr: false });

const fmt$  = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;
const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`;

const CHANNEL_LABEL: Record<string, string> = {
  IN_HOUSE: 'In-House',
  TPD:      '3PD',
  APP:      'Loyalty',
};

type SortKey = 'total_checks' | 'attachment_rate' | 'missed_opportunity' | 'uplift_per_check';
type GridMode = 'location' | 'channel';

function Badge({ children, bg, color }: { children: React.ReactNode; bg: string; color: string }) {
  return (
    <span style={{ background: bg, color, fontSize: 9, fontWeight: 700, borderRadius: 4, padding: '2px 6px', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
      {children}
    </span>
  );
}

const IN_SCOPE_CHANNELS = new Set(['IN_HOUSE', 'TPD', 'APP']);

export default function AttachmentRate({
  dr, selectedChannels = [], selectedLocations = [],
}: {
  dr: DateRange;
  selectedChannels?: string[];
  selectedLocations?: string[];
}) {
  const [data, setData]     = useState<AttachmentData | null>(null);
  const [error, setError]   = useState('');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('missed_opportunity');
  const [showBottom, setShowBottom] = useState(false);
  const [expandedCompanions, setExpandedCompanions] = useState<Set<string>>(new Set());
  const [gridMode, setGridMode] = useState<GridMode>('location');

  // This feature only ever tracks In-House/3PD/Loyalty — if every selected channel
  // falls outside that set (e.g. Catering, Offsite), there's nothing to show.
  const outOfScope = selectedChannels.length > 0 && !selectedChannels.some(c => IN_SCOPE_CHANNELS.has(c));

  useEffect(() => {
    if (outOfScope) { setLoading(false); return; }
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ start: dr.start, end: dr.end, label: dr.label });
    if (selectedChannels.length > 0)  params.set('channels', selectedChannels.join(','));
    if (selectedLocations.length > 0) params.set('locations', selectedLocations.join(','));
    fetch(`/api/attachment-rate?${params.toString()}`)
      .then(res => res.json())
      .then(d => { if (d.error) throw new Error(d.error); setData(d); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dr.start, dr.end, dr.label, outOfScope, selectedChannels.join(','), selectedLocations.join(',')]);

  // ── Derived summary stats ────────────────────────────────────────────────
  const summary = useMemo(() => {
    if (!data) return null;
    const { overall, byChannel } = data;
    const totalChecks   = overall.reduce((s, r) => s + r.total_checks, 0);
    const totalAttached = overall.reduce((s, r) => s + r.totals, 0);
    const blendedRate   = totalChecks > 0 ? totalAttached / totalChecks : 0;

    const eligible = overall.filter(r => r.total_checks >= 20); // ignore tiny-sample noise for rankings
    const best  = [...eligible].sort((a, b) => b.attachment_rate - a.attachment_rate)[0] ?? null;
    const worst = [...eligible].sort((a, b) => a.attachment_rate - b.attachment_rate)[0] ?? null;
    const biggestOpportunity = [...overall]
      .filter(r => r.missed_opportunity != null)
      .sort((a, b) => (b.missed_opportunity ?? 0) - (a.missed_opportunity ?? 0))[0] ?? null;
    const totalMissedOpportunity = overall.reduce((s, r) => s + Math.max(0, r.missed_opportunity ?? 0), 0);

    // Blended rate per channel
    const chAgg = new Map<string, { checks: number; attached: number }>();
    byChannel.forEach(r => {
      const e = chAgg.get(r.channel) ?? { checks: 0, attached: 0 };
      e.checks   += r.total_checks;
      e.attached += r.totals;
      chAgg.set(r.channel, e);
    });
    const channelRates = ['IN_HOUSE', 'TPD', 'APP']
      .filter(ch => chAgg.has(ch))
      .map(ch => {
        const e = chAgg.get(ch)!;
        return { channel: ch, rate: e.checks > 0 ? e.attached / e.checks : 0, checks: e.checks };
      });

    return { totalChecks, totalAttached, blendedRate, best, worst, biggestOpportunity, totalMissedOpportunity, channelRates };
  }, [data]);

  // ── Location blended stats ───────────────────────────────────────────────
  const locationStats = useMemo(() => {
    if (!data) return [];
    const agg = new Map<string, { checks: number; attached: number }>();
    data.byLocation.forEach(r => {
      const e = agg.get(r.location) ?? { checks: 0, attached: 0 };
      e.checks   += r.total_checks;
      e.attached += r.totals;
      agg.set(r.location, e);
    });
    return [...agg.entries()]
      .map(([location, v]) => ({ location, rate: v.checks > 0 ? v.attached / v.checks : 0, checks: v.checks }))
      .sort((a, b) => b.rate - a.rate);
  }, [data]);

  // ── Leaderboard (search + sort) ──────────────────────────────────────────
  const leaderboard = useMemo(() => {
    if (!data) return [];
    let rows = data.overall.filter(r => r.total_checks >= 5); // drop near-zero-sample noise
    if (search) rows = rows.filter(r => r.main_item.toLowerCase().includes(search.toLowerCase()));
    const sorted = [...rows].sort((a, b) => {
      const av = sortKey === 'attachment_rate' ? a.attachment_rate
               : sortKey === 'uplift_per_check' ? (a.uplift_per_check ?? -Infinity)
               : sortKey === 'missed_opportunity' ? (a.missed_opportunity ?? -Infinity)
               : a.total_checks;
      const bv = sortKey === 'attachment_rate' ? b.attachment_rate
               : sortKey === 'uplift_per_check' ? (b.uplift_per_check ?? -Infinity)
               : sortKey === 'missed_opportunity' ? (b.missed_opportunity ?? -Infinity)
               : b.total_checks;
      return bv - av;
    });
    return showBottom ? sorted.reverse() : sorted;
  }, [data, search, sortKey, showBottom]);

  const channelBarData = useMemo(() =>
    (summary?.channelRates ?? []).map(c => ({ name: CHANNEL_LABEL[c.channel] ?? c.channel, value: Math.round(c.rate * 1000) / 10 })),
  [summary]);

  // ── Raw grid: Main Item × Location or Main Item × Channel, same layout as
  // the original Apps Script's "Main Attachment - Location/Channel" sheets ──
  const grid = useMemo(() => {
    if (!data) return null;
    const source = gridMode === 'location' ? data.byLocation : data.byChannel;
    const cols = [...new Set(source.map(r => gridMode === 'location' ? (r as typeof data.byLocation[number]).location : CHANNEL_LABEL[(r as typeof data.byChannel[number]).channel] ?? (r as typeof data.byChannel[number]).channel))]
      .sort();
    const byMain = new Map<string, Map<string, { total_checks: number; checks_with_item: number; checks_with_mod: number; totals: number; attachment_rate: number }>>();
    source.forEach(r => {
      const col = gridMode === 'location' ? (r as typeof data.byLocation[number]).location : (CHANNEL_LABEL[(r as typeof data.byChannel[number]).channel] ?? (r as typeof data.byChannel[number]).channel);
      if (!byMain.has(r.main_item)) byMain.set(r.main_item, new Map());
      byMain.get(r.main_item)!.set(col, {
        total_checks: r.total_checks, checks_with_item: r.checks_with_item,
        checks_with_mod: r.checks_with_mod, totals: r.totals, attachment_rate: r.attachment_rate,
      });
    });
    const mainItems = [...byMain.keys()].sort();
    return { cols, byMain, mainItems };
  }, [data, gridMode]);

  const companionBarData = useMemo(() => {
    if (!data) return [];
    return [...data.companions]
      .sort((a, b) => b.total_attach_checks - a.total_attach_checks)
      .slice(0, 10)
      .map(c => ({ name: c.companion_name.length > 22 ? c.companion_name.slice(0, 20) + '…' : c.companion_name, value: c.total_attach_checks }));
  }, [data]);

  if (outOfScope) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>
        <i className="ti ti-link-off" style={{ fontSize: 28, opacity: 0.3, display: 'block', marginBottom: 8 }} />
        Attachment Rate only tracks In-House, 3PD, and Loyalty channels — the selected channel(s) aren&apos;t covered here.
      </div>
    );
  }
  if (loading) return <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>Loading attachment data…</div>;
  if (error)   return <div style={{ padding: 20, color: '#dc2626' }}>Error: {error}</div>;
  if (!data || !summary) return null;

  const sortLabel: Record<SortKey, string> = {
    total_checks:       'Volume',
    attachment_rate:    'Attachment Rate',
    missed_opportunity: 'Missed $ Opportunity',
    uplift_per_check:   'Uplift / Check',
  };

  return (
    <div>
      {/* ── Methodology / scope banner ── */}
      <div style={{
        background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10,
        padding: '10px 14px', marginBottom: 14, fontSize: 11, color: 'var(--muted)', display: 'flex', gap: 8, alignItems: 'flex-start',
      }}>
        <i className="ti ti-info-circle" style={{ fontSize: 13, marginTop: 1, flexShrink: 0 }} />
        <div>
          <strong style={{ color: 'var(--text)' }}>What this measures:</strong> of checks containing an Entrée, how many also have a Side/Sweet/Drink item and/or a &quot;Make it a Meal&quot; modifier attached.
          Scoped to In-House, 3PD, and Loyalty only (Catering, Offsite, and Open Items excluded). Every pairing — modifier or item — is exact per Entrée, reconstructed from Toast&apos;s own order timestamps, even on checks with more than one Entrée.
        </div>
      </div>

      {/* ── Headline insight ── */}
      {summary.biggestOpportunity && (
        <div style={{
          background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)', color: '#fff',
          borderRadius: 12, padding: '16px 20px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 16,
        }}>
          <i className="ti ti-bulb" style={{ fontSize: 28, opacity: 0.85, flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 3 }}>Biggest opportunity this period</div>
            <div style={{ fontSize: 12, opacity: 0.9 }}>
              <strong>{summary.biggestOpportunity.main_item}</strong> converts only {fmtPct(summary.biggestOpportunity.attachment_rate)} of its {summary.biggestOpportunity.total_checks.toLocaleString()} checks into an attached side/drink/sweet/meal upsell.
              {summary.biggestOpportunity.missed_opportunity != null && summary.biggestOpportunity.missed_opportunity > 0 && (
                <> Closing that gap to the blended average is worth an estimated <strong>{fmt$(summary.biggestOpportunity.missed_opportunity)}</strong> this period alone.</>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── KPI row ── */}
      <div className="krow k4">
        <div className="kc a">
          <div className="kl">Blended Attachment Rate</div>
          <div className="kv">{fmtPct(summary.blendedRate)}</div>
          <div className="ks">{summary.totalAttached.toLocaleString()} of {summary.totalChecks.toLocaleString()} qualifying checks</div>
        </div>
        <div className="kc o">
          <div className="kl">Est. Missed Opportunity</div>
          <div className="kv">{fmt$(summary.totalMissedOpportunity)}</div>
          <div className="ks">if every item hit its own best-check average</div>
        </div>
        <div className="kc g">
          <div className="kl">Best Performer</div>
          <div className="kv-sm">{summary.best?.main_item ?? '—'}</div>
          <div className="ks">{summary.best ? fmtPct(summary.best.attachment_rate) : '—'} attachment rate</div>
        </div>
        <div className="kc pk">
          <div className="kl">Lowest Performer</div>
          <div className="kv-sm">{summary.worst?.main_item ?? '—'}</div>
          <div className="ks">{summary.worst ? fmtPct(summary.worst.attachment_rate) : '—'} attachment rate</div>
        </div>
      </div>

      {/* ── Channel + companion charts ── */}
      <div className="gr2">
        <div className="cc">
          <h3>Attachment rate by channel</h3>
          <div style={{ position: 'relative', height: 200 }}>
            <HBarChart data={channelBarData} color="#9f7cef" formatter={(v) => `${v}%`} height={200} />
          </div>
          {summary.channelRates.length >= 2 && (() => {
            const sorted = [...summary.channelRates].sort((a, b) => b.rate - a.rate);
            const top = sorted[0], bottom = sorted[sorted.length - 1];
            const gap = top.rate - bottom.rate;
            return gap > 0.05 ? (
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 8 }}>
                <i className="ti ti-arrow-up-right" style={{ fontSize: 10 }} /> {CHANNEL_LABEL[top.channel] ?? top.channel} outperforms {CHANNEL_LABEL[bottom.channel] ?? bottom.channel} by {fmtPct(gap)} — worth checking whether {CHANNEL_LABEL[bottom.channel] ?? bottom.channel}&apos;s ordering flow prompts upsells as effectively.
              </div>
            ) : null;
          })()}
        </div>
        <div className="cc">
          <h3>Top 10 companions by attach volume</h3>
          <div style={{ position: 'relative', height: 200 }}>
            <HBarChart data={companionBarData} color="#10b981" formatter={(v) => v.toLocaleString()} height={200} />
          </div>
        </div>
      </div>

      {/* ── Location comparison ── */}
      {locationStats.length > 1 && (
        <div className="cc" style={{ marginBottom: 10 }}>
          <h3>Attachment rate by location</h3>
          <div className="tw" style={{ boxShadow: 'none' }}>
            <table>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Location</th>
                  <th>Qualifying Checks</th>
                  <th style={{ width: 240 }}>Attachment Rate</th>
                </tr>
              </thead>
              <tbody>
                {locationStats.map(l => (
                  <tr key={l.location}>
                    <td style={{ textAlign: 'left', fontWeight: 600 }}>{l.location}</td>
                    <td>{l.checks.toLocaleString()}</td>
                    <td style={{ fontWeight: 700 }}>{fmtPct(l.rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Main leaderboard ── */}
      <div className="cc" style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0 }}>Entrée attachment leaderboard</h3>
          <input
            className="fb-sel" placeholder="Search item…" value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ marginLeft: 'auto', minWidth: 160 }}
          />
          <select className="fb-sel" value={sortKey} onChange={e => setSortKey(e.target.value as SortKey)}>
            {(Object.keys(sortLabel) as SortKey[]).map(k => (
              <option key={k} value={k}>Sort: {sortLabel[k]}</option>
            ))}
          </select>
          <button className="drb" onClick={() => setShowBottom(b => !b)} style={{ minWidth: 0, padding: '5px 12px', fontSize: 11 }}>
            {showBottom ? 'Showing: Worst first' : 'Showing: Best first'}
          </button>
        </div>
        <div className="tw" style={{ boxShadow: 'none' }}>
          <table>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Entrée</th>
                <th>Checks</th>
                <th>+ Item</th>
                <th>+ Meal Mod</th>
                <th style={{ width: 180 }}>Attachment Rate</th>
                <th>Avg Check (Attached)</th>
                <th>Avg Check (Not)</th>
                <th>Uplift / Check</th>
                <th>Missed Opportunity</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.map(r => (
                <tr key={r.main_item}>
                  <td style={{ textAlign: 'left', fontWeight: 600 }}>{r.main_item}</td>
                  <td>{r.total_checks.toLocaleString()}</td>
                  <td>{r.checks_with_item.toLocaleString()}</td>
                  <td>{r.checks_with_mod.toLocaleString()}</td>
                  <td style={{ fontWeight: 700 }}>{fmtPct(r.attachment_rate)}</td>
                  <td>{r.avg_check_attached != null ? fmt$(r.avg_check_attached) : '—'}</td>
                  <td>{r.avg_check_unattached != null ? fmt$(r.avg_check_unattached) : '—'}</td>
                  <td style={{ color: (r.uplift_per_check ?? 0) > 0 ? '#16a34a' : (r.uplift_per_check ?? 0) < 0 ? '#dc2626' : undefined, fontWeight: 700 }}>
                    {r.uplift_per_check != null ? fmt$(r.uplift_per_check) : '—'}
                  </td>
                  <td style={{ fontWeight: 700 }}>
                    {r.missed_opportunity != null && r.missed_opportunity > 0 ? fmt$(r.missed_opportunity) : '—'}
                  </td>
                </tr>
              ))}
              {leaderboard.length === 0 && (
                <tr><td colSpan={9} style={{ color: 'var(--muted)', padding: 20 }}>No items match.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Raw grid (same layout as the Apps Script "Main Attachment - Location/
          Channel" sheets) — full detail, no aggregation, for direct comparison ── */}
      {grid && (
        <div className="cc" style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <h3 style={{ margin: 0 }}>Raw detail grid</h3>
            <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
              <button
                className="drb" onClick={() => setGridMode('location')}
                style={{ minWidth: 0, padding: '5px 12px', fontSize: 11, ...(gridMode === 'location' ? { background: 'var(--accent)', color: '#fff' } : {}) }}
              >
                By Location
              </button>
              <button
                className="drb" onClick={() => setGridMode('channel')}
                style={{ minWidth: 0, padding: '5px 12px', fontSize: 11, ...(gridMode === 'channel' ? { background: 'var(--accent)', color: '#fff' } : {}) }}
              >
                By Channel
              </button>
            </div>
          </div>
          <div className="tw" style={{ boxShadow: 'none', overflowX: 'auto' }}>
            <table style={{ width: 'max-content', minWidth: '100%' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', position: 'sticky', left: 0, background: 'var(--card)' }}>Main Item</th>
                  {grid.cols.map(col => (
                    <th key={col} colSpan={5} style={{ borderLeft: '2px solid var(--border)' }}>{col}</th>
                  ))}
                </tr>
                <tr>
                  <th style={{ position: 'sticky', left: 0, background: 'var(--card)' }} />
                  {grid.cols.map(col => (
                    <Fragment key={col}>
                      <th style={{ borderLeft: '2px solid var(--border)', fontSize: 9 }}>Total Checks</th>
                      <th style={{ fontSize: 9 }}>+ Item</th>
                      <th style={{ fontSize: 9 }}>+ Meal Mod</th>
                      <th style={{ fontSize: 9 }}>Totals</th>
                      <th style={{ fontSize: 9 }}>Rate</th>
                    </Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.mainItems.map(main => (
                  <tr key={main}>
                    <td style={{ textAlign: 'left', fontWeight: 600, position: 'sticky', left: 0, background: 'var(--card)' }}>{main}</td>
                    {grid.cols.map(col => {
                      const e = grid.byMain.get(main)?.get(col);
                      return (
                        <Fragment key={col}>
                          <td style={{ borderLeft: '2px solid var(--border)' }}>{e ? e.total_checks.toLocaleString() : '—'}</td>
                          <td>{e ? e.checks_with_item.toLocaleString() : '—'}</td>
                          <td>{e ? e.checks_with_mod.toLocaleString() : '—'}</td>
                          <td>{e ? e.totals.toLocaleString() : '—'}</td>
                          <td style={{ fontWeight: 700 }}>{e ? fmtPct(e.attachment_rate) : '—'}</td>
                        </Fragment>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Companion item detail ── */}
      <div className="cc">
        <h3>Companion item detail</h3>
        <div className="tw" style={{ boxShadow: 'none' }}>
          <table>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Companion Item</th>
                <th>Category</th>
                <th>Attach Checks</th>
                <th>Most Common With</th>
              </tr>
            </thead>
            <tbody>
              {[...data.companions]
                .sort((a, b) => b.total_attach_checks - a.total_attach_checks)
                .map(c => {
                  const key = `${c.companion_category}||${c.companion_name}`;
                  const isOpen = expandedCompanions.has(key);
                  const top = c.pairs[0];
                  return (
                    <Fragment key={key}>
                      <tr>
                        <td style={{ textAlign: 'left', fontWeight: 600 }}>{c.companion_name}</td>
                        <td>
                          <Badge
                            bg={c.companion_category === 'Make it a Meal' ? '#ede9fe' : '#f0fdf4'}
                            color={c.companion_category === 'Make it a Meal' ? '#7c3aed' : '#15803d'}
                          >
                            {c.companion_category}
                          </Badge>
                        </td>
                        <td>{c.total_attach_checks.toLocaleString()}</td>
                        <td style={{ textAlign: 'left' }}>
                          {top ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
                              <span>{top.main_item} ({top.checks.toLocaleString()})</span>
                              {c.pairs.length > 1 && (
                                <button
                                  onClick={() => setExpandedCompanions(s => {
                                    const next = new Set(s);
                                    if (next.has(key)) next.delete(key); else next.add(key);
                                    return next;
                                  })}
                                  style={{
                                    display: 'flex', alignItems: 'center', gap: 2, padding: '1px 6px',
                                    border: 'none', background: 'transparent', fontSize: 10, fontWeight: 700,
                                    color: 'var(--accent)', cursor: 'pointer',
                                  }}
                                >
                                  <i className={`ti ${isOpen ? 'ti-chevron-up' : 'ti-chevron-down'}`} style={{ fontSize: 10 }} />
                                  {isOpen ? 'Hide' : `+${c.pairs.length - 1} more`}
                                </button>
                              )}
                            </div>
                          ) : '—'}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={4} style={{ textAlign: 'left', background: '#faf9fd', padding: '10px 14px' }}>
                            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 6 }}>
                              Every Entrée {c.companion_name} pairs with
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                              {c.pairs.map(p => (
                                <span
                                  key={p.main_item}
                                  style={{
                                    background: '#fff', border: '1px solid var(--border)', borderRadius: 6,
                                    padding: '3px 9px', fontSize: 11,
                                  }}
                                >
                                  {p.main_item} <strong>({p.checks.toLocaleString()})</strong>
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
