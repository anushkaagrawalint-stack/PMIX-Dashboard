'use client';
import { useEffect, useState } from 'react';
import { TAB_META } from '@/lib/tabsMeta';

type UserRole = 'admin' | 'tester' | 'user';
type GovernedRole = 'admin' | 'user';

interface UserRow {
  email: string;
  name: string | null;
  role: UserRole;
  created_at: string;
}

const card: React.CSSProperties = {
  background: 'var(--card)', borderRadius: 12, border: '1px solid var(--border)',
  padding: '20px 24px', boxShadow: 'var(--shadow)',
};
const inp: React.CSSProperties = {
  background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8,
  padding: '8px 12px', fontSize: 13, width: '100%', boxSizing: 'border-box',
  fontFamily: 'inherit', color: 'var(--text)',
};
const lbl: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase',
  display: 'block', marginBottom: 4,
};
const btn = (bg: string, color = '#fff'): React.CSSProperties => ({
  background: bg, color, border: 'none', borderRadius: 8, padding: '8px 18px',
  fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
});

const ROLE_COLORS: Record<UserRole, [string, string]> = {
  admin:  ['#ede9fe', '#7c3aed'],
  tester: ['#fef3c7', '#92400e'],
  user:   ['#f3f4f6', '#6b7280'],
};

function Badge({ role }: { role: UserRole }) {
  const [bg, fg] = ROLE_COLORS[role] ?? ROLE_COLORS.user;
  return (
    <span style={{ background: bg, color: fg, fontSize: 11, fontWeight: 700, borderRadius: 4, padding: '2px 8px' }}>
      {role}
    </span>
  );
}

// ── Password cell — reveals one user's current password on demand ─────────
function PasswordCell({ email }: { email: string }) {
  const [state, setState] = useState<'hidden' | 'loading' | 'shown' | 'unavailable'>('hidden');
  const [password, setPassword] = useState('');

  async function reveal() {
    setState('loading');
    try {
      const res = await fetch('/api/admin/users/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) { setState('unavailable'); return; }
      setPassword(data.password);
      setState('shown');
    } catch {
      setState('unavailable');
    }
  }

  if (state === 'shown') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text)' }}>{password}</span>
        <button
          onClick={() => setState('hidden')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--muted)', display: 'flex' }}
          aria-label="Hide password"
        >
          <i className="ti ti-eye-off" style={{ fontSize: 14 }} aria-hidden="true" />
        </button>
      </div>
    );
  }

  if (state === 'unavailable') {
    return <span style={{ fontSize: 11, color: 'var(--muted)', fontStyle: 'italic' }}>Reset required</span>;
  }

  return (
    <button
      onClick={reveal}
      disabled={state === 'loading'}
      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}
      aria-label="Show password"
    >
      <i className="ti ti-eye" style={{ fontSize: 14 }} aria-hidden="true" />
      {state === 'loading' ? '…' : '••••••••'}
    </button>
  );
}

// ── Add / Edit user modal ──────────────────────────────────────────────────
function UserModal({
  prefillEmail, prefillName, prefillRole, isEdit, onClose, onDone,
}: {
  prefillEmail?: string; prefillName?: string | null; prefillRole?: UserRole; isEdit: boolean;
  onClose: () => void; onDone: () => void;
}) {
  const [email, setEmail]       = useState(prefillEmail ?? '');
  const [name, setName]         = useState(prefillName ?? '');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw]     = useState(false);
  const [role, setRole]         = useState<UserRole>(prefillRole ?? 'user');
  const [busy, setBusy]         = useState(false);
  const [msg, setMsg]           = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg('');
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password: password || undefined, role, name: name.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save user');
      setMsg(isEdit ? 'Updated.' : 'User added.');
      setTimeout(() => { onDone(); onClose(); }, 700);
    } catch (err) {
      setMsg('Error: ' + (err instanceof Error ? err.message : String(err)));
      setBusy(false);
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: 'var(--card)', borderRadius: 16, padding: 28, width: 400,
        boxShadow: '0 8px 40px rgba(0,0,0,0.25)', fontFamily: 'inherit',
      }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 18, color: 'var(--text)' }}>
          {isEdit ? 'Edit User' : 'Add New User'}
        </div>
        <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
          <div>
            <label style={lbl}>Email</label>
            <input
              style={{ ...inp, opacity: isEdit ? 0.7 : 1 }}
              value={email} onChange={e => setEmail(e.target.value)}
              placeholder="user@example.com" readOnly={isEdit}
            />
          </div>
          <div>
            <label style={lbl}>Name</label>
            <input
              style={inp}
              value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. your name"
            />
          </div>
          <div>
            <label style={lbl}>
              Password {isEdit && <span style={{ fontWeight: 400, textTransform: 'none' }}>(leave blank to keep current)</span>}
            </label>
            <div style={{ position: 'relative' }}>
              <input
                style={{ ...inp, paddingRight: 36 }} type={showPw ? 'text' : 'password'} value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={isEdit ? 'Leave blank to keep unchanged' : 'Min 6 characters'}
              />
              <button
                type="button"
                onClick={() => setShowPw(s => !s)}
                aria-label={showPw ? 'Hide password' : 'Show password'}
                style={{
                  position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer', padding: 4,
                  color: 'var(--muted)', display: 'flex', alignItems: 'center',
                }}
              >
                <i className={`ti ${showPw ? 'ti-eye-off' : 'ti-eye'}`} style={{ fontSize: 15 }} aria-hidden="true" />
              </button>
            </div>
          </div>
          <div>
            <label style={lbl}>Role</label>
            <select style={inp} value={role} onChange={e => setRole(e.target.value as UserRole)}>
              <option value="user">User — can view dashboard</option>
              <option value="tester">Tester — full access (temporary, same as admin)</option>
              <option value="admin">Admin — full access + admin panel</option>
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              type="submit"
              disabled={busy || !email.trim() || (!isEdit && !password)}
              style={{ ...btn('#7c3aed'), opacity: busy ? 0.7 : 1 }}
            >
              {busy ? 'Saving…' : isEdit ? 'Update' : 'Add User'}
            </button>
            <button type="button" onClick={onClose} style={btn('#e5e7eb', '#374151')}>Cancel</button>
            {msg && <span style={{ fontSize: 12, color: msg.startsWith('Error') ? '#dc2626' : '#16a34a' }}>{msg}</span>}
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Tab access — which tabs each governed role (admin, user) can see ───────
// Tester itself is never shown here: it always sees every tab, unconditionally.
// Checking/unchecking a box only edits the local working copy — nothing is
// sent to the server until "Confirm" is clicked, so a misclick doesn't
// instantly change what a real admin/user account can see.
function TabToggleGrid({
  label, permissions, saved, onChange, onConfirm, onCancel, saving,
}: {
  label: string;
  permissions: Record<string, boolean>;
  saved: Record<string, boolean>;
  onChange: (tabId: string, visible: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const dirty = TAB_META.some(t => (permissions[t.id] !== false) !== (saved[t.id] !== false));
  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>
          Tabs visible to {label}
        </div>
        {dirty && <span style={{ fontSize: 11, color: '#d97706', fontWeight: 600 }}>Unsaved changes</span>}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {dirty && !saving && (
            <button onClick={onCancel} style={{ ...btn('#e5e7eb', '#374151'), padding: '6px 16px', fontSize: 12 }}>
              Cancel
            </button>
          )}
          <button
            onClick={onConfirm}
            disabled={!dirty || saving}
            style={{
              ...btn('#059669'), padding: '6px 16px', fontSize: 12,
              opacity: (!dirty || saving) ? 0.5 : 1,
              cursor: (!dirty || saving) ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Saving…' : 'Confirm'}
          </button>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
        {TAB_META.map(t => {
          const visible = permissions[t.id] !== false;
          return (
            <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text)', cursor: 'pointer' }}>
              <input type="checkbox" checked={visible} onChange={e => onChange(t.id, e.target.checked)} />
              <i className={`ti ${t.icon}`} style={{ fontSize: 14, color: 'var(--muted)' }} aria-hidden="true" />
              {t.label}
            </label>
          );
        })}
      </div>
    </div>
  );
}

// ── Location status — which locations are Open vs Closed ───────────────────
// Tester-only feature (owner request 2026-07-13): not shown to admin or user at
// all. Drives the "Open Locations" quick-select that appears in the location
// dropdowns, tester-view-only, wherever they exist in the dashboard. Same
// edit-locally-then-Confirm pattern as the tab-access grid above.
interface LocationStatusRow { location_code: string; display_name: string }

function LocationStatusGrid({
  locations, statuses, saved, onChange, onConfirm, onCancel, saving,
}: {
  locations: LocationStatusRow[];
  statuses: Record<string, boolean>;
  saved: Record<string, boolean>;
  onChange: (locationCode: string, isOpen: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const dirty = locations.some(l => (statuses[l.location_code] !== false) !== (saved[l.location_code] !== false));
  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>Open / Closed Locations</div>
        {dirty && <span style={{ fontSize: 11, color: '#d97706', fontWeight: 600 }}>Unsaved changes</span>}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {dirty && !saving && (
            <button onClick={onCancel} style={{ ...btn('#e5e7eb', '#374151'), padding: '6px 16px', fontSize: 12 }}>
              Cancel
            </button>
          )}
          <button
            onClick={onConfirm}
            disabled={!dirty || saving}
            style={{
              ...btn('#059669'), padding: '6px 16px', fontSize: 12,
              opacity: (!dirty || saving) ? 0.5 : 1,
              cursor: (!dirty || saving) ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Saving…' : 'Confirm'}
          </button>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
        {locations.map(l => {
          const isOpen = statuses[l.location_code] !== false;
          return (
            <label key={l.location_code} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text)', cursor: 'pointer' }}>
              <input type="checkbox" checked={isOpen} onChange={e => onChange(l.location_code, e.target.checked)} />
              {l.display_name}
              <span style={{ fontSize: 10, fontWeight: 700, color: isOpen ? '#16a34a' : '#dc2626' }}>
                {isOpen ? 'OPEN' : 'CLOSED'}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

export default function AdminPanel({ currentEmail, currentRole }: { currentEmail: string | null; currentRole: UserRole }) {
  const [users, setUsers]       = useState<UserRow[] | null>(null);
  const [error, setError]       = useState('');
  const [modal, setModal]       = useState<{ email?: string; name?: string | null; role?: UserRole; isEdit: boolean } | null>(null);

  // `permissions` is the local working copy the checkboxes edit; `saved` is the
  // last-confirmed-with-the-server snapshot, used to detect unsaved changes and
  // to revert on Cancel or a rejected save.
  const [permissions, setPermissions] = useState<Record<GovernedRole, Record<string, boolean>> | null>(null);
  const [saved, setSaved]             = useState<Record<GovernedRole, Record<string, boolean>> | null>(null);
  const [permError, setPermError]     = useState('');
  const [saving, setSaving]           = useState<Record<GovernedRole, boolean>>({ admin: false, user: false });

  // Location status — tester-only, not fetched at all for admin/user (the API
  // would 403 anyway, but there's no reason to even ask).
  const [locations, setLocations]           = useState<LocationStatusRow[] | null>(null);
  const [locStatuses, setLocStatuses]       = useState<Record<string, boolean> | null>(null);
  const [locSaved, setLocSaved]             = useState<Record<string, boolean> | null>(null);
  const [locError, setLocError]             = useState('');
  const [locSaving, setLocSaving]           = useState(false);

  const load = () => {
    fetch('/api/admin/users')
      .then(res => res.json())
      .then(d => { if (d.error) throw new Error(d.error); setUsers(d.users); })
      .catch(e => setError(e.message));
  };

  const loadPermissions = () => {
    fetch('/api/admin/tab-permissions')
      .then(res => res.json())
      .then(d => { if (d.error) throw new Error(d.error); setPermissions(d.permissions); setSaved(d.permissions); })
      .catch(e => setPermError(e.message));
  };

  const loadLocationStatus = () => {
    fetch('/api/admin/location-status')
      .then(res => res.json())
      .then(d => {
        if (d.error) throw new Error(d.error);
        const locs: LocationStatusRow[] = d.locations.map((l: { location_code: string; display_name: string }) => ({
          location_code: l.location_code, display_name: l.display_name,
        }));
        const statusMap: Record<string, boolean> = {};
        for (const l of d.locations) statusMap[l.location_code] = l.is_open;
        setLocations(locs);
        setLocStatuses(statusMap);
        setLocSaved(statusMap);
      })
      .catch(e => setLocError(e.message));
  };

  useEffect(load, []);
  useEffect(loadPermissions, []);
  useEffect(() => { if (currentRole === 'tester' || currentRole === 'admin') loadLocationStatus(); }, [currentRole]);

  // Just edits the local working copy — nothing is sent to the server yet.
  function editPermission(role: GovernedRole, tabId: string, visible: boolean) {
    setPermissions(p => p ? { ...p, [role]: { ...p[role], [tabId]: visible } } : p);
  }

  function cancelPermission(role: GovernedRole) {
    setPermissions(p => (p && saved) ? { ...p, [role]: saved[role] } : p);
  }

  // Sends only the tabs that actually changed since the last confirmed save.
  async function confirmPermission(role: GovernedRole) {
    if (!permissions || !saved) return;
    const changed = TAB_META.filter(t => (permissions[role][t.id] !== false) !== (saved[role][t.id] !== false));
    if (changed.length === 0) return;

    setSaving(s => ({ ...s, [role]: true }));
    try {
      for (const t of changed) {
        const visible = permissions[role][t.id] !== false;
        const res = await fetch('/api/admin/tab-permissions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role, tab_id: t.id, visible }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to update');
      }
      setSaved(s => s ? { ...s, [role]: permissions[role] } : s);
    } catch (err) {
      alert('Error: ' + (err instanceof Error ? err.message : String(err)));
      loadPermissions(); // out of sync with the server — refetch the real state
    } finally {
      setSaving(s => ({ ...s, [role]: false }));
    }
  }

  function editLocationStatus(locationCode: string, isOpen: boolean) {
    setLocStatuses(s => s ? { ...s, [locationCode]: isOpen } : s);
  }

  function cancelLocationStatus() {
    setLocStatuses(locSaved);
  }

  async function confirmLocationStatus() {
    if (!locations || !locStatuses || !locSaved) return;
    const changed = locations.filter(l => (locStatuses[l.location_code] !== false) !== (locSaved[l.location_code] !== false));
    if (changed.length === 0) return;

    setLocSaving(true);
    try {
      for (const l of changed) {
        const is_open = locStatuses[l.location_code] !== false;
        const res = await fetch('/api/admin/location-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ location_code: l.location_code, is_open }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to update');
      }
      setLocSaved(locStatuses);
    } catch (err) {
      alert('Error: ' + (err instanceof Error ? err.message : String(err)));
      loadLocationStatus(); // out of sync with the server — refetch the real state
    } finally {
      setLocSaving(false);
    }
  }

  async function deleteUser(email: string) {
    if (!confirm(`Delete ${email}? This cannot be undone.`)) return;
    try {
      const res = await fetch('/api/admin/users', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      load();
    } catch (err) {
      alert('Error: ' + (err instanceof Error ? err.message : String(err)));
    }
  }

  return (
    <div>
      {modal && (
        <UserModal
          prefillEmail={modal.email}
          prefillName={modal.name}
          prefillRole={modal.role}
          isEdit={modal.isEdit}
          onClose={() => setModal(null)}
          onDone={load}
        />
      )}

      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16, gap: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>User Management</div>
        <button onClick={() => setModal({ isEdit: false })} style={{ ...btn('#059669'), marginLeft: 'auto' }}>
          + Add User
        </button>
        <button onClick={load} style={btn('#6b7280')}>Refresh</button>
      </div>

      {error && <div style={{ color: '#dc2626', padding: 10, marginBottom: 10 }}>{error}</div>}

      {!users ? (
        <div style={{ color: 'var(--muted)', padding: 20 }}>Loading users…</div>
      ) : (
        <div style={card}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14, color: 'var(--text)' }}>
            All Users ({users.length})
          </div>
          {users.length === 0 ? (
            <div style={{ color: 'var(--muted)', fontSize: 13 }}>No users found.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border)' }}>
                  {['Email', 'Name', 'Role', 'Password', 'Actions'].map(h => (
                    <th key={h} style={{
                      textAlign: 'left', padding: '6px 10px', fontSize: 11, fontWeight: 700,
                      color: 'var(--muted)', textTransform: 'uppercase',
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.email} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px 10px', fontWeight: 500, color: 'var(--text)' }}>{u.email}</td>
                    <td style={{ padding: '10px 10px', color: u.name ? 'var(--text)' : 'var(--muted)', fontStyle: u.name ? 'normal' : 'italic' }}>
                      {u.name ?? 'Not set'}
                    </td>
                    <td style={{ padding: '10px 10px' }}><Badge role={u.role} /></td>
                    <td style={{ padding: '10px 10px' }}><PasswordCell email={u.email} /></td>
                    <td style={{ padding: '10px 10px' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          onClick={() => setModal({ email: u.email, name: u.name, role: u.role, isEdit: true })}
                          style={{ ...btn('#2563eb'), padding: '4px 12px', fontSize: 12, borderRadius: 6 }}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => deleteUser(u.email)}
                          disabled={currentEmail !== null && u.email === currentEmail}
                          style={{
                            ...btn('#dc2626'), padding: '4px 12px', fontSize: 12, borderRadius: 6,
                            opacity: currentEmail === u.email ? 0.4 : 1,
                            cursor: currentEmail === u.email ? 'not-allowed' : 'pointer',
                          }}
                          title={currentEmail === u.email ? "You can't delete your own account" : undefined}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div style={{ marginTop: 28 }}>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16, color: 'var(--text)' }}>Tab Access</div>
        {permError && <div style={{ color: '#dc2626', padding: 10, marginBottom: 10 }}>{permError}</div>}
        {!permissions || !saved ? (
          <div style={{ color: 'var(--muted)', padding: 20 }}>Loading tab permissions…</div>
        ) : (
          <div style={{ display: 'grid', gap: 16 }}>
            {currentRole === 'tester' && (
              <TabToggleGrid
                label="Admin"
                permissions={permissions.admin}
                saved={saved.admin}
                saving={saving.admin}
                onChange={(tabId, visible) => editPermission('admin', tabId, visible)}
                onConfirm={() => confirmPermission('admin')}
                onCancel={() => cancelPermission('admin')}
              />
            )}
            <TabToggleGrid
              label="User"
              permissions={permissions.user}
              saved={saved.user}
              saving={saving.user}
              onChange={(tabId, visible) => editPermission('user', tabId, visible)}
              onConfirm={() => confirmPermission('user')}
              onCancel={() => cancelPermission('user')}
            />
          </div>
        )}
      </div>

      {(currentRole === 'tester' || currentRole === 'admin') && (
        <div style={{ marginTop: 28 }}>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16, color: 'var(--text)' }}>Location Status</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
            Available to admin and tester. Drives the &quot;Open Locations&quot; quick-select in the location dropdowns.
          </div>
          {locError && <div style={{ color: '#dc2626', padding: 10, marginBottom: 10 }}>{locError}</div>}
          {!locations || !locStatuses || !locSaved ? (
            <div style={{ color: 'var(--muted)', padding: 20 }}>Loading location status…</div>
          ) : (
            <LocationStatusGrid
              locations={locations}
              statuses={locStatuses}
              saved={locSaved}
              saving={locSaving}
              onChange={editLocationStatus}
              onConfirm={confirmLocationStatus}
              onCancel={cancelLocationStatus}
            />
          )}
        </div>
      )}
    </div>
  );
}
