-- 1. Allow drivers to see pending bookings
CREATE POLICY "Drivers can view pending bookings" 
ON public.booking 
FOR SELECT 
TO authenticated 
USING (booking_status = 'Pending');

-- 2. Allow drivers to accept a pending booking (update driver_id to themselves)
CREATE POLICY "Drivers can accept pending bookings" 
ON public.booking 
FOR UPDATE 
TO authenticated 
USING (booking_status = 'Pending' AND driver_id IS NULL)
WITH CHECK (driver_id = (SELECT driver_id FROM public.driver WHERE auth_user_id = auth.uid()));
