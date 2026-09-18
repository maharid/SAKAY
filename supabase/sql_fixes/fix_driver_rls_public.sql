-- 1. Allow EVERYONE (including test drivers/anon) to see pending bookings
CREATE POLICY "Drivers can view pending bookings" 
ON public.booking 
FOR SELECT 
TO public 
USING (booking_status = 'Pending');

-- 2. Allow EVERYONE (including test drivers/anon) to accept a pending booking
CREATE POLICY "Drivers can accept pending bookings" 
ON public.booking 
FOR UPDATE 
TO public 
USING (booking_status = 'Pending' AND driver_id IS NULL)
WITH CHECK (
  driver_id = (SELECT driver_id FROM public.driver WHERE auth_user_id = auth.uid()) 
  OR driver_id IS NULL
);
