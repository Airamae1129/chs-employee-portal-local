-- Self-service password reset and sign-in MFA.
--
-- Every sign-in needs a second factor. On their first sign-in after this
-- ships, users must enrol: pick a 6-digit code emailed to them, or an
-- authenticator app, and prove it works ("mfaEnrolledAt"). "mfaMethod" is
-- the factor offered first afterwards; email stays available as a fallback
-- so a lost phone never locks anyone out. "totpPendingSecret" holds a
-- secret during app setup until a valid code confirms it.
ALTER TABLE "User"
  ADD COLUMN "mfaMethod" TEXT NOT NULL DEFAULT 'EMAIL' CHECK ("mfaMethod" IN ('EMAIL', 'TOTP')),
  ADD COLUMN "mfaEnrolledAt" TIMESTAMPTZ,
  ADD COLUMN "totpSecret" TEXT,
  ADD COLUMN "totpPendingSecret" TEXT,
  ADD COLUMN "totpLastUsedStep" INTEGER,
  ADD COLUMN "mfaFailedCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "mfaLockedUntil" TIMESTAMPTZ;

-- One-time 6-digit codes sent by email. Only an HMAC of the code is stored.
CREATE TABLE "EmailCode" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "purpose" TEXT NOT NULL CHECK ("purpose" IN ('PASSWORD_RESET', 'LOGIN_MFA', 'CHANGE_PASSWORD')),
  "codeHash" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "consumedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "EmailCode_userId_purpose_createdAt_idx" ON "EmailCode"("userId", "purpose", "createdAt");
