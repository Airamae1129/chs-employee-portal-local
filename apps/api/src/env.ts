import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  // Render (and most PaaS hosts) inject PORT and require the app to bind
  // to it; API_PORT is the local-dev override so it doesn't collide with
  // other copies of this project running on the same machine.
  apiPort: parseInt(process.env.PORT ?? process.env.API_PORT ?? "4000", 10),
  webOrigin: required("WEB_ORIGIN", "http://localhost:3000"),
  // Public address of this API, used to build file links returned to the browser.
  // Render provides RENDER_EXTERNAL_URL automatically; locally it falls back to localhost.
  publicApiUrl: (
    process.env.PUBLIC_API_URL ??
    process.env.RENDER_EXTERNAL_URL ??
    `http://localhost:${parseInt(process.env.PORT ?? process.env.API_PORT ?? "4000", 10)}`
  ).replace(/\/+$/, ""),

  jwtSecret: required("JWT_SECRET", "dev-only-insecure-secret-change-me"),
  sessionTtlHours: parseInt(process.env.SESSION_TTL_HOURS ?? "12", 10),
  allowPasswordLogin: (process.env.ALLOW_PASSWORD_LOGIN ?? "true") === "true",

  entra: {
    tenantId: process.env.ENTRA_TENANT_ID ?? "",
    clientId: process.env.ENTRA_CLIENT_ID ?? "",
    clientSecret: process.env.ENTRA_CLIENT_SECRET ?? "",
    redirectUri: process.env.ENTRA_REDIRECT_URI ?? "",
  },

  teams: {
    webhookUrl: process.env.TEAMS_WEBHOOK_URL ?? "",
    portalBaseUrl: process.env.PORTAL_BASE_URL ?? "http://localhost:3000",
  },

  storage: {
    driver: (process.env.STORAGE_DRIVER as "local" | "s3") ?? "local",
    localDir: process.env.STORAGE_LOCAL_DIR ?? "../../storage",
    signedUrlTtlMinutes: parseInt(process.env.STORAGE_SIGNED_URL_TTL_MINUTES ?? "10", 10),
    s3: {
      bucket: process.env.S3_BUCKET ?? "",
      region: process.env.S3_REGION ?? "",
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
      endpoint: process.env.S3_ENDPOINT ?? "",
    },
  },
};

export const isEntraConfigured =
  !!env.entra.tenantId && !!env.entra.clientId && !!env.entra.clientSecret;
