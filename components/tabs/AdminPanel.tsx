'use client';
import { useEffect, useState } from 'react';

type UserRole = 'admin' | 'tester' | 'user';

interface UserRow {
  email: string;
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
  prefillEmail, prefillRole, isEdit, onClose, onDone,
}: {
  prefillEmail?: string; prefillRole?: UserRole; isEdit: boolean;
  onClose: () => void; onDone: () => void;
}) {
  const [email, setEmail]       = useState(prefillEmail ?? '');
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
        body: JSON.stringify({ email: email.trim(), password: password || undefined, role }),
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

export default function AdminPanel({ currentEmail }: { currentEmail: string | null }) {
  const [users, setUsers]       = useState<UserRow[] | null>(null);
  const [error, setError]       = useState('');
  const [modal, setModal]       = useState<{ email?: string; role?: UserRole; isEdit: boolean } | null>(null);

  const load = () => {
    fetch('/api/admin/users')
      .then(res => res.json())
      .then(d => { if (d.error) throw new Error(d.error); setUsers(d.users); })
      .catch(e => setError(e.message));
  };

  useEffect(load, []);

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
                  {['Email', 'Role', 'Password', 'Actions'].map(h => (
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
                    <td style={{ padding: '10px 10px' }}><Badge role={u.role} /></td>
                    <td style={{ padding: '10px 10px' }}><PasswordCell email={u.email} /></td>
                    <td style={{ padding: '10px 10px' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          onClick={() => setModal({ email: u.email, role: u.role, isEdit: true })}
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
    </div>
  );
}
