-- Removes one passenger account so the number can register again.
-- BEFORE RUNNING: replace the placeholder 09XXXXXXXXX (and its +63 / 63 forms) below with the number to reset. Run it in the Supabase SQL editor.
-- As written, the placeholders match nothing, so running it unchanged deletes nothing.

-- 1. Delete the passenger profile
DELETE FROM public.passenger
WHERE contact_number IN ('09XXXXXXXXX', '+639XXXXXXXXX', '639XXXXXXXXX');

-- 2. Delete the user from the Supabase Authentication system
DELETE FROM auth.users
WHERE phone IN ('09XXXXXXXXX', '+639XXXXXXXXX', '639XXXXXXXXX')
OR email IN (
    'passenger_+639XXXXXXXXX@sakay.ph',
    'passenger_09XXXXXXXXX@sakay.ph',
    'passenger_639XXXXXXXXX@sakay.ph',
    'test_+639XXXXXXXXX@sakay.ph',
    '+639XXXXXXXXX@sakay.ph'
);
