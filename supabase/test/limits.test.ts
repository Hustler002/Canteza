import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isHttpsUrl, TEXT_LIMITS } from '@canteza/shared';
import { createTestDb, type Db } from './harness';

/**
 * The forms and the database must stop text at the same length, or a form lets the user
 * type something the save then refuses with "Something went wrong". The database copy is
 * authoritative; this pins the form copy to it.
 */

const MIGRATION = readFileSync(
  fileURLToPath(new URL('../migrations/20260929120000_security_hardening.sql', import.meta.url)),
  'utf8',
);

const CONSTRAINTS: Record<string, keyof typeof TEXT_LIMITS> = {
  profiles_full_name_len: 'fullName',
  profiles_phone_len: 'phone',
  profiles_default_block_len: 'block',
  profiles_default_room_len: 'room',
  orders_block_len: 'block',
  orders_room_len: 'room',
  orders_delivery_note_len: 'deliveryNote',
  orders_cancellation_reason_len: 'reason',
  order_status_history_reason_len: 'reason',
  support_tickets_subject_len: 'ticketSubject',
  support_tickets_body_len: 'ticketBody',
  support_tickets_resolution_len: 'ticketResolution',
  reviews_comment_len: 'reviewComment',
  canteens_name_len: 'canteenName',
  canteens_description_len: 'description',
  canteens_phone_len: 'phone',
  menu_items_name_len: 'menuItemName',
  menu_items_description_len: 'description',
  hostels_name_len: 'hostelName',
  coupons_code_len: 'couponCode',
};

describe('TEXT_LIMITS matches the database', () => {
  it.each(Object.entries(CONSTRAINTS))('%s', (constraint, limit) => {
    const match = new RegExp(
      `constraint ${constraint} check \\(char_length\\(\\w+\\) <= (\\d+)\\)`,
    ).exec(MIGRATION);
    expect(match, `${constraint} not found`).not.toBeNull();
    expect(Number(match![1])).toBe(TEXT_LIMITS[limit]);
  });

  it('holds every picture link to the same length', () => {
    const lengths = [...MIGRATION.matchAll(/char_length\((\w+_url)\) <= (\d+)/g)];
    expect(lengths).toHaveLength(3);
    for (const [, , n] of lengths) expect(Number(n)).toBe(TEXT_LIMITS.url);
  });
});

describe('isHttpsUrl agrees with the database', () => {
  let db: Db;
  beforeAll(async () => {
    db = await createTestDb();
  });
  afterAll(async () => {
    await db?.close();
  });

  const pattern = /image_url ~\* '([^']+)'/.exec(MIGRATION)![1]!;

  it.each([
    'https://images.example.com/a.png',
    'HTTPS://EXAMPLE.COM',
    'https://cdn.example.com/p?w=200#x',
    'http://example.com/a.png',
    'javascript:alert(1)',
    'data:image/png;base64,AA',
    'https://',
    'https:///path',
    'https://exa mple.com',
    ' https://example.com',
    'ftp://example.com',
  ])('%s', async (url) => {
    const { rows } = await db.query<{ ok: boolean }>(`select $1 ~* $2 as ok`, [url, pattern]);
    expect(isHttpsUrl(url)).toBe(rows[0]!.ok);
  });
});
