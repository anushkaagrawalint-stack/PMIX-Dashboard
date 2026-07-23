'use client';
import { useState, useCallback, useMemo } from 'react';
import { CHANNELS, CHANNEL_LABEL } from '@/lib/constants';
import type { NeedsReviewRow, UncategorizedItemRow, UncategorizedModifierRow, MissingCostRow, FiscalPeriodRow } from '@/lib/types';

interface Props {
  needsReview:            NeedsReviewRow[];
  uncategorizedItems:     UncategorizedItemRow[];
  uncategorizedModifiers: UncategorizedModifierRow[];
  missingCosts:           MissingCostRow[];
  periods:                FiscalPeriodRow[];
  isAdmin:                boolean;
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

// Bucket → allowed r365 "menu" values a cost can be written to — must match
// app/api/costs/route.ts's BUCKET_MENUS exactly (server re-validates the same set).
const BUCKET_MENUS: Record<MissingCostRow['bucket'], string[]> = {
  ih:           ['FOOD - IN HOUSE', 'DRINKS - IN HOUSE'],
  online:       ['DELIVERY', '3PD OPEN MARKUP'],
  catering:     ['CATERING'],
  catering_3pd: ['CATERING - 3PD'],
  offsite:      ['OFFSITE POP-UPS'],
};

const BUCKET_LABEL: Record<MissingCostRow['bucket'], string> = {
  ih: 'In-House', online: 'Online (LO/3PD)', catering: 'Catering',
  catering_3pd: 'Catering 3PD', offsite: 'Offsite',
};

// FiscalPeriodRow → r365's period string format, e.g. period=5, fiscal_year=2026 → 'P05-2026'
const toR365Period = (p: FiscalPeriodRow) => `P${String(p.period).padStart(2, '0')}-${p.fiscal_year}`;

type Section = 'channels' | 'items' | 'modifiers' | 'costs';

export default function NeedsReview({ needsReview, uncategorizedItems, uncategorizedModifiers, missingCosts, periods, isAdmin }: Props) {
  const [section, setSection]     = useState<Section>('channels');

  // ── Missing R365 cost state (admin only) ──────────────────────────────────
  const defaultPeriod = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return periods.find(p => today >= p.start_date && today <= p.end_date) ?? periods[periods.length - 1];
  }, [periods]);

  const costKey = (r: MissingCostRow) => `${r.canonical_name}||${r.bucket}`;
  const [costMenu,   setCostMenu]   = useState<Record<string, string>>(() =>
    Object.fromEntries(missingCosts.map(r => [costKey(r), BUCKET_MENUS[r.bucket][0]]))
  );
  const [costPeriod, setCostPeriod] = useState<Record<string, string>>(() =>
    Object.fromEntries(missingCosts.map(r => [costKey(r), defaultPeriod ? toR365Period(defaultPeriod) : '']))
  );
  const [costValue,  setCostValue]  = useState<Record<string, string>>({});
  const [costStatus, setCostStatus] = useState<Record<string, 'idle' | 'saving' | 'done' | 'error'>>({});
  const [costBulkSaving, setCostBulkSaving] = useState(false);

  const saveCost = useCallback(async (r: MissingCostRow) => {
    const key    = costKey(r);
    const menu   = costMenu[key]   ?? BUCKET_MENUS[r.bucket][0];
    const period = costPeriod[key] ?? (defaultPeriod ? toR365Period(defaultPeriod) : '');
    const cost   = Number(costValue[key]);
    if (!Number.isFinite(cost) || cost <= 0) {
      setCostStatus(s => ({ ...s, [key]: 'error' }));
      return;
    }
    setCostStatus(s => ({ ...s, [key]: 'saving' }));
    try {
      const res = await fetch('/api/costs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          canonical_name: r.canonical_name, bucket: r.bucket, menu, period,
          avg_cost: cost, category: r.category, menu_group: r.menu_group,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setCostStatus(s => ({ ...s, [key]: 'done' }));
    } catch {
      setCostStatus(s => ({ ...s, [key]: 'error' }));
    }
  }, [costMenu, costPeriod, costValue, defaultPeriod]);

  const doneCosts = Object.values(costStatus).filter(s => s === 'done').length;

  // Rows the admin actually entered a cost for and hasn't saved yet — the
  // ONLY rows "Confirm All Changes" is allowed to touch. A row with no value
  // typed in (still blank, i.e. never touched) is never included here, so
  // clicking the bulk button can't accidentally write a cost for a row the
  // admin skipped past.
  const costPendingRows = useMemo(() => missingCosts.filter(r => {
    const key = costKey(r);
    const cost = Number(costValue[key]);
    return Number.isFinite(cost) && cost > 0 && costStatus[key] !== 'done' && costStatus[key] !== 'saving';
  }), [missingCosts, costValue, costStatus]);

  const confirmAllCosts = useCallback(async () => {
    if (costPendingRows.length === 0) return;
    setCostBulkSaving(true);
    await Promise.all(costPendingRows.map(r => saveCost(r)));
    setCostBulkSaving(false);
  }, [costPendingRows, saveCost]);

  // ── Any-item/modifier cost entry (admin only) — not limited to flagged-missing
  // rows above; set a cost for any canonical name, any period. Item cost writes
  // to the same analytics.r365_item_cost as saveCost above; modifier cost is a
  // different table/shape (no bucket/menu concept) so it has its own endpoint.
  const [customKind,   setCustomKind]   = useState<'item' | 'modifier'>('item');
  const [customName,   setCustomName]   = useState('');
  const [customBucket, setCustomBucket] = useState<MissingCostRow['bucket']>('ih');
  const [customMenu,   setCustomMenu]   = useState(BUCKET_MENUS.ih[0]);
  const [customPeriod, setCustomPeriod] = useState(() => defaultPeriod ? toR365Period(defaultPeriod) : '');
  const [customValue,  setCustomValue]  = useState('');
  const [customStatus, setCustomStatus] = useState<'idle' | 'saving' | 'done' | 'error'>('idle');

  const saveCustomCost = useCallback(async () => {
    const cost = Number(customValue);
    if (!customName.trim() || !Number.isFinite(cost) || cost <= 0) {
      setCustomStatus('error');
      return;
    }
    setCustomStatus('saving');
    try {
      const res = customKind === 'item'
        ? await fetch('/api/costs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              canonical_name: customName.trim(), bucket: customBucket, menu: customMenu,
              period: customPeriod, avg_cost: cost,
            }),
          })
        : await fetch('/api/costs/modifier', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              canonical_name: customName.trim(), period: customPeriod, cost_per_portion: cost,
            }),
          });
      if (!res.ok) throw new Error(await res.text());
      setCustomStatus('done');
      setCustomName('');
      setCustomValue('');
    } catch {
      setCustomStatus('error');
    }
  }, [customKind, customName, customBucket, customMenu, customPeriod, customValue]);

  // ── Channel correction state ──────────────────────────────────────────────
  // channelDraft[order_guid] = selected channel value (not yet confirmed).
  // Pre-fills from a persisted override if one already exists (survives reload),
  // else falls back to the suggested channel.
  const [channelDraft,    setChannelDraft]    = useState<Record<string, string>>(() =>
    Object.fromEntries(needsReview.map(r => [r.order_guid, r.override_channel ?? r.suggested_channel]))
  );
  const [channelStatus,  setChannelStatus]   = useState<Record<string, 'idle' | 'saving' | 'done' | 'undoing' | 'error'>>({});
  const [channelEditing, setChannelEditing]  = useState<Set<string>>(new Set());
  // Marked only by the dropdown's own onChange — NOT pre-filled just because
  // channelDraft already holds the suggested channel as its default value.
  // "Confirm All Changes" must only ever touch orders the admin actually
  // interacted with; every other order is left exactly as the server has it.
  const [channelTouched, setChannelTouched]  = useState<Set<string>>(new Set());
  const [channelBulkSaving, setChannelBulkSaving] = useState(false);
  const [expandedOrders, setExpandedOrders]  = useState<Set<string>>(new Set());
  const toggleExpanded = (order_guid: string) =>
    setExpandedOrders(prev => {
      const n = new Set(prev);
      n.has(order_guid) ? n.delete(order_guid) : n.add(order_guid);
      return n;
    });

  // ── Item categorization state ─────────────────────────────────────────────
  const [catDraft,    setCatDraft]    = useState<Record<string, string>>({});
  const [subCatDraft, setSubCatDraft] = useState<Record<string, string>>({});
  const [grpDraft,    setGrpDraft]    = useState<Record<string, string>>({});
  const [itemStatus,  setItemStatus]  = useState<Record<string, 'idle' | 'saving' | 'done' | 'error'>>({});
  const [itemEditing, setItemEditing] = useState<Set<string>>(new Set());

  // ── Modifier categorization state ─────────────────────────────────────────
  const [modItemTypeDraft, setModItemTypeDraft] = useState<Record<string, string>>({});
  const [modTypeDraft,     setModTypeDraft]     = useState<Record<string, string>>({});
  const [modStatus,        setModStatus]        = useState<Record<string, 'idle' | 'saving' | 'done' | 'error'>>({});
  const [modEditing,       setModEditing]       = useState<Set<string>>(new Set());

  // ── Channel save — only ever touches THIS order's flagged line(s), never
  // the whole order, so already-correct lines (e.g. a Catering-3PD line sitting
  // next to a mistracked In-House one) are never rewritten. Returns success so
  // both the single-row and bulk confirm flows can share this without either
  // one reloading mid-batch. ──────────────────────────────────────────────────
  const saveChannelRow = useCallback(async (r: NeedsReviewRow) => {
    const channel = channelDraft[r.order_guid];
    if (!channel) return false;
    setChannelStatus(s => ({ ...s, [r.order_guid]: 'saving' }));
    try {
      const res = await fetch('/api/review/update-channel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_guid: r.order_guid,
          selection_guids: r.flagged_lines.map(l => l.selection_guid),
          channel,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setChannelStatus(s => ({ ...s, [r.order_guid]: 'done' }));
      return true;
    } catch {
      setChannelStatus(s => ({ ...s, [r.order_guid]: 'error' }));
      return false;
    }
  }, [channelDraft]);

  // Orders the admin actually changed the channel dropdown for (channelTouched)
  // AND that still have a pending draft to save — an order the admin never
  // touched keeps its suggested-channel default in channelDraft forever, but
  // is never in channelTouched, so "Confirm All Changes" can never pick it up.
  const channelPendingRows = useMemo(() => needsReview.filter(r =>
    channelTouched.has(r.order_guid) &&
    channelDraft[r.order_guid] &&
    channelStatus[r.order_guid] !== 'saving' &&
    (r.override_channel === null || channelEditing.has(r.order_guid))
  ), [needsReview, channelTouched, channelDraft, channelStatus, channelEditing]);

  const confirmAllChannels = useCallback(async () => {
    if (channelPendingRows.length === 0) return;
    setChannelBulkSaving(true);
    const results = await Promise.all(channelPendingRows.map(r => saveChannelRow(r)));
    setChannelBulkSaving(false);
    if (results.some(Boolean)) {
      setChannelEditing(new Set());
      window.location.reload();
    }
  }, [channelPendingRows, saveChannelRow]);

  // ── Channel undo — removes the override for THIS order's flagged line(s)
  // only, so those specific lines revert to whatever they naturally derive to
  // from menu_name (their pre-fix state). Other lines are untouched. ─────────
  const undoChannel = useCallback(async (r: NeedsReviewRow) => {
    setChannelStatus(s => ({ ...s, [r.order_guid]: 'undoing' }));
    try {
      const res = await fetch('/api/review/update-channel', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selection_guids: r.flagged_lines.map(l => l.selection_guid) }),
      });
      if (!res.ok) throw new Error(await res.text());
      window.location.reload();
    } catch {
      setChannelStatus(s => ({ ...s, [r.order_guid]: 'error' }));
    }
  }, []);

  // ── Item confirm ──────────────────────────────────────────────────────────
  const confirmItem = useCallback(async (canonical_name: string) => {
    const category     = catDraft[canonical_name];
    const sub_category = subCatDraft[canonical_name] ?? '';
    const menu_group    = grpDraft[canonical_name] ?? '';
    if (!category) return;
    setItemStatus(s => ({ ...s, [canonical_name]: 'saving' }));
    try {
      const res = await fetch('/api/review/categorize-item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canonical_name, category, sub_category, menu_group }),
      });
      if (!res.ok) throw new Error(await res.text());
      setItemStatus(s => ({ ...s, [canonical_name]: 'done' }));
      setItemEditing(prev => { const n = new Set(prev); n.delete(canonical_name); return n; });
    } catch {
      setItemStatus(s => ({ ...s, [canonical_name]: 'error' }));
    }
  }, [catDraft, subCatDraft, grpDraft]);

  // ── Modifier confirm ───────────────────────────────────────────────────────
  const confirmModifier = useCallback(async (modifier_name: string) => {
    const item_type    = modItemTypeDraft[modifier_name];
    const modifier_type = modTypeDraft[modifier_name] ?? '';
    if (!item_type) return;
    setModStatus(s => ({ ...s, [modifier_name]: 'saving' }));
    try {
      const res = await fetch('/api/review/categorize-modifier', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modifier_name, item_type, modifier_type }),
      });
      if (!res.ok) throw new Error(await res.text());
      setModStatus(s => ({ ...s, [modifier_name]: 'done' }));
      setModEditing(prev => { const n = new Set(prev); n.delete(modifier_name); return n; });
    } catch {
      setModStatus(s => ({ ...s, [modifier_name]: 'error' }));
    }
  }, [modItemTypeDraft, modTypeDraft]);

  // Persisted count (survives reload) — a session-local 'done' status only briefly
  // exists between save success and the reload that follows it.
  const doneChannels  = needsReview.filter(r => r.override_channel !== null).length;
  const doneItems     = Object.values(itemStatus).filter(s => s === 'done').length;
  const doneModifiers = Object.values(modStatus).filter(s => s === 'done').length;

  // ── CSV export (admin only) — exports whichever section is currently active ──
  function exportCSV() {
    let hdr: string, rows: string[], filename: string;
    if (section === 'channels') {
      // Only the flagged line(s) — what channel it's currently tagged as, what
      // it should be per the system's suggestion, and what the admin actually
      // chose (may differ from the suggestion if they picked something else).
      hdr = 'Order GUID,Location,Business Date,Flagged Item,Amount,What It Is (Current Channel),What It Should Be (Suggested),User\'s Preference (Chosen Channel)';
      rows = needsReview.flatMap(r => {
        const chosen = r.override_channel ?? channelDraft[r.order_guid] ?? '';
        return r.flagged_lines.map(l => {
          const amount = r.line_items.find(li => li.selection_guid === l.selection_guid)?.line_total ?? 0;
          return [
            r.order_guid, `"${r.location}"`, r.business_date, `"${l.canonical_name}"`, amount.toFixed(2),
            CHANNEL_LABEL[r.current_channel] ?? r.current_channel,
            CHANNEL_LABEL[r.suggested_channel] ?? r.suggested_channel,
            chosen ? (CHANNEL_LABEL[chosen] ?? chosen) : '',
          ].join(',');
        });
      });
      filename = 'needs-review-wrong-channel-orders.csv';
    } else {
      hdr = 'Canonical Name,Category,Menu Group,Bucket,Qty,Net Sales';
      rows = missingCosts.map(r => [
        `"${r.canonical_name}"`, `"${r.category}"`, `"${r.menu_group}"`, BUCKET_LABEL[r.bucket], r.qty, r.net_sales.toFixed(2),
      ].join(','));
      filename = 'needs-review-missing-costs.csv';
    }
    const blob = new Blob([[hdr, ...rows].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = filename; a.click();
  }

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
          {isAdmin && (
            <option value="items">
              Uncategorized Items ({uncategorizedItems.length}{doneItems > 0 ? ` · ${doneItems} fixed` : ''})
            </option>
          )}
          {isAdmin && (
            <option value="modifiers">
              Uncategorized Modifiers ({uncategorizedModifiers.length}{doneModifiers > 0 ? ` · ${doneModifiers} fixed` : ''})
            </option>
          )}
          {isAdmin && (
            <option value="costs">
              Missing R365 Costs ({missingCosts.length}{doneCosts > 0 ? ` · ${doneCosts} added` : ''})
            </option>
          )}
        </select>
        {isAdmin && (
          <button onClick={exportCSV} style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid rgba(124,58,237,0.2)', background: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer', color: 'var(--accent)', fontFamily: 'inherit' }}>
            ⬇ Export CSV
          </button>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 1 — Wrong-channel orders
      ══════════════════════════════════════════════════════════════════════ */}
      {section === 'channels' && (
        <>
          {needsReview.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>
              <i className="ti ti-check" style={{ fontSize: 28, opacity: 0.3, display: 'block' }} />
              <div style={{ marginTop: 8 }}>No excluded orders in this date range.</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {channelPendingRows.length > 0 && (
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '8px 12px', marginBottom: 2,
                  background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 8,
                }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)' }}>
                    {channelPendingRows.length} order{channelPendingRows.length !== 1 ? 's' : ''} changed, not yet confirmed
                    — every other order is left as-is
                  </span>
                  <button
                    disabled={channelBulkSaving}
                    onClick={confirmAllChannels}
                    style={{
                      padding: '5px 16px', borderRadius: 6, border: 'none',
                      background: 'var(--accent)', color: '#fff',
                      fontSize: 11, fontWeight: 700, cursor: 'pointer',
                      opacity: channelBulkSaving ? 0.6 : 1,
                    }}
                  >
                    {channelBulkSaving ? 'Saving…' : `✓ Confirm All Changes (${channelPendingRows.length})`}
                  </button>
                </div>
              )}
              {needsReview.map((r) => {
                const status    = channelStatus[r.order_guid] ?? 'idle';
                // Persisted (survives reload) — this is the real source of truth once the
                // page has reloaded after a save; the ephemeral 'done'/'undoing' statuses
                // only matter in the brief instant before that reload happens.
                const hasOverride = r.override_channel !== null;
                const isDone    = hasOverride || status === 'done';
                const isUndoing = status === 'undoing';
                const isEdit    = channelEditing.has(r.order_guid);
                const draft     = channelDraft[r.order_guid] ?? r.override_channel ?? r.suggested_channel;
                const updatedToChannel = r.override_channel ?? channelDraft[r.order_guid];
                // Which of this order's lines are actually the mistracked one(s) —
                // Confirm/Undo only ever touch these, never the rest of the order.
                const flaggedGuids = new Set(r.flagged_lines.map(l => l.selection_guid));
                const flaggedNames = [...new Set(r.flagged_lines.map(l => l.canonical_name))];
                // The actual $ that moves if you confirm — just the flagged line(s),
                // NOT the whole order's total (r.amount includes already-correct lines too).
                const flaggedAmount = r.line_items
                  .filter(li => flaggedGuids.has(li.selection_guid))
                  .reduce((s, li) => s + li.line_total, 0);

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
                            <i className="ti ti-check" /> Updated to {CHANNEL_LABEL[updatedToChannel] ?? updatedToChannel}
                          </span>
                        )}
                      </div>
                      <div className="nr-main">{r.location} · {r.business_date}</div>
                      <div className="nr-sub">
                        {r.item_count} item{r.item_count !== 1 ? 's' : ''} · {fmt$(r.amount)}
                      </div>
                      <div className="nr-hint">
                        <i className="ti ti-info-circle" style={{ fontSize: 9, marginRight: 3 }} />
                        Paid via <strong>{r.alt_payment_name || '(none)'}</strong>
                        {r.dining_option && r.dining_option !== r.alt_payment_name && <> · Dining option: <strong>{r.dining_option}</strong></>}
                        {' '}but {flaggedNames.length === 1
                          ? <><strong>{flaggedNames[0]}</strong> is</>
                          : <><strong>{r.flagged_lines.length} line{r.flagged_lines.length !== 1 ? 's' : ''}</strong> ({flaggedNames.join(', ')}) are</>
                        }
                        {' '}still marked <strong>In-House</strong> — should be <strong>{CHANNEL_LABEL[r.suggested_channel] ?? r.suggested_channel}</strong>.
                        {' '}Only {flaggedNames.length === 1 ? 'this line' : 'these lines'} will move — the rest of the order is untouched.
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                        <span style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'monospace' }}>
                          {r.order_guid}
                        </span>
                        <button
                          onClick={() => toggleExpanded(r.order_guid)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 3,
                            padding: 0, border: 'none', background: 'transparent',
                            fontSize: 10, fontWeight: 600, color: 'var(--accent)', cursor: 'pointer',
                          }}
                        >
                          <i className={`ti ti-chevron-${expandedOrders.has(r.order_guid) ? 'up' : 'down'}`} style={{ fontSize: 10 }} />
                          {expandedOrders.has(r.order_guid) ? 'Hide' : 'Show'} {r.line_items.length} line item{r.line_items.length !== 1 ? 's' : ''}
                        </button>
                      </div>

                      {/* Line-item detail — shows every line in the order for context, but
                          Confirm/Undo ONLY ever touch the specific flagged line(s) below
                          (matched by selection_guid, not by channel) — an order can have
                          several already-correct lines sitting right next to the mistracked
                          one(s), and those are never rewritten. */}
                      {expandedOrders.has(r.order_guid) && (
                        <div style={{
                          marginTop: 6, border: '1px solid var(--border)', borderRadius: 6,
                          overflow: 'hidden', fontSize: 10.5,
                        }}>
                          <div style={{
                            padding: '5px 8px', fontSize: 9.5, color: 'var(--muted)',
                            background: 'var(--bg)', borderBottom: '1px solid var(--border)',
                          }}>
                            Target if you confirm: <strong>{CHANNEL_LABEL[draft] ?? draft}</strong>
                            {' '}· <span style={{ color: '#991b1b' }}>red</span> = flagged, will move to it
                            {' '}· gray = not flagged, left as-is (even if its own channel looks different)
                          </div>
                          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                              <tr style={{ background: 'var(--bg)' }}>
                                <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 700, color: 'var(--muted)' }}>Item</th>
                                <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 700, color: 'var(--muted)' }}>Menu (raw)</th>
                                <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 700, color: 'var(--muted)' }}>Channel</th>
                                <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 700, color: 'var(--muted)' }}>Payment Method</th>
                                <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 700, color: 'var(--muted)' }}>Qty</th>
                                <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 700, color: 'var(--muted)' }}>Line Total</th>
                              </tr>
                            </thead>
                            <tbody>
                              {r.line_items.map((li, i) => {
                                // Flagged = this exact line (by selection_guid) is one of the
                                // mistracked ones Confirm/Undo will act on. NOT a channel
                                // comparison — a line can look "wrong" vs the target and still
                                // not be flagged (e.g. it's fine as Catering-3PD and was never
                                // part of the problem), and confirming must never touch it.
                                const isFlagged = flaggedGuids.has(li.selection_guid);
                                return (
                                  <tr key={li.selection_guid + i} style={{
                                    borderTop: '1px solid var(--border)',
                                    background: isFlagged ? 'rgba(220,38,38,0.06)' : undefined,
                                  }}>
                                    <td style={{ padding: '4px 8px', fontWeight: 600 }}>{li.canonical_name}</td>
                                    <td style={{ padding: '4px 8px', color: 'var(--muted)' }}>{li.menu_name ?? '(blank)'}</td>
                                    <td style={{ padding: '4px 8px' }}>
                                      <span style={{
                                        fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
                                        background: isFlagged ? '#fee2e2' : 'var(--border)',
                                        color: isFlagged ? '#991b1b' : 'var(--text)',
                                      }}>
                                        {CHANNEL_LABEL[li.channel] ?? li.channel}
                                      </span>
                                      {isFlagged && (
                                        <span style={{ marginLeft: 5, fontSize: 9, color: '#991b1b', fontWeight: 700 }}>
                                          → {CHANNEL_LABEL[draft] ?? draft}
                                        </span>
                                      )}
                                    </td>
                                    {/* Payment is captured per ORDER in Toast, not per line — same
                                        value repeats for every line of this order. This is exactly
                                        the evidence proving the flagged line(s) are mistracked (paid
                                        via a catering vendor while Toast still shows them In-House). */}
                                    <td style={{ padding: '4px 8px', color: 'var(--muted)' }}>{r.alt_payment_name || '—'}</td>
                                    <td style={{ padding: '4px 8px', textAlign: 'right' }}>{li.quantity}</td>
                                    <td style={{ padding: '4px 8px', textAlign: 'right' }}>{fmt$(li.line_total)}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {/* Action row */}
                      {(!isDone || isEdit) && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
                          <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>
                            Correct channel for {flaggedNames.length === 1 ? flaggedNames[0] : `${r.flagged_lines.length} flagged lines`}:
                          </span>
                          <select
                            className="fb-sel"
                            value={draft}
                            onChange={e => {
                              setChannelDraft(prev => ({ ...prev, [r.order_guid]: e.target.value }));
                              setChannelTouched(prev => new Set(prev).add(r.order_guid));
                            }}
                            style={{ fontSize: 11, padding: '3px 6px' }}
                          >
                            {ASSIGNABLE_CHANNELS.map(c => (
                              <option key={c.code} value={c.code}>{c.label}</option>
                            ))}
                          </select>
                          {status === 'saving' && (
                            <span style={{ fontSize: 10, color: 'var(--muted)' }}>Saving…</span>
                          )}
                          {status === 'error' && (
                            <span style={{ fontSize: 10, color: '#dc2626' }}>Save failed — try again</span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Edit / Undo buttons after done */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                      {/* The flagged line(s)' own $ — what actually moves — not the whole
                          order's total (r.amount), which includes already-correct lines. */}
                      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent)', minWidth: 70, textAlign: 'right' }}>
                        {fmt$(flaggedAmount)}
                      </div>
                      <div style={{ fontSize: 9, color: 'var(--muted)', textAlign: 'right' }}>
                        of {fmt$(r.amount)} order
                      </div>
                      {isDone && !isEdit && (
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button
                            disabled={isUndoing}
                            onClick={() => undoChannel(r)}
                            style={{
                              padding: '3px 10px', borderRadius: 5,
                              border: '1px solid #dc2626', background: 'transparent',
                              fontSize: 10, fontWeight: 600, cursor: 'pointer', color: '#dc2626',
                              opacity: isUndoing ? 0.6 : 1,
                            }}
                          >
                            {isUndoing ? 'Undoing…' : 'Undo'}
                          </button>
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
                        </div>
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
              <div className="tscroll">
                <table style={{ fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>#</th>
                      <th style={{ textAlign: 'left' }}>Item Name</th>
                      <th style={{ textAlign: 'left' }}>Channel</th>
                      <th>Qty</th>
                      <th>Revenue</th>
                      <th style={{ textAlign: 'left' }}>Category</th>
                      <th style={{ textAlign: 'left' }}>Sub-Category</th>
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
                      const subCat = subCatDraft[key] ?? '';
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

                          {/* Sub-Category cell */}
                          <td>
                            {isDone && !isEdit ? (
                              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{subCatDraft[key] || '—'}</span>
                            ) : (
                              <input
                                value={subCat}
                                onChange={e => setSubCatDraft(prev => ({ ...prev, [key]: e.target.value }))}
                                placeholder="optional"
                                style={{
                                  fontSize: 11, padding: '3px 6px', width: 100,
                                  border: '1px solid var(--border)', borderRadius: 5,
                                  background: 'var(--card)', color: 'var(--text)', fontFamily: 'inherit',
                                }}
                              />
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

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION — Uncategorized modifiers (admin only)
      ══════════════════════════════════════════════════════════════════════ */}
      {section === 'modifiers' && isAdmin && (
        <>
          <div className="info-banner" style={{
            background: 'rgba(249,115,22,0.08)', borderColor: '#f97316', marginBottom: 12,
          }}>
            <i className="ti ti-tag-off" style={{ color: '#f97316' }} />
            <div>
              <strong style={{ color: '#f97316' }}>{uncategorizedModifiers.length}</strong> modifiers
              aren&apos;t in <code>analytics.modifier_type</code> yet. Assign each an item type and
              confirm to save.
              {doneModifiers > 0 && <> <strong style={{ color: '#16a34a' }}>{doneModifiers} fixed.</strong></>}
              {' '}Type changes reach Pink Sheets / ME detail / BYO Breakdown on the next daily
              pipeline run (up to ~24h) — those three tabs read a precomputed layer, not this table
              directly.
            </div>
          </div>

          {uncategorizedModifiers.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>
              <i className="ti ti-check" style={{ fontSize: 28, opacity: 0.3, display: 'block' }} />
              <div style={{ marginTop: 8 }}>All modifiers are categorized.</div>
            </div>
          ) : (
            <div className="tw">
              <div className="tscroll">
                <table style={{ fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>#</th>
                      <th style={{ textAlign: 'left' }}>Modifier Name</th>
                      <th style={{ textAlign: 'left' }}>Channel</th>
                      <th>Qty</th>
                      <th>Revenue</th>
                      <th style={{ textAlign: 'left' }}>Item Type</th>
                      <th style={{ textAlign: 'left' }}>Modifier Type</th>
                      <th style={{ textAlign: 'left' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {uncategorizedModifiers.map((row, i) => {
                      const key      = row.modifier_name;
                      const status   = modStatus[key] ?? 'idle';
                      const isDone   = status === 'done';
                      const isEdit   = modEditing.has(key);
                      const itemType = modItemTypeDraft[key] ?? '';
                      const modType  = modTypeDraft[key] ?? '';

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
                            {row.modifier_name}
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

                          {/* Item Type cell */}
                          <td>
                            {isDone && !isEdit ? (
                              <span style={{ fontSize: 11, fontWeight: 700, color: '#16a34a' }}>
                                <i className="ti ti-check" /> {modItemTypeDraft[key]}
                              </span>
                            ) : (
                              <input
                                value={itemType}
                                onChange={e => setModItemTypeDraft(prev => ({ ...prev, [key]: e.target.value }))}
                                placeholder="e.g. BYO Grain Bowl - In House"
                                style={{
                                  fontSize: 11, padding: '3px 6px', width: 160,
                                  border: '1px solid var(--border)', borderRadius: 5,
                                  background: 'var(--card)', color: 'var(--text)', fontFamily: 'inherit',
                                }}
                              />
                            )}
                          </td>

                          {/* Modifier Type cell */}
                          <td>
                            {isDone && !isEdit ? (
                              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{modTypeDraft[key] || '—'}</span>
                            ) : (
                              <input
                                value={modType}
                                onChange={e => setModTypeDraft(prev => ({ ...prev, [key]: e.target.value }))}
                                placeholder="optional, e.g. Base"
                                style={{
                                  fontSize: 11, padding: '3px 6px', width: 120,
                                  border: '1px solid var(--border)', borderRadius: 5,
                                  background: 'var(--card)', color: 'var(--text)', fontFamily: 'inherit',
                                }}
                              />
                            )}
                          </td>

                          {/* Action cell */}
                          <td style={{ whiteSpace: 'nowrap' }}>
                            {isDone && !isEdit ? (
                              <button
                                onClick={() => setModEditing(prev => { const n = new Set(prev); n.add(key); return n; })}
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
                                  disabled={!itemType || status === 'saving'}
                                  onClick={() => confirmModifier(key)}
                                  style={{
                                    padding: '4px 12px', borderRadius: 5, border: 'none',
                                    background: itemType ? 'var(--accent)' : 'var(--border)',
                                    color: itemType ? '#fff' : 'var(--muted)',
                                    fontSize: 11, fontWeight: 700,
                                    cursor: itemType ? 'pointer' : 'not-allowed',
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
                {doneModifiers} of {uncategorizedModifiers.length} modifiers categorized · Changes saved to{' '}
                <code>analytics.modifier_type</code>
              </div>
            </div>
          )}
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 3 — Missing R365 costs (admin only)
      ══════════════════════════════════════════════════════════════════════ */}
      {section === 'costs' && isAdmin && (
        <>
          <div className="info-banner" style={{
            background: 'rgba(220,38,38,0.08)', borderColor: '#dc2626', marginBottom: 12,
          }}>
            <i className="ti ti-currency-dollar-off" style={{ color: '#dc2626' }} />
            <div>
              <strong style={{ color: '#dc2626' }}>{missingCosts.length}</strong> item × channel
              combinations have real sales but no matching cost in R365 — pick the menu/period and
              enter a cost to save it directly to <code>analytics.r365_item_cost</code>.
              {doneCosts > 0 && <> <strong style={{ color: '#16a34a' }}>{doneCosts} added.</strong></>}
            </div>
          </div>

          {/* Any item/modifier cost entry — not limited to the flagged-missing rows below */}
          <div className="tw" style={{ padding: 12, marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
              Set a cost for any item or modifier
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <select
                className="fb-sel"
                value={customKind}
                onChange={e => setCustomKind(e.target.value as 'item' | 'modifier')}
                style={{ fontSize: 11, padding: '4px 8px' }}
              >
                <option value="item">Item cost</option>
                <option value="modifier">Modifier cost</option>
              </select>
              <input
                value={customName}
                onChange={e => setCustomName(e.target.value)}
                placeholder="Canonical name"
                style={{
                  fontSize: 11, padding: '4px 8px', width: 200,
                  border: '1px solid var(--border)', borderRadius: 5,
                  background: 'var(--card)', color: 'var(--text)', fontFamily: 'inherit',
                }}
              />
              {customKind === 'item' && (
                <>
                  <select
                    className="fb-sel"
                    value={customBucket}
                    onChange={e => {
                      const b = e.target.value as MissingCostRow['bucket'];
                      setCustomBucket(b);
                      setCustomMenu(BUCKET_MENUS[b][0]);
                    }}
                    style={{ fontSize: 11, padding: '4px 8px' }}
                  >
                    {(Object.keys(BUCKET_MENUS) as MissingCostRow['bucket'][]).map(b => (
                      <option key={b} value={b}>{BUCKET_LABEL[b]}</option>
                    ))}
                  </select>
                  <select
                    className="fb-sel"
                    value={customMenu}
                    onChange={e => setCustomMenu(e.target.value)}
                    style={{ fontSize: 11, padding: '4px 8px' }}
                  >
                    {BUCKET_MENUS[customBucket].map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </>
              )}
              <select
                className="fb-sel"
                value={customPeriod}
                onChange={e => setCustomPeriod(e.target.value)}
                style={{ fontSize: 11, padding: '4px 8px' }}
              >
                {periods.map(p => (
                  <option key={p.label} value={toR365Period(p)}>{p.label}</option>
                ))}
              </select>
              <input
                type="number" step="0.01" min="0"
                value={customValue}
                onChange={e => setCustomValue(e.target.value)}
                placeholder="0.00"
                style={{
                  fontSize: 11, padding: '4px 8px', width: 80,
                  border: '1px solid var(--border)', borderRadius: 5,
                  background: 'var(--card)', color: 'var(--text)',
                }}
              />
              <button
                disabled={!customName.trim() || !customValue || customStatus === 'saving'}
                onClick={saveCustomCost}
                style={{
                  padding: '5px 14px', borderRadius: 5, border: 'none',
                  background: customName.trim() && customValue ? 'var(--accent)' : 'var(--border)',
                  color: customName.trim() && customValue ? '#fff' : 'var(--muted)',
                  fontSize: 11, fontWeight: 700,
                  cursor: customName.trim() && customValue ? 'pointer' : 'not-allowed',
                  opacity: customStatus === 'saving' ? 0.6 : 1,
                }}
              >
                {customStatus === 'saving' ? '…' : '✓ Save'}
              </button>
              {customStatus === 'done' && (
                <span style={{ fontSize: 10, color: '#16a34a', fontWeight: 700 }}><i className="ti ti-check" /> Saved</span>
              )}
              {customStatus === 'error' && (
                <span style={{ fontSize: 10, color: '#dc2626' }}>Failed — check name/cost</span>
              )}
            </div>
            {customKind === 'modifier' && (
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 6 }}>
                Modifier cost is live immediately wherever the dashboard reads it live (e.g. Menu
                Engineering); Pink Sheets / ME detail / BYO Breakdown read a precomputed layer and
                pick it up on the next daily pipeline run (up to ~24h).
              </div>
            )}
          </div>

          {missingCosts.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>
              <i className="ti ti-check" style={{ fontSize: 28, opacity: 0.3, display: 'block' }} />
              <div style={{ marginTop: 8 }}>No missing costs in this date range.</div>
            </div>
          ) : (
            <div className="tw">
              {costPendingRows.length > 0 && (
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '8px 12px', borderBottom: '1px solid var(--border)',
                  background: 'rgba(99,102,241,0.06)',
                }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)' }}>
                    {costPendingRows.length} cost{costPendingRows.length !== 1 ? 's' : ''} entered, not yet saved
                    — every row with no value typed in is left as-is
                  </span>
                  <button
                    disabled={costBulkSaving}
                    onClick={confirmAllCosts}
                    style={{
                      padding: '5px 16px', borderRadius: 6, border: 'none',
                      background: 'var(--accent)', color: '#fff',
                      fontSize: 11, fontWeight: 700, cursor: 'pointer',
                      opacity: costBulkSaving ? 0.6 : 1,
                    }}
                  >
                    {costBulkSaving ? 'Saving…' : `✓ Confirm All Changes (${costPendingRows.length})`}
                  </button>
                </div>
              )}
              <div className="tscroll">
                <table style={{ fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>#</th>
                      <th style={{ textAlign: 'left' }}>Item Name</th>
                      <th style={{ textAlign: 'left' }}>Category</th>
                      <th style={{ textAlign: 'left' }}>Menu Group</th>
                      <th style={{ textAlign: 'left' }}>Bucket</th>
                      <th>Qty</th>
                      <th>Net Sales</th>
                      <th style={{ textAlign: 'left' }}>Menu</th>
                      <th style={{ textAlign: 'left' }}>Period</th>
                      <th style={{ textAlign: 'left' }}>Avg Cost</th>
                      <th style={{ textAlign: 'left' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {missingCosts.map((r, i) => {
                      const key    = costKey(r);
                      const status = costStatus[key] ?? 'idle';
                      const isDone = status === 'done';
                      const menu   = costMenu[key]   ?? BUCKET_MENUS[r.bucket][0];
                      const period = costPeriod[key] ?? (defaultPeriod ? toR365Period(defaultPeriod) : '');
                      const value  = costValue[key]  ?? '';

                      return (
                        <tr key={key} style={{
                          background: isDone ? 'rgba(22,163,74,0.05)' : undefined,
                          borderLeft: isDone ? '3px solid #16a34a' : undefined,
                        }}>
                          <td style={{ color: 'var(--muted)', fontSize: 11 }}>{i + 1}</td>
                          <td style={{
                            fontWeight: 600, maxWidth: 200,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                            {r.canonical_name}
                          </td>
                          <td style={{ fontSize: 11, color: 'var(--muted)' }}>{r.category}</td>
                          <td style={{ fontSize: 11, color: 'var(--muted)' }}>{r.menu_group || '—'}</td>
                          <td>
                            <span style={{
                              fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                              background: 'var(--border)', color: 'var(--text)',
                            }}>
                              {BUCKET_LABEL[r.bucket]}
                            </span>
                          </td>
                          <td style={{ fontWeight: 600 }}>{r.qty.toLocaleString()}</td>
                          <td style={{ fontWeight: 600, color: 'var(--accent)' }}>{fmt$(r.net_sales)}</td>

                          {/* Menu */}
                          <td>
                            {isDone ? (
                              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{menu}</span>
                            ) : (
                              <select
                                className="fb-sel"
                                value={menu}
                                onChange={e => setCostMenu(prev => ({ ...prev, [key]: e.target.value }))}
                                style={{ fontSize: 11, padding: '3px 6px', minWidth: 120 }}
                              >
                                {BUCKET_MENUS[r.bucket].map(m => (
                                  <option key={m} value={m}>{m}</option>
                                ))}
                              </select>
                            )}
                          </td>

                          {/* Period */}
                          <td>
                            {isDone ? (
                              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{period}</span>
                            ) : (
                              <select
                                className="fb-sel"
                                value={period}
                                onChange={e => setCostPeriod(prev => ({ ...prev, [key]: e.target.value }))}
                                style={{ fontSize: 11, padding: '3px 6px', minWidth: 100 }}
                              >
                                {periods.map(p => (
                                  <option key={p.label} value={toR365Period(p)}>{p.label}</option>
                                ))}
                              </select>
                            )}
                          </td>

                          {/* Avg cost */}
                          <td>
                            {isDone ? (
                              <span style={{ fontSize: 11, fontWeight: 700, color: '#16a34a' }}>
                                <i className="ti ti-check" /> ${value}
                              </span>
                            ) : (
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={value}
                                onChange={e => setCostValue(prev => ({ ...prev, [key]: e.target.value }))}
                                placeholder="0.00"
                                style={{
                                  fontSize: 11, padding: '3px 6px', width: 70,
                                  border: '1px solid var(--border)', borderRadius: 5,
                                  background: 'var(--card)', color: 'var(--text)',
                                }}
                              />
                            )}
                          </td>

                          {/* Action */}
                          <td style={{ whiteSpace: 'nowrap' }}>
                            {isDone ? (
                              <span style={{ fontSize: 10, color: '#16a34a', fontWeight: 700 }}>Saved</span>
                            ) : (
                              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                <button
                                  disabled={!value || status === 'saving'}
                                  onClick={() => saveCost(r)}
                                  style={{
                                    padding: '4px 12px', borderRadius: 5, border: 'none',
                                    background: value ? 'var(--accent)' : 'var(--border)',
                                    color: value ? '#fff' : 'var(--muted)',
                                    fontSize: 11, fontWeight: 700,
                                    cursor: value ? 'pointer' : 'not-allowed',
                                    opacity: status === 'saving' ? 0.6 : 1,
                                  }}
                                >
                                  {status === 'saving' ? '…' : '✓ Save'}
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
                {doneCosts} of {missingCosts.length} costs added · Changes saved directly to{' '}
                <code>analytics.r365_item_cost</code>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
