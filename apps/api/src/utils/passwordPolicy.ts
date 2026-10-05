import { z } from "zod";

// 8-16 chars, at least one uppercase, one lowercase, one number, one symbol.
export const STRONG_PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,16}$/;
export const STRONG_PASSWORD_MESSAGE =
  "Password must be 8-16 characters and include an uppercase letter, a lowercase letter, a number, and a symbol.";

export const strongPassword = z.string().regex(STRONG_PASSWORD_REGEX, STRONG_PASSWORD_MESSAGE);
