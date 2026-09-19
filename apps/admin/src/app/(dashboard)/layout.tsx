import Link from 'next/link';
import { getIdentity } from '@canteza/api';
import { BRAND } from '@canteza/shared';
import { createServerSupabase } from '@/lib/supabase/server';
import { SignOutButton } from '@/app/sign-out-button';

/**
 * The signed-in admin shell. `(dashboard)` is a route group, so it adds nothing to a
 * URL — `(dashboard)/page.tsx` is still `/`. It exists so the identity check and the
 * navigation are written once instead of at the top of every page.
 *
 * The role check below is a courtesy message, not a gate: `proxy.ts` decides whether
 * there is a session at all, and RLS decides what any session can read. A canteen
 * account that reached this URL would see its own rows and nothing else.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabase();
  const identity = await getIdentity(supabase);

  if (!identity) {
    return (
      <main className="shell">
        <p className="muted">Not signed in.</p>
      </main>
    );
  }

  if (identity.role !== 'admin') {
    return (
      <main className="shell">
        <div className="card">
          <h2>This dashboard is for admins</h2>
          <p className="muted">
            You are signed in as a {identity.role}. Use the {BRAND.name} mobile app for that role.
          </p>
          <SignOutButton />
        </div>
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <span className="badge">ADMIN</span>
          <h1 style={{ marginTop: 8 }}>{BRAND.name}</h1>
          <p className="muted">{identity.profile.full_name || identity.email}</p>
        </div>
        <SignOutButton />
      </header>

      <nav className="nav">
        <Link href="/">Overview</Link>
        <Link href="/orders">Orders</Link>
        <Link href="/canteens">Canteens</Link>
      </nav>

      {children}
    </main>
  );
}
