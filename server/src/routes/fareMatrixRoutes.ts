import { Router } from 'express';
import { forbidDirectFareChange } from './disabledEndpoints';

const router = Router();

// Rule 6.3: only the LGU Administrator may change the fare, and only through public.enact_fare_matrix() in the
// database (role check, forward-only effective time, audit entry). This route used to accept an unauthenticated
// POST, write with the service-role key, deactivate the live rule first and fall back to in-memory fake rates.
// Every method and path now answers 403. The LGU portal calls the Supabase function directly.
router.use(forbidDirectFareChange);

export default router;
