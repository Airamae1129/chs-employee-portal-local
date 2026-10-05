import { authenticator } from "otplib";
import QRCode from "qrcode";

// Accept the previous and next 30-second step too, for phone clock drift.
authenticator.options = { window: 1 };

const ISSUER = "CHS Employee Portal";

export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

export async function totpSetupPayload(email: string, secret: string) {
  const otpauthUrl = authenticator.keyuri(email, ISSUER, secret);
  return { secret, otpauthUrl, qrDataUrl: await QRCode.toDataURL(otpauthUrl) };
}

/**
 * Returns the matched time step, or null if the code is wrong. Callers
 * store the step and reject anything at or before it, so a code someone
 * shoulder-surfed can't be replayed within its 30-second window.
 */
export function matchTotpStep(code: string, secret: string): number | null {
  const token = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(token)) return null;
  const delta = authenticator.checkDelta(token, secret);
  if (delta === null) return null;
  return Math.floor(Date.now() / 30_000) + delta;
}
