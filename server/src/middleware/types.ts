/**
 * What the authentication middleware puts on a request. The identity always comes from the verified token and the database,
 * never from the request body or query string.
 */
export interface AuthContext {
  /** auth.users.id of the signed-in account (from a token Supabase Auth has just verified) */
  userId: string;
  email: string | null;
}

export interface PassengerActor {
  passengerId: string;
  accountStatus: string;
  contactNumber: string | null;
}

export interface DriverActor {
  driverId: string;
  accountStatus: string;
  contactNumber: string | null;
  todaId: string | null;
  fullName: string | null;
}

export interface TodaAdminActor {
  adminId: string;
  todaId: string;
  accountStatus: string;
}

export interface LguAdminActor {
  adminId: string;
  accountStatus: string;
}

/** The role rows that belong to the signed-in account (any of them may be null). Read from the database with the service role. */
export interface Actor {
  userId: string;
  passenger: PassengerActor | null;
  driver: DriverActor | null;
  todaAdmin: TodaAdminActor | null;
  lguAdmin: LguAdminActor | null;
}

export type Role = 'lgu' | 'toda' | 'driver' | 'passenger';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
      actor?: Actor;
    }
  }
}
