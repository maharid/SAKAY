-- Function to recalculate driver rating
CREATE OR REPLACE FUNCTION public.update_driver_rating()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.driver
    SET weighted_average_rating = (
        SELECT ROUND(AVG(stars)::numeric, 2)
        FROM public.rating
        WHERE ratee_id = NEW.ratee_id
    )
    WHERE driver_id = NEW.ratee_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to run after every new rating
DROP TRIGGER IF EXISTS trigger_update_driver_rating ON public.rating;
CREATE TRIGGER trigger_update_driver_rating
AFTER INSERT OR UPDATE ON public.rating
FOR EACH ROW
EXECUTE FUNCTION public.update_driver_rating();
