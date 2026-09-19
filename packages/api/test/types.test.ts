import { describe, expectTypeOf, it } from 'vitest';
import type { Insert, Row } from '@canteza/shared';
import type { CampusClient } from '../src/client';
import type { Identity } from '../src/auth';

/**
 * Compile-time tests. They exist because the generated types silently degraded to
 * `never` once already: `unwrap` had a union parameter that collapsed inference, and
 * every query through it lost its type while still compiling.
 */
describe('generated database types', () => {
  it('gives orders its real money columns as numbers', () => {
    expectTypeOf<Row<'orders'>['total_paise']>().toEqualTypeOf<number>();
    expectTypeOf<Row<'orders'>['platform_fee_paise']>().toEqualTypeOf<number>();
    expectTypeOf<Row<'orders'>['status']>().toEqualTypeOf<string>();
  });

  it('marks nullable columns nullable and required columns required', () => {
    expectTypeOf<Row<'orders'>['delivery_partner_id']>().toEqualTypeOf<string | null>();
    expectTypeOf<Row<'orders'>['room']>().toEqualTypeOf<string>();
  });

  it('knows delivery_partners is canteen-scoped (ADR 008)', () => {
    expectTypeOf<Row<'delivery_partners'>['canteen_id']>().toEqualTypeOf<string>();
    expectTypeOf<Row<'delivery_partners'>['is_active']>().toEqualTypeOf<boolean>();
  });

  it('maps text[] to string[], not unknown', () => {
    expectTypeOf<Row<'hostels'>['blocks']>().toEqualTypeOf<string[]>();
  });

  it('makes defaulted columns optional on insert but keeps required ones required', () => {
    expectTypeOf<Insert<'reviews'>>().toHaveProperty('order_id');
    expectTypeOf<Insert<'reviews'>['created_at']>().toEqualTypeOf<string | undefined>();
  });

  it('exposes the view the student home screen reads', () => {
    expectTypeOf<Row<'canteens_public'>['is_open']>().toEqualTypeOf<boolean | null>();
  });

  it('types a real query rather than degrading to never or any', () => {
    type Query = ReturnType<
      ReturnType<CampusClient['from']> extends { select: infer S }
        ? S extends (...args: never[]) => unknown
          ? S
          : never
        : never
    >;
    expectTypeOf<Query>().not.toBeNever();
    expectTypeOf<Identity['role']>().toEqualTypeOf<'student' | 'canteen' | 'delivery' | 'admin'>();
    expectTypeOf<Identity['canteenId']>().toEqualTypeOf<string | null>();
  });
});
