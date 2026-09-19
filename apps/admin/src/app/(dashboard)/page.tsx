import Link from 'next/link';
import { formatPaise } from '@canteza/shared';
import { createServerSupabase } from '@/lib/supabase/server';

/**
 * Admin overview.
 *
 * Every number here is a real, RLS-scoped query. An admin sees the whole platform
 * because their profile says so — not because this page is privileged. The layout
 * has already established that the viewer is an admin.
 */
export default async function DashboardPage() {
  const supabase = await createServerSupabase();

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
    <>
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
          <Link href="/orders">Orders</Link> is live: search, filter and the full status trail.
          Still to come in Phase 6 — canteens, delivery staff, students and hostels, and the
          analytics breakdown. The data and the permissions for all of it already exist.
        </p>
      </section>
    </>
  );
}
