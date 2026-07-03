'use client';
import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';

export default function LoginPage() {
  const router    = useRouter();
  const emailRef  = useRef<HTMLInputElement>(null);
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  useEffect(() => { emailRef.current?.focus(); }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res  = await fetch('/api/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Login failed');
      router.replace('/');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed');
      setLoading(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-logo-wrap">
        <div className="rasa-box" style={{ padding: '8px 14px' }}>
          <Image src="/rasa-logo.png" alt="RASA" width={120} height={39} style={{ height: 26, width: 'auto' }} priority />
        </div>
      </div>

      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-title">Product Mix Dashboard</div>
        <div className="login-sub" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          Sign in to continue · Powered by
          <Image src="/kutlerri-logo.png" alt="Kutlerri" width={160} height={54} style={{ height: 13, width: 'auto', filter: 'invert(1)' }} />
        </div>

        <label className="login-label" htmlFor="login-email">Email</label>
        <input
          id="login-email"
          ref={emailRef}
          type="email"
          className="login-input"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          autoComplete="email"
        />

        <label className="login-label" htmlFor="login-password">Password</label>
        <input
          id="login-password"
          type="password"
          className="login-input"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
          autoComplete="current-password"
        />

        {error && <div className="login-error">{error}</div>}

        <button type="submit" className="login-btn" disabled={loading}>
          {loading ? 'Signing in…' : 'Sign In'}
        </button>
      </form>

      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 8 }}>
        Kutlerri Analytics · RASA PMix
      </div>
    </div>
  );
}
