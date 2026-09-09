import { Role, Country } from "@chs/db";

/** Shape of the JWT payload issued at login and read on every request. */
export interface SessionClaims {
  sub: string; // user id
  role: Role;
  country: Country;
  name: string;
  email: string;
  iat: number;
  exp: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionClaims;
    }
  }
}
