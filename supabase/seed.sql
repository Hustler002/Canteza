-- CampusEats seed: campus reference data.
--
-- User accounts are NOT created here. Inserting into auth.users by hand breaks
-- whenever GoTrue changes its schema (auth.identities.provider_id is the usual
-- casualty), so accounts are created through the Auth API by supabase/seed-users.mjs,
-- which then places a few demo orders through the real RPCs.
--
-- IDs are fixed so that script can reference them.

-- ---------------------------------------------------------------------------
-- platform settings  (overrides PLATFORM_DEFAULTS in packages/shared/src/config.ts)
-- ---------------------------------------------------------------------------

insert into public.platform_settings (key, value) values
  ('delivery_fee_paise',    '1000'),  -- ₹10
  ('packaging_fee_paise',   '0'),
  ('partner_payout_paise',  '800'),   -- ₹8 of the ₹10 goes to the partner
  ('max_quantity_per_item', '20'),
  ('max_items_per_order',   '50')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- hostels
-- ---------------------------------------------------------------------------

insert into public.hostels (id, name, blocks) values
  ('a0000000-0000-4000-8000-000000000001', 'Aryabhatta Hostel',     array['A', 'B', 'C']),
  ('a0000000-0000-4000-8000-000000000002', 'Ramanujan Hostel',      array['A', 'B']),
  ('a0000000-0000-4000-8000-000000000003', 'Kalpana Chawla Hostel', array['A', 'B', 'C', 'D']),
  ('a0000000-0000-4000-8000-000000000004', 'Vivekananda Hostel',    array['A', 'B', 'C'])
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- canteens
-- ---------------------------------------------------------------------------

insert into public.canteens (id, name, description, opens_at, closes_at, min_order_paise, phone) values
  ('c0000000-0000-4000-8000-000000000001', 'Main Canteen',
   'The big one near the academic block. Thalis, rolls and everything fried.',
   '08:00', '22:00', 5000, '+91 98100 00001'),
  ('c0000000-0000-4000-8000-000000000002', 'Hostel Canteen',
   'Breakfast, chai and Maggi, a two-minute walk from your room.',
   '07:00', '23:30', 3000, '+91 98100 00002'),
  ('c0000000-0000-4000-8000-000000000003', 'Night Canteen',
   'Open when nothing else is. Rolls, fries and cold coffee until 2am.',
   '20:00', '02:00', 5000, '+91 98100 00003'),
  ('c0000000-0000-4000-8000-000000000004', 'Juice Corner',
   'Fresh juices and shakes by the sports ground.',
   '09:00', '21:00', 0, '+91 98100 00004')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- categories
-- ---------------------------------------------------------------------------

insert into public.food_categories (id, name, sort_order) values
  ('f0000000-0000-4000-8000-000000000001', 'Breakfast', 1),
  ('f0000000-0000-4000-8000-000000000002', 'Snacks',    2),
  ('f0000000-0000-4000-8000-000000000003', 'Meals',     3),
  ('f0000000-0000-4000-8000-000000000004', 'Beverages', 4),
  ('f0000000-0000-4000-8000-000000000005', 'Desserts',  5)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- menu  (prices in paise; ₹40 = 4000)
-- ---------------------------------------------------------------------------

insert into public.menu_items (canteen_id, category_id, name, description, price_paise, is_veg, sort_order) values
  -- Main Canteen
  ('c0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000002', 'Masala Maggi',   'Two-minute noodles, ten-minute queue.',        4000, true,  1),
  ('c0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000002', 'Veg Maggi',      'Plain, hot, dependable.',                      3500, true,  2),
  ('c0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000002', 'Samosa',         'Two pieces with green chutney.',               1500, true,  3),
  ('c0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000002', 'Paneer Roll',    'Paneer tikka in a hot paratha.',               7000, true,  4),
  ('c0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000002', 'Veg Burger',     'Aloo patty, lettuce, mayo.',                   6000, true,  5),
  ('c0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000003', 'Chole Bhature',  'Two bhature, chole, pickle.',                  8000, true,  6),
  ('c0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000003', 'Rajma Rice',     'Comfort food, hostel edition.',                9000, true,  7),
  ('c0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000003', 'Veg Thali',      'Dal, sabzi, rice, four rotis, salad.',        11000, true,  8),
  ('c0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000004', 'Tea',            'Cutting chai.',                                1200, true,  9),
  ('c0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000004', 'Cold Coffee',    'Thick, cold, over-sweet. As intended.',        6000, true, 10),

  -- Hostel Canteen
  ('c0000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000001', 'Aloo Paratha',   'Two parathas with curd and achaar.',           4500, true,  1),
  ('c0000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000001', 'Poha',           'Light, quick, with sev.',                      3000, true,  2),
  ('c0000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000001', 'Bread Omelette', 'Two eggs, four slices.',                       4000, false, 3),
  ('c0000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000002', 'Masala Maggi',   'The hostel default.',                          4000, true,  4),
  ('c0000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000002', 'Veg Maggi',      'Plain and fast.',                              3500, true,  5),
  ('c0000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000004', 'Tea',            'Round the clock.',                             1000, true,  6),
  ('c0000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000004', 'Coffee',         'Instant, milky.',                              2000, true,  7),

  -- Night Canteen
  ('c0000000-0000-4000-8000-000000000003', 'f0000000-0000-4000-8000-000000000002', 'Chicken Roll',   'The 1am order.',                              12000, false, 1),
  ('c0000000-0000-4000-8000-000000000003', 'f0000000-0000-4000-8000-000000000002', 'Egg Roll',       'Double egg, extra onion.',                     6500, false, 2),
  ('c0000000-0000-4000-8000-000000000003', 'f0000000-0000-4000-8000-000000000002', 'Paneer Roll',    'Veg option, equally late.',                    8000, true,  3),
  ('c0000000-0000-4000-8000-000000000003', 'f0000000-0000-4000-8000-000000000002', 'French Fries',   'Peri peri masala on request.',                 7000, true,  4),
  ('c0000000-0000-4000-8000-000000000003', 'f0000000-0000-4000-8000-000000000002', 'Maggi',          'Extra spicy after midnight.',                  4500, true,  5),
  ('c0000000-0000-4000-8000-000000000003', 'f0000000-0000-4000-8000-000000000004', 'Cold Coffee',    'Caffeine for the deadline.',                   7000, true,  6),

  -- Juice Corner
  ('c0000000-0000-4000-8000-000000000004', 'f0000000-0000-4000-8000-000000000004', 'Fresh Lime Soda','Sweet, salted or mixed.',                      3500, true,  1),
  ('c0000000-0000-4000-8000-000000000004', 'f0000000-0000-4000-8000-000000000004', 'Watermelon Juice','Seasonal and very cold.',                     4500, true,  2),
  ('c0000000-0000-4000-8000-000000000004', 'f0000000-0000-4000-8000-000000000005', 'Banana Shake',   'Thick, no sugar added.',                       5000, true,  3),
  ('c0000000-0000-4000-8000-000000000004', 'f0000000-0000-4000-8000-000000000005', 'Mango Shake',    'Alphonso when in season.',                     6000, true,  4),
  ('c0000000-0000-4000-8000-000000000004', 'f0000000-0000-4000-8000-000000000005', 'Oreo Shake',     'Dessert pretending to be a drink.',            8000, true,  5)
on conflict (canteen_id, name) do nothing;

-- ---------------------------------------------------------------------------
-- coupons
-- ---------------------------------------------------------------------------

insert into public.coupons
  (code, kind, amount_paise, percent_off, max_discount_paise, min_order_paise, per_student_limit, max_redemptions)
values
  ('FIRST50', 'percent', null, 50, 5000,  10000, 1, 500),
  ('FLAT20',  'flat',    2000, null, null, 15000, 3, null),
  ('NIGHT10', 'flat',    1000, null, null,  8000, 5, null)
on conflict (code) do nothing;
