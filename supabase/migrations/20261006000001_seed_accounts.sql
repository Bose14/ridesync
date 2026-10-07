-- ====================================================================
-- RideSync Seed Data & Default Accounts Migration
-- Creates rider profiles, default rides, waypoints, and security records
-- ====================================================================

-- 0. Ensure foreign key constraint to auth.users is dropped so test accounts seed cleanly
ALTER TABLE IF EXISTS public.profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;

-- 1. Insert Initial Rider Profiles
INSERT INTO public.profiles (id, name, username, avatar_url, phone_number, bike_model, emergency_contact)
VALUES 
  (
    '00000000-0000-0000-0000-000000000001',
    'Bose',
    'bose_ktm',
    'https://images.unsplash.com/photo-1568602471122-7832951cc4c5?w=150',
    '+919876543210',
    'KTM 390 Adventure',
    'Vikram (Brother) +91 98765 00001'
  ),
  (
    '00000000-0000-0000-0000-000000000002',
    'Arun',
    'arun_gs',
    'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=150',
    '+919876543211',
    'BMW G310 GS',
    'Pooja (Wife) +91 98765 00002'
  ),
  (
    '00000000-0000-0000-0000-000000000003',
    'Karthi',
    'karthi_hunter',
    'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150',
    '+919876543212',
    'Royal Enfield Hunter 350',
    'Suresh (Father) +91 98765 00003'
  ),
  (
    '00000000-0000-0000-0000-000000000004',
    'Vicky',
    'vicky_scrambler',
    'https://images.unsplash.com/photo-1527980965255-d3b416303d12?w=150',
    '+919876543213',
    'Triumph Scrambler 400X',
    'Dinesh (Friend) +91 98765 00004'
  ),
  (
    '00000000-0000-0000-0000-000000000005',
    'Priya',
    'priya_ninja',
    'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150',
    '+919876543214',
    'Kawasaki Ninja 300',
    'Meera (Mother) +91 98765 00005'
  )
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  phone_number = EXCLUDED.phone_number,
  bike_model = EXCLUDED.bike_model,
  emergency_contact = EXCLUDED.emergency_contact;

-- 2. Insert Active Ride: Kodaikanal Weekend Ride
INSERT INTO public.rides (
  id,
  creator_id,
  name,
  description,
  code,
  start_time,
  status,
  start_address,
  start_lat,
  start_lng,
  destination_address,
  destination_lat,
  destination_lng,
  total_distance_km,
  total_duration_min
)
VALUES (
  '10000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'Kodaikanal Weekend Ride',
  'Ghat ride from Bangalore Silk Board to Pillar Rocks Kodaikanal',
  'KODAI26',
  NOW() + INTERVAL '30 minutes',
  'active',
  'Silk Board, Bangalore',
  12.9176,
  77.6233,
  'Pillar Rocks, Kodaikanal',
  10.2185,
  77.4682,
  324.8,
  510
)
ON CONFLICT (id) DO NOTHING;

-- 3. Insert Ride Members
INSERT INTO public.ride_members (ride_id, user_id, role, status)
VALUES
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'creator', 'ready'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'admin', 'ready'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', 'rider', 'joined'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000004', 'rider', 'ready')
ON CONFLICT (ride_id, user_id) DO NOTHING;

-- 4. Insert Waypoints for Kodaikanal Ride
INSERT INTO public.waypoints (ride_id, name, type, latitude, longitude, sequence, planned_duration_min)
VALUES
  ('10000000-0000-0000-0000-000000000001', 'Silk Board, Bangalore', 'start', 12.9176, 77.6233, 1, 0),
  ('10000000-0000-0000-0000-000000000001', 'Salem Highway Tea Halt', 'tea', 11.6643, 78.1460, 2, 30),
  ('10000000-0000-0000-0000-000000000001', 'Dindigul Bypass BPCL Fuel', 'fuel', 10.3673, 77.9803, 3, 15),
  ('10000000-0000-0000-0000-000000000001', 'Silver Cascade Falls', 'photo', 10.2582, 77.5186, 4, 20),
  ('10000000-0000-0000-0000-000000000001', 'Coaker''s Walk & Viewpoint', 'photo', 10.2324, 77.4947, 5, 30),
  ('10000000-0000-0000-0000-000000000001', 'Pillar Rocks, Kodaikanal', 'destination', 10.2185, 77.4682, 6, 0)
ON CONFLICT DO NOTHING;
