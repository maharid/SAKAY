-- 1. Create a dummy user in auth.users so we can satisfy the foreign key constraint
INSERT INTO auth.users (
  id,
  instance_id,
  email,
  aud,
  role,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin
)
SELECT 
  '22222222-2222-2222-2222-222222222222', 
  '00000000-0000-0000-0000-000000000000', 
  'testdriver@sakay.local', 
  'authenticated', 
  'authenticated', 
  now(), 
  now(), 
  '{"provider":"email","providers":["email"]}', 
  '{}', 
  false
WHERE NOT EXISTS (
  SELECT 1 FROM auth.users WHERE id = '22222222-2222-2222-2222-222222222222'
);

-- 2. Insert the real test driver in the public.driver table using the auth ID we just made
INSERT INTO public.driver (
  driver_id,
  auth_user_id,
  full_name,
  contact_number,
  account_status,
  toda_id
)
SELECT 
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  'Juan Dela Cruz (Test)',
  '+639123456789',
  'Verified',
  (SELECT toda_id FROM public.toda LIMIT 1)
WHERE NOT EXISTS (
  SELECT 1 FROM public.driver WHERE driver_id = '11111111-1111-1111-1111-111111111111'
);

-- 3. Drop the restrictive test rules we made earlier
DROP POLICY IF EXISTS "Test drivers can accept bookings" ON public.booking;
DROP POLICY IF EXISTS "Test drivers can ONLY accept pending rides" ON public.booking;

-- 4. Create an open, fully permissive rule for your testing phase
CREATE POLICY "Test Driver Unrestricted Access" 
ON public.booking 
FOR UPDATE 
TO public 
USING (true)
WITH CHECK (true);
