/**
 * Minimal migration runner: applies sql/*.sql files in order against
 * DATABASE_URL, tracked in a `_migrations` table so re-running is safe.
 * Deliberately simple (no rollback support) — this is a scaffold; swap
 * in a proper migration tool (node-pg-migrate, Kysely's migrator) once
 * the schema is evolving under real usage.
 */
import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import { Client } from "pg";
import fs from "fs";

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS "_migrations" (
      "name" TEXT PRIMARY KEY,
      "appliedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const sqlDir = path.resolve(__dirname, "../sql");
  const files = fs.readdirSync(sqlDir).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    const { rows } = await client.query('SELECT 1 FROM "_migrations" WHERE "name" = $1', [file]);
    if (rows.length > 0) {
      console.log(`skip (already applied): ${file}`);
      continue;
    }
    console.log(`applying: ${file}`);
    const sql = fs.readFileSync(path.join(sqlDir, file), "utf-8");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query('INSERT INTO "_migrations" ("name") VALUES ($1)', [file]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  }

  await client.end();
  console.log("Migrations complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
