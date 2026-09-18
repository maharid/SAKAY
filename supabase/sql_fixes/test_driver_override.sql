-- Temporarily override all security for testing drivers
DROP POLICY IF EXISTS "Test drivers can accept bookings" ON public.booking;

CREATE POLICY "Test drivers can accept bookings" 
ON public.booking 
FOR UPDATE 
TO public 
USING (true)
WITH CHECK (true);
