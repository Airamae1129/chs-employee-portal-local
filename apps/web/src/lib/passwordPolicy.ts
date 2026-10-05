// Mirrors apps/api/src/utils/passwordPolicy.ts so the form can explain the rule before submitting.
// 8-16 chars, at least one uppercase, one lowercase, one number, one symbol.
export const STRONG_PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,16}$/;
export const STRONG_PASSWORD_MESSAGE =
  "Password must be 8-16 characters and include an uppercase letter, a lowercase letter, a number, and a symbol.";
export const STRONG_PASSWORD_HINT = "8-16 characters, with an uppercase letter, a lowercase letter, a number, and a symbol.";
