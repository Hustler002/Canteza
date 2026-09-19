'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signIn } from '@campuseats/api';
import { BRAND, toAppError } from '@campuseats/shared';
import { createClientSupabase } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(createClientSupabase(), { email, password });
      // The server decides whether this account is actually an admin.
      router.replace('/');
      router.refresh();
    } catch (err) {
      setError(toAppError(err).userMessage);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="center">
      <form className="login" onSubmit={onSubmit}>
        <div>
          <h1>{BRAND.name}</h1>
          <p className="muted">Admin dashboard</p>
        </div>

        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        {error ? <p className="error">{error}</p> : null}

        <button className="button" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
