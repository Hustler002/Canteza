import { getIdentity } from '@campuseats/api';
import { BRAND, formatPaise } from '@campuseats/shared';
import { createServerSupabase } from '@/lib/supabase/server';
import { SignOutButton } from './sign-out-button';

/**
 * Admin overview.
 *
 * Every number here is a real, RLS-scoped query. An admin sees the whole platform
 * because their profile says so — not because this page is privileged. A canteen
 * account that reached this URL would see its own canteen's rows and nothing else,
 * which is why the role check below is a courtesy message rather than a gate.
 */
export default async function DashboardPage() {
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

  const [orders, students, canteens, partners, revenue] = await Promise.all([
    supabase.from('orders').select('id', { count: 'exact', head: true }),
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'student'),
    supabase.from('canteens').select('id', { count: 'exact', head: true }).eq('is_active', true),
    supabase
      .from('delivery_partners')
      .select('profile_id', { count: 'exact', head: true })
      .eq('is_active', true),
    supabase.from('orders').select('platform_fee_paise').eq('status', 'delivered'),
  ]);

  // Our revenue is the platform's slice of the delivery fee on delivered orders.
  // The canteen keeps the food subtotal in full (ADR 008).
  const platformRevenue = (revenue.data ?? []).reduce(
    (sum, row) => sum + row.platform_fee_paise,
    0,
  );

  const stats: Array<{ label: string; value: string }> = [
    { label: 'Orders', value: String(orders.count ?? 0) },
    { label: 'Students', value: String(students.count ?? 0) },
    { label: 'Active canteens', value: String(canteens.count ?? 0) },
    { label: 'Delivery staff', value: String(partners.count ?? 0) },
    { label: 'Platform revenue', value: formatPaise(platformRevenue) },
  ];

  return (
    <main className="shell">
      <header
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}
      >
        <div>
          <span className="badge">ADMIN</span>
          <h1 style={{ marginTop: 8 }}>{BRAND.name}</h1>
          <p className="muted">{identity.profile.full_name || identity.email}</p>
        </div>
        <SignOutButton />
      </header>

      <section className="grid">
        {stats.map((stat) => (
          <div className="card" key={stat.label}>
            <span className="muted">{stat.label}</span>
            <span className="stat">{stat.value}</span>
          </div>
        ))}
      </section>

      <section className="card">
        <h2>Next</h2>
        <p className="muted">
          Phase 6 fills this in: order search and filtering, student and canteen management,
          delivery staff onboarding, hostels, complaints and analytics. The data and the permissions
          for all of it already exist — these counts prove the connection works.
        </p>
      </section>
    </main>
  );
}
