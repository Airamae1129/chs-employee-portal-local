import fs from "fs";
import path from "path";
import crypto from "crypto";
import { env } from "../env";

/**
 * Storage adapter interface — deliberately S3-shaped so swapping
 * STORAGE_DRIVER=local for STORAGE_DRIVER=s3 later only means
 * implementing this interface against an S3-compatible SDK client
 * (see the commented sketch at the bottom of this file) and nothing in
 * the route handlers has to change.
 *
 * Section 9 requires policy/payslip files to never be served from
 * public URLs — putObject stores by key, and getSignedUrl returns a
 * short-lived, tokenized URL instead of a permanent public link.
 */
export interface StorageAdapter {
  putObject(key: string, data: Buffer, contentType: string): Promise<void>;
  getObject(key: string): Promise<Buffer>;
  getSignedUrl(key: string, ttlMinutes?: number): Promise<string>;
}

const SIGNING_SECRET = env.jwtSecret; // reuse app secret for local HMAC signing

export function verifyLocalSignedUrl(key: string, expires: number, sig: string): boolean {
  if (Number.isNaN(expires) || Date.now() > expires) return false;
  const payload = `${key}:${expires}`;
  const expected = crypto.createHmac("sha256", SIGNING_SECRET).update(payload).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

class LocalStorageAdapter implements StorageAdapter {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = path.resolve(__dirname, "../../", baseDir);
    fs.mkdirSync(this.baseDir, { recursive: true });
  }

  private resolveKey(key: string): string {
    const resolved = path.resolve(this.baseDir, key);
    if (!resolved.startsWith(this.baseDir)) {
      throw new Error("Invalid storage key (path traversal attempt)");
    }
    return resolved;
  }

  async putObject(key: string, data: Buffer, _contentType: string): Promise<void> {
    const full = this.resolveKey(key);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, data);
  }

  async getObject(key: string): Promise<Buffer> {
    return fs.readFileSync(this.resolveKey(key));
  }

  /**
   * Local dev stand-in for a real signed URL: an HMAC token + expiry in
   * the query string, verified by GET /files/:key in
   * src/routes/files.ts. Not a substitute for real S3 presigned URLs in
   * production, but keeps the "no public URLs" contract intact locally.
   */
  async getSignedUrl(key: string, ttlMinutes = env.storage.signedUrlTtlMinutes): Promise<string> {
    const expires = Date.now() + ttlMinutes * 60 * 1000;
    const payload = `${key}:${expires}`;
    const sig = crypto.createHmac("sha256", SIGNING_SECRET).update(payload).digest("hex");
    return `${env.publicApiUrl}/files/${encodeURIComponent(key)}?expires=${expires}&sig=${sig}`;
  }
}

let adapter: StorageAdapter | null = null;

export function getStorageAdapter(): StorageAdapter {
  if (adapter) return adapter;
  if (env.storage.driver === "s3") {
    throw new Error(
      "STORAGE_DRIVER=s3 is not wired up yet. Implement StorageAdapter against " +
        "@aws-sdk/client-s3 (putObject -> PutObjectCommand, getObject -> " +
        "GetObjectCommand, getSignedUrl -> getSignedUrl(s3, new GetObjectCommand(...))) " +
        "using env.storage.s3, then return it here."
    );
  }
  adapter = new LocalStorageAdapter(env.storage.localDir);
  return adapter;
}

/*
 * Sketch for the S3 adapter, for when a bucket is provisioned:
 *
 * import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
 * import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
 *
 * class S3StorageAdapter implements StorageAdapter {
 *   private client = new S3Client({ region: env.storage.s3.region, endpoint: env.storage.s3.endpoint || undefined });
 *   async putObject(key, data, contentType) {
 *     await this.client.send(new PutObjectCommand({ Bucket: env.storage.s3.bucket, Key: key, Body: data, ContentType: contentType }));
 *   }
 *   async getObject(key) { ... GetObjectCommand ... }
 *   async getSignedUrl(key, ttlMinutes) {
 *     return getSignedUrl(this.client, new GetObjectCommand({ Bucket: env.storage.s3.bucket, Key: key }), { expiresIn: ttlMinutes * 60 });
 *   }
 * }
 */
